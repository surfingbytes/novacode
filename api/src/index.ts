// node_modules
import type { FastifyInstance } from 'fastify';

// classes
import { buildApp } from './app';
import {
  assertBootConfig,
  clearAgentMcpAutoloadFiles,
  config,
  scrubServerSecretsFromEnv,
  writeGlobalGitConfig
} from './classes/config';
import { db } from './classes/database';
import { prisma } from './classes/db/client';
import { sessionManager } from './classes/sessionManager';
import { workspaceTerminalManager } from './classes/workspaceTerminalManager';
import { runWorkspacePathMigrations } from './classes/workspacePathMigration';
import { startAutomationScheduler, stopAutomationScheduler } from './classes/automationScheduler';
import { startCiWatcher, stopCiWatcher } from './classes/ciWatcher';
import { ensureVapidKeys } from './classes/push';
import { ensureSshKey } from './classes/sshKey';
import { logger } from './classes/logger';
import { applyReachableMcpAutoload } from './classes/mcpServersForAcp';
import { signalStartupReady } from './classes/startupStatus';
import { warmupAgentOptions } from './classes/agentOptions';
import { isLocalLoginEnabled, readOidcSettings } from './classes/oidc';
import { cancelAllRuns, startClaudeAutoContinue, stopClaudeAutoContinue } from './classes/chatEngine';
import { closeAllAcpSessions } from './classes/acpSessionClose';
import { cancelAllOrchestratorRuns } from './classes/orchestratorRunner';

// routes
import { broadcastServerShutdown } from './classes/wsBroadcast';

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection');
});

// State is unknown after an uncaught exception: exit and let Docker restart the container.
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception, exiting');
  logger.flush();
  process.exit(1);
});

/** Hard limit for graceful shutdown; past it the process exits with code 1. */
const SHUTDOWN_DEADLINE_MS = 15_000;
const SHUTDOWN_REASON = 'server shutdown';

// --------------------------------------------- Methods ---------------------------------------------

/** Run one shutdown part; a failure is logged and the rest still runs. */
async function shutdownPart(what: string, fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error({ err }, `shutdown: ${what} failed`);
  }
}

let bShuttingDown = false;

async function shutdown(fastify: FastifyInstance, signal: string): Promise<void> {
  if (bShuttingDown) {
    logger.warn(`${signal} received while already shutting down; ignoring`);
    return;
  }
  bShuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully`);
  setTimeout(() => {
    logger.fatal({ deadlineMs: SHUTDOWN_DEADLINE_MS }, 'Graceful shutdown timed out, exiting');
    logger.flush();
    process.exit(1);
  }, SHUTDOWN_DEADLINE_MS);

  // Stop accepting connections; fastify.close() below tolerates the already-closed server.
  fastify.server.close();
  broadcastServerShutdown();
  stopAutomationScheduler();
  stopCiWatcher();
  stopClaudeAutoContinue();
  // Orchestrators first: a step whose turn is cancelled before its run is failed would count as done.
  await shutdownPart('cancel orchestrator runs', () => cancelAllOrchestratorRuns(SHUTDOWN_REASON));
  await shutdownPart('cancel chat runs', () => cancelAllRuns(SHUTDOWN_REASON));
  await shutdownPart('close ACP sessions', () => closeAllAcpSessions(SHUTDOWN_REASON));
  await shutdownPart('stop PTY sessions', () => sessionManager.stopAll());
  await shutdownPart('stop workspace terminals', () => workspaceTerminalManager.stopAll());
  await shutdownPart('close server', () => fastify.close());
  await shutdownPart('disconnect database', () => prisma.$disconnect());
  logger.info('Shutdown complete');
  logger.flush();
  process.exit(0);
}

async function listen(fastify: FastifyInstance): Promise<void> {
  // reusePort lets this overlap the entrypoint progress server; signalStartupReady then tells that server to exit.
  try {
    await fastify.listen({
      port: config.port,
      host: '0.0.0.0',
      reusePort: true
    } as { port: number; host: string });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : undefined;
    if (code !== 'EADDRINUSE') {
      throw err;
    }
    signalStartupReady();
    await new Promise((r) => setTimeout(r, 400));
    await fastify.listen({ port: config.port, host: '0.0.0.0' });
  }
  signalStartupReady();
}

function startBackgroundServices(): void {
  startAutomationScheduler();
  startCiWatcher();
  startClaudeAutoContinue();

  void applyReachableMcpAutoload(config.configDir)
    .then((autoload) => {
      if (autoload.skipped.length > 0) {
        logger.warn(
          { skipped: autoload.skipped, enabled: autoload.enabled },
          'Some MCP servers are unreachable and were not loaded'
        );
      } else if (autoload.enabled.length > 0) {
        logger.info({ enabled: autoload.enabled }, 'MCP servers loaded for agents');
      }
    })
    .catch((err) => {
      logger.warn({ err }, 'MCP autoload probe failed');
    });

  void db
    .listUsers()
    .then((users) => users.find((user) => user.claudeToken)?.claudeToken ?? null)
    .catch((err) => {
      logger.warn({ err }, 'Failed to load Claude token for agent options warmup');
      return null;
    })
    .then((claudeToken) => {
      warmupAgentOptions({ claudeToken });
    });

  // assistant prose for global search (rows persisted before search_text existed)
  void db
    .backfillSessionMessageSearchText()
    .then((count) => {
      if (count > 0) {
        logger.info({ count }, 'Backfilled session message search text');
      }
    })
    .catch((err: unknown) => {
      logger.error({ err }, 'Failed to backfill session message search text');
    });
}

async function main(): Promise<void> {
  scrubServerSecretsFromEnv();
  try {
    assertBootConfig();
  } catch (err) {
    logger.fatal(`Invalid configuration: ${err instanceof Error ? err.message : String(err)}`);
    logger.flush();
    process.exit(1);
  }
  ensureVapidKeys();
  await ensureSshKey(config.configDir);
  try {
    clearAgentMcpAutoloadFiles(config.configDir);
  } catch (err) {
    logger.warn({ err }, 'Failed to clear agent MCP autoload files');
  }

  // browse-root / abs-prefix path migration (workspace rows + agent project caches)
  try {
    await runWorkspacePathMigrations(config.configDir);
  } catch (err) {
    logger.error({ err }, 'Failed to run workspace path migrations');
  }

  // write global .gitconfig with safe.directory and optional user identity
  const firstUser = await db.getFirstUser();
  writeGlobalGitConfig(
    config.configDir,
    firstUser?.gitUserName ?? null,
    firstUser?.gitUserEmail ?? null
  );

  const fastify = await buildApp();
  process.on('SIGTERM', () => void shutdown(fastify, 'SIGTERM'));
  process.on('SIGINT', () => void shutdown(fastify, 'SIGINT'));

  // recover stale orchestrator runs from previous process
  try {
    const failedCount = await db.failStaleRunningOrchestrators();
    if (failedCount > 0) {
      logger.info({ failedCount }, 'Marked running orchestrator runs from previous process as failed');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to mark stale orchestrator runs as failed');
  }

  startBackgroundServices();
  await listen(fastify);
  logger.info(`Server listening on port ${config.port}`);
  const oidcSettings = readOidcSettings();
  if (oidcSettings) {
    logger.info({ issuer: oidcSettings.issuer, localLogin: isLocalLoginEnabled() }, 'OIDC login enabled');
  } else if (!isLocalLoginEnabled()) {
    logger.warn('AUTH_LOCAL_LOGIN is disabled but OIDC is not configured');
  }
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start API');
  process.exit(1);
});

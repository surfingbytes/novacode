// node_modules
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// classes
import { registerAuth } from './classes/auth';
import { assertJwtSecret, clearAgentMcpAutoloadFiles, config, writeGlobalGitConfig } from './classes/config';
import { db } from './classes/database';
import { sessionManager } from './classes/sessionManager';
import { workspaceTerminalManager } from './classes/workspaceTerminalManager';

// routes
import { authRoutes } from './routes/auth';
import { workspaceRoutes } from './routes/workspaces';
import { agentAuthRoutes } from './routes/agentAuth';
import { wsRoutes, broadcastServerShutdown } from './routes/ws';
import { chatRoutes } from './routes/chat';
import { gitRoutes } from './routes/git';
import { fileRoutes } from './routes/files';
import { settingsRoutes } from './routes/settings';
import { sessionsRoutes } from './routes/sessions';
import { roleTemplateRoutes } from './routes/roleTemplates';
import { workspaceRuleRoutes } from './routes/workspaceRules';
import { orchestratorRoutes } from './routes/orchestrator';
import { automationRoutes } from './routes/automations';
import { startAutomationScheduler, stopAutomationScheduler } from './classes/automationScheduler';
import { imageRoutes } from './routes/images';
import { pushRoutes } from './routes/push';
import { searchRoutes } from './routes/search';
import { ensureVapidKeys } from './classes/push';
import { ensureSshKey } from './classes/sshKey';
import { logger } from './classes/logger';
import { resolveCorsOrigin } from './classes/corsOrigin';
import { applyReachableMcpAutoload } from './classes/mcpServersForAcp';
import { signalStartupReady } from './classes/startupStatus';

const startTime = Date.now();

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught exception');
});

/** Max JSON/raw body size for most routes. Default Fastify limit is 1MiB and returns 413.
 *  The attachment-upload route overrides this with config.uploadBodyLimitBytes (video-sized). */
const BODY_LIMIT_BYTES = 25 * 1024 * 1024;

// --------------------------------------------- Methods ---------------------------------------------

async function main(): Promise<void> {
  assertJwtSecret();
  ensureVapidKeys();
  ensureSshKey(config.configDir);
  try {
    clearAgentMcpAutoloadFiles(config.configDir);
  } catch (err) {
    logger.warn({ err }, 'Failed to clear agent MCP autoload files');
  }

  const trustProxy =
    process.env['TRUST_PROXY'] === '1' || process.env['TRUST_PROXY'] === 'true';
  const fastify = Fastify({ bodyLimit: BODY_LIMIT_BYTES, trustProxy, logger: { level: logger.level } });

  // plugins
  await fastify.register(fastifyHelmet, {
    // HSTS is off because many self-hosted installs are plain HTTP on a LAN.
    hsts: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-eval'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
        workerSrc: ["'self'", 'blob:'],
        childSrc: ["'self'", 'blob:'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    }
  });

  await fastify.register(fastifyCors, {
    origin: resolveCorsOrigin(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
  });

  await fastify.register(fastifyRateLimit, {
    global: false
  });

  await fastify.register(fastifyWebsocket, {
    options: {
      // Accept the bearer.<jwt> subprotocol so dashboard WS clients can
      // authenticate without putting the token in the URL.
      handleProtocols: (protocols: Set<string>): string | false => {
        for (const protocol of protocols) {
          if (protocol.startsWith('bearer.')) {
            return protocol;
          }
        }
        return false;
      }
    }
  });

  // auth decorator
  registerAuth(fastify);

  // routes
  await fastify.register(authRoutes);
  await fastify.register(workspaceRoutes);
  await fastify.register(agentAuthRoutes);
  await fastify.register(wsRoutes);
  await fastify.register(chatRoutes);
  await fastify.register(gitRoutes);
  await fastify.register(fileRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(sessionsRoutes);
  await fastify.register(roleTemplateRoutes);
  await fastify.register(workspaceRuleRoutes);
  await fastify.register(orchestratorRoutes);
  await fastify.register(automationRoutes);
  await fastify.register(imageRoutes);
  await fastify.register(pushRoutes);
  await fastify.register(searchRoutes);

  // health check (no auth, for monitoring/Docker HEALTHCHECK)
  fastify.get('/api/health', async (_request, reply) => {
    let dbOk = false;
    try {
      await db.pingDatabase();
      dbOk = true;
    } catch {
      // db not ok
    }
    const status = dbOk ? 'ok' : 'degraded';
    return reply.send({
      status,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      dbOk
    });
  });

  // serve dashboard SPA in production
  const dashboardDist = join(__dirname, '..', '..', 'dashboard-dist');
  if (existsSync(dashboardDist)) {
    logger.info('Dashboard dist found — serving dashboard');
    await fastify.register(fastifyStatic, {
      root: dashboardDist,
      prefix: '/'
    });
    fastify.setNotFoundHandler(async (_request, reply) => {
      return reply.sendFile('index.html');
    });
  } else {
    fastify.log.warn('Dashboard dist not found — serving API only');
  }

  // graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    fastify.log.info(`${signal} received, shutting down gracefully`);
    broadcastServerShutdown();
    stopAutomationScheduler();
    await new Promise((r) => setTimeout(r, 5000));
    sessionManager.stopAll();
    workspaceTerminalManager.stopAll();
    await fastify.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Bind as soon as routes are registered. reusePort lets this overlap the
  // entrypoint progress server; signalStartupReady then tells that server to exit.
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
  fastify.log.info(`Server listening on port ${config.port}`);

  void applyReachableMcpAutoload(config.configDir)
    .then((autoload) => {
      if (autoload.skipped.length > 0) {
        fastify.log.warn(
          { skipped: autoload.skipped, enabled: autoload.enabled },
          'Some MCP servers are unreachable and were not loaded'
        );
      } else if (autoload.enabled.length > 0) {
        fastify.log.info({ enabled: autoload.enabled }, 'MCP servers loaded for agents');
      }
    })
    .catch((err) => {
      fastify.log.warn({ err }, 'MCP autoload probe failed');
    });

  // recover stale orchestrator runs from previous process
  try {
    const failedCount = await db.failStaleRunningOrchestrators();
    if (failedCount > 0) {
      fastify.log.info(
        { failedCount },
        'Marked running orchestrator runs from previous process as failed'
      );
    }
  } catch (err) {
    fastify.log.error({ err }, 'Failed to mark stale orchestrator runs as failed');
  }

  // write global .gitconfig with safe.directory and optional user identity
  const firstUser = await db.getFirstUser();
  writeGlobalGitConfig(
    config.configDir,
    firstUser?.gitUserName ?? null,
    firstUser?.gitUserEmail ?? null
  );

  // automation scheduler
  startAutomationScheduler();

}

main().catch((err) => {
  logger.error({ err }, 'Failed to start API');
  process.exit(1);
});

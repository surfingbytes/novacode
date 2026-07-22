// node_modules
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// classes
import { registerAuth } from './classes/auth';
import { config, writeGlobalGitConfig } from './classes/config';
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

const startTime = Date.now();

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[process] uncaught exception:', err);
});

/** Max JSON/raw body size (e.g. session image uploads). Default Fastify limit is 1MiB and returns 413. */
const BODY_LIMIT_BYTES = 25 * 1024 * 1024;

// --------------------------------------------- Methods ---------------------------------------------

async function main(): Promise<void> {
  ensureVapidKeys();
  ensureSshKey(config.configDir);

  const fastify = Fastify({ bodyLimit: BODY_LIMIT_BYTES });

  // plugins
  await fastify.register(fastifyCors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
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

  // health check (no auth, for monitoring/Docker HEALTHCHECK)
  fastify.get('/api/health', async (_request, reply) => {
    let dbOk = false;
    try {
      await db.listWorkspaces();
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
    console.log('Dashboard dist found — serving dashboard');
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

  // write global .gitconfig with safe.directory and optional user identity
  const firstUser = await db.getFirstUser();
  writeGlobalGitConfig(
    config.configDir,
    firstUser?.gitUserName ?? null,
    firstUser?.gitUserEmail ?? null
  );

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

  // start listening
  await fastify.listen({ port: config.port, host: '0.0.0.0' });
  fastify.log.info(`Server listening on port ${config.port}`);

  // automation scheduler
  startAutomationScheduler();

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

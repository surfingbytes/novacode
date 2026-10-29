// node_modules
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// classes
import { registerAuth } from './classes/auth';
import { contentSecurityPolicyDirectives } from './classes/contentSecurityPolicy';
import { db } from './classes/database';
import { logger as sharedLogger } from './classes/logger';
import { resolveCorsOrigin } from './classes/corsOrigin';
import { registerErrorHandler } from './classes/errorHandler';

// routes
import { authRoutes } from './routes/auth';
import { workspaceRoutes } from './routes/workspaces';
import { sessionSpecRoutes } from './routes/sessionSpec';
import { novaMcpRoutes } from './routes/novaMcp';
import { agentAuthRoutes } from './routes/agentAuth';
import { wsRoutes } from './routes/ws';
import { chatRoutes } from './routes/chat';
import { gitRoutes } from './routes/git';
import { fileRoutes } from './routes/files';
import { settingsRoutes } from './routes/settings';
import { sessionsRoutes } from './routes/sessions';
import { roleTemplateRoutes } from './routes/roleTemplates';
import { workspaceRuleRoutes } from './routes/workspaceRules';
import { globalRuleRoutes } from './routes/globalRules';
import { orchestratorRoutes } from './routes/orchestrator';
import { automationRoutes } from './routes/automations';
import { imageRoutes } from './routes/images';
import { pushRoutes } from './routes/push';
import { forgeRoutes } from './routes/forge';
import { searchRoutes } from './routes/search';

/** Max JSON/raw body size for most routes. Default Fastify limit is 1MiB and returns 413.
 *  The attachment-upload route overrides this with config.uploadBodyLimitBytes (video-sized). */
const BODY_LIMIT_BYTES = 25 * 1024 * 1024;

const startTime = Date.now();

export interface BuildAppOptions {
  /** `false` disables logging; an object is pino options; omitted uses the shared pino logger. */
  logger?: boolean | object;
}

// --------------------------------------------- Methods ---------------------------------------------

function isApiPath(url: string): boolean {
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');
}

/**
 * Create the Fastify instance with all plugins, decorators and routes.
 * Does not listen, run migrations or write git config.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const trustProxy =
    process.env['TRUST_PROXY'] === '1' || process.env['TRUST_PROXY'] === 'true';
  // Typed as the base logger so route plugins (typed against FastifyInstance) accept the instance.
  const loggerOption =
    opts.logger === undefined ? { loggerInstance: sharedLogger as FastifyBaseLogger } : { logger: opts.logger };
  const fastify = Fastify({ bodyLimit: BODY_LIMIT_BYTES, trustProxy, ...loggerOption });

  registerErrorHandler(fastify);

  // plugins
  await fastify.register(fastifyHelmet, {
    // HSTS is off because many self-hosted installs are plain HTTP on a LAN.
    hsts: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    contentSecurityPolicy: { directives: contentSecurityPolicyDirectives }
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
  await fastify.register(globalRuleRoutes);
  await fastify.register(orchestratorRoutes);
  await fastify.register(sessionSpecRoutes);
  await fastify.register(novaMcpRoutes);
  await fastify.register(automationRoutes);
  await fastify.register(imageRoutes);
  await fastify.register(pushRoutes);
  await fastify.register(forgeRoutes);
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
  const bServeDashboard = existsSync(dashboardDist);
  if (bServeDashboard) {
    fastify.log.info('Dashboard dist found — serving dashboard');
    await fastify.register(fastifyStatic, {
      root: dashboardDist,
      prefix: '/'
    });
  } else {
    fastify.log.warn('Dashboard dist not found — serving API only');
  }

  // unknown /api/* paths answer JSON; everything else falls back to the SPA
  fastify.setNotFoundHandler(async (request, reply) => {
    if (bServeDashboard && !isApiPath(request.url)) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'Not found' });
  });

  return fastify;
}

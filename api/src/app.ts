// node_modules
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { Type } from '@sinclair/typebox';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// classes
import { registerAuth } from './classes/auth';
import { contentSecurityPolicyDirectives } from './classes/contentSecurityPolicy';
import { db } from './classes/database';
import { logger as sharedLogger } from './classes/logger';
import { resolveCorsOrigin } from './classes/corsOrigin';
import { registerErrorHandler } from './classes/errorHandler';
import { registerOpenApi, registerTaggedRoutes } from './classes/openapi';

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
import { usageRoutes } from './routes/usage';

/** Max JSON/raw body size for most routes. Default Fastify limit is 1MiB and returns 413.
 *  The attachment-upload route overrides this with config.uploadBodyLimitBytes (video-sized). */
const BODY_LIMIT_BYTES = 25 * 1024 * 1024;

const startTime = Date.now();

export interface BuildAppOptions {
  /** `false` disables logging; an object is pino options; omitted uses the shared pino logger. */
  logger?: boolean | object;
  /** Dashboard build to serve; defaults to `dashboard-dist` at the repo root. */
  dashboardDist?: string;
}

// --------------------------------------------- Methods ---------------------------------------------

function isApiPath(url: string): boolean {
  return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');
}

/** True when the last path segment (query string ignored) looks like a file, e.g. `/assets/a.js`. */
function hasFileExtension(url: string): boolean {
  const pathname = url.split('?')[0] ?? '';
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  return /\.[A-Za-z0-9]+$/.test(lastSegment);
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

  // OpenAPI collects routes via onRoute, so it must come before them
  await registerOpenApi(fastify);

  // routes (one OpenAPI tag per route file)
  await registerTaggedRoutes(fastify, 'auth', authRoutes);
  await registerTaggedRoutes(fastify, 'workspaces', workspaceRoutes);
  await registerTaggedRoutes(fastify, 'agent-auth', agentAuthRoutes);
  await registerTaggedRoutes(fastify, 'websocket', wsRoutes);
  await registerTaggedRoutes(fastify, 'chat', chatRoutes);
  await registerTaggedRoutes(fastify, 'git', gitRoutes);
  await registerTaggedRoutes(fastify, 'files', fileRoutes);
  await registerTaggedRoutes(fastify, 'settings', settingsRoutes);
  await registerTaggedRoutes(fastify, 'sessions', sessionsRoutes);
  await registerTaggedRoutes(fastify, 'role-templates', roleTemplateRoutes);
  await registerTaggedRoutes(fastify, 'workspace-rules', workspaceRuleRoutes);
  await registerTaggedRoutes(fastify, 'global-rules', globalRuleRoutes);
  await registerTaggedRoutes(fastify, 'orchestrator', orchestratorRoutes);
  await registerTaggedRoutes(fastify, 'session-spec', sessionSpecRoutes);
  await registerTaggedRoutes(fastify, 'nova-mcp', novaMcpRoutes);
  await registerTaggedRoutes(fastify, 'automations', automationRoutes);
  await registerTaggedRoutes(fastify, 'images', imageRoutes);
  await registerTaggedRoutes(fastify, 'push', pushRoutes);
  await registerTaggedRoutes(fastify, 'forge', forgeRoutes);
  await registerTaggedRoutes(fastify, 'search', searchRoutes);
  await registerTaggedRoutes(fastify, 'usage', usageRoutes);

  // health check (no auth, for monitoring/Docker HEALTHCHECK)
  const healthBody = Type.Object({
    status: Type.Union([Type.Literal('ok'), Type.Literal('degraded')]),
    uptime: Type.Integer(),
    dbOk: Type.Boolean()
  });
  const healthSchema = {
    tags: ['health'],
    security: [],
    response: {
      200: healthBody,
      503: healthBody
    }
  };
  fastify.get('/api/health', { schema: healthSchema }, async (_request, reply) => {
    let dbOk = false;
    try {
      await db.pingDatabase();
      dbOk = true;
    } catch {
      // db not ok
    }
    const status = dbOk ? 'ok' : 'degraded';
    // 503 makes Docker HEALTHCHECK (curl -fsS) fail while the database is unreachable
    return reply.code(dbOk ? 200 : 503).send({
      status,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      dbOk
    });
  });

  // serve dashboard SPA in production
  const dashboardDist = opts.dashboardDist ?? join(__dirname, '..', '..', 'dashboard-dist');
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

  // unknown /api/* paths and missing files answer JSON; client routes fall back to the SPA
  fastify.setNotFoundHandler(async (request, reply) => {
    if (bServeDashboard && !isApiPath(request.url) && !hasFileExtension(request.url)) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  return fastify;
}

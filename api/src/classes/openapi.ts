// node_modules
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

// classes
import { jwtPreHandler } from './auth';
import { SESSION_COOKIE_NAME } from './sessionCookie';

// --------------------------------------------- Functions ---------------------------------------------

/**
 * Register a route plugin in its own scope so every route it declares gets `tag` in the OpenAPI spec.
 */
export async function registerTaggedRoutes(
  fastify: FastifyInstance,
  tag: string,
  plugin: FastifyPluginAsync
): Promise<void> {
  await fastify.register(async (scope) => {
    scope.addHook('onRoute', (route) => {
      // Replace rather than mutate: route schemas are shared TypeBox objects.
      route.schema = { ...route.schema, tags: [tag] };
    });
    await scope.register(plugin);
  });
}

/**
 * OpenAPI spec generated from the route schemas. Must be registered before any route.
 * Spec at `GET /api/openapi.json`, Swagger UI at `/api/docs`; both need auth like the rest of the API.
 */
export async function registerOpenApi(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Nova Code API', version: '1.0.0' },
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: SESSION_COOKIE_NAME,
            description: 'httpOnly session cookie set by the dashboard login'
          },
          apiKey: {
            type: 'http',
            scheme: 'bearer',
            description: 'API key (`nck_…`) from Account → API keys'
          }
        }
      },
      // Every route needs one of these unless its schema sets `security: []`.
      security: [{ sessionCookie: [] }, { apiKey: [] }]
    }
  });

  // No inline scripts, so the UI runs under the helmet CSP (script-src 'self').
  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/api/docs',
    // Don't send the spec URL to swagger.io's online validator.
    uiConfig: { validatorUrl: null },
    uiHooks: { preHandler: jwtPreHandler }
  });

  fastify.get(
    '/api/openapi.json',
    { preHandler: jwtPreHandler, schema: { hide: true } },
    async (_request, reply) => reply.send(fastify.swagger())
  );
}

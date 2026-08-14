// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';

const SearchResultSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  type: Type.Union([
    Type.Literal('workspace'),
    Type.Literal('session'),
    Type.Literal('orchestrator'),
    Type.Literal('role-template'),
    Type.Literal('automation')
  ]),
  workspaceId: Type.Optional(Type.String()),
  workspaceName: Type.Optional(Type.String())
});

const SearchResponseSchema = Type.Object({
  workspaces: Type.Array(SearchResultSchema),
  sessions: Type.Array(SearchResultSchema),
  orchestrators: Type.Array(SearchResultSchema),
  roleTemplates: Type.Array(SearchResultSchema),
  automations: Type.Array(SearchResultSchema)
});

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  // -------------------------------------------------- Setup --------------------------------------------------
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // -------------------------------------------------- Routes --------------------------------------------------
  // GET /api/search — search across all resources
  fastifyInstance.get(
    '/api/search',
    {
      preHandler: jwtPreHandler,
      schema: {
        querystring: Type.Object({
          query: Type.String({ minLength: 1 })
        }),
        response: {
          200: SearchResponseSchema,
          400: Type.Object({ error: Type.String() }),
          500: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { query } = request.query as { query: string };

      if (!query || query.trim().length === 0) {
        return reply.code(400).send({ error: 'Query parameter is required' });
      }

      try {
        const results = await db.searchCatalog(query);
        return reply.send(results);
      } catch (error) {
        request.log.error({ err: error }, 'Search failed');
        return reply.status(500).send({ error: 'Failed to perform search' });
      }
    }
  );
}

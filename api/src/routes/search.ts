// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { SearchResponseSchema } from '@novacode/shared';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';

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
        return reply.code(500).send({ error: 'Failed to perform search' });
      }
    }
  );
}

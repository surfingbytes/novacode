// node_modules
import type { FastifyInstance } from 'fastify';

// classes
import { jwtPreHandler } from '../classes/auth';
import {
  deleteGlobalRuleFile,
  listGlobalRuleFiles,
  readGlobalRuleFile,
  renameGlobalRuleFile,
  writeGlobalRuleFile
} from '../classes/globalRules';
import type { RuleFileErrorCode } from '../classes/ruleFiles';

function mapErrorCodeToStatus(code: RuleFileErrorCode): number {
  switch (code) {
    case 'RULES_DIR_NOT_FOUND':
    case 'FILE_NOT_FOUND':
      return 404;
    case 'INVALID_FILENAME':
      return 400;
    case 'IO_ERROR':
    default:
      return 500;
  }
}

export async function globalRuleRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/global-rules', { preHandler: jwtPreHandler }, async (_request, reply) => {
    const result = await listGlobalRuleFiles();
    if (!result.ok) {
      return reply.status(mapErrorCodeToStatus(result.code)).send({
        error: result.message,
        code: result.code
      });
    }
    return reply.send(result.value);
  });

  fastify.get(
    '/api/global-rules/:filename',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { filename } = request.params as { filename: string };
      const result = await readGlobalRuleFile(filename);
      if (!result.ok) {
        return reply.status(mapErrorCodeToStatus(result.code)).send({
          error: result.message,
          code: result.code
        });
      }
      return reply.send(result.value);
    }
  );

  fastify.put(
    '/api/global-rules/:filename',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { filename } = request.params as { filename: string };
      const body = request.body as { content?: unknown };
      if (typeof body?.content !== 'string') {
        return reply.status(400).send({ error: 'content is required and must be a string' });
      }
      const result = await writeGlobalRuleFile(filename, body.content);
      if (!result.ok) {
        return reply.status(mapErrorCodeToStatus(result.code)).send({
          error: result.message,
          code: result.code
        });
      }
      return reply.send(result.value);
    }
  );

  fastify.delete(
    '/api/global-rules/:filename',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { filename } = request.params as { filename: string };
      const result = await deleteGlobalRuleFile(filename);
      if (!result.ok) {
        return reply.status(mapErrorCodeToStatus(result.code)).send({
          error: result.message,
          code: result.code
        });
      }
      return reply.send(result.value);
    }
  );

  fastify.patch(
    '/api/global-rules/:filename',
    { preHandler: jwtPreHandler },
    async (request, reply) => {
      const { filename } = request.params as { filename: string };
      const body = request.body as { newFilename?: unknown };
      if (typeof body?.newFilename !== 'string') {
        return reply.status(400).send({ error: 'newFilename is required and must be a string' });
      }
      const result = await renameGlobalRuleFile(filename, body.newFilename);
      if (!result.ok) {
        return reply.status(mapErrorCodeToStatus(result.code)).send({
          error: result.message,
          code: result.code
        });
      }
      return reply.send(result.value);
    }
  );
}

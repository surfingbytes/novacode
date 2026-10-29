// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

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

const FilenameParamsSchema = Type.Object({ filename: Type.String() });
const WriteBodySchema = Type.Object({ content: Type.String() });
const RenameBodySchema = Type.Object({ newFilename: Type.String() });

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
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  fastifyInstance.get('/api/global-rules', { preHandler: jwtPreHandler }, async (_request, reply) => {
    const result = await listGlobalRuleFiles();
    if (!result.ok) {
      return reply.code(mapErrorCodeToStatus(result.code)).send({
        error: result.message,
        code: result.code
      });
    }
    return reply.send(result.value);
  });

  fastifyInstance.get(
    '/api/global-rules/:filename',
    { preHandler: jwtPreHandler, schema: { params: FilenameParamsSchema } },
    async (request, reply) => {
      const { filename } = request.params;
      const result = await readGlobalRuleFile(filename);
      if (!result.ok) {
        return reply.code(mapErrorCodeToStatus(result.code)).send({
          error: result.message,
          code: result.code
        });
      }
      return reply.send(result.value);
    }
  );

  fastifyInstance.put(
    '/api/global-rules/:filename',
    { preHandler: jwtPreHandler, schema: { params: FilenameParamsSchema, body: WriteBodySchema } },
    async (request, reply) => {
      const { filename } = request.params;
      const result = await writeGlobalRuleFile(filename, request.body.content);
      if (!result.ok) {
        return reply.code(mapErrorCodeToStatus(result.code)).send({
          error: result.message,
          code: result.code
        });
      }
      return reply.send(result.value);
    }
  );

  fastifyInstance.delete(
    '/api/global-rules/:filename',
    { preHandler: jwtPreHandler, schema: { params: FilenameParamsSchema } },
    async (request, reply) => {
      const { filename } = request.params;
      const result = await deleteGlobalRuleFile(filename);
      if (!result.ok) {
        return reply.code(mapErrorCodeToStatus(result.code)).send({
          error: result.message,
          code: result.code
        });
      }
      return reply.send(result.value);
    }
  );

  fastifyInstance.patch(
    '/api/global-rules/:filename',
    { preHandler: jwtPreHandler, schema: { params: FilenameParamsSchema, body: RenameBodySchema } },
    async (request, reply) => {
      const { filename } = request.params;
      const result = await renameGlobalRuleFile(filename, request.body.newFilename);
      if (!result.ok) {
        return reply.code(mapErrorCodeToStatus(result.code)).send({
          error: result.message,
          code: result.code
        });
      }
      return reply.send(result.value);
    }
  );
}

// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import { jwtPreHandler } from '../classes/auth';
import {
  listWorkspaceRuleFiles,
  readWorkspaceRuleFile,
  writeWorkspaceRuleFile,
  deleteWorkspaceRuleFile,
  renameWorkspaceRuleFile,
  type WorkspaceRuleErrorCode
} from '../classes/workspaceRules';

const WorkspaceParamsSchema = Type.Object({ workspaceId: Type.String() });
const RuleFileParamsSchema = Type.Object({ workspaceId: Type.String(), filename: Type.String() });
const WriteBodySchema = Type.Object({ content: Type.String() });
const RenameBodySchema = Type.Object({ newFilename: Type.String() });

function mapErrorCodeToStatus(code: WorkspaceRuleErrorCode): number {
  switch (code) {
    case 'WORKSPACE_NOT_FOUND':
    case 'RULES_DIR_NOT_FOUND':
    case 'FILE_NOT_FOUND':
      return 404;
    case 'INVALID_FILENAME':
    case 'INVALID_WORKSPACE_PATH':
      return 400;
    case 'IO_ERROR':
    default:
      return 500;
  }
}

export async function workspaceRuleRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // GET /api/workspaces/:workspaceId/rules
  fastifyInstance.get(
    '/api/workspaces/:workspaceId/rules',
    { preHandler: jwtPreHandler, schema: { params: WorkspaceParamsSchema } },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const result = await listWorkspaceRuleFiles(workspaceId);
      if (!result.ok) {
        const status = mapErrorCodeToStatus(result.code);
        return reply.code(status).send({ error: result.message, code: result.code });
      }
      return reply.send(result.value);
    }
  );

  // GET /api/workspaces/:workspaceId/rules/:filename
  fastifyInstance.get(
    '/api/workspaces/:workspaceId/rules/:filename',
    { preHandler: jwtPreHandler, schema: { params: RuleFileParamsSchema } },
    async (request, reply) => {
      const { workspaceId, filename } = request.params;
      const result = await readWorkspaceRuleFile(workspaceId, filename);
      if (!result.ok) {
        const status = mapErrorCodeToStatus(result.code);
        return reply.code(status).send({ error: result.message, code: result.code });
      }
      return reply.send(result.value);
    }
  );

  // PUT /api/workspaces/:workspaceId/rules/:filename
  fastifyInstance.put(
    '/api/workspaces/:workspaceId/rules/:filename',
    { preHandler: jwtPreHandler, schema: { params: RuleFileParamsSchema, body: WriteBodySchema } },
    async (request, reply) => {
      const { workspaceId, filename } = request.params;
      const result = await writeWorkspaceRuleFile(workspaceId, filename, request.body.content);
      if (!result.ok) {
        const status = mapErrorCodeToStatus(result.code);
        return reply.code(status).send({ error: result.message, code: result.code });
      }
      return reply.send(result.value);
    }
  );

  // DELETE /api/workspaces/:workspaceId/rules/:filename
  fastifyInstance.delete(
    '/api/workspaces/:workspaceId/rules/:filename',
    { preHandler: jwtPreHandler, schema: { params: RuleFileParamsSchema } },
    async (request, reply) => {
      const { workspaceId, filename } = request.params;
      const result = await deleteWorkspaceRuleFile(workspaceId, filename);
      if (!result.ok) {
        const status = mapErrorCodeToStatus(result.code);
        return reply.code(status).send({ error: result.message, code: result.code });
      }
      return reply.send(result.value);
    }
  );

  // PATCH /api/workspaces/:workspaceId/rules/:filename (rename)
  fastifyInstance.patch(
    '/api/workspaces/:workspaceId/rules/:filename',
    { preHandler: jwtPreHandler, schema: { params: RuleFileParamsSchema, body: RenameBodySchema } },
    async (request, reply) => {
      const { workspaceId, filename } = request.params;
      const result = await renameWorkspaceRuleFile(workspaceId, filename, request.body.newFilename);
      if (!result.ok) {
        const status = mapErrorCodeToStatus(result.code);
        return reply.code(status).send({ error: result.message, code: result.code });
      }
      return reply.send(result.value);
    }
  );
}


// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { FileListResponseSchema, FilePathResponseSchema, FileReadResponseSchema } from '@novacode/shared';

// classes
import { authenticateToken, extractRequestToken, jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';
import { isDotEntry, MAX_FILE_READ_BYTES, resolveRealInsideWorkspace } from '../classes/workspaceFs';
import { resolveWorkspaceAbsolutePath } from '../classes/workspacePaths';
import { resolveToolImagePath } from '../classes/toolImagePath';
import { fsHttpError, PayloadTooLargeError } from '../classes/httpErrors';

async function workspaceBase(
  workspaceId: string
): Promise<{ basePath: string } | { error: string; status: 404 }> {
  const workspace = await db.getWorkspace(workspaceId);
  if (!workspace) {
    return { error: 'Workspace not found', status: 404 };
  }
  return { basePath: resolveWorkspaceAbsolutePath(workspace.path) };
}

export async function fileRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();


  // GET /api/workspaces/:workspaceId/files/list?path=&hidden=
  fastifyInstance.get(
    '/api/workspaces/:workspaceId/files/list',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({
          path: Type.Optional(Type.String()),
          hidden: Type.Optional(Type.String())
        }),
        response: {
          200: FileListResponseSchema,
          404: Type.Object({ error: Type.String() }),
          403: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const base = await workspaceBase(request.params.workspaceId);
      if ('error' in base) {
        return reply.code(base.status).send({ error: base.error });
      }

      const query = request.query as { path?: string; hidden?: string };
      const relativePath = query.path ?? '';
      const bShowHidden = query.hidden === '1' || query.hidden === 'true';
      const resolved = await resolveRealInsideWorkspace(base.basePath, relativePath);
      if ('error' in resolved) {
        return reply.code(resolved.status).send({ error: resolved.error });
      }

      if (!existsSync(resolved.absolutePath)) {
        return reply.code(400).send({ error: 'Path does not exist' });
      }

      try {
        const entries = await readdir(resolved.absolutePath, { withFileTypes: true });
        const prefix = resolved.relativePath;
        const mapped = entries
          .filter((entry) => entry.name !== '.' && entry.name !== '..')
          .filter((entry) => bShowHidden || !isDotEntry(entry.name))
          .sort((left, right) => {
            if (left.isDirectory() !== right.isDirectory()) {
              return left.isDirectory() ? -1 : 1;
            }
            return left.name.localeCompare(right.name);
          })
          .map((entry) => ({
            name: entry.name,
            path: prefix ? `${prefix}/${entry.name}` : entry.name,
            isDirectory: entry.isDirectory()
          }));
        return {
          path: prefix || '.',
          entries: mapped
        };
      } catch (err) {
        throw fsHttpError(err);
      }
    }
  );

  // GET /api/workspaces/:workspaceId/files/read?path=
  fastifyInstance.get(
    '/api/workspaces/:workspaceId/files/read',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({ path: Type.String({ minLength: 1 }) }),
        response: {
          200: FileReadResponseSchema,
          413: Type.Object({ error: Type.String() }),
          404: Type.Object({ error: Type.String() }),
          403: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const base = await workspaceBase(request.params.workspaceId);
      if ('error' in base) {
        return reply.code(base.status).send({ error: base.error });
      }
      const relativePath = (request.query as { path: string }).path;
      const resolved = await resolveRealInsideWorkspace(base.basePath, relativePath);
      if ('error' in resolved) {
        return reply.code(resolved.status).send({ error: resolved.error });
      }
      if (!resolved.relativePath) {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      if (!existsSync(resolved.absolutePath)) {
        return reply.code(404).send({ error: 'File not found' });
      }

      try {
        const fileStat = await stat(resolved.absolutePath);
        if (fileStat.size > MAX_FILE_READ_BYTES) {
          throw new PayloadTooLargeError('File too large');
        }
        const buffer = await readFile(resolved.absolutePath);
        const isBinary = buffer.subarray(0, 8192).includes(0);
        if (isBinary) {
          return {
            content: buffer.toString('base64'),
            path: relativePath,
            encoding: 'base64' as const
          };
        }
        return { content: buffer.toString('utf8'), path: relativePath, encoding: 'utf8' as const };
      } catch (err) {
        throw fsHttpError(err);
      }
    }
  );

  // PUT /api/workspaces/:workspaceId/files/write
  fastifyInstance.put(
    '/api/workspaces/:workspaceId/files/write',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        body: Type.Object({
          path: Type.String({ minLength: 1 }),
          content: Type.String()
        }),
        response: {
          200: FilePathResponseSchema,
          404: Type.Object({ error: Type.String() }),
          403: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const base = await workspaceBase(request.params.workspaceId);
      if ('error' in base) {
        return reply.code(base.status).send({ error: base.error });
      }
      const { path: relativePath, content } = request.body as { path: string; content: string };
      const resolved = await resolveRealInsideWorkspace(base.basePath, relativePath);
      if ('error' in resolved) {
        return reply.code(resolved.status).send({ error: resolved.error });
      }
      if (!resolved.relativePath) {
        return reply.code(400).send({ error: 'Invalid path' });
      }

      try {
        await mkdir(dirname(resolved.absolutePath), { recursive: true });
        await writeFile(resolved.absolutePath, content, 'utf8');
        return { path: relativePath };
      } catch (err) {
        throw fsHttpError(err);
      }
    }
  );

  // POST /api/workspaces/:workspaceId/files/mkdir
  fastifyInstance.post(
    '/api/workspaces/:workspaceId/files/mkdir',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        body: Type.Object({ path: Type.String({ minLength: 1 }) }),
        response: {
          200: FilePathResponseSchema,
          404: Type.Object({ error: Type.String() }),
          403: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const base = await workspaceBase(request.params.workspaceId);
      if ('error' in base) {
        return reply.code(base.status).send({ error: base.error });
      }
      const relativePath = (request.body as { path: string }).path;
      const resolved = await resolveRealInsideWorkspace(base.basePath, relativePath);
      if ('error' in resolved) {
        return reply.code(resolved.status).send({ error: resolved.error });
      }
      if (!resolved.relativePath) {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      try {
        await mkdir(resolved.absolutePath, { recursive: true });
        return { path: resolved.relativePath };
      } catch (err) {
        throw fsHttpError(err);
      }
    }
  );

  // POST /api/workspaces/:workspaceId/files/rename
  fastifyInstance.post(
    '/api/workspaces/:workspaceId/files/rename',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        body: Type.Object({
          from: Type.String({ minLength: 1 }),
          to: Type.String({ minLength: 1 })
        }),
        response: {
          200: FilePathResponseSchema,
          404: Type.Object({ error: Type.String() }),
          403: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const base = await workspaceBase(request.params.workspaceId);
      if ('error' in base) {
        return reply.code(base.status).send({ error: base.error });
      }
      const { from, to } = request.body as { from: string; to: string };
      const source = await resolveRealInsideWorkspace(base.basePath, from);
      const target = await resolveRealInsideWorkspace(base.basePath, to);
      if ('error' in source) {
        return reply.code(source.status).send({ error: source.error });
      }
      if ('error' in target) {
        return reply.code(target.status).send({ error: target.error });
      }
      if (!source.relativePath || !target.relativePath) {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      if (!existsSync(source.absolutePath)) {
        return reply.code(404).send({ error: 'Path not found' });
      }
      if (existsSync(target.absolutePath)) {
        return reply.code(400).send({ error: 'A file or folder already exists at the new path' });
      }
      try {
        await mkdir(dirname(target.absolutePath), { recursive: true });
        await rename(source.absolutePath, target.absolutePath);
        return { path: target.relativePath };
      } catch (err) {
        throw fsHttpError(err);
      }
    }
  );

  // DELETE /api/workspaces/:workspaceId/files?path=
  fastifyInstance.delete(
    '/api/workspaces/:workspaceId/files',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({ path: Type.String({ minLength: 1 }) }),
        response: {
          200: FilePathResponseSchema,
          404: Type.Object({ error: Type.String() }),
          403: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const base = await workspaceBase(request.params.workspaceId);
      if ('error' in base) {
        return reply.code(base.status).send({ error: base.error });
      }
      const relativePath = (request.query as { path: string }).path;
      const resolved = await resolveRealInsideWorkspace(base.basePath, relativePath);
      if ('error' in resolved) {
        return reply.code(resolved.status).send({ error: resolved.error });
      }
      if (!resolved.relativePath) {
        return reply.code(400).send({ error: 'Cannot delete the workspace root' });
      }
      if (!existsSync(resolved.absolutePath)) {
        return reply.code(404).send({ error: 'Path not found' });
      }
      try {
        await rm(resolved.absolutePath, { recursive: true });
        return { path: resolved.relativePath };
      } catch (err) {
        throw fsHttpError(err);
      }
    }
  );

  // GET /api/files/tool-image?path= — image a tool read, shown on demand in the chat.
  // Cookie (dashboard) or Bearer only — no query-token fallback.
  fastifyInstance.get(
    '/api/files/tool-image',
    {
      schema: {
        querystring: Type.Object({ path: Type.String({ minLength: 1 }) })
      }
    },
    async (request, reply) => {
      const token = extractRequestToken(request) ?? '';
      if (!(await authenticateToken(token))) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      const resolved = await resolveToolImagePath(request.query.path);
      if ('error' in resolved) {
        return reply.code(resolved.status).send({ error: resolved.error });
      }
      try {
        const data = await readFile(resolved.absolutePath);
        return reply
          .header('Content-Type', resolved.contentType)
          .header('Cache-Control', 'private, no-cache')
          .send(data);
      } catch {
        return reply.code(404).send({ error: 'File not found' });
      }
    }
  );
}

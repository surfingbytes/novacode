// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, normalize } from 'node:path';
import { existsSync } from 'node:fs';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';
import { config } from '../classes/config';

const workspaceRoot = () => resolve(config.workspaceBrowseRoot);

export async function fileRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  const FileEntrySchema = Type.Object({
    name: Type.String(),
    path: Type.String(),
    isDirectory: Type.Boolean()
  });

  // GET /api/workspaces/:workspaceId/files/list?path= — list directory (path relative to workspace)
  fastifyInstance.get(
    '/api/workspaces/:workspaceId/files/list',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({ path: Type.Optional(Type.String()) }),
        response: {
          200: Type.Object({
            path: Type.String(),
            entries: Type.Array(FileEntrySchema)
          }),
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const workspace = await db.getWorkspace(request.params.workspaceId);
      if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

      // workspace.path may be stored with leading slash (e.g. /Personal/workspace); treat as relative to root
      const workspaceRel = workspace.path.replace(/^\//, '');
      const basePath = resolve(workspaceRoot(), workspaceRel || '.');
      const relativePath = (request.query as { path?: string }).path ?? '';
      const targetPath = resolve(basePath, relativePath || '.');
      const baseNorm = normalize(basePath).replace(/\\/g, '/').replace(/\/?$/, '');
      const targetNorm = normalize(targetPath).replace(/\\/g, '/');
      if (targetNorm !== baseNorm && !targetNorm.startsWith(baseNorm + '/')) {
        return reply.code(400).send({ error: 'Invalid path' });
      }

      if (!existsSync(targetPath)) {
        return reply.code(400).send({ error: 'Path does not exist' });
      }

      try {
        const entries = await readdir(targetPath, { withFileTypes: true });
        const dirs = entries
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((d) => ({
            name: d.name,
            path: relativePath ? `${relativePath.replace(/\/$/, '')}/${d.name}` : d.name,
            isDirectory: true
          }));
        const files = entries
          .filter((d) => !d.isDirectory())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((d) => ({
            name: d.name,
            path: relativePath ? `${relativePath.replace(/\/$/, '')}/${d.name}` : d.name,
            isDirectory: false
          }));
        return {
          path: relativePath || '.',
          entries: [...dirs, ...files]
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to list directory';
        return reply.code(400).send({ error: message });
      }
    }
  );

  // GET /api/workspaces/:workspaceId/files/read?path= — read file content (path relative to workspace)
  fastifyInstance.get(
    '/api/workspaces/:workspaceId/files/read',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({ path: Type.String({ minLength: 1 }) }),
        response: {
          200: Type.Object({
            content: Type.String(),
            path: Type.String(),
            encoding: Type.Union([Type.Literal('utf8'), Type.Literal('base64')])
          }),
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const workspace = await db.getWorkspace(request.params.workspaceId);
      if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

      const workspaceRel = workspace.path.replace(/^\//, '');
      const basePath = resolve(workspaceRoot(), workspaceRel || '.');
      const relativePath = (request.query as { path: string }).path;
      const targetPath = resolve(basePath, relativePath);
      const baseNorm = normalize(basePath).replace(/\\/g, '/').replace(/\/?$/, '');
      const targetNorm = normalize(targetPath).replace(/\\/g, '/');
      if (!targetNorm.startsWith(baseNorm + '/') && targetNorm !== baseNorm) {
        return reply.code(400).send({ error: 'Invalid path' });
      }

      if (!existsSync(targetPath)) {
        return reply.code(404).send({ error: 'File not found' });
      }

      try {
        const buffer = await readFile(targetPath);
        // Binary heuristic: a NUL byte in the first 8KB means it is not displayable text.
        const isBinary = buffer.subarray(0, 8192).includes(0);
        if (isBinary) {
          return { content: buffer.toString('base64'), path: relativePath, encoding: 'base64' as const };
        }
        return { content: buffer.toString('utf8'), path: relativePath, encoding: 'utf8' as const };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to read file';
        return reply.code(400).send({ error: message });
      }
    }
  );

  // PUT /api/workspaces/:workspaceId/files/write — write file content (path in body)
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
          200: Type.Object({ path: Type.String() }),
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const workspace = await db.getWorkspace(request.params.workspaceId);
      if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

      const workspaceRel = workspace.path.replace(/^\//, '');
      const basePath = resolve(workspaceRoot(), workspaceRel || '.');
      const { path: relativePath, content } = request.body as { path: string; content: string };
      const targetPath = resolve(basePath, relativePath);
      const baseNorm = normalize(basePath).replace(/\\/g, '/').replace(/\/?$/, '');
      const targetNorm = normalize(targetPath).replace(/\\/g, '/');
      if (!targetNorm.startsWith(baseNorm + '/') && targetNorm !== baseNorm) {
        return reply.code(400).send({ error: 'Invalid path' });
      }

      try {
        await writeFile(targetPath, content, 'utf8');
        return { path: relativePath };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to write file';
        return reply.code(400).send({ error: message });
      }
    }
  );
}

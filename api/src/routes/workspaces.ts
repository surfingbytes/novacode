// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { readdir, mkdir } from 'node:fs/promises';
import { resolve, normalize } from 'node:path';
import { existsSync } from 'node:fs';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';
import { config } from '../classes/config';

const WorkspaceSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  path: Type.String(),
  group: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  createdAt: Type.String(),
  gitUserName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  gitUserEmail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  sortOrder: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  defaultAgentType: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  tags: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()])),
  archived: Type.Boolean()
});

const BrowseEntrySchema = Type.Object({
  name: Type.String(),
  path: Type.String(),
  isDirectory: Type.Boolean()
});

const rootPath = resolve(config.workspaceBrowseRoot);
const rootNorm = normalize(rootPath).replace(/\\/g, '/').replace(/\/?$/, '/');

function ensureUnderRoot(requestedPath: string): string {
  const resolved = resolve(rootPath, requestedPath || '.');
  const resolvedNorm = normalize(resolved).replace(/\\/g, '/');
  const isUnder =
    resolvedNorm === rootNorm.slice(0, -1) || (resolvedNorm + '/').startsWith(rootNorm);
  if (!isUnder) {
    return rootPath;
  }
  return resolved;
}

function isPathUnderRoot(path: string): boolean {
  const resolved = resolve(path);
  const resolvedNorm = normalize(resolved).replace(/\\/g, '/');
  return resolvedNorm === rootNorm.slice(0, -1) || (resolvedNorm + '/').startsWith(rootNorm);
}

/**
 * Validates that the given workspace path (as provided by user) is under workspaceBrowseRoot.
 * Returns the path in a form safe to store (relative to root, no leading slash). Throws if invalid.
 */
function validateAndNormalizeWorkspacePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('Workspace path is required');
  }
  const pathRelativeToRoot = trimmed.replace(/^\//, '');
  const resolved = resolve(rootPath, pathRelativeToRoot);
  const resolvedNorm = normalize(resolved).replace(/\\/g, '/');
  const rootNormNoTrailing = rootNorm.replace(/\/$/, '');
  const isUnder =
    resolvedNorm === rootNormNoTrailing || resolvedNorm.startsWith(rootNormNoTrailing + '/');
  if (!isUnder) {
    throw new Error('Workspace path must be inside the allowed root');
  }
  return pathRelativeToRoot.replace(/\/$/, '') || '.';
}

/** Normalize workspace for API response: ensure tags is string[] | null (no empty strings). */
function normalizeWorkspaceResponse<T extends { tags?: unknown }>(w: T): Omit<T, 'tags'> & { tags: string[] | null } {
  if (!Array.isArray(w.tags)) {
    return { ...w, tags: null };
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const x of w.tags) {
    if (typeof x !== 'string') continue;
    const t = x.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    tags.push(t);
  }
  return { ...w, tags: tags.length > 0 ? tags : null };
}

const WORKSPACE_AGENT_TYPES = new Set(['cursor-agent', 'claude', 'mistral-vibe', 'open-code', 'codex']);

/** Persist only known agent ids; invalid strings become null. */
function normalizeDefaultAgentTypeForWrite(
  value: string | null | undefined
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return WORKSPACE_AGENT_TYPES.has(value) ? value : null;
}

export async function workspaceRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // GET /api/workspaces/browse — list directory entries under allowed root
  fastifyInstance.get(
    '/api/workspaces/browse',
    {
      preHandler: jwtPreHandler,
      schema: {
        querystring: Type.Object({ path: Type.Optional(Type.String()) }),
        response: {
          200: Type.Object({
            path: Type.String(),
            entries: Type.Array(BrowseEntrySchema)
          }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const requested = (request.query as { path?: string }).path ?? '';
      const safePath = ensureUnderRoot(requested);
      if (!existsSync(safePath)) {
        return reply.code(400).send({ error: 'Path does not exist' });
      }
      try {
        const entries = await readdir(safePath, { withFileTypes: true });
        const dirs = entries
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((d) => ({
            name: d.name,
            path: resolve(safePath, d.name),
            isDirectory: true
          }));
        return { path: safePath, entries: dirs };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to list directory';
        return reply.code(400).send({ error: message });
      }
    }
  );

  // POST /api/workspaces/browse/mkdir — create directory under allowed root
  fastifyInstance.post(
    '/api/workspaces/browse/mkdir',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({
          path: Type.String(),
          name: Type.String({ minLength: 1 })
        }),
        response: {
          201: Type.Object({ path: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { path: parentPath, name } = request.body as { path: string; name: string };
      if (/[\\/]/.test(name)) {
        return reply.code(400).send({ error: 'Folder name cannot contain path separators' });
      }
      const parentSafe = ensureUnderRoot(parentPath || '.');
      if (!existsSync(parentSafe)) {
        return reply.code(400).send({ error: 'Parent path does not exist' });
      }
      const newDir = resolve(parentSafe, name);
      if (!isPathUnderRoot(newDir)) {
        return reply.code(400).send({ error: 'Path would be outside allowed root' });
      }
      if (existsSync(newDir)) {
        return reply.code(400).send({ error: 'A file or folder with that name already exists' });
      }
      try {
        await mkdir(newDir, { recursive: false });
        return reply.code(201).send({ path: newDir });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create folder';
        return reply.code(400).send({ error: message });
      }
    }
  );

  // GET /api/workspaces — list all workspaces
  fastifyInstance.get(
    '/api/workspaces',
    {
      preHandler: jwtPreHandler,
      schema: {
        querystring: Type.Object({ includeArchived: Type.Optional(Type.String()) }),
        response: { 200: Type.Array(WorkspaceSchema) }
      }
    },
    async (request) => {
      const q = request.query as { includeArchived?: string };
      const includeArchived = q.includeArchived === 'true';
      const list = await db.listWorkspaces({ includeArchived });
      return list.map(normalizeWorkspaceResponse);
    }
  );

  // POST /api/workspaces — create workspace
  fastifyInstance.post(
    '/api/workspaces',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({
          name: Type.String({ minLength: 1 }),
          path: Type.String({ minLength: 1 }),
          group: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          gitUserName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          gitUserEmail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          defaultAgentType: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          tags: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()]))
        }),
        response: {
          201: WorkspaceSchema,
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { name, path, group, gitUserName, gitUserEmail, color, defaultAgentType, tags } =
        request.body;
      let safePath: string;
      try {
        safePath = validateAndNormalizeWorkspacePath(path);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }

      const workspace = await db.createWorkspace({
        name,
        path: safePath,
        group: group ?? undefined,
        gitUserName: gitUserName?.trim() || undefined,
        gitUserEmail: gitUserEmail?.trim() || undefined,
        color: color?.trim() || undefined,
        defaultAgentType: normalizeDefaultAgentTypeForWrite(defaultAgentType),
        tags: tags ?? undefined
      });
      return reply.code(201).send(normalizeWorkspaceResponse(workspace));
    }
  );

  // PUT /api/workspaces/:id — update workspace
  fastifyInstance.put(
    '/api/workspaces/:id',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1 })),
          path: Type.Optional(Type.String({ minLength: 1 })),
          group: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          gitUserName: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          gitUserEmail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          color: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          defaultAgentType: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          tags: Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()]))
        }),
        response: {
          200: WorkspaceSchema,
          400: Type.Object({ error: Type.String() }),
          404: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const body = request.body as {
        name?: string;
        path?: string;
        group?: string | null;
        gitUserName?: string | null;
        gitUserEmail?: string | null;
        color?: string | null;
        defaultAgentType?: string | null;
        tags?: string[] | null;
      };
      let pathPatch: string | undefined;
      if (body.path !== undefined) {
        try {
          pathPatch = validateAndNormalizeWorkspacePath(body.path);
        } catch (err) {
          return reply.code(400).send({ error: (err as Error).message });
        }
      }
      const updated = await db.updateWorkspace(request.params.id, {
        name: body.name,
        path: pathPatch,
        group: body.group !== undefined ? body.group?.trim() || null : undefined,
        gitUserName: body.gitUserName !== undefined ? body.gitUserName?.trim() || null : undefined,
        gitUserEmail:
          body.gitUserEmail !== undefined ? body.gitUserEmail?.trim() || null : undefined,
        color: body.color !== undefined ? body.color?.trim() || null : undefined,
        defaultAgentType: normalizeDefaultAgentTypeForWrite(body.defaultAgentType),
        tags: body.tags
      });
      if (!updated) return reply.code(404).send({ error: 'Workspace not found' });
      return normalizeWorkspaceResponse(updated);
    }
  );

  // PUT /api/workspaces/reorder — reorder workspaces by id list
  fastifyInstance.put(
    '/api/workspaces/reorder',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({ ids: Type.Array(Type.String()) }),
        response: {
          204: Type.Null(),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { ids } = request.body as { ids: string[] };
      if (!ids.length) return reply.code(400).send({ error: 'ids must be a non-empty array' });
      await db.reorderWorkspaces(ids);
      return reply.code(204).send(null);
    }
  );

  // PUT /api/workspaces/:id/archive — archive or unarchive workspace
  fastifyInstance.put(
    '/api/workspaces/:id/archive',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: Type.Object({ archived: Type.Boolean() }),
        response: {
          200: WorkspaceSchema,
          404: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const { archived } = request.body as { archived: boolean };
      const updated = await db.archiveWorkspace(id, archived);
      if (!updated) return reply.code(404).send({ error: 'Workspace not found' });
      return normalizeWorkspaceResponse(updated);
    }
  );

  // DELETE /api/workspaces/:id — delete workspace
  fastifyInstance.delete(
    '/api/workspaces/:id',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          204: Type.Null(),
          404: Type.Object({ error: Type.String() }),
          409: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await db.getWorkspace(id))) {
        return reply.code(404).send({ error: 'Workspace not found' });
      }
      await db.deleteWorkspace(id);
      return reply.code(204).send(null);
    }
  );
}

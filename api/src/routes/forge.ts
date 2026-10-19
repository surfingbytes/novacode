// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

// classes
import { jwtPreHandler } from '../classes/auth';
import { config } from '../classes/config';
import { db } from '../classes/database';
import {
  buildFixPromptForRun,
  createForgeConnection,
  deleteForgeConnection,
  forgeLinks,
  getCachedCiRuns,
  getForgeConnection,
  listForgeConnections,
  resolveForgeRepo,
  resolveTestToken,
  testForgeConnection,
  toConnectionStatus,
  updateForgeConnection
} from '../classes/forge';
import { summarizeCiRuns } from '../classes/forgeCi';
import { observeCiRuns, touchCiWatch } from '../classes/ciWatcher';
import { getBranchMeta, maybeGitOutput, resolvePushRemote, resolveWorkspaceGitContext } from './git';

// types
import type {
  CiStatusResponse,
  ForgeProvider,
  ForgeRepoDetectResponse,
  SaveForgeConnectionPayload
} from '@novacode/shared';
import type { ResolvedForgeRepo } from '../classes/forge';

const ProviderSchema = Type.Union([
  Type.Literal('gitea'),
  Type.Literal('forgejo'),
  Type.Literal('github'),
  Type.Literal('gitlab')
]);

const ConnectionSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  provider: ProviderSchema,
  url: Type.String(),
  remoteHosts: Type.Array(Type.String()),
  version: Type.Union([Type.String(), Type.Null()]),
  source: Type.Union([Type.Literal('env'), Type.Literal('file')])
});

const SaveConnectionSchema = Type.Object({
  provider: ProviderSchema,
  url: Type.String({ minLength: 1 }),
  token: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  remoteHosts: Type.Optional(Type.Array(Type.String()))
});

const TestResultSchema = Type.Object({
  ok: Type.Boolean(),
  provider: Type.Optional(ProviderSchema),
  version: Type.Optional(Type.String()),
  username: Type.Optional(Type.String()),
  error: Type.Optional(Type.String())
});

const CiRunSchema = Type.Object({
  id: Type.Number(),
  number: Type.Union([Type.Number(), Type.Null()]),
  title: Type.String(),
  status: Type.String(),
  branch: Type.Union([Type.String(), Type.Null()]),
  sha: Type.Union([Type.String(), Type.Null()]),
  event: Type.Union([Type.String(), Type.Null()]),
  url: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.Union([Type.String(), Type.Null()])
});

const NullableString = Type.Union([Type.String(), Type.Null()]);

const CiStatusSchema = Type.Object({
  configured: Type.Boolean(),
  connectionId: NullableString,
  connectionName: NullableString,
  provider: Type.Union([ProviderSchema, Type.Null()]),
  repo: NullableString,
  repoSource: Type.Union([Type.Literal('override'), Type.Literal('remote'), Type.Null()]),
  repoUrl: NullableString,
  runsUrl: NullableString,
  branch: NullableString,
  source: Type.Union([Type.Literal('actions'), Type.Literal('commit-status'), Type.Null()]),
  lastCompleted: Type.Union([CiRunSchema, Type.Null()]),
  running: Type.Array(CiRunSchema),
  queued: Type.Array(CiRunSchema),
  queuedTotal: Type.Number(),
  error: Type.Optional(Type.String()),
  fetchedAt: Type.Number()
});

const ErrorSchema = Type.Object({ error: Type.String() });

interface CiTarget {
  workspaceName: string;
  repoPath: string;
  resolved: ResolvedForgeRepo | null;
  branch: string | null;
  sha: string | null;
}

/**
 * Forge connection + repo for one git root in the workspace. The workspace override
 * applies to the root repo (or the only repo); nested repos auto-detect from their remote.
 */
async function resolveCiTarget(workspaceId: string, repoPath: string): Promise<CiTarget | null> {
  const workspace = await db.getWorkspace(workspaceId);
  if (!workspace) return null;
  const context = await resolveWorkspaceGitContext(workspaceId, repoPath);
  if (!context) return null;

  const meta = await getBranchMeta(context.cwd);
  const sha = (await maybeGitOutput(context.cwd, ['rev-parse', 'HEAD'], '')) || null;
  let remoteUrl: string | null = null;
  try {
    const remote = await resolvePushRemote(context.cwd);
    remoteUrl = (await maybeGitOutput(context.cwd, ['remote', 'get-url', remote], '')) || null;
  } catch {
    // no remotes — only the override can apply
  }
  return {
    workspaceName: workspace.name,
    repoPath: context.repo,
    resolved: resolveForgeRepo({
      connections: listForgeConnections(config.configDir),
      remoteUrl,
      overrideApplies: context.repo === '' || context.repoPaths.length === 1,
      forgeConnectionId: workspace.forgeConnectionId ?? null,
      forgeRepo: workspace.forgeRepo ?? null
    }),
    branch: meta.detached ? null : meta.currentBranch,
    sha
  };
}

function emptyCiStatus(configured: boolean, extra?: Partial<CiStatusResponse>): CiStatusResponse {
  return {
    configured,
    connectionId: null,
    connectionName: null,
    provider: null,
    repo: null,
    repoSource: null,
    repoUrl: null,
    runsUrl: null,
    branch: null,
    source: null,
    lastCompleted: null,
    running: [],
    queued: [],
    queuedTotal: 0,
    fetchedAt: Date.now(),
    ...extra
  };
}

function detectResponse(resolved: ResolvedForgeRepo | null): ForgeRepoDetectResponse {
  return {
    configured: true,
    connectionId: resolved?.connection.id ?? null,
    connectionName: resolved?.connection.name ?? null,
    provider: resolved?.connection.provider ?? null,
    repo: resolved?.repo ?? null,
    source: resolved?.source ?? null
  };
}

export async function forgeRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // -------------------------------------------------- Connections --------------------------------------------------
  // GET /api/forge/connections — Gitea/Forgejo/GitHub/GitLab connections (never returns tokens)
  fastifyInstance.get(
    '/api/forge/connections',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 200: Type.Object({ connections: Type.Array(ConnectionSchema) }) } }
    },
    async () => ({ connections: listForgeConnections(config.configDir).map(toConnectionStatus) })
  );

  // POST /api/forge/connections — test, then add a connection to `forge.json`
  fastifyInstance.post(
    '/api/forge/connections',
    {
      preHandler: jwtPreHandler,
      schema: { body: SaveConnectionSchema, response: { 201: ConnectionSchema, 400: ErrorSchema } }
    },
    async (request, reply) => {
      const body = request.body as SaveForgeConnectionPayload;
      const test = await testForgeConnection({ provider: body.provider, url: body.url, token: body.token ?? '' });
      if (!test.ok) return reply.code(400).send({ error: test.error ?? 'Connection test failed' });
      try {
        return reply.code(201).send(toConnectionStatus(createForgeConnection(config.configDir, body, test)));
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  // PUT /api/forge/connections/:id — test, then update (omit `token` to keep the stored one)
  fastifyInstance.put(
    '/api/forge/connections/:id',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ id: Type.String() }),
        body: SaveConnectionSchema,
        response: { 200: ConnectionSchema, 400: ErrorSchema, 404: ErrorSchema }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const existing = getForgeConnection(config.configDir, id);
      if (!existing) return reply.code(404).send({ error: 'Connection not found' });
      if (existing.source === 'env') {
        return reply.code(400).send({ error: 'This connection comes from FORGE_* environment variables' });
      }
      const body = request.body as SaveForgeConnectionPayload;
      const token = resolveTestToken(config.configDir, body.token, id);
      const test = await testForgeConnection({ provider: body.provider, url: body.url, token }, id);
      if (!test.ok) return reply.code(400).send({ error: test.error ?? 'Connection test failed' });
      try {
        const updated = updateForgeConnection(config.configDir, id, body, test);
        if (!updated) return reply.code(404).send({ error: 'Connection not found' });
        return toConnectionStatus(updated);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    }
  );

  // DELETE /api/forge/connections/:id
  fastifyInstance.delete(
    '/api/forge/connections/:id',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: { 204: Type.Null(), 404: ErrorSchema }
      }
    },
    async (request, reply) => {
      if (!deleteForgeConnection(config.configDir, request.params.id)) {
        return reply.code(404).send({ error: 'Connection not found' });
      }
      return reply.code(204).send(null);
    }
  );

  // POST /api/forge/test — check provider + URL + token without saving
  fastifyInstance.post(
    '/api/forge/test',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({
          provider: ProviderSchema,
          url: Type.String({ minLength: 1 }),
          token: Type.Optional(Type.String()),
          /** Reuse this connection's stored token when `token` is blank. */
          connectionId: Type.Optional(Type.String())
        }),
        response: { 200: TestResultSchema }
      }
    },
    async (request) => {
      const { provider, url, token, connectionId } = request.body as {
        provider: ForgeProvider;
        url: string;
        token?: string;
        connectionId?: string;
      };
      return testForgeConnection(
        { provider, url, token: resolveTestToken(config.configDir, token, connectionId) },
        connectionId
      );
    }
  );

  // -------------------------------------------------- Workspace CI --------------------------------------------------
  // GET /api/forge/workspace/:workspaceId/repo — connection + repo the workspace root resolves to
  fastifyInstance.get(
    '/api/forge/workspace/:workspaceId/repo',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        response: {
          200: Type.Object({
            configured: Type.Boolean(),
            connectionId: NullableString,
            connectionName: NullableString,
            provider: Type.Union([ProviderSchema, Type.Null()]),
            repo: NullableString,
            source: Type.Union([Type.Literal('override'), Type.Literal('remote'), Type.Null()])
          }),
          404: ErrorSchema
        }
      }
    },
    async (request, reply): Promise<ForgeRepoDetectResponse | void> => {
      const connections = listForgeConnections(config.configDir);
      if (connections.length === 0) return { ...detectResponse(null), configured: false };
      try {
        const target = await resolveCiTarget(request.params.workspaceId, '');
        if (!target) return reply.code(404).send({ error: 'Workspace not found' });
        return detectResponse(target.resolved);
      } catch {
        // Not a git repo (yet) — only the override can apply.
        const workspace = await db.getWorkspace(request.params.workspaceId);
        if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
        return detectResponse(
          resolveForgeRepo({
            connections,
            remoteUrl: null,
            overrideApplies: true,
            forgeConnectionId: workspace.forgeConnectionId ?? null,
            forgeRepo: workspace.forgeRepo ?? null
          })
        );
      }
    }
  );

  // GET /api/forge/workspace/:workspaceId/ci?repo=&sessionId= — CI status for the checked-out branch
  fastifyInstance.get(
    '/api/forge/workspace/:workspaceId/ci',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({
          repo: Type.Optional(Type.String()),
          sessionId: Type.Optional(Type.String())
        }),
        response: { 200: CiStatusSchema, 404: ErrorSchema }
      }
    },
    async (request, reply): Promise<CiStatusResponse | void> => {
      if (listForgeConnections(config.configDir).length === 0) return emptyCiStatus(false);

      let target: CiTarget | null;
      try {
        target = await resolveCiTarget(request.params.workspaceId, request.query.repo ?? '');
      } catch (err) {
        return emptyCiStatus(true, { error: (err as Error).message });
      }
      if (!target) return reply.code(404).send({ error: 'Workspace not found' });
      const { resolved } = target;
      if (!resolved) return emptyCiStatus(true, { branch: target.branch });

      const { connection, repo } = resolved;
      const base: Partial<CiStatusResponse> = {
        connectionId: connection.id,
        connectionName: connection.name,
        provider: connection.provider,
        repo,
        repoSource: resolved.source,
        branch: target.branch,
        ...forgeLinks(connection, repo, null)
      };
      touchCiWatch({
        workspaceId: request.params.workspaceId,
        workspaceName: target.workspaceName,
        repoPath: target.repoPath,
        connectionId: connection.id,
        forgeRepo: repo,
        branch: target.branch,
        sha: target.sha,
        sessionId: request.query.sessionId ?? null
      });
      try {
        const result = await getCachedCiRuns(connection, repo, { branch: target.branch, sha: target.sha });
        observeCiRuns(request.params.workspaceId, target.repoPath, result.runs);
        const runs = target.branch ? result.runs : result.runs.filter((run) => !run.sha || run.sha === target.sha);
        return {
          ...emptyCiStatus(true, base),
          ...forgeLinks(connection, repo, result.source),
          source: result.source,
          ...summarizeCiRuns(runs, target.branch)
        };
      } catch (err) {
        return emptyCiStatus(true, { ...base, error: (err as Error).message });
      }
    }
  );

  // POST /api/forge/workspace/:workspaceId/ci/runs/:runId/fix-prompt?repo= — agent prompt with failed job logs
  fastifyInstance.post(
    '/api/forge/workspace/:workspaceId/ci/runs/:runId/fix-prompt',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String(), runId: Type.Integer({ minimum: 1 }) }),
        querystring: Type.Object({ repo: Type.Optional(Type.String()) }),
        response: {
          200: Type.Object({ prompt: Type.String(), includesLogs: Type.Boolean() }),
          400: ErrorSchema,
          404: ErrorSchema
        }
      }
    },
    async (request, reply) => {
      try {
        const target = await resolveCiTarget(request.params.workspaceId, request.query.repo ?? '');
        if (!target) return reply.code(404).send({ error: 'Workspace not found' });
        if (!target.resolved) return reply.code(400).send({ error: 'No forge repository for this workspace' });
        const { connection, repo } = target.resolved;
        const { runId } = request.params;
        const result = await getCachedCiRuns(connection, repo, { branch: target.branch, sha: target.sha });
        const run = result.runs.find((r) => r.id === runId) ?? null;
        return await buildFixPromptForRun(connection, repo, target.branch, run, result.source, runId);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    }
  );
}

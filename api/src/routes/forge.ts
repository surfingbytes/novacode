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
  clearForgeSettings,
  forgeRepoFromRemote,
  forgeRepoUrl,
  getCachedCiRuns,
  getForgeSettingsStatus,
  resolveForgeCredentials,
  resolveTestToken,
  saveForgeSettings,
  summarizeCiRuns,
  testForgeConnection
} from '../classes/forge';
import { observeCiRuns, touchCiWatch } from '../classes/ciWatcher';
import { getBranchMeta, maybeGitOutput, resolvePushRemote, resolveWorkspaceGitContext } from './git';

// types
import type { CiStatusResponse, ForgeRepoDetectResponse } from '@novacode/shared';
import type { ForgeCredentials } from '../classes/forge';

const ProviderSchema = Type.Union([Type.Literal('gitea'), Type.Literal('forgejo')]);

const ForgeSettingsStatusSchema = Type.Object({
  configured: Type.Boolean(),
  source: Type.Union([Type.Literal('env'), Type.Literal('file'), Type.Null()]),
  url: Type.Union([Type.String(), Type.Null()]),
  provider: Type.Union([ProviderSchema, Type.Null()]),
  version: Type.Union([Type.String(), Type.Null()])
});

const ForgeTestResultSchema = Type.Object({
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

const CiStatusSchema = Type.Object({
  configured: Type.Boolean(),
  repo: Type.Union([Type.String(), Type.Null()]),
  repoSource: Type.Union([Type.Literal('override'), Type.Literal('remote'), Type.Null()]),
  repoUrl: Type.Union([Type.String(), Type.Null()]),
  branch: Type.Union([Type.String(), Type.Null()]),
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
  forgeRepo: string | null;
  repoSource: 'override' | 'remote' | null;
  branch: string | null;
  sha: string | null;
}

/**
 * Forge repo for one git root in the workspace. The workspace override applies to the
 * root repo (or the only repo); nested repos always auto-detect from their own remote.
 */
async function resolveCiTarget(
  workspaceId: string,
  repoPath: string,
  creds: ForgeCredentials
): Promise<CiTarget | null> {
  const workspace = await db.getWorkspace(workspaceId);
  if (!workspace) return null;
  const context = await resolveWorkspaceGitContext(workspaceId, repoPath);
  if (!context) return null;

  const meta = await getBranchMeta(context.cwd);
  const sha = (await maybeGitOutput(context.cwd, ['rev-parse', 'HEAD'], '')) || null;
  const target: CiTarget = {
    workspaceName: workspace.name,
    repoPath: context.repo,
    forgeRepo: null,
    repoSource: null,
    branch: meta.detached ? null : meta.currentBranch,
    sha
  };

  const overrideApplies = context.repo === '' || context.repoPaths.length === 1;
  if (workspace.forgeRepo && overrideApplies) {
    target.forgeRepo = workspace.forgeRepo;
    target.repoSource = 'override';
    return target;
  }
  try {
    const remote = await resolvePushRemote(context.cwd);
    const remoteUrl = await maybeGitOutput(context.cwd, ['remote', 'get-url', remote], '');
    const detected = forgeRepoFromRemote(remoteUrl, creds.url);
    if (detected) {
      target.forgeRepo = detected;
      target.repoSource = 'remote';
    }
  } catch {
    // no remotes — nothing to detect
  }
  return target;
}

function emptyCiStatus(configured: boolean, extra?: Partial<CiStatusResponse>): CiStatusResponse {
  return {
    configured,
    repo: null,
    repoSource: null,
    repoUrl: null,
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

export async function forgeRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // -------------------------------------------------- Settings --------------------------------------------------
  // GET /api/forge/settings — Gitea/Forgejo connection (never returns the token)
  fastifyInstance.get(
    '/api/forge/settings',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 200: ForgeSettingsStatusSchema } }
    },
    async () => getForgeSettingsStatus(config.configDir)
  );

  // PUT /api/forge/settings — test, then save to `forge.json` in the config dir
  fastifyInstance.put(
    '/api/forge/settings',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({
          url: Type.String({ minLength: 1 }),
          /** Omit to keep the stored token. */
          token: Type.Optional(Type.String())
        }),
        response: { 200: ForgeSettingsStatusSchema, 400: ErrorSchema }
      }
    },
    async (request, reply) => {
      const { url, token } = request.body;
      const effectiveToken = resolveTestToken(config.configDir, token);
      const test = await testForgeConnection(url, effectiveToken);
      if (!test.ok) {
        return reply.code(400).send({ error: test.error ?? 'Connection test failed' });
      }
      try {
        saveForgeSettings(config.configDir, {
          url,
          token: effectiveToken,
          provider: test.provider,
          version: test.version
        });
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
      return getForgeSettingsStatus(config.configDir);
    }
  );

  // DELETE /api/forge/settings — remove file settings (env still wins if set)
  fastifyInstance.delete(
    '/api/forge/settings',
    {
      preHandler: jwtPreHandler,
      schema: { response: { 200: ForgeSettingsStatusSchema } }
    },
    async () => {
      clearForgeSettings(config.configDir);
      return getForgeSettingsStatus(config.configDir);
    }
  );

  // POST /api/forge/test — check URL + token without saving
  fastifyInstance.post(
    '/api/forge/test',
    {
      preHandler: jwtPreHandler,
      schema: {
        body: Type.Object({
          url: Type.String({ minLength: 1 }),
          token: Type.Optional(Type.String())
        }),
        response: { 200: ForgeTestResultSchema }
      }
    },
    async (request) => {
      const { url, token } = request.body;
      return testForgeConnection(url, resolveTestToken(config.configDir, token));
    }
  );

  // -------------------------------------------------- Workspace CI --------------------------------------------------
  // GET /api/forge/workspace/:workspaceId/repo — forge repo the workspace resolves to
  fastifyInstance.get(
    '/api/forge/workspace/:workspaceId/repo',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        response: {
          200: Type.Object({
            configured: Type.Boolean(),
            repo: Type.Union([Type.String(), Type.Null()]),
            source: Type.Union([Type.Literal('override'), Type.Literal('remote'), Type.Null()])
          }),
          404: ErrorSchema
        }
      }
    },
    async (request, reply): Promise<ForgeRepoDetectResponse | void> => {
      const creds = resolveForgeCredentials(config.configDir);
      if (!creds) return { configured: false, repo: null, source: null };
      try {
        const target = await resolveCiTarget(request.params.workspaceId, '', creds);
        if (!target) return reply.code(404).send({ error: 'Workspace not found' });
        return { configured: true, repo: target.forgeRepo, source: target.repoSource };
      } catch {
        // Not a git repo (yet) — only the override can apply.
        const workspace = await db.getWorkspace(request.params.workspaceId);
        if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });
        return {
          configured: true,
          repo: workspace.forgeRepo ?? null,
          source: workspace.forgeRepo ? 'override' : null
        };
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
      const creds = resolveForgeCredentials(config.configDir);
      if (!creds) return emptyCiStatus(false);

      let target: CiTarget | null;
      try {
        target = await resolveCiTarget(request.params.workspaceId, request.query.repo ?? '', creds);
      } catch (err) {
        return emptyCiStatus(true, { error: (err as Error).message });
      }
      if (!target) return reply.code(404).send({ error: 'Workspace not found' });
      if (!target.forgeRepo) return emptyCiStatus(true, { branch: target.branch });

      const base = {
        repo: target.forgeRepo,
        repoSource: target.repoSource,
        repoUrl: forgeRepoUrl(creds.url, target.forgeRepo),
        branch: target.branch
      };
      touchCiWatch({
        workspaceId: request.params.workspaceId,
        workspaceName: target.workspaceName,
        repoPath: target.repoPath,
        forgeRepo: target.forgeRepo,
        branch: target.branch,
        sha: target.sha,
        sessionId: request.query.sessionId ?? null
      });
      try {
        const result = await getCachedCiRuns(creds, target.forgeRepo, { branch: target.branch, sha: target.sha });
        observeCiRuns(request.params.workspaceId, target.repoPath, result.runs);
        const runs = target.branch ? result.runs : result.runs.filter((run) => !run.sha || run.sha === target.sha);
        return {
          ...emptyCiStatus(true, base),
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
      const creds = resolveForgeCredentials(config.configDir);
      if (!creds) return reply.code(400).send({ error: 'Gitea/Forgejo is not configured' });
      try {
        const target = await resolveCiTarget(request.params.workspaceId, request.query.repo ?? '', creds);
        if (!target) return reply.code(404).send({ error: 'Workspace not found' });
        if (!target.forgeRepo) return reply.code(400).send({ error: 'No forge repository for this workspace' });
        const { runId } = request.params;
        const result = await getCachedCiRuns(creds, target.forgeRepo, { branch: target.branch, sha: target.sha });
        const run = result.runs.find((r) => r.id === runId) ?? null;
        return await buildFixPromptForRun(creds, target.forgeRepo, target.branch, run, result.source, runId);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    }
  );
}

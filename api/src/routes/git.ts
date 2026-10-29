// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { rm } from 'node:fs/promises';
import {
  GitBranchesResponseSchema,
  GitCheckoutResponseSchema,
  GitCommitMessageResponseSchema,
  GitCommitResponseSchema,
  GitCreateBranchResponseSchema,
  GitDiffResponseSchema,
  GitDiscardResponseSchema,
  GitFetchResponseSchema,
  GitLogResponseSchema,
  GitPullResponseSchema,
  GitPushResponseSchema,
  GitShowResponseSchema,
  GitStatusResponseSchema
} from '@novacode/shared';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';
import {
  buildCommitMessagePrompt,
  cleanCommitMessage,
  isPaywallText,
  resolveOneShotModel,
  runOneShotAgentText
} from '../classes/oneShotAgentText';
import { resolveAuthenticatedOneShotAgentType } from '../classes/agentAuthStatus';
import { parseGitLog } from '../classes/gitLog';
import { markCiWatchPushed } from '../classes/ciWatcher';
import { AGENT_ROUTE_RATE_LIMIT } from '../classes/rateLimits';
import { ensureSafeGitArg, gitHttpError, runGit } from '../classes/runGit';
import {
  ensureBranchName,
  fileDiff,
  getBranchMeta,
  getRepoStatus,
  getWorkspaceRepos,
  gitIdentityEnv,
  listBranches,
  maybeGitOutput,
  resolvePushRemote,
  resolveWorkspaceGitContext,
  safeRepoFilePath,
  toRepoRelativePath
} from '../classes/gitWorkspace';
import { BadRequestError, ConflictError, NotFoundError, UpstreamError } from '../classes/httpErrors';

const COMMIT_MESSAGE_DIFF_MAX_CHARS = 60_000;
const COMMIT_MESSAGE_FILE_DIFF_MAX_CHARS = 12_000;
/** fetch / pull / push talk to the remote and may be slow. */
const GIT_NETWORK_TIMEOUT_MS = 120_000;

export async function gitRoutes(fastify: FastifyInstance): Promise<void> {
  const fastifyInstance = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // GET /api/git/workspace/:workspaceId/status — list changed files
  fastifyInstance.get(
    '/api/git/workspace/:workspaceId/status',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        response: {
          200: GitStatusResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const workspaceRepos = await getWorkspaceRepos(request.params.workspaceId);
        if (!workspaceRepos) return reply.code(404).send({ error: 'Workspace not found' });
        const { baseCwd, repoPaths } = workspaceRepos;
        const repos = await Promise.all(repoPaths.map((repo) => getRepoStatus(baseCwd, repo)));
        const files = repos.flatMap((repo) => repo.files);
        const aheadCount = repos.reduce((sum, repo) => sum + repo.aheadCount, 0);

        // Legacy fallback: return single flat status error shape only when no repo exists.
        if (repos.length === 0) {
          return { files: [], aheadCount: 0, repos: [] };
        }
        return { files, aheadCount, repos };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );

  // GET /api/git/workspace/:workspaceId/diff?file=... — unified diff for one file
  fastifyInstance.get(
    '/api/git/workspace/:workspaceId/diff',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({
          file: Type.String({ minLength: 1 }),
          status: Type.Optional(Type.String()),
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: GitDiffResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { file, status, repo = '' } = request.query;

      try {
        const context = await resolveWorkspaceGitContext(request.params.workspaceId, repo);
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });

        const repoFile = toRepoRelativePath(context.repo, file);
        safeRepoFilePath(context.cwd, repoFile);
        return { diff: await fileDiff(context.cwd, repoFile, status === '??') };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );

  // POST /api/git/workspace/:workspaceId/commit-message — generate a commit message for selected files
  fastifyInstance.post(
    '/api/git/workspace/:workspaceId/commit-message',
    {
      preHandler: jwtPreHandler,
      config: { rateLimit: AGENT_ROUTE_RATE_LIMIT },
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        body: Type.Object({
          files: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: GitCommitMessageResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const { files, repo = '' } = request.body;

      try {
        const context = await resolveWorkspaceGitContext(request.params.workspaceId, repo);
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });

        const status = await getRepoStatus(context.baseCwd, context.repo);
        const statusByFile = new Map(status.files.map((file) => [file.file, file.status]));
        const diffParts: string[] = [];
        let totalChars = 0;

        for (const file of files) {
          const repoFile = toRepoRelativePath(context.repo, file);
          safeRepoFilePath(context.cwd, repoFile);
          const fileStatus = statusByFile.get(file) ?? statusByFile.get(repoFile) ?? '';
          let diff = await fileDiff(context.cwd, repoFile, fileStatus === '??');

          if (!diff.trim()) continue;
          if (diff.length > COMMIT_MESSAGE_FILE_DIFF_MAX_CHARS) {
            diff = `${diff.slice(0, COMMIT_MESSAGE_FILE_DIFF_MAX_CHARS)}\n... diff truncated ...\n`;
          }

          const part = `\n--- ${file} ---\n${diff}`;
          if (totalChars + part.length > COMMIT_MESSAGE_DIFF_MAX_CHARS) {
            diffParts.push('\n... remaining diff truncated ...\n');
            break;
          }
          diffParts.push(part);
          totalChars += part.length;
        }

        const diff = diffParts.join('').trim();
        if (!diff) return reply.code(400).send({ error: 'No diff found for selected files' });

        const user = await db.getFirstUser();
        const agentType = await resolveAuthenticatedOneShotAgentType(
          user?.utilityAgentType,
          [context.workspace.defaultAgentType],
          user?.claudeToken
        );
        const raw = await runOneShotAgentText({
          agentType,
          cwd: context.cwd,
          promptText: buildCommitMessagePrompt(diff),
          model: await resolveOneShotModel(user?.utilityModelSelection, agentType),
          claudeToken: user?.claudeToken ?? null,
          runIdPrefix: 'git-commit-message',
          denyTools: true
        }).catch((err: unknown) => {
          throw new UpstreamError(`AI (${agentType}): ${(err as Error).message}`, { expose: true, cause: err });
        });
        const message = cleanCommitMessage(raw);
        if (!message) {
          const error = isPaywallText(raw)
            ? `${agentType}: ${raw.trim().split('\n')[0]}`
            : `AI (${agentType}) did not return a commit message`;
          throw new UpstreamError(error, { expose: true });
        }

        return { message };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );

  // GET /api/git/workspace/:workspaceId/branches?repo=... — list local and remote branches
  fastifyInstance.get(
    '/api/git/workspace/:workspaceId/branches',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: GitBranchesResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const context = await resolveWorkspaceGitContext(
          request.params.workspaceId,
          request.query.repo ?? ''
        );
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });
        return await listBranches(context.cwd);
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );

  // POST /api/git/workspace/:workspaceId/fetch — update remote-tracking refs without merging
  fastifyInstance.post(
    '/api/git/workspace/:workspaceId/fetch',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: GitFetchResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const context = await resolveWorkspaceGitContext(
          request.params.workspaceId,
          request.query.repo ?? ''
        );
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });

        const { stdout, stderr } = await runGit(['fetch'], { cwd: context.cwd, timeoutMs: GIT_NETWORK_TIMEOUT_MS });
        const { behindCount, upstreamBranch } = await getBranchMeta(context.cwd);
        const output = (stdout + '\n' + stderr).trim();
        const upToDate = !upstreamBranch || behindCount === 0;
        return { output, upToDate, behindCount };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );

  // POST /api/git/workspace/:workspaceId/pull — fast-forward pull current branch
  fastifyInstance.post(
    '/api/git/workspace/:workspaceId/pull',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: GitPullResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const context = await resolveWorkspaceGitContext(
          request.params.workspaceId,
          request.query.repo ?? ''
        );
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });

        const opts = { cwd: context.cwd, timeoutMs: GIT_NETWORK_TIMEOUT_MS };
        await runGit(['fetch'], opts);
        const { behindCount } = await getBranchMeta(context.cwd);
        const { stdout, stderr } = await runGit(['pull', '--ff-only'], opts);
        const output = (stdout + '\n' + stderr).trim();
        const upToDate = behindCount === 0;
        return { output, upToDate, commitCount: upToDate ? 0 : behindCount };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );

  // POST /api/git/workspace/:workspaceId/checkout — switch to a local branch or track a remote branch
  fastifyInstance.post(
    '/api/git/workspace/:workspaceId/checkout',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        body: Type.Object({
          branch: Type.String({ minLength: 1 }),
          remoteBranch: Type.Optional(Type.String({ minLength: 1 })),
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: GitCheckoutResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const context = await resolveWorkspaceGitContext(
          request.params.workspaceId,
          request.body.repo ?? ''
        );
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });

        ensureSafeGitArg(request.body.branch, 'branch name');
        const remoteBranch = request.body.remoteBranch?.trim();
        const args = ['switch', request.body.branch];

        if (remoteBranch) {
          ensureSafeGitArg(remoteBranch, 'remote branch');
          const { remoteBranches } = await listBranches(context.cwd);
          if (!remoteBranches.includes(remoteBranch)) throw new NotFoundError('Remote branch not found');
          args.splice(1, 1, '--track', remoteBranch);
        }

        await runGit(args, { cwd: context.cwd });
        const branch = await maybeGitOutput(context.cwd, ['branch', '--show-current'], request.body.branch);
        return { branch };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );

  // POST /api/git/workspace/:workspaceId/branches — create a branch, optionally switching to it
  fastifyInstance.post(
    '/api/git/workspace/:workspaceId/branches',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        body: Type.Object({
          branch: Type.String({ minLength: 1 }),
          startPoint: Type.Optional(Type.String()),
          checkout: Type.Optional(Type.Boolean()),
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: GitCreateBranchResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const context = await resolveWorkspaceGitContext(
          request.params.workspaceId,
          request.body.repo ?? ''
        );
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });

        await ensureBranchName(context.cwd, request.body.branch);
        const startPoint = request.body.startPoint?.trim();
        if (startPoint) ensureSafeGitArg(startPoint, 'start point');

        const args = request.body.checkout ? ['switch', '-c', request.body.branch] : ['branch', request.body.branch];
        if (startPoint) args.push(startPoint);
        await runGit(args, { cwd: context.cwd });

        return { branch: request.body.branch, checkedOut: request.body.checkout === true };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );

  // POST /api/git/workspace/:workspaceId/discard — discard selected working tree changes
  fastifyInstance.post(
    '/api/git/workspace/:workspaceId/discard',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        body: Type.Object({
          files: Type.Array(Type.String(), { minItems: 1 }),
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: GitDiscardResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const context = await resolveWorkspaceGitContext(
          request.params.workspaceId,
          request.body.repo ?? ''
        );
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });

        const status = await getRepoStatus(context.baseCwd, context.repo);
        const statusByRepoPath = new Map(
          status.files.map((file) => [toRepoRelativePath(context.repo, file.file), file.status])
        );
        const trackedFiles: string[] = [];
        const untrackedFiles: string[] = [];

        for (const workspaceFile of request.body.files) {
          const repoFile = ensureSafeGitArg(toRepoRelativePath(context.repo, workspaceFile), 'file path');
          safeRepoFilePath(context.cwd, repoFile);
          const fileStatus = statusByRepoPath.get(repoFile);
          if (!fileStatus) throw new BadRequestError(`No pending change found for ${workspaceFile}`);
          if (fileStatus === '??') {
            untrackedFiles.push(repoFile);
          } else {
            trackedFiles.push(repoFile);
          }
        }

        if (trackedFiles.length > 0) {
          await runGit(['restore', '--source=HEAD', '--staged', '--worktree', '--', ...trackedFiles], {
            cwd: context.cwd
          });
        }
        for (const repoFile of untrackedFiles) {
          await rm(safeRepoFilePath(context.cwd, repoFile), { recursive: true, force: true });
        }

        return { discarded: request.body.files };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );

  // POST /api/git/workspace/:workspaceId/commit — stage selected (or all) changes and commit
  fastifyInstance.post(
    '/api/git/workspace/:workspaceId/commit',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        body: Type.Object({
          message: Type.String({ minLength: 1 }),
          files: Type.Optional(Type.Array(Type.String())),
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: GitCommitResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const context = await resolveWorkspaceGitContext(
          request.params.workspaceId,
          request.body.repo ?? ''
        );
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });

        const opts = { cwd: context.cwd, env: gitIdentityEnv(context.workspace) };
        const filesToStage = request.body.files;
        if (filesToStage && filesToStage.length > 0) {
          const repoRelativeFiles = filesToStage.map((file) => {
            const repoFile = ensureSafeGitArg(toRepoRelativePath(context.repo, file), 'file path');
            safeRepoFilePath(context.cwd, repoFile);
            return repoFile;
          });
          await runGit(['add', '--', ...repoRelativeFiles], opts);
        } else {
          await runGit(['add', '-A'], opts);
        }
        await runGit(['commit', '-m', request.body.message], opts);
        const { stdout } = await runGit(['log', '-1', '--format=%H %s'], opts);
        const [hash, ...rest] = stdout.trim().split(' ');
        return { hash, message: rest.join(' ') };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );

  // POST /api/git/workspace/:workspaceId/push — push current branch to remote
  fastifyInstance.post(
    '/api/git/workspace/:workspaceId/push',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: GitPushResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const context = await resolveWorkspaceGitContext(
          request.params.workspaceId,
          request.query.repo ?? ''
        );
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });

        const { currentBranch, upstreamBranch, detached } = await getBranchMeta(context.cwd);
        if (detached) throw new ConflictError('Cannot push in detached HEAD state');

        const pushArgs = ['push'];
        if (!upstreamBranch) {
          const remote = await resolvePushRemote(context.cwd);
          ensureSafeGitArg(remote, 'remote');
          await ensureBranchName(context.cwd, currentBranch);
          pushArgs.push('-u', remote, currentBranch);
        }

        const { stdout, stderr } = await runGit(pushArgs, { cwd: context.cwd, timeoutMs: GIT_NETWORK_TIMEOUT_MS });
        markCiWatchPushed(request.params.workspaceId, context.repo);
        return { output: (stdout + '\n' + stderr).trim() };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );


  // GET /api/git/workspace/:workspaceId/log — recent commits
  fastifyInstance.get(
    '/api/git/workspace/:workspaceId/log',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({
          repo: Type.Optional(Type.String()),
          limit: Type.Optional(Type.String())
        }),
        response: {
          200: GitLogResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const context = await resolveWorkspaceGitContext(
          request.params.workspaceId,
          request.query.repo ?? ''
        );
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });
        const parsedLimit = parseInt(request.query.limit ?? '80', 10);
        const limit = Number.isFinite(parsedLimit) ? Math.min(200, Math.max(1, parsedLimit)) : 80;
        const { stdout } = await runGit(
          ['log', `-n${limit}`, '--date=iso-strict', '--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s'],
          { cwd: context.cwd, timeoutMs: 15_000 }
        );
        return { commits: parseGitLog(stdout) };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );

  // GET /api/git/workspace/:workspaceId/show — commit patch
  fastifyInstance.get(
    '/api/git/workspace/:workspaceId/show',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        querystring: Type.Object({
          hash: Type.String({ minLength: 7 }),
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: GitShowResponseSchema,
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      try {
        const context = await resolveWorkspaceGitContext(
          request.params.workspaceId,
          request.query.repo ?? ''
        );
        if (!context) return reply.code(404).send({ error: 'Workspace not found' });
        const hash = request.query.hash.trim();
        if (!/^[0-9a-fA-F]{7,40}$/.test(hash)) {
          return reply.code(400).send({ error: 'Invalid commit hash' });
        }
        const { stdout } = await runGit(
          ['show', '--stat', '-p', '--format=commit %H%nAuthor: %an <%ae>%nDate: %ad%n%n%s%n%n%b', hash, '--'],
          { cwd: context.cwd, timeoutMs: 15_000, maxBuffer: 2 * 1024 * 1024 }
        );
        return { hash, patch: stdout };
      } catch (err) {
        throw gitHttpError(err);
      }
    }
  );
}

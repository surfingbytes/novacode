// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';
import { config } from '../classes/config';
import { sshEnvForGit } from '../classes/sshKey';
import { runClaudeAcp } from '../classes/claudeAcp';
import { runCodexAcp } from '../classes/codexAcp';
import { runCursorAcp } from '../classes/cursorAcp';
import { runOpenCodeAcp } from '../classes/openCodeAcp';
import { runVibeAcp } from '../classes/vibeAcp';

// types
import type { AgentType } from '../@types';

const execFileAsync = promisify(execFile);
const COMMIT_MESSAGE_DIFF_MAX_CHARS = 60_000;
const COMMIT_MESSAGE_FILE_DIFF_MAX_CHARS = 12_000;
const COMMIT_MESSAGE_AGENT_TYPES: AgentType[] = ['cursor-agent', 'claude', 'mistral-vibe', 'open-code', 'codex'];

interface RepoStatusFile {
  status: string;
  file: string;
  repo: string;
}

interface RepoStatus {
  repo: string;
  currentBranch: string;
  upstreamBranch: string | null;
  aheadCount: number;
  behindCount: number;
  detached: boolean;
  dirty: boolean;
  files: RepoStatusFile[];
}

interface BranchInfo {
  name: string;
  current: boolean;
  upstream: string | null;
}

interface WorkspaceGitContext {
  workspace: {
    path: string;
    gitUserName?: string | null;
    gitUserEmail?: string | null;
    defaultAgentType?: string | null;
  };
  baseCwd: string;
  repo: string;
  cwd: string;
  repoPaths: string[];
}

function gitEnv(workspace: {
  gitUserName?: string | null;
  gitUserEmail?: string | null;
}): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  env['HOME'] = config.configDir;
  Object.assign(env, sshEnvForGit(config.configDir));
  if (workspace.gitUserName) {
    env['GIT_AUTHOR_NAME'] = workspace.gitUserName;
    env['GIT_COMMITTER_NAME'] = workspace.gitUserName;
  }
  if (workspace.gitUserEmail) {
    env['GIT_AUTHOR_EMAIL'] = workspace.gitUserEmail;
    env['GIT_COMMITTER_EMAIL'] = workspace.gitUserEmail;
  }
  return env;
}

async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function discoverGitRepos(baseCwd: string): Promise<string[]> {
  const repos = new Set<string>();
  const skipDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache']);
  /** Only the workspace root and immediate child directories are scanned for `.git` (no deeper nesting). */
  const maxDepth = 1;

  if (await isGitRepo(baseCwd)) repos.add('');

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = (await readdir(dir, { withFileTypes: true, encoding: 'utf8' })) as Array<{
        name: string;
        isDirectory: () => boolean;
      }>;
    } catch {
      return;
    }

    const hasGit = entries.some((entry) => entry.name === '.git');
    if (hasGit) {
      const rel = path.relative(baseCwd, dir).replace(/\\/g, '/');
      repos.add(rel === '.' ? '' : rel);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (skipDirs.has(entry.name)) continue;
      const child = path.join(dir, entry.name);
      await walk(child, depth + 1);
    }
  };

  await walk(baseCwd, 0);

  return [...repos].sort((a, b) => a.localeCompare(b));
}

function repoCwd(baseCwd: string, repo: string): string {
  return repo ? path.join(baseCwd, repo) : baseCwd;
}

function gitErrorMessage(err: unknown): string {
  const gitErr = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
  return gitErr.stderr?.trim() || gitErr.stdout?.trim() || (err as Error).message;
}

async function gitOutput(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, env });
  return stdout.trim();
}

async function maybeGitOutput(
  cwd: string,
  args: string[],
  fallback: string,
  env?: Record<string, string>
): Promise<string> {
  try {
    return await gitOutput(cwd, args, env);
  } catch {
    return fallback;
  }
}

function ensureSafeGitArg(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`);
  if (value.includes('\0') || value.startsWith('-')) throw new Error(`Invalid ${label}`);
}

async function ensureBranchName(cwd: string, branch: string): Promise<void> {
  ensureSafeGitArg(branch, 'branch name');
  await execFileAsync('git', ['check-ref-format', '--branch', branch], { cwd });
}

async function resolveWorkspaceGitContext(
  workspaceId: string,
  repo = ''
): Promise<WorkspaceGitContext | null> {
  const workspace = await db.getWorkspace(workspaceId);
  if (!workspace) return null;

  const workspaceRel = workspace.path.replace(/^\//, '');
  const baseCwd = config.workspaceBrowseRoot + '/' + (workspaceRel || '.');
  const repoPaths = await discoverGitRepos(baseCwd);

  if (repoPaths.length === 0) throw new Error('No Git repositories found');
  if (!repoPaths.includes(repo)) throw new Error('Repository not found in workspace');

  return {
    workspace,
    baseCwd,
    repo,
    cwd: repoCwd(baseCwd, repo),
    repoPaths
  };
}

async function getBranchMeta(cwd: string): Promise<{
  currentBranch: string;
  upstreamBranch: string | null;
  aheadCount: number;
  behindCount: number;
  detached: boolean;
}> {
  const branch = await maybeGitOutput(cwd, ['branch', '--show-current'], '');
  const detached = !branch;
  const currentBranch = branch || (await maybeGitOutput(cwd, ['rev-parse', '--short', 'HEAD'], 'HEAD'));
  const upstream = await maybeGitOutput(
    cwd,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    ''
  );

  let aheadCount = 0;
  let behindCount = 0;
  if (upstream) {
    const counts = await maybeGitOutput(cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], '');
    const [ahead, behind] = counts.split(/\s+/);
    aheadCount = parseInt(ahead, 10) || 0;
    behindCount = parseInt(behind, 10) || 0;
  }

  return {
    currentBranch,
    upstreamBranch: upstream || null,
    aheadCount,
    behindCount,
    detached
  };
}

async function getRepoStatus(baseCwd: string, repo: string): Promise<RepoStatus> {
  const cwd = repoCwd(baseCwd, repo);
  const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-u'], { cwd });
  const files = stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const repoFile = line.slice(3).trim();
      const workspaceFile = repo ? `${repo}/${repoFile}` : repoFile;
      return {
        status: line.slice(0, 2).trim(),
        file: workspaceFile,
        repo
      };
    });

  const branchMeta = await getBranchMeta(cwd);

  return { repo, ...branchMeta, dirty: files.length > 0, files };
}

function toRepoRelativePath(repo: string, workspaceFile: string): string {
  if (!repo) return workspaceFile;
  const prefix = `${repo}/`;
  if (workspaceFile.startsWith(prefix)) return workspaceFile.slice(prefix.length);
  return workspaceFile;
}

function safeRepoFilePath(cwd: string, repoFile: string): string {
  const absolute = path.resolve(cwd, repoFile);
  const root = path.resolve(cwd);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new Error('File path escapes repository');
  }
  return absolute;
}

async function listBranches(cwd: string): Promise<{
  branches: BranchInfo[];
  remoteBranches: string[];
  currentBranch: string;
  upstreamBranch: string | null;
  detached: boolean;
}> {
  const meta = await getBranchMeta(cwd);
  const localRaw = await maybeGitOutput(
    cwd,
    ['for-each-ref', '--format=%(refname:short)%00%(upstream:short)%00%(HEAD)', 'refs/heads'],
    ''
  );
  const branches = localRaw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, upstream, head] = line.split('\0');
      return {
        name,
        upstream: upstream || null,
        current: head === '*' || name === meta.currentBranch
      };
    });
  const remoteRaw = await maybeGitOutput(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], '');
  const remoteBranches = remoteRaw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.endsWith('/HEAD'));

  return {
    branches,
    remoteBranches,
    currentBranch: meta.currentBranch,
    upstreamBranch: meta.upstreamBranch,
    detached: meta.detached
  };
}

function appendAssistantText(line: string, chunks: string[]): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }

  if (typeof event.sessionId === 'string' && event.update && typeof event.update === 'object') {
    const update = event.update as Record<string, unknown>;
    const content = update.content as { type?: string; text?: string } | undefined;
    if (update.sessionUpdate === 'agent_message_chunk' && content?.type === 'text' && content.text) {
      chunks.push(content.text);
    }
    return;
  }

  if (event.type === 'stream' && typeof event.data === 'string') {
    appendAssistantText(event.data, chunks);
    return;
  }

  if (event.type === 'assistant' && Array.isArray((event.message as Record<string, unknown>)?.content)) {
    const content = (event.message as Record<string, unknown>).content as Array<{
      type?: string;
      text?: string;
    }>;
    for (const block of content) {
      if (block.type === 'text' && block.text) chunks.push(block.text);
    }
    return;
  }

  if ((event.role === 'assistant' || event.type === 'assistant') && typeof event.content === 'string') {
    chunks.push(event.content);
  }
}

function cleanGeneratedCommitMessage(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:text)?/i, '')
    .replace(/```$/i, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

async function runCommitMessageAgent(params: {
  agentType: AgentType;
  cwd: string;
  promptText: string;
  model: string;
  claudeToken?: string | null;
}): Promise<string> {
  const chunks: string[] = [];
  const onEvent = (line: string): void => appendAssistantText(line, chunks);
  const runId = `git-commit-message-${randomUUID()}`;
  let result: { error?: string };

  if (params.agentType === 'open-code') {
    result = await runOpenCodeAcp(
      { acpSessionId: null, cwd: params.cwd, promptText: params.promptText, model: params.model },
      onEvent,
      runId
    );
  } else if (params.agentType === 'codex') {
    result = await runCodexAcp(
      { acpSessionId: null, cwd: params.cwd, promptText: params.promptText, model: params.model },
      onEvent,
      runId
    );
  } else if (params.agentType === 'mistral-vibe') {
    result = await runVibeAcp(
      { acpSessionId: null, cwd: params.cwd, promptText: params.promptText },
      onEvent,
      runId
    );
  } else if (params.agentType === 'claude') {
    result = await runClaudeAcp(
      { acpSessionId: null, cwd: params.cwd, promptText: params.promptText, claudeToken: params.claudeToken },
      onEvent
    );
  } else {
    result = await runCursorAcp(
      { acpSessionId: null, cwd: params.cwd, promptText: params.promptText },
      onEvent,
      runId
    );
  }

  if (result.error) throw new Error(result.error);
  const message = cleanGeneratedCommitMessage(chunks.join(''));
  if (!message) throw new Error('AI did not return a commit message');
  return message;
}

function buildCommitMessagePrompt(diff: string): string {
  return `Generate a concise git commit message for the following changes.

Rules:
- Return only the commit message text.
- Use an imperative subject line.
- Keep the subject under 72 characters.
- Add a short body only if it helps explain why.
- Do not wrap the answer in quotes or markdown fences.

Diff:
${diff}`;
}

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
          200: Type.Object({
            files: Type.Array(
              Type.Object({
                status: Type.String(),
                file: Type.String(),
                repo: Type.String()
              })
            ),
            aheadCount: Type.Number(),
            repos: Type.Array(
              Type.Object({
                repo: Type.String(),
                currentBranch: Type.String(),
                upstreamBranch: Type.Union([Type.String(), Type.Null()]),
                aheadCount: Type.Number(),
                behindCount: Type.Number(),
                detached: Type.Boolean(),
                dirty: Type.Boolean(),
                files: Type.Array(
                  Type.Object({
                    status: Type.String(),
                    file: Type.String(),
                    repo: Type.String()
                  })
                )
              })
            )
          }),
          404: Type.Object({ error: Type.String() }),
          400: Type.Object({ error: Type.String() })
        }
      }
    },
    async (request, reply) => {
      const workspace = await db.getWorkspace(request.params.workspaceId);
      if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

      try {
        const workspaceRel = workspace.path.replace(/^\//, '');
        const baseCwd = config.workspaceBrowseRoot + '/' + (workspaceRel || '.');
        const repoPaths = await discoverGitRepos(baseCwd);
        const repos = await Promise.all(repoPaths.map((repo) => getRepoStatus(baseCwd, repo)));
        const files = repos.flatMap((repo) => repo.files);
        const aheadCount = repos.reduce((sum, repo) => sum + repo.aheadCount, 0);

        // Legacy fallback: return single flat status error shape only when no repo exists.
        if (repos.length === 0) {
          return { files: [], aheadCount: 0, repos: [] };
        }
        return { files, aheadCount, repos };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
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
          200: Type.Object({ diff: Type.String() }),
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
        const opts = {
          cwd: context.cwd,
          maxBuffer: 5 * 1024 * 1024
        };

        // Untracked file: diff against /dev/null
        if (status === '??') {
          let diff = '';
          try {
            await execFileAsync('git', ['diff', '--no-index', '/dev/null', repoFile], opts);
          } catch (err) {
            // git diff --no-index exits with code 1 when differences exist; stdout still has the diff
            diff = (err as NodeJS.ErrnoException & { stdout?: string }).stdout ?? '';
          }
          return { diff };
        }

        // Try combined staged + unstaged diff vs HEAD
        const { stdout: headDiff } = await execFileAsync(
          'git',
          ['diff', 'HEAD', '--', repoFile],
          opts
        ).catch((error) => {
          console.log('error', error);
          return { stdout: '' };
        });

        if (headDiff.trim()) return { diff: headDiff };

        // Fallback: staged-only (new file added with git add)
        const { stdout: cachedDiff } = await execFileAsync(
          'git',
          ['diff', '--cached', '--', repoFile],
          opts
        ).catch(() => ({ stdout: '' }));

        return { diff: cachedDiff };
      } catch (err) {
        return reply.code(400).send({ error: gitErrorMessage(err) });
      }
    }
  );

  // POST /api/git/workspace/:workspaceId/commit-message — generate a commit message for selected files
  fastifyInstance.post(
    '/api/git/workspace/:workspaceId/commit-message',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        body: Type.Object({
          files: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: Type.Object({ message: Type.String() }),
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
          const opts = { cwd: context.cwd, maxBuffer: 5 * 1024 * 1024 };
          let diff = '';

          if (fileStatus === '??') {
            try {
              await execFileAsync('git', ['diff', '--no-index', '/dev/null', repoFile], opts);
            } catch (err) {
              diff = (err as NodeJS.ErrnoException & { stdout?: string }).stdout ?? '';
            }
          } else {
            const { stdout: headDiff } = await execFileAsync(
              'git',
              ['diff', 'HEAD', '--', repoFile],
              opts
            ).catch(() => ({ stdout: '' }));
            if (headDiff.trim()) {
              diff = headDiff;
            } else {
              const { stdout: cachedDiff } = await execFileAsync(
                'git',
                ['diff', '--cached', '--', repoFile],
                opts
              ).catch(() => ({ stdout: '' }));
              diff = cachedDiff;
            }
          }

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
        const configuredAgentType = context.workspace.defaultAgentType as AgentType | null | undefined;
        const agentType = configuredAgentType && COMMIT_MESSAGE_AGENT_TYPES.includes(configuredAgentType)
          ? configuredAgentType
          : 'cursor-agent';
        const message = await runCommitMessageAgent({
          agentType,
          cwd: context.cwd,
          promptText: buildCommitMessagePrompt(diff),
          model: user?.modelSelection ?? 'auto',
          claudeToken: user?.claudeToken ?? null
        });

        return { message };
      } catch (err) {
        return reply.code(400).send({ error: gitErrorMessage(err) });
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
          200: Type.Object({
            branches: Type.Array(
              Type.Object({
                name: Type.String(),
                current: Type.Boolean(),
                upstream: Type.Union([Type.String(), Type.Null()])
              })
            ),
            remoteBranches: Type.Array(Type.String()),
            currentBranch: Type.String(),
            upstreamBranch: Type.Union([Type.String(), Type.Null()]),
            detached: Type.Boolean()
          }),
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
        return reply.code(400).send({ error: gitErrorMessage(err) });
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
          200: Type.Object({
            output: Type.String(),
            upToDate: Type.Boolean(),
            behindCount: Type.Number()
          }),
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

        const opts = {
          cwd: context.cwd,
          env: gitEnv(context.workspace),
          timeout: 60_000
        };
        const { stdout, stderr } = await execFileAsync('git', ['fetch'], opts);
        const { behindCount, upstreamBranch } = await getBranchMeta(context.cwd);
        const output = (stdout + '\n' + stderr).trim();
        const upToDate = !upstreamBranch || behindCount === 0;
        return { output, upToDate, behindCount };
      } catch (err) {
        return reply.code(400).send({ error: gitErrorMessage(err) });
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
          200: Type.Object({
            output: Type.String(),
            upToDate: Type.Boolean(),
            commitCount: Type.Number()
          }),
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

        const opts = {
          cwd: context.cwd,
          env: gitEnv(context.workspace),
          timeout: 60_000
        };
        await execFileAsync('git', ['fetch'], opts);
        const { behindCount } = await getBranchMeta(context.cwd);
        const { stdout, stderr } = await execFileAsync('git', ['pull', '--ff-only'], opts);
        const output = (stdout + '\n' + stderr).trim();
        const upToDate = behindCount === 0;
        return { output, upToDate, commitCount: upToDate ? 0 : behindCount };
      } catch (err) {
        return reply.code(400).send({ error: gitErrorMessage(err) });
      }
    }
  );

  // POST /api/git/workspace/:workspaceId/checkout — switch to an existing branch
  fastifyInstance.post(
    '/api/git/workspace/:workspaceId/checkout',
    {
      preHandler: jwtPreHandler,
      schema: {
        params: Type.Object({ workspaceId: Type.String() }),
        body: Type.Object({
          branch: Type.String({ minLength: 1 }),
          repo: Type.Optional(Type.String())
        }),
        response: {
          200: Type.Object({ branch: Type.String() }),
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
        await execFileAsync('git', ['switch', request.body.branch], {
          cwd: context.cwd,
          env: gitEnv(context.workspace)
        });
        const branch = await maybeGitOutput(context.cwd, ['branch', '--show-current'], request.body.branch);
        return { branch };
      } catch (err) {
        return reply.code(400).send({ error: gitErrorMessage(err) });
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
          200: Type.Object({ branch: Type.String(), checkedOut: Type.Boolean() }),
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
        await execFileAsync('git', args, {
          cwd: context.cwd,
          env: gitEnv(context.workspace)
        });

        return { branch: request.body.branch, checkedOut: request.body.checkout === true };
      } catch (err) {
        return reply.code(400).send({ error: gitErrorMessage(err) });
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
          200: Type.Object({ discarded: Type.Array(Type.String()) }),
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
          const repoFile = toRepoRelativePath(context.repo, workspaceFile);
          safeRepoFilePath(context.cwd, repoFile);
          const fileStatus = statusByRepoPath.get(repoFile);
          if (!fileStatus) throw new Error(`No pending change found for ${workspaceFile}`);
          if (fileStatus === '??') {
            untrackedFiles.push(repoFile);
          } else {
            trackedFiles.push(repoFile);
          }
        }

        if (trackedFiles.length > 0) {
          await execFileAsync('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...trackedFiles], {
            cwd: context.cwd
          });
        }
        for (const repoFile of untrackedFiles) {
          await rm(safeRepoFilePath(context.cwd, repoFile), { recursive: true, force: true });
        }

        return { discarded: request.body.files };
      } catch (err) {
        return reply.code(400).send({ error: gitErrorMessage(err) });
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
          200: Type.Object({ hash: Type.String(), message: Type.String() }),
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

        const env = gitEnv(context.workspace);
        const opts = { cwd: context.cwd, env };
        const filesToStage = request.body.files;
        if (filesToStage && filesToStage.length > 0) {
          const repoRelativeFiles = filesToStage.map((file) => {
            const repoFile = toRepoRelativePath(context.repo, file);
            safeRepoFilePath(context.cwd, repoFile);
            return repoFile;
          });
          await execFileAsync('git', ['add', '--', ...repoRelativeFiles], opts);
        } else {
          await execFileAsync('git', ['add', '-A'], opts);
        }
        await execFileAsync('git', ['commit', '-m', request.body.message], opts);
        const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%H %s'], opts);
        const [hash, ...rest] = stdout.trim().split(' ');
        return { hash, message: rest.join(' ') };
      } catch (err) {
        return reply.code(400).send({ error: gitErrorMessage(err) });
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
          200: Type.Object({ output: Type.String() }),
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

        const { stdout, stderr } = await execFileAsync('git', ['push'], {
          cwd: context.cwd,
          env: gitEnv(context.workspace),
          timeout: 30_000
        });
        return { output: (stdout + '\n' + stderr).trim() };
      } catch (err) {
        return reply.code(400).send({ error: gitErrorMessage(err) });
      }
    }
  );
}

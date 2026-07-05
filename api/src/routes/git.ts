// node_modules
import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

// classes
import { jwtPreHandler } from '../classes/auth';
import { db } from '../classes/database';
import { config } from '../classes/config';
import { sshEnvForGit } from '../classes/sshKey';

const execFileAsync = promisify(execFile);

interface RepoStatusFile {
  status: string;
  file: string;
  repo: string;
}

interface RepoStatus {
  repo: string;
  aheadCount: number;
  files: RepoStatusFile[];
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

  let aheadCount = 0;
  try {
    const { stdout: revList } = await execFileAsync(
      'git',
      ['rev-list', '--count', '@{upstream}..HEAD'],
      { cwd }
    );
    aheadCount = parseInt(revList.trim(), 10) || 0;
  } catch {
    // No upstream configured or other error — leave as 0
  }

  return { repo, aheadCount, files };
}

function toRepoRelativePath(repo: string, workspaceFile: string): string {
  if (!repo) return workspaceFile;
  const prefix = `${repo}/`;
  if (workspaceFile.startsWith(prefix)) return workspaceFile.slice(prefix.length);
  return workspaceFile;
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
                aheadCount: Type.Number(),
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
      const workspace = await db.getWorkspace(request.params.workspaceId);
      if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

      const { file, status, repo = '' } = request.query;
      const workspaceRel = workspace.path.replace(/^\//, '');
      const baseCwd = config.workspaceBrowseRoot + '/' + (workspaceRel || '.');
      const cwd = repoCwd(baseCwd, repo);
      const repoFile = toRepoRelativePath(repo, file);
      const opts = {
        cwd,
        maxBuffer: 5 * 1024 * 1024
      };

      try {
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
        return reply.code(400).send({ error: (err as Error).message });
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
      const workspace = await db.getWorkspace(request.params.workspaceId);
      if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

      const workspaceRel = workspace.path.replace(/^\//, '');
      const baseCwd = config.workspaceBrowseRoot + '/' + (workspaceRel || '.');
      const repo = request.body.repo ?? '';
      const cwd = repoCwd(baseCwd, repo);
      const env = gitEnv(workspace);
      const opts = { cwd, env };

      try {
        const filesToStage = request.body.files;
        if (filesToStage && filesToStage.length > 0) {
          const repoRelativeFiles = filesToStage.map((file) => toRepoRelativePath(repo, file));
          await execFileAsync('git', ['add', '--', ...repoRelativeFiles], opts);
        } else {
          await execFileAsync('git', ['add', '-A'], opts);
        }
        await execFileAsync('git', ['commit', '-m', request.body.message], opts);
        const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%H %s'], opts);
        const [hash, ...rest] = stdout.trim().split(' ');
        return { hash, message: rest.join(' ') };
      } catch (err) {
        const stderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? '';
        return reply.code(400).send({ error: stderr || (err as Error).message });
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
      const workspace = await db.getWorkspace(request.params.workspaceId);
      if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

      const workspaceRel = workspace.path.replace(/^\//, '');
      const baseCwd = config.workspaceBrowseRoot + '/' + (workspaceRel || '.');
      const cwd = repoCwd(baseCwd, request.query.repo ?? '');
      const env = gitEnv(workspace);

      try {
        const { stdout, stderr } = await execFileAsync('git', ['push'], {
          cwd,
          env,
          timeout: 30_000
        });
        return { output: (stdout + '\n' + stderr).trim() };
      } catch (err) {
        const stderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? '';
        return reply.code(400).send({ error: stderr || (err as Error).message });
      }
    }
  );
}

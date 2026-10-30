// node_modules
import { readdir } from 'node:fs/promises';
import path from 'node:path';

// classes
import { db } from './database';
import { resolveWorkspaceAbsolutePath } from './workspacePaths';
import { ensureSafeGitArg, GitCommandError, parsePorcelainZ, runGit } from './runGit';
import { BadRequestError, NotFoundError } from './httpErrors';

// types
import type { GitBranchesResponse, GitRepoStatus } from '@novacode/shared';

const DIFF_MAX_BUFFER = 5 * 1024 * 1024;
/** How long a workspace's repo list (readdir + `git rev-parse`) is reused across git requests. */
const WORKSPACE_REPOS_CACHE_TTL_MS = 5_000;

export interface WorkspaceGitContext {
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

/** Commit identity from the workspace settings; runGit adds the rest of the child env. */
export function gitIdentityEnv(workspace: {
  gitUserName?: string | null;
  gitUserEmail?: string | null;
}): Record<string, string> {
  const env: Record<string, string> = {};
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
    const { stdout } = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd });
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

async function gitOutput(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  const { stdout } = await runGit(args, { cwd, env });
  return stdout.trim();
}

export async function maybeGitOutput(
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

export async function ensureBranchName(cwd: string, branch: string): Promise<void> {
  ensureSafeGitArg(branch, 'branch name');
  await runGit(['check-ref-format', '--branch', branch], { cwd });
}

/** Prefer origin; otherwise the first configured remote. */
export async function resolvePushRemote(cwd: string): Promise<string> {
  const remotesRaw = await maybeGitOutput(cwd, ['remote'], '');
  const remotes = remotesRaw
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean);
  if (remotes.length === 0) throw new BadRequestError('No git remotes configured');
  if (remotes.includes('origin')) return 'origin';
  return remotes[0];
}

export interface WorkspaceRepos {
  workspace: WorkspaceGitContext['workspace'];
  baseCwd: string;
  repoPaths: string[];
}

const workspaceReposCache = new Map<string, { expiresAt: number; value: Promise<WorkspaceRepos | null> }>();

async function loadWorkspaceRepos(workspaceId: string): Promise<WorkspaceRepos | null> {
  const workspace = await db.getWorkspace(workspaceId);
  if (!workspace) return null;
  const baseCwd = resolveWorkspaceAbsolutePath(workspace.path);
  return { workspace, baseCwd, repoPaths: await discoverGitRepos(baseCwd) };
}

/** Workspace row + discovered repos, shared by git requests for WORKSPACE_REPOS_CACHE_TTL_MS. */
export function getWorkspaceRepos(workspaceId: string): Promise<WorkspaceRepos | null> {
  const now = Date.now();
  const cached = workspaceReposCache.get(workspaceId);
  if (cached && cached.expiresAt > now) return cached.value;

  for (const [id, entry] of workspaceReposCache) {
    if (entry.expiresAt <= now) workspaceReposCache.delete(id);
  }
  const value = loadWorkspaceRepos(workspaceId);
  workspaceReposCache.set(workspaceId, { expiresAt: now + WORKSPACE_REPOS_CACHE_TTL_MS, value });
  value.catch(() => {
    if (workspaceReposCache.get(workspaceId)?.value === value) workspaceReposCache.delete(workspaceId);
  });
  return value;
}

/** Test hook: forget cached workspace repo lists. */
export function clearWorkspaceGitContextCache(): void {
  workspaceReposCache.clear();
}

export async function resolveWorkspaceGitContext(
  workspaceId: string,
  repo = ''
): Promise<WorkspaceGitContext | null> {
  const repos = await getWorkspaceRepos(workspaceId);
  if (!repos) return null;
  const { workspace, baseCwd, repoPaths } = repos;

  if (repoPaths.length === 0) throw new NotFoundError('No Git repositories found');
  if (!repoPaths.includes(repo)) throw new NotFoundError('Repository not found in workspace');

  return {
    workspace,
    baseCwd,
    repo,
    cwd: repoCwd(baseCwd, repo),
    repoPaths
  };
}

export async function getBranchMeta(cwd: string): Promise<{
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

export async function getRepoStatus(baseCwd: string, repo: string): Promise<GitRepoStatus> {
  const cwd = repoCwd(baseCwd, repo);
  const { stdout } = await runGit(['status', '--porcelain', '-z', '-u'], { cwd });
  const files = parsePorcelainZ(stdout).map(({ status, file }) => ({
    status,
    file: repo ? `${repo}/${file}` : file,
    repo
  }));

  const branchMeta = await getBranchMeta(cwd);

  return { repo, ...branchMeta, dirty: files.length > 0, files };
}

export function toRepoRelativePath(repo: string, workspaceFile: string): string {
  if (!repo) return workspaceFile;
  const prefix = `${repo}/`;
  if (workspaceFile.startsWith(prefix)) return workspaceFile.slice(prefix.length);
  return workspaceFile;
}

export function safeRepoFilePath(cwd: string, repoFile: string): string {
  const absolute = path.resolve(cwd, repoFile);
  const root = path.resolve(cwd);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new BadRequestError('File path escapes repository');
  }
  return absolute;
}

/**
 * Diff of one repo-relative file: untracked files against /dev/null, otherwise
 * working tree vs HEAD, falling back to the staged diff (new file after `git add`).
 */
export async function fileDiff(cwd: string, repoFile: string, bUntracked: boolean): Promise<string> {
  ensureSafeGitArg(repoFile, 'file path');
  const opts = { cwd, maxBuffer: DIFF_MAX_BUFFER };

  if (bUntracked) {
    try {
      const { stdout } = await runGit(['diff', '--no-index', '--', '/dev/null', repoFile], opts);
      return stdout;
    } catch (err) {
      // git diff --no-index exits with code 1 when differences exist; stdout still has the diff
      if (err instanceof GitCommandError && err.code === 1) return err.stdout;
      throw err;
    }
  }

  const { stdout: headDiff } = await runGit(['diff', 'HEAD', '--', repoFile], opts).catch(() => ({ stdout: '' }));
  if (headDiff.trim()) return headDiff;

  const { stdout: cachedDiff } = await runGit(['diff', '--cached', '--', repoFile], opts).catch(() => ({
    stdout: ''
  }));
  return cachedDiff;
}

export async function listBranches(cwd: string): Promise<GitBranchesResponse> {
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

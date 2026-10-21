// node_modules
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

// classes
import { config } from './config';

/**
 * Git plumbing for parallel orchestrator runs: every step works in its own
 * worktree (outside the workspace, under /config/worktrees), finished steps are
 * merged into an integration worktree, and the result is applied back to the
 * workspace as uncommitted changes.
 */

const FALLBACK_IDENTITY = {
  GIT_AUTHOR_NAME: 'Nova Code',
  GIT_AUTHOR_EMAIL: 'nova@localhost',
  GIT_COMMITTER_NAME: 'Nova Code',
  GIT_COMMITTER_EMAIL: 'nova@localhost'
};

const CONFLICT_MARKER_RE = /^(<{7}|>{7})( |$)/m;

/** Ignored entries shared into worktrees via symlink so steps can build and test. */
const LINKED_IGNORED_RE = /^(node_modules|\.env(\..+)?)$/;

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function git(
  cwd: string,
  args: string[],
  opts: { env?: Record<string, string>; input?: string } = {}
): Promise<GitResult> {
  return new Promise((resolvePromise) => {
    const child = spawn('git', args, {
      cwd,
      env: { ...process.env, ...opts.env, GIT_TERMINAL_PROMPT: '0' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (err) => resolvePromise({ code: -1, stdout, stderr: stderr || err.message }));
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
    // git may exit without reading stdin; an unhandled EPIPE here would crash the process
    child.stdin.on('error', () => {});
    child.stdin.end(opts.input ?? '');
  });
}

async function gitOk(cwd: string, args: string[], opts: { env?: Record<string, string>; input?: string } = {}): Promise<string> {
  const result = await git(cwd, args, opts);
  if (result.code !== 0) {
    throw new Error(`git ${args[0]} failed: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`);
  }
  return result.stdout.trim();
}

export function worktreesRootDir(): string {
  return join(config.configDir, 'worktrees');
}

export function isUnderWorktreesRoot(path: string): boolean {
  const root = resolve(worktreesRootDir());
  const target = resolve(path);
  return target === root || target.startsWith(root + '/');
}

/** Git identity env: the workspace's (via `baseEnv`) or a fallback so plumbing commits never fail. */
async function identityEnv(cwd: string, baseEnv: Record<string, string>): Promise<Record<string, string>> {
  if (baseEnv['GIT_AUTHOR_EMAIL']) return baseEnv;
  const configured = await git(cwd, ['config', 'user.email'], { env: baseEnv });
  return configured.code === 0 && configured.stdout.trim() ? baseEnv : { ...FALLBACK_IDENTITY, ...baseEnv };
}

export interface RepoInfo {
  /** Repository top level. */
  root: string;
  /** Workspace path relative to the top level ('' when the workspace is the repo root). */
  subdir: string;
}

/** Repo containing `workspacePath`, or an error message explaining why parallel runs can't work. */
export async function resolveRepo(workspacePath: string): Promise<RepoInfo | { error: string }> {
  const top = await git(workspacePath, ['rev-parse', '--show-toplevel']);
  if (top.code !== 0) return { error: 'Parallel runs need the workspace to be a git repository.' };
  const head = await git(workspacePath, ['rev-parse', '--verify', 'HEAD']);
  if (head.code !== 0) return { error: 'Parallel runs need at least one commit in the repository.' };
  const root = top.stdout.trim();
  const subdir = relative(root, resolve(workspacePath));
  return { root, subdir: subdir === '.' ? '' : subdir };
}

/**
 * Commit of HEAD plus every uncommitted change (staged, unstaged and untracked,
 * not ignored), built with a temporary index so the user's index and files stay untouched.
 */
export async function createSnapshotCommit(repoRoot: string, baseEnv: Record<string, string>): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'nova-snapshot-'));
  const env = { ...(await identityEnv(repoRoot, baseEnv)), GIT_INDEX_FILE: join(tempDir, 'index') };
  try {
    await gitOk(repoRoot, ['read-tree', 'HEAD'], { env });
    await gitOk(repoRoot, ['add', '-A'], { env });
    const tree = await gitOk(repoRoot, ['write-tree'], { env });
    const headTree = await gitOk(repoRoot, ['rev-parse', 'HEAD^{tree}'], { env });
    if (tree === headTree) return gitOk(repoRoot, ['rev-parse', 'HEAD'], { env });
    return gitOk(repoRoot, ['commit-tree', tree, '-p', 'HEAD', '-m', 'Nova orchestrator: snapshot of uncommitted changes'], { env });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function headCommit(dir: string): Promise<string> {
  return gitOk(dir, ['rev-parse', 'HEAD']);
}

/** Fresh worktree at `dir` on `branch` (reset to `base`). */
export async function addWorktree(repoRoot: string, dir: string, branch: string, base: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await git(repoRoot, ['worktree', 'prune']);
  await mkdir(dirname(dir), { recursive: true });
  await gitOk(repoRoot, ['worktree', 'add', '--force', '-B', branch, dir, base]);
}

/**
 * Symlink ignored dependency folders and env files (node_modules, .env*) from
 * the repo into a worktree. Returns the linked paths (relative to the worktree).
 */
export async function linkIgnoredEntries(repoRoot: string, worktreeDir: string): Promise<string[]> {
  const listed = await git(repoRoot, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory']);
  if (listed.code !== 0) return [];
  const linked: string[] = [];
  for (const raw of listed.stdout.split('\n')) {
    const entry = raw.trim().replace(/\/+$/, '');
    if (!entry || !LINKED_IGNORED_RE.test(basename(entry))) continue;
    if (entry.split('/').slice(0, -1).includes('node_modules')) continue;
    const target = join(worktreeDir, entry);
    if (existsSync(target) || !existsSync(dirname(target))) continue;
    try {
      await symlink(join(repoRoot, entry), target);
      linked.push(entry);
    } catch {
      // best-effort: a step can still install dependencies itself
    }
  }
  return linked;
}

/** Commit everything in a worktree (except our symlinks). Returns false when there was nothing to commit. */
export async function commitAll(
  dir: string,
  message: string,
  baseEnv: Record<string, string>,
  excludePaths: string[] = []
): Promise<boolean> {
  const env = await identityEnv(dir, baseEnv);
  await gitOk(dir, ['add', '-A'], { env });
  if (excludePaths.length > 0) {
    await git(dir, ['reset', '-q', '--', ...excludePaths], { env });
  }
  const staged = await git(dir, ['diff', '--cached', '--quiet'], { env });
  if (staged.code === 0) return false;
  await gitOk(dir, ['commit', '-q', '--no-verify', '-m', message], { env });
  return true;
}

export async function unmergedFiles(dir: string): Promise<string[]> {
  const result = await git(dir, ['diff', '--name-only', '--diff-filter=U']);
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function isMergeInProgress(dir: string): Promise<boolean> {
  return git(dir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).then((result) => result.code === 0);
}

/** Merge `branch` into the worktree at `dir`. On conflict the merge is left in progress. */
export async function mergeBranch(
  dir: string,
  branch: string,
  message: string,
  baseEnv: Record<string, string>
): Promise<{ ok: true } | { ok: false; conflicts: string[]; error: string }> {
  const env = await identityEnv(dir, baseEnv);
  const result = await git(dir, ['merge', '--no-ff', '--no-edit', '-m', message, branch], { env });
  if (result.code === 0) return { ok: true };
  return { ok: false, conflicts: await unmergedFiles(dir), error: (result.stderr || result.stdout).trim() };
}

/** Finish a merge whose conflicts were resolved in the files (but maybe not staged/committed). */
export async function concludeMerge(dir: string, baseEnv: Record<string, string>): Promise<boolean> {
  if (!(await isMergeInProgress(dir))) return true;
  const env = await identityEnv(dir, baseEnv);
  for (const file of await unmergedFiles(dir)) {
    const content = await readFile(join(dir, file), 'utf8').catch(() => '');
    if (CONFLICT_MARKER_RE.test(content)) return false;
  }
  await git(dir, ['add', '-A'], { env });
  if ((await unmergedFiles(dir)).length > 0) return false;
  const result = await git(dir, ['commit', '-q', '--no-verify', '--no-edit'], { env });
  return result.code === 0;
}

export async function abortMerge(dir: string): Promise<void> {
  await git(dir, ['merge', '--abort']);
}

/**
 * Apply the changes between two commits to the user's working tree as
 * uncommitted edits (three-way when the plain patch doesn't fit).
 */
export async function applyCommitRangeToWorkingTree(
  repoRoot: string,
  from: string,
  to: string
): Promise<{ ok: true; bChanged: boolean } | { ok: false; error: string }> {
  const diff = await git(repoRoot, ['diff', '--binary', from, to]);
  if (diff.code !== 0) return { ok: false, error: diff.stderr.trim() || 'git diff failed' };
  if (!diff.stdout.trim()) return { ok: true, bChanged: false };
  const plain = await git(repoRoot, ['apply', '--whitespace=nowarn'], { input: diff.stdout });
  if (plain.code === 0) return { ok: true, bChanged: true };
  const threeWay = await git(repoRoot, ['apply', '--3way', '--whitespace=nowarn'], { input: diff.stdout });
  if (threeWay.code === 0) return { ok: true, bChanged: true };
  return { ok: false, error: (threeWay.stderr || plain.stderr).trim() || 'git apply failed' };
}

export async function removeWorktree(repoRoot: string, dir: string): Promise<void> {
  await git(repoRoot, ['worktree', 'remove', '--force', dir]);
  await rm(dir, { recursive: true, force: true });
  await git(repoRoot, ['worktree', 'prune']);
}

export async function deleteBranch(repoRoot: string, branch: string): Promise<void> {
  await git(repoRoot, ['branch', '-D', branch]);
}

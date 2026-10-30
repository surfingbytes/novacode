// node_modules
import { execFile } from 'node:child_process';

// classes
import { childEnv } from './childEnv';
import { BadRequestError, ConflictError, HttpError, UpstreamError } from './httpErrors';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;
/** Time between SIGTERM and SIGKILL once a git command times out. */
const KILL_GRACE_MS = 2_000;
/** Subcommands that talk to a remote; their timeouts and network failures answer 502. */
const NETWORK_SUBCOMMANDS = new Set(['fetch', 'pull', 'push', 'clone', 'ls-remote']);

/** Failures the user can fix in the repo (state of the tree or branches). */
const GIT_CONFLICT_RE =
  /CONFLICT|Automatic merge failed|unmerged|nothing to commit|nothing added to commit|no changes added to commit|would be overwritten|commit your changes or stash them|\[rejected\]|non-fast-forward|fetch first|Not possible to fast-forward|already exists|is already (?:checked out|used by worktree)|index\.lock/i;
/** Failures caused by the refs, paths or arguments the user picked. */
const GIT_BAD_REQUEST_RE =
  /unknown revision|bad revision|not a valid (?:object name|ref|branch name)|is not a valid branch name|invalid reference|invalid refspec|did not match any|ambiguous argument|bad object|not a commit|no upstream|no tracking information|No such remote|does not appear to be a git repository|Please tell me who you are|empty ident|not a git repository|does not have any commits yet/i;
const GIT_REMOTE_AUTH_RE =
  /Authentication failed|Permission denied \(publickey|could not read Username|could not read Password|terminal prompts disabled|Host key verification failed|HTTP Basic: Access denied|403 Forbidden/i;
const GIT_REMOTE_NETWORK_RE =
  /Could not resolve host|Connection refused|Connection timed out|Network is unreachable|Could not read from remote repository|unable to access|Operation timed out|early EOF|remote end hung up/i;

export interface RunGitOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  maxBuffer?: number;
  /** Written to git's stdin (e.g. a patch for `git apply`). Stdin is closed either way. */
  input?: string;
}

/** A git command that exited non-zero, timed out, overflowed its buffer or failed to spawn. */
export class GitCommandError extends Error {
  /** Exit code; null when git was killed (timeout, buffer overflow) or never started. */
  code: number | null;
  stderr: string;
  /** Output captured before the failure (`git diff --no-index` exits 1 with the diff here). */
  stdout: string;
  args: string[];
  bTimedOut: boolean;

  constructor(
    message: string,
    opts: { code: number | null; stderr: string; stdout: string; args: string[]; bTimedOut?: boolean }
  ) {
    super(message);
    this.name = 'GitCommandError';
    this.code = opts.code;
    this.stderr = opts.stderr;
    this.stdout = opts.stdout;
    this.args = opts.args;
    this.bTimedOut = opts.bTimedOut ?? false;
  }
}

/** Rejects client-supplied refs/paths that git would parse as options. Returns the value unchanged. */
export function ensureSafeGitArg(value: string, label = 'git argument'): string {
  if (!value.trim()) throw new BadRequestError(`${label} is required`);
  if (value.includes('\0') || value.startsWith('-')) throw new BadRequestError(`Invalid ${label}`);
  return value;
}

/**
 * Parses `git status --porcelain -z` output. Paths come back verbatim (no C-style quoting of
 * spaces/non-ASCII); renames/copies report the new path and skip the trailing original-path field.
 */
export function parsePorcelainZ(stdout: string): Array<{ status: string; file: string }> {
  const fields = stdout.split('\0');
  const entries: Array<{ status: string; file: string }> = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.length < 4) continue;
    const xy = field.slice(0, 2);
    entries.push({ status: xy.trim(), file: field.slice(3) });
    if (xy.includes('R') || xy.includes('C')) i++;
  }
  return entries;
}

/** Git's own explanation of a failure (stderr, else stdout — `nothing to commit` is on stdout). */
function gitErrorMessage(err: unknown): string {
  const gitErr = err as { stderr?: string; stdout?: string };
  return gitErr.stderr?.trim() || gitErr.stdout?.trim() || (err as Error).message;
}

/**
 * Maps a failure from a git route to an HttpError. User-caused git failures (conflicts, dirty
 * tree, unknown refs, nothing to commit, rejected push) → 409/400 with git's message; remote
 * auth/network failures and network timeouts → 502 with a fixed message; anything else
 * (git missing, EACCES, local timeout, buffer overflow, unrecognised exit) is returned unchanged
 * so the error handler logs it and answers a generic 500 without stderr or paths.
 */
export function gitHttpError(err: unknown): unknown {
  if (err instanceof HttpError || !(err instanceof GitCommandError)) return err;
  const subcommand = err.args[0] ?? '';
  const bNetwork = NETWORK_SUBCOMMANDS.has(subcommand);

  if (err.bTimedOut) {
    return bNetwork ? new UpstreamError(`git ${subcommand} timed out`, { expose: true, cause: err }) : err;
  }
  // Killed or never started (ENOENT, EACCES, maxBuffer): a server problem.
  if (err.code === null) return err;

  const detail = `${err.stderr}\n${err.stdout}`;
  if (GIT_CONFLICT_RE.test(detail)) return new ConflictError(gitErrorMessage(err), { cause: err });
  if (GIT_BAD_REQUEST_RE.test(detail)) return new BadRequestError(gitErrorMessage(err), { cause: err });
  if (GIT_REMOTE_AUTH_RE.test(detail)) {
    return new UpstreamError('The git remote rejected the credentials', { expose: true, cause: err });
  }
  if (GIT_REMOTE_NETWORK_RE.test(detail)) {
    return new UpstreamError('Could not reach the git remote', { expose: true, cause: err });
  }
  // `git commit` exits 1 for user-side reasons (nothing staged, a failing hook).
  if (subcommand === 'commit' && err.code === 1) return new BadRequestError(gitErrorMessage(err), { cause: err });
  return err;
}

/**
 * Runs git without a shell, with the curated child env (no server secrets, no
 * credential prompts, no optional index locks) and a hard timeout.
 */
export function runGit(args: string[], opts: RunGitOptions): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolvePromise, rejectPromise) => {
    let bSettled = false;
    let bTimedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    const settle = (fn: () => void): void => {
      if (bSettled) return;
      bSettled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      fn();
    };

    const child = execFile(
      'git',
      args,
      {
        cwd: opts.cwd,
        env: childEnv({ GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...opts.env }),
        maxBuffer: opts.maxBuffer ?? DEFAULT_MAX_BUFFER,
        encoding: 'utf8'
      },
      (err, stdout, stderr) => {
        settle(() => {
          if (!err) {
            resolvePromise({ stdout, stderr });
            return;
          }
          const code = typeof err.code === 'number' ? err.code : null;
          const detail = stderr.trim() || err.message;
          rejectPromise(
            new GitCommandError(`git ${args[0] ?? ''} failed: ${detail}`, { code, stderr, stdout, args })
          );
        });
      }
    );

    const timeoutTimer = setTimeout(() => {
      bTimedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
    }, timeoutMs);

    // On timeout, settle as soon as git itself exits: grandchildren (hooks, ssh)
    // may keep the pipes open, which would delay execFile's callback.
    child.once('exit', () => {
      if (!bTimedOut) return;
      child.stdout?.destroy();
      child.stderr?.destroy();
      settle(() =>
        rejectPromise(
          new GitCommandError(`git ${args[0] ?? ''} timed out after ${timeoutMs} ms`, {
            code: null,
            stderr: '',
            stdout: '',
            args,
            bTimedOut: true
          })
        )
      );
    });

    // git may exit without reading stdin; an unhandled EPIPE would crash the process
    child.stdin?.on('error', () => {});
    child.stdin?.end(opts.input ?? '');
  });
}

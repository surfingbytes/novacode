// node_modules
import { execFile, type ChildProcess } from 'node:child_process';

// classes
import { config } from './config';

/**
 * Env for spawned agents, CLIs and git: the curated `config.agentEnv()` plus
 * call-site extras. Never spreads `process.env`, so server secrets stay in the API.
 */
export function childEnv(extra?: Record<string, string>): Record<string, string> {
  return { ...config.agentEnv(), ...extra };
}

/**
 * Session `_meta` carrying the Claude OAuth token for the in-process Claude ACP agent.
 * The adapter merges `options.env` over `process.env` when it spawns the Claude CLI, so
 * the token goes here instead of into `process.env` (server secrets are scrubbed at boot).
 */
export function claudeTokenSessionMeta(claudeToken?: string | null): {
  claudeCode: { options?: { env: Record<string, string> } };
} {
  return claudeToken ? { claudeCode: { options: { env: { CLAUDE_CODE_OAUTH_TOKEN: claudeToken } } } } : { claudeCode: {} };
}

/**
 * Routes spawn failures (ENOENT for a missing binary) and stdin EPIPE to `onError`
 * (called at most once). Without listeners Node throws them as uncaught exceptions.
 */
export function onChildProcessError(proc: ChildProcess, onError: (err: Error) => void): void {
  let bReported = false;
  const report = (err: Error): void => {
    if (bReported) return;
    bReported = true;
    onError(err);
  };
  proc.on('error', report);
  proc.stdin?.on('error', report);
}

/** Promise that rejects when the child fails to spawn or its stdin errors. Never resolves. */
export function childProcessFailure(proc: ChildProcess): Promise<never> {
  const failure = new Promise<never>((_resolve, reject) => onChildProcessError(proc, reject));
  // Only observed via Promise.race; a late failure must not become an unhandled rejection.
  failure.catch(() => {});
  return failure;
}

export interface CliResult {
  /** Exit code; `null` when the process failed to spawn or was killed. */
  status: number | null;
  stdout: string;
  stderr: string;
  /** Spawn failure, non-zero exit or timeout kill. */
  error?: Error;
  timedOut: boolean;
}

/**
 * Async CLI probe (a sync spawn would block the event loop). Runs with
 * `childEnv()` in `config.configDir`. Never rejects: failures come back in the result.
 */
export function execCli(command: string, args: string[], opts: { timeoutMs: number }): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: 'utf8', timeout: opts.timeoutMs, cwd: config.configDir, env: childEnv() },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ status: 0, stdout, stderr, timedOut: false });
          return;
        }
        const code = (err as NodeJS.ErrnoException).code;
        resolve({
          status: typeof code === 'number' ? code : null,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          error: err,
          timedOut: err.killed === true && err.signal !== null && err.signal !== undefined
        });
      }
    );
  });
}

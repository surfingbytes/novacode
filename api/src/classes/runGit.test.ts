import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BadRequestError, ConflictError, UpstreamError } from './httpErrors';
import { ensureSafeGitArg, GitCommandError, gitHttpError, parsePorcelainZ, runGit } from './runGit';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nova-rungit-test-'));
  await runGit(['init', '-q', '-b', 'main'], { cwd: root });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('runGit', () => {
  it('returns stdout of a successful command and applies extra env', async () => {
    const env = {
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com'
    };
    await writeFile(join(root, 'a.txt'), 'a\n');
    await runGit(['add', '--', 'a.txt'], { cwd: root });
    await runGit(['commit', '-q', '-m', 'init'], { cwd: root, env });
    const { stdout } = await runGit(['log', '-1', '--format=%an %s'], { cwd: root });
    expect(stdout.trim()).toBe('Test init');
  });

  it('passes input to stdin', async () => {
    const { stdout } = await runGit(['hash-object', '--stdin'], { cwd: root, input: 'hello\n' });
    expect(stdout.trim()).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('throws GitCommandError with stderr and exit code on failure', async () => {
    const err = await runGit(['rev-parse', '--verify', 'does-not-exist'], { cwd: root }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitCommandError);
    const gitErr = err as GitCommandError;
    expect(gitErr.code).toBe(128);
    expect(gitErr.stderr).toMatch(/fatal/);
    expect(gitErr.args).toEqual(['rev-parse', '--verify', 'does-not-exist']);
    expect(gitErr.bTimedOut).toBe(false);
  });

  it('throws GitCommandError when output exceeds maxBuffer', async () => {
    await writeFile(join(root, 'big.txt'), 'x'.repeat(10_000));
    const err = await runGit(['diff', '--no-index', '--', '/dev/null', 'big.txt'], { cwd: root, maxBuffer: 100 }).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(GitCommandError);
    expect((err as GitCommandError).code).toBeNull();
  });

  it('kills a hanging git with SIGKILL after the SIGTERM grace and throws', async () => {
    const binDir = join(root, 'bin');
    const pidFile = join(root, 'pid');
    await runGit(['--version'], { cwd: root }); // real git still works before PATH is faked
    await mkdir(binDir);
    // Ignores SIGTERM, so only the SIGKILL escalation can stop it.
    await writeFile(
      join(binDir, 'git'),
      `#!/bin/sh\necho $$ > "${pidFile}"\ntrap '' TERM\nwhile :; do sleep 0.1; done\n`
    );
    await chmod(join(binDir, 'git'), 0o755);

    const startedAt = Date.now();
    const err = await runGit(['fetch'], {
      cwd: root,
      timeoutMs: 200,
      env: { PATH: `${binDir}:${process.env['PATH'] ?? ''}` }
    }).catch((e: unknown) => e);
    const elapsed = Date.now() - startedAt;

    expect(err).toBeInstanceOf(GitCommandError);
    expect((err as GitCommandError).bTimedOut).toBe(true);
    expect((err as GitCommandError).code).toBeNull();
    expect(elapsed).toBeGreaterThanOrEqual(2_000);
    expect(elapsed).toBeLessThan(6_000);
    const pid = parseInt(await readFile(pidFile, 'utf8'), 10);
    expect(isAlive(pid)).toBe(false);
  }, 10_000);

  it('stops a hanging git with SIGTERM before the grace period', async () => {
    const binDir = join(root, 'bin');
    await mkdir(binDir);
    await writeFile(join(binDir, 'git'), '#!/bin/sh\nexec sleep 30\n');
    await chmod(join(binDir, 'git'), 0o755);

    const startedAt = Date.now();
    const err = await runGit(['status'], {
      cwd: root,
      timeoutMs: 100,
      env: { PATH: `${binDir}:${process.env['PATH'] ?? ''}` }
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitCommandError);
    expect((err as GitCommandError).bTimedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});

describe('ensureSafeGitArg', () => {
  it('rejects option-like values', () => {
    expect(() => ensureSafeGitArg('-x')).toThrow();
    expect(() => ensureSafeGitArg('--upload-pack=touch /tmp/pwned')).toThrow();
    expect(() => ensureSafeGitArg('a\0b')).toThrow();
    expect(() => ensureSafeGitArg('  ')).toThrow();
  });

  it('returns safe values unchanged', () => {
    expect(ensureSafeGitArg('feature/x')).toBe('feature/x');
    expect(ensureSafeGitArg('src/a-b.ts', 'file path')).toBe('src/a-b.ts');
  });
});

describe('gitHttpError', () => {
  const gitError = (args: string[], opts: { code: number | null; stderr?: string; stdout?: string; bTimedOut?: boolean }) =>
    new GitCommandError('git failed', { stderr: '', stdout: '', args, ...opts });

  it('maps user-caused failures to 409/400 with git\'s message', () => {
    const conflict = gitHttpError(gitError(['pull'], { code: 128, stderr: 'fatal: Not possible to fast-forward, aborting.' }));
    expect(conflict).toBeInstanceOf(ConflictError);
    expect((conflict as ConflictError).message).toBe('fatal: Not possible to fast-forward, aborting.');

    const nothing = gitHttpError(gitError(['commit'], { code: 1, stdout: 'nothing to commit, working tree clean' }));
    expect(nothing).toBeInstanceOf(ConflictError);

    const hook = gitHttpError(gitError(['commit'], { code: 1, stderr: 'lint failed' }));
    expect(hook).toBeInstanceOf(BadRequestError);

    const badRef = gitHttpError(gitError(['switch'], { code: 128, stderr: 'fatal: invalid reference: nope' }));
    expect(badRef).toBeInstanceOf(BadRequestError);
  });

  it('maps remote failures and network timeouts to 502 without stderr', () => {
    const auth = gitHttpError(
      gitError(['push'], { code: 128, stderr: "fatal: Authentication failed for 'https://host/secret'" })
    );
    expect(auth).toBeInstanceOf(UpstreamError);
    expect((auth as UpstreamError).message).not.toContain('secret');

    const timeout = gitHttpError(gitError(['fetch'], { code: null, bTimedOut: true }));
    expect(timeout).toBeInstanceOf(UpstreamError);
    expect((timeout as UpstreamError).expose).toBe(true);
  });

  it('leaves server-side failures unchanged so they answer a generic 500', () => {
    const missing = gitError(['status'], { code: null, stderr: 'spawn git ENOENT' });
    expect(gitHttpError(missing)).toBe(missing);
    const localTimeout = gitError(['log'], { code: null, bTimedOut: true });
    expect(gitHttpError(localTimeout)).toBe(localTimeout);
    const unknown = gitError(['status'], { code: 128, stderr: "fatal: unable to read /srv/ws/.git/index" });
    expect(gitHttpError(unknown)).toBe(unknown);
    const plain = new Error('boom');
    expect(gitHttpError(plain)).toBe(plain);
  });

  it('throws BadRequestError for option-like arguments', () => {
    expect(() => ensureSafeGitArg('-x')).toThrow(BadRequestError);
  });
});

describe('parsePorcelainZ', () => {
  it('returns unquoted paths with spaces/non-ASCII and the new path of renames', async () => {
    const env = { GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@e.x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@e.x' };
    await writeFile(join(root, 'old.txt'), 'x');
    await runGit(['add', '.'], { cwd: root });
    await runGit(['commit', '-qm', 'init'], { cwd: root, env });
    await runGit(['mv', 'old.txt', 'new name.txt'], { cwd: root });
    await mkdir(join(root, 'dir with space'));
    await writeFile(join(root, 'dir with space', 'čaj.md'), 'x');

    const { stdout } = await runGit(['status', '--porcelain', '-z', '-u'], { cwd: root });
    expect(parsePorcelainZ(stdout)).toEqual([
      { status: 'R', file: 'new name.txt' },
      { status: '??', file: 'dir with space/čaj.md' }
    ]);
  });
});

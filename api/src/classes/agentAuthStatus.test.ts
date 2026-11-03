// node_modules
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// classes
import { config } from './config';
import { checkCursorAuth, clearCursorAuthCache } from './agentAuthStatus';

let workDir: string;
let savedConfigDir: string;

function fakeCursor(body: string): string {
  const path = join(workDir, 'cursor-agent');
  writeFileSync(path, `#!/bin/sh\necho call >> "${join(workDir, 'calls')}"\n${body}\n`);
  chmodSync(path, 0o755);
  process.env['CURSOR_COMMAND'] = path;
  return path;
}

function callCount(): number {
  return readFileSync(join(workDir, 'calls'), 'utf8').trim().split('\n').length;
}

function jwt(expMs: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(expMs / 1000) })).toString('base64url');
  return `e30.${payload}.sig`;
}

function writeCursorAuth(tokens: Record<string, string>): void {
  mkdirSync(join(workDir, '.config', 'cursor'), { recursive: true });
  writeFileSync(join(workDir, '.config', 'cursor', 'auth.json'), JSON.stringify(tokens));
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'agent-auth-test-'));
  savedConfigDir = config.configDir;
  // No .config/cursor/auth.json here, so the CLI probe runs.
  config.configDir = workDir;
  clearCursorAuthCache();
});

afterEach(() => {
  config.configDir = savedConfigDir;
  delete process.env['CURSOR_COMMAND'];
  rmSync(workDir, { recursive: true, force: true });
});

describe('checkCursorAuth', () => {
  it('runs `cursor status` asynchronously and caches the result', async () => {
    fakeCursor('echo "Logged in as nova@example.com"');

    const [first, second] = await Promise.all([checkCursorAuth(), checkCursorAuth()]);
    expect(first).toEqual({ authenticated: true, status: 'authenticated' });
    expect(second).toEqual(first);
    expect(await checkCursorAuth()).toEqual(first);
    // Concurrent callers share one probe; the follow-up hits the cache.
    expect(callCount()).toBe(1);
  });

  it('reports a non-zero exit as an error with the CLI output', async () => {
    fakeCursor('echo "something broke" >&2; exit 2');

    const check = await checkCursorAuth();
    expect(check.authenticated).toBe(false);
    expect(check.status).toBe('error');
    expect(check.message).toContain('something broke');
  });

  it('trusts auth.json while the refresh token is valid, without calling the CLI', async () => {
    fakeCursor('echo "Not logged in"');
    writeCursorAuth({ accessToken: jwt(Date.now() - 60_000), refreshToken: jwt(Date.now() + 86_400_000) });

    expect(await checkCursorAuth()).toEqual({ authenticated: true, status: 'authenticated' });
    expect(() => callCount()).toThrow();
  });

  it('reports an expired login when both tokens are (nearly) expired', async () => {
    fakeCursor('echo "Logged in as nova@example.com"');
    const soon = jwt(Date.now() + 60_000);
    writeCursorAuth({ accessToken: soon, refreshToken: soon });

    const check = await checkCursorAuth();
    expect(check.authenticated).toBe(false);
    expect(check.status).toBe('unauthenticated');
    expect(check.message).toContain('expired');
  });

  it('falls back to `cursor status` when auth.json tokens are unreadable', async () => {
    fakeCursor('echo "Logged in as nova@example.com"');
    writeCursorAuth({ accessToken: 'opaque', refreshToken: 'opaque' });

    expect(await checkCursorAuth()).toEqual({ authenticated: true, status: 'authenticated' });
    expect(callCount()).toBe(1);
  });
});

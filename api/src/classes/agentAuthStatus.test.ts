// node_modules
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
});

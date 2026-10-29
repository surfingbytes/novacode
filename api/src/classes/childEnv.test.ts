// node_modules
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// classes
import { childEnv, childProcessFailure, claudeTokenSessionMeta, execCli, onChildProcessError } from './childEnv';
import { config } from './config';

const FAKE_SECRET = 'fake-jwt-secret-for-child-env-test';

afterEach(() => {
  delete process.env['JWT_SECRET'];
  delete process.env['AGENT_ENV_CHILD_ENV_TEST'];
});

describe('childEnv', () => {
  it('does not leak server secrets set on process.env', () => {
    process.env['JWT_SECRET'] = FAKE_SECRET;

    const env = childEnv();

    expect(env['JWT_SECRET']).toBeUndefined();
    expect(Object.values(env)).not.toContain(FAKE_SECRET);
  });

  it('carries agentEnv with HOME set to the config dir', () => {
    process.env['AGENT_ENV_CHILD_ENV_TEST'] = 'forwarded';

    const env = childEnv();

    expect(env['HOME']).toBe(config.configDir);
    expect(env['CHILD_ENV_TEST']).toBe('forwarded');
  });

  it('lets extras override agentEnv values', () => {
    const env = childEnv({ HOME: '/elsewhere', GIT_TERMINAL_PROMPT: '0' });

    expect(env['HOME']).toBe('/elsewhere');
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0');
  });
});

describe('claudeTokenSessionMeta', () => {
  it('passes the token through session options env', () => {
    expect(claudeTokenSessionMeta('tok')).toEqual({
      claudeCode: { options: { env: { CLAUDE_CODE_OAUTH_TOKEN: 'tok' } } },
    });
    expect(claudeTokenSessionMeta(null)).toEqual({ claudeCode: {} });
  });
});

describe('spawn error guards', () => {
  it('rejects instead of throwing globally when the binary does not exist', async () => {
    const proc = spawn('/nonexistent/novacode-agent-binary', [], { stdio: ['pipe', 'pipe', 'pipe'] });

    await expect(childProcessFailure(proc)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a spawn failure to onError once', async () => {
    const proc = spawn('/nonexistent/novacode-agent-binary', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    const errors: Error[] = [];

    await new Promise<void>((resolve) => {
      onChildProcessError(proc, (err) => {
        errors.push(err);
        resolve();
      });
      proc.stdin?.write('ping\n');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(errors).toHaveLength(1);
  });
});

describe('execCli', () => {
  // execCli runs in config.configDir, which only exists in the container (not on CI).
  let savedConfigDir: string;
  let tmp: string;

  beforeEach(() => {
    savedConfigDir = config.configDir;
    tmp = mkdtempSync(join(tmpdir(), 'child-env-test-'));
    config.configDir = tmp;
  });

  afterEach(() => {
    config.configDir = savedConfigDir;
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns stdout with status 0 and runs with childEnv', async () => {
    process.env['JWT_SECRET'] = FAKE_SECRET;
    const result = await execCli(
      process.execPath,
      ['-e', 'process.stdout.write(String(process.env.JWT_SECRET ?? "none"))'],
      { timeoutMs: 5000 }
    );
    expect(result).toMatchObject({ status: 0, stdout: 'none', timedOut: false });
    expect(result.error).toBeUndefined();
  });

  it('resolves with the exit code and output on a non-zero exit', async () => {
    const result = await execCli(
      process.execPath,
      ['-e', 'process.stderr.write("boom"); process.exit(3)'],
      { timeoutMs: 5000 }
    );
    expect(result).toMatchObject({ status: 3, stderr: 'boom', timedOut: false });
    expect(result.error).toBeInstanceOf(Error);
  });

  it('flags a timeout instead of blocking', async () => {
    const result = await execCli(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 200 });
    expect(result).toMatchObject({ status: null, timedOut: true });
  });

  it('resolves with an ENOENT error for a missing binary', async () => {
    const result = await execCli('/nonexistent/nova-cli', [], { timeoutMs: 1000 });
    expect(result.status).toBeNull();
    expect(result.timedOut).toBe(false);
    expect(result.error?.message).toMatch(/ENOENT/);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildFixBuildPrompt,
  cleanJobLog,
  clearForgeCaches,
  commitStatusesToRuns,
  detectForgeProvider,
  fetchCiRuns,
  forgeRepoFromRemote,
  getForgeSettingsStatus,
  normalizeCiRun,
  normalizeForgeRepoInput,
  normalizeForgeUrl,
  parseGitRemote,
  resolveForgeCredentials,
  saveForgeSettings,
  summarizeCiRuns,
  tailLog
} from './forge';
import { diffFinishedRuns } from './ciWatcher';

import type { CiRun } from '@novacode/shared';

const FORGE = 'http://gitea:3000';

function run(id: number, status: CiRun['status'], branch = 'main'): CiRun {
  return {
    id,
    number: id,
    title: `Run ${id}`,
    status,
    branch,
    sha: null,
    event: 'push',
    url: null,
    createdAt: null,
    updatedAt: null
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('forge settings', () => {
  let configDir: string;
  let savedUrl: string | undefined;
  let savedToken: string | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'forge-'));
    savedUrl = process.env['FORGE_URL'];
    savedToken = process.env['FORGE_TOKEN'];
    delete process.env['FORGE_URL'];
    delete process.env['FORGE_TOKEN'];
    clearForgeCaches();
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    if (savedUrl === undefined) delete process.env['FORGE_URL'];
    else process.env['FORGE_URL'] = savedUrl;
    if (savedToken === undefined) delete process.env['FORGE_TOKEN'];
    else process.env['FORGE_TOKEN'] = savedToken;
  });

  it('normalizes URLs pasted with the API suffix', () => {
    expect(normalizeForgeUrl(' https://git.example.com/api/v1/ ')).toBe('https://git.example.com');
    expect(() => normalizeForgeUrl('git.example.com')).toThrow();
  });

  it('saves to the config dir and keeps the stored token when omitted', () => {
    saveForgeSettings(configDir, { url: 'https://git.example.com/', token: 'abc', provider: 'forgejo', version: '11.0.1+gitea-1.22.0' });
    saveForgeSettings(configDir, { url: 'https://git2.example.com' });
    expect(resolveForgeCredentials(configDir)).toEqual({ url: 'https://git2.example.com', token: 'abc', source: 'file' });
    // Provider was captured for the previous URL only.
    expect(getForgeSettingsStatus(configDir)).toMatchObject({ configured: true, provider: null, source: 'file' });
  });

  it('prefers env credentials', () => {
    saveForgeSettings(configDir, { url: 'https://file.example.com', token: 'file' });
    process.env['FORGE_URL'] = 'https://env.example.com/';
    process.env['FORGE_TOKEN'] = 'env';
    expect(resolveForgeCredentials(configDir)).toEqual({ url: 'https://env.example.com', token: 'env', source: 'env' });
  });

  it('detects Forgejo from its version string', () => {
    expect(detectForgeProvider('11.0.1+gitea-1.22.0')).toBe('forgejo');
    expect(detectForgeProvider('1.24.3')).toBe('gitea');
  });
});

describe('repo detection', () => {
  it('parses scp-style, ssh and https remotes', () => {
    expect(parseGitRemote('git@gitea.example.com:tomas/lumezzo.git')).toEqual({ host: 'gitea.example.com', repo: 'tomas/lumezzo' });
    expect(parseGitRemote('ssh://git@gitea.example.com:2222/tomas/lumezzo.git')).toEqual({ host: 'gitea.example.com', repo: 'tomas/lumezzo' });
    expect(parseGitRemote('https://host/git/tomas/lumezzo')).toEqual({ host: 'host', repo: 'tomas/lumezzo' });
    expect(parseGitRemote('not a remote')).toBeNull();
  });

  it('accepts remotes on a different host than the API but skips public hosts', () => {
    expect(forgeRepoFromRemote('ssh://git@gitea.example.com:2222/tomas/x.git', FORGE)).toBe('tomas/x');
    expect(forgeRepoFromRemote('git@github.com:tomas/x.git', FORGE)).toBeNull();
  });

  it('normalizes the workspace override field', () => {
    expect(normalizeForgeRepoInput('  ')).toBeNull();
    expect(normalizeForgeRepoInput('tomas/x.git')).toBe('tomas/x');
    expect(normalizeForgeRepoInput('https://gitea.example.com/tomas/x')).toBe('tomas/x');
    expect(() => normalizeForgeRepoInput('just-a-name')).toThrow();
  });
});

describe('run normalization', () => {
  it('maps Gitea runs (status + conclusion)', () => {
    const r = normalizeCiRun(
      {
        id: 2071,
        run_number: 1990,
        display_title: 'Fix login',
        status: 'completed',
        conclusion: 'failure',
        head_branch: 'main',
        head_sha: 'abc',
        event: 'push',
        html_url: 'http://gitea:3000/tomas/x/actions/runs/2071'
      },
      FORGE
    );
    expect(r).toMatchObject({ id: 2071, number: 1990, title: 'Fix login', status: 'failure', branch: 'main', sha: 'abc' });
  });

  it('maps Forgejo runs (single status, prettyref, relative URL)', () => {
    const r = normalizeCiRun(
      { id: 7, index_in_repo: 3, title: 'CI', status: 'waiting', prettyref: 'feature', commit_sha: 'def', html_url: '/o/r/actions/runs/3' },
      FORGE
    );
    expect(r).toMatchObject({ number: 3, status: 'queued', branch: 'feature', sha: 'def', url: `${FORGE}/o/r/actions/runs/3` });
  });

  it('maps commit statuses, treating pending as running', () => {
    const runs = commitStatusesToRuns(
      {
        sha: 'abc',
        statuses: [
          { id: 1, status: 'success', context: 'lint', updated_at: '2026-01-01T00:00:00Z' },
          { id: 2, status: 'pending', context: 'ci/woodpecker', target_url: 'https://ci/1', updated_at: '2026-01-01T00:01:00Z' }
        ]
      },
      FORGE,
      'main'
    );
    expect(runs.map((r) => [r.title, r.status])).toEqual([
      ['ci/woodpecker', 'running'],
      ['lint', 'success']
    ]);
  });
});

describe('summarizeCiRuns', () => {
  it('splits running, oldest-first queue (max 3) and last finished on the branch', () => {
    const runs = [
      run(9, 'queued'),
      run(8, 'queued'),
      run(7, 'queued'),
      run(6, 'queued'),
      run(5, 'running'),
      run(4, 'success', 'other'),
      run(3, 'skipped'),
      run(2, 'failure'),
      run(1, 'success')
    ];
    const summary = summarizeCiRuns(runs, 'main');
    expect(summary.running.map((r) => r.id)).toEqual([5]);
    expect(summary.queued.map((r) => r.id)).toEqual([6, 7, 8]);
    expect(summary.queuedTotal).toBe(4);
    expect(summary.lastCompleted?.id).toBe(2);
  });
});

describe('fetchCiRuns', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('falls back to commit statuses when the Actions API is missing', async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/actions/runs')) return jsonResponse({ message: 'not found' }, 404);
      return jsonResponse({ sha: 'abc', statuses: [{ id: 1, status: 'failure', context: 'drone' }] });
    }) as typeof fetch;
    const result = await fetchCiRuns({ url: FORGE, token: 't' }, 'o/r', { branch: 'main', sha: 'abc' });
    expect(result.source).toBe('commit-status');
    expect(result.runs[0]).toMatchObject({ title: 'drone', status: 'failure' });
  });

  it('reports a missing repository when both APIs 404', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ message: 'not found' }, 404)) as typeof fetch;
    await expect(fetchCiRuns({ url: FORGE, token: 't' }, 'o/r', { branch: 'main', sha: null })).rejects.toThrow(
      /not found on the forge/
    );
  });
});

describe('fix-build prompt', () => {
  it('strips runner timestamps and ANSI codes, and tails long logs', () => {
    expect(cleanJobLog('2026-10-19T07:18:11.1234567Z \u001b[31merror\u001b[0m TS2345')).toBe('error TS2345');
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    expect(tailLog(long, 3)).toBe('line 497\nline 498\nline 499');
  });

  it('fences logs safely and links the run', () => {
    const prompt = buildFixBuildPrompt({
      repo: 'o/r',
      branch: 'main',
      run: run(12, 'failure'),
      runUrl: 'http://gitea:3000/o/r/actions/runs/12',
      jobs: [{ name: 'build', log: 'has ``` inside' }]
    });
    expect(prompt).toContain('branch `main` of `o/r` failed');
    expect(prompt).toContain('http://gitea:3000/o/r/actions/runs/12');
    expect(prompt).toContain('````text\nhas ``` inside\n````');
  });
});

describe('ciWatcher.diffFinishedRuns', () => {
  it('reports only runs that were active before and finished now', () => {
    const previous = new Map([
      [1, run(1, 'running')],
      [2, run(2, 'queued')]
    ]);
    const finished = diffFinishedRuns(previous, [run(1, 'success'), run(2, 'running'), run(3, 'failure')]);
    expect(finished.map((r) => r.id)).toEqual([1]);
    expect(diffFinishedRuns(null, [run(1, 'success')])).toEqual([]);
  });
});

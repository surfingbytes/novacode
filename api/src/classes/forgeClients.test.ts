import { afterEach, describe, expect, it, vi } from 'vitest';

import { forgeClient, githubApiBase } from './forgeClients';

const FORGE = 'http://gitea:3000';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('forge clients', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('Gitea: detects Forgejo from the version string', async () => {
    mockFetch((url) =>
      url.endsWith('/version') ? jsonResponse({ version: '11.0.1+gitea-1.22.0' }) : jsonResponse({ login: 'tomas' })
    );
    await expect(forgeClient({ provider: 'gitea', url: FORGE, token: 't' }).test()).resolves.toEqual({
      provider: 'forgejo',
      version: '11.0.1+gitea-1.22.0',
      username: 'tomas'
    });
  });

  it('Gitea: falls back to commit statuses when the Actions API is missing', async () => {
    mockFetch((url) =>
      url.includes('/actions/runs')
        ? jsonResponse({ message: 'not found' }, 404)
        : jsonResponse({ sha: 'abc', statuses: [{ id: 1, status: 'failure', context: 'drone' }] })
    );
    const result = await forgeClient({ provider: 'gitea', url: FORGE, token: 't' }).fetchRuns('o/r', { branch: 'main', sha: 'abc' });
    expect(result.source).toBe('commit-status');
    expect(result.runs[0]).toMatchObject({ title: 'drone', status: 'failure' });
  });

  it('Gitea: reports a missing repository when both APIs 404', async () => {
    mockFetch(() => jsonResponse({ message: 'not found' }, 404));
    await expect(
      forgeClient({ provider: 'gitea', url: FORGE, token: 't' }).fetchRuns('o/r', { branch: 'main', sha: null })
    ).rejects.toThrow(/not found on Gitea/);
  });

  it('GitHub: uses api.github.com with a Bearer token', async () => {
    expect(githubApiBase('https://github.com')).toBe('https://api.github.com');
    expect(githubApiBase('https://ghe.example.com')).toBe('https://ghe.example.com/api/v3');
    const fn = mockFetch(() =>
      jsonResponse({
        workflow_runs: [{ id: 5, run_number: 2, status: 'in_progress', head_branch: 'main', html_url: 'https://github.com/o/r/actions/runs/5' }]
      })
    );
    const client = forgeClient({ provider: 'github', url: 'https://github.com', token: 'ghp' });
    const result = await client.fetchRuns('o/r', { branch: 'main', sha: null });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/api\.github\.com\/repos\/o\/r\/actions\/runs\?/);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer ghp');
    expect(result.runs[0]).toMatchObject({ id: 5, status: 'running' });
    expect(client.runsUrl('o/r', 'actions')).toBe('https://github.com/o/r/actions');
  });

  it('GitHub: surfaces rate limiting instead of falling back', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' }
        })
    );
    await expect(
      forgeClient({ provider: 'github', url: 'https://github.com', token: 'x' }).fetchRuns('o/r', { branch: 'main', sha: null })
    ).rejects.toThrow(/rate limit/);
  });

  it('GitLab: encodes nested project paths and reads failed job traces', async () => {
    const fn = mockFetch((url) => {
      if (url.includes('/pipelines?')) {
        return jsonResponse([{ id: 40, iid: 4, status: 'running', ref: 'main', web_url: 'https://gitlab.com/g/s/p/-/pipelines/40' }]);
      }
      if (url.includes('/pipelines/40/jobs')) return jsonResponse([{ id: 7, name: 'test', stage: 'verify', status: 'failed' }]);
      return new Response('section_start:1:step\r\u001b[0Kboom\n', { status: 200 });
    });
    const client = forgeClient({ provider: 'gitlab', url: 'https://gitlab.com', token: 'glpat' });
    const result = await client.fetchRuns('g/s/p', { branch: 'main', sha: null });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v4/projects/g%2Fs%2Fp/pipelines?');
    expect((init.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('glpat');
    expect(result.runs[0]).toMatchObject({ id: 40, number: 4, status: 'running' });
    await expect(client.fetchFailedJobLogs('g/s/p', 40)).resolves.toEqual([
      { name: 'test', log: 'boom', failedSteps: ['verify'] }
    ]);
    expect(client.runsUrl('g/s/p', 'actions')).toBe('https://gitlab.com/g/s/p/-/pipelines');
  });
});

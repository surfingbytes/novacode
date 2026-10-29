import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const getWorkspace = vi.fn();

vi.mock('../classes/database', () => ({
  db: {
    getWorkspace: (...args: unknown[]) => getWorkspace(...args)
  }
}));

vi.mock('../classes/auth', () => ({
  jwtPreHandler: async (): Promise<void> => {}
}));

vi.mock('../classes/workspacePaths', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/workspacePaths')>()),
  // Workspace rows in these tests store the absolute temp path.
  resolveWorkspaceAbsolutePath: (path: string): string => path
}));

import { AGENT_ROUTE_RATE_LIMIT } from '../classes/rateLimits';
import { runGit } from '../classes/runGit';
import { gitRoutes } from './git';
import { clearWorkspaceGitContextCache } from '../classes/gitWorkspace';
import { registerErrorHandler } from '../classes/errorHandler';

const ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com'
};

let workspace: string;
let app: FastifyInstance;
const routeConfigs = new Map<string, unknown>();

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'nova-git-route-'));
  await runGit(['init', '-q', '-b', 'main'], { cwd: workspace });
  await writeFile(join(workspace, 'a.txt'), 'one\n');
  await runGit(['add', '-A'], { cwd: workspace });
  await runGit(['commit', '-q', '-m', 'init'], { cwd: workspace, env: ENV });
  await writeFile(join(workspace, 'new.txt'), 'fresh\n');

  app = Fastify();
  registerErrorHandler(app);
  app.addHook('onRoute', (route) => {
    routeConfigs.set(`${String(route.method)} ${route.url}`, route.config);
  });
  await app.register(gitRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await rm(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  clearWorkspaceGitContextCache();
  getWorkspace.mockReset();
  getWorkspace.mockResolvedValue({ id: 'w1', path: workspace });
});

describe('git routes', () => {
  it('diffs an untracked file against /dev/null', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/git/workspace/w1/diff?file=new.txt&status=%3F%3F' });
    expect(res.statusCode).toBe(200);
    expect(res.json().diff).toContain('+fresh');
  });

  it('rejects option-like file paths before they reach git', async () => {
    for (const status of ['%3F%3F', 'M']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/git/workspace/w1/diff?file=--output%3D%2Ftmp%2Fx&status=${status}`
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid file path');
    }
  });

  it('rejects option-like refs before they reach git', async () => {
    const cases: Array<{ url: string; payload: Record<string, unknown>; error: string }> = [
      { url: '/api/git/workspace/w1/checkout', payload: { branch: '--orphan' }, error: 'Invalid branch name' },
      { url: '/api/git/workspace/w1/checkout', payload: { branch: 'main', remoteBranch: '--track' }, error: 'Invalid remote branch' },
      { url: '/api/git/workspace/w1/branches', payload: { branch: '-x' }, error: 'Invalid branch name' },
      { url: '/api/git/workspace/w1/branches', payload: { branch: 'feature', startPoint: '--force' }, error: 'Invalid start point' }
    ];
    for (const { url, payload, error } of cases) {
      const res = await app.inject({ method: 'POST', url, payload });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error).toBe(error);
    }
    // Nothing reached git: still on main, no extra branches.
    const { stdout } = await runGit(['branch', '--list'], { cwd: workspace });
    expect(stdout.trim()).toBe('* main');
  });

  it('reuses the workspace repo list for 5 s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const url = '/api/git/workspace/w1/branches';
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/api/git/workspace/w1/status' })).statusCode).toBe(200);
      expect(getWorkspace).toHaveBeenCalledTimes(1);

      vi.setSystemTime(Date.now() + 5_001);
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);
      expect(getWorkspace).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not cache a failed workspace lookup', async () => {
    getWorkspace.mockRejectedValueOnce(new Error('db down'));
    const url = '/api/git/workspace/w1/branches';
    const failed = await app.inject({ method: 'GET', url });
    expect(failed.statusCode).toBe(500);
    expect(failed.json()).toEqual({ error: 'Internal server error' });
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);
    expect(getWorkspace).toHaveBeenCalledTimes(2);
  });

  it('answers user-caused git failures with 409/400 and git\'s message', async () => {
    const existing = await app.inject({
      method: 'POST',
      url: '/api/git/workspace/w1/branches',
      payload: { branch: 'main' }
    });
    expect(existing.statusCode).toBe(409);
    expect(existing.json().error).toContain('already exists');

    const unknownRef = await app.inject({
      method: 'POST',
      url: '/api/git/workspace/w1/checkout',
      payload: { branch: 'no-such-branch' }
    });
    expect(unknownRef.statusCode).toBe(400);
    expect(unknownRef.json().error).toMatch(/invalid reference|did not match/);

    const unknownCommit = await app.inject({ method: 'GET', url: '/api/git/workspace/w1/show?hash=deadbeef' });
    expect(unknownCommit.statusCode).toBe(400);
  });

  it('answers 404 for a repo that is not in the workspace', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/git/workspace/w1/branches?repo=nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Repository not found in workspace' });
  });

  it('rate-limits the AI commit-message route', () => {
    expect(routeConfigs.get('POST /api/git/workspace/:workspaceId/commit-message')).toMatchObject({
      rateLimit: AGENT_ROUTE_RATE_LIMIT
    });
  });
});

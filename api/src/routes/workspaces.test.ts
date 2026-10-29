import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  disposeWorkspace: vi.fn()
}));

vi.mock('../classes/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/database')>()),
  db: {
    getWorkspace: (...args: unknown[]) => mocks.getWorkspace(...args),
    deleteWorkspace: (...args: unknown[]) => mocks.deleteWorkspace(...args)
  }
}));

vi.mock('../classes/auth', () => ({
  jwtPreHandler: async (): Promise<void> => {}
}));

vi.mock('../classes/dispose', () => ({
  disposeWorkspace: (...args: unknown[]) => mocks.disposeWorkspace(...args)
}));

import { workspaceRoutes } from './workspaces';
import { registerErrorHandler } from '../classes/errorHandler';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);
  await app.register(workspaceRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.disposeWorkspace.mockResolvedValue(undefined);
});

describe('DELETE /api/workspaces/:id', () => {
  it('returns 404 for an unknown workspace without disposing anything', async () => {
    mocks.getWorkspace.mockResolvedValue(undefined);

    const res = await app.inject({ method: 'DELETE', url: '/api/workspaces/missing' });

    expect(res.statusCode).toBe(404);
    expect(mocks.disposeWorkspace).not.toHaveBeenCalled();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
  });

  it('disposes the workspace, then deletes it', async () => {
    mocks.getWorkspace.mockResolvedValue({ id: 'w1' });
    mocks.deleteWorkspace.mockResolvedValue({ ok: true });

    const res = await app.inject({ method: 'DELETE', url: '/api/workspaces/w1' });

    expect(res.statusCode).toBe(204);
    expect(mocks.disposeWorkspace).toHaveBeenCalledWith('w1');
    expect(mocks.disposeWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteWorkspace.mock.invocationCallOrder[0]!
    );
  });

  it('returns 404 when the row vanished before the delete', async () => {
    mocks.getWorkspace.mockResolvedValue({ id: 'w1' });
    mocks.deleteWorkspace.mockResolvedValue({ ok: false, reason: 'not_found' });

    const res = await app.inject({ method: 'DELETE', url: '/api/workspaces/w1' });

    expect(res.statusCode).toBe(404);
  });

  it('returns 500 when the delete fails for another reason', async () => {
    mocks.getWorkspace.mockResolvedValue({ id: 'w1' });
    mocks.deleteWorkspace.mockResolvedValue({ ok: false, reason: 'error', error: new Error('fk') });

    const res = await app.inject({ method: 'DELETE', url: '/api/workspaces/w1' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Failed to delete workspace' });
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';

const mocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getAutomation: vi.fn(),
  createAutomation: vi.fn(),
  updateAutomation: vi.fn(),
  listRunsByAutomation: vi.fn()
}));

vi.mock('../classes/auth', () => ({ jwtPreHandler: async (): Promise<void> => {} }));
vi.mock('../classes/automationScheduler', () => ({ runAutomation: vi.fn() }));
vi.mock('../classes/database', () => ({
  db: {
    getWorkspace: (...args: unknown[]) => mocks.getWorkspace(...args),
    getAutomation: (...args: unknown[]) => mocks.getAutomation(...args),
    createAutomation: (...args: unknown[]) => mocks.createAutomation(...args),
    updateAutomation: (...args: unknown[]) => mocks.updateAutomation(...args),
    listRunsByAutomation: (...args: unknown[]) => mocks.listRunsByAutomation(...args)
  }
}));

import { automationRoutes } from './automations';
import { registerErrorHandler } from '../classes/errorHandler';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);
  await app.register(automationRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getWorkspace.mockResolvedValue({ id: 'w1', defaultAgentType: null });
  mocks.getAutomation.mockResolvedValue({ id: 'a1', intervalMinutes: 60 });
  mocks.createAutomation.mockImplementation(async (data: Record<string, unknown>) => ({ id: 'a1', ...data }));
  mocks.updateAutomation.mockImplementation(async (_id: string, data: Record<string, unknown>) => ({ id: 'a1', ...data }));
  mocks.listRunsByAutomation.mockResolvedValue([]);
});

describe('intervalMinutes validation', () => {
  const create = (intervalMinutes: unknown): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'POST', url: '/api/automations', payload: { workspaceId: 'w1', prompt: 'p', intervalMinutes } });

  it.each([0, -5, 1.5, 0.5])('rejects %s on create and update', async (intervalMinutes) => {
    expect((await create(intervalMinutes)).statusCode).toBe(400);
    const patch = await app.inject({ method: 'PATCH', url: '/api/automations/a1', payload: { intervalMinutes } });
    expect(patch.statusCode).toBe(400);
    expect(mocks.createAutomation).not.toHaveBeenCalled();
    expect(mocks.updateAutomation).not.toHaveBeenCalled();
  });

  it('rejects a missing interval on create', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/automations', payload: { workspaceId: 'w1', prompt: 'p' } });

    expect(res.statusCode).toBe(400);
  });

  it('accepts a whole number of minutes', async () => {
    expect((await create(15)).statusCode).toBe(201);
    const patch = await app.inject({ method: 'PATCH', url: '/api/automations/a1', payload: { intervalMinutes: 30 } });
    expect(patch.statusCode).toBe(200);
  });
});

describe('GET /api/automations/:id/runs limit', () => {
  it.each(['0', '201', 'abc', '2.5', '-1'])('rejects limit=%s', async (limit) => {
    const res = await app.inject({ url: `/api/automations/a1/runs?limit=${limit}` });

    expect(res.statusCode).toBe(400);
    expect(mocks.listRunsByAutomation).not.toHaveBeenCalled();
  });

  it('passes a valid limit through and defaults to 20', async () => {
    await app.inject({ url: '/api/automations/a1/runs?limit=200' });
    await app.inject({ url: '/api/automations/a1/runs' });

    expect(mocks.listRunsByAutomation.mock.calls).toEqual([
      ['a1', 200],
      ['a1', 20]
    ]);
  });
});

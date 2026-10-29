import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => ({
  summarizeUsageOverview: vi.fn()
}));

vi.mock('../classes/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/database')>()),
  db: {
    summarizeUsageOverview: (...args: unknown[]) => mocks.summarizeUsageOverview(...args)
  }
}));

vi.mock('../classes/auth', () => ({
  jwtPreHandler: async (): Promise<void> => {}
}));

import { resolveUsageRange, usageRoutes } from './usage';
import { registerErrorHandler } from '../classes/errorHandler';

const DAY_MS = 24 * 60 * 60 * 1000;

let app: FastifyInstance;

function emptyOverview(fromIso: string, toIso: string): Record<string, unknown> {
  return {
    from: fromIso,
    to: toIso,
    totals: { turnCount: 0, used: 0, costAmount: null, costCurrency: null },
    byWorkspace: [],
    byAgentType: [],
    byModel: [],
    byDay: []
  };
}

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);
  await app.register(usageRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.summarizeUsageOverview.mockImplementation(async (fromIso: string, toIso: string) =>
    emptyOverview(fromIso, toIso)
  );
});

describe('resolveUsageRange', () => {
  const now = new Date('2026-10-29T12:00:00.000Z');

  it('defaults to the last 30 days ending now', () => {
    expect(resolveUsageRange(undefined, undefined, now)).toEqual({
      fromIso: '2026-09-29T12:00:00.000Z',
      toIso: '2026-10-29T12:00:00.000Z'
    });
  });

  it('defaults from to 30 days before an explicit to', () => {
    expect(resolveUsageRange(undefined, '2026-01-31T00:00:00.000Z', now)).toEqual({
      fromIso: '2026-01-01T00:00:00.000Z',
      toIso: '2026-01-31T00:00:00.000Z'
    });
  });

  it('accepts a full 366-day range and normalizes to ISO', () => {
    const to = new Date(now.getTime());
    const from = new Date(now.getTime() - 366 * DAY_MS);
    expect(resolveUsageRange(from.toISOString(), to.toISOString(), now)).toEqual({
      fromIso: from.toISOString(),
      toIso: to.toISOString()
    });
  });

  it('rejects invalid input', () => {
    expect(resolveUsageRange('nope', undefined, now)).toEqual({ error: 'Invalid "from" date' });
    expect(resolveUsageRange(undefined, 'nope', now)).toEqual({ error: 'Invalid "to" date' });
    expect(resolveUsageRange('2026-10-02T00:00:00Z', '2026-10-01T00:00:00Z', now)).toHaveProperty('error');
    expect(resolveUsageRange('2025-01-01T00:00:00Z', '2026-01-03T00:00:00Z', now)).toHaveProperty('error');
  });
});

describe('GET /api/usage/overview', () => {
  it('uses the default 30-day range', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/usage/overview' });
    expect(res.statusCode).toBe(200);
    const [fromIso, toIso] = mocks.summarizeUsageOverview.mock.calls[0] as [string, string];
    expect(Date.parse(toIso) - Date.parse(fromIso)).toBe(30 * DAY_MS);
    expect(res.json()).toMatchObject({ from: fromIso, to: toIso, byDay: [] });
  });

  it('passes explicit bounds through', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/usage/overview?from=2026-10-01T00:00:00.000Z&to=2026-10-15T00:00:00.000Z'
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.summarizeUsageOverview).toHaveBeenCalledWith('2026-10-01T00:00:00.000Z', '2026-10-15T00:00:00.000Z');
  });

  it.each([
    ['unparseable from', '?from=yesterday'],
    ['unparseable to', '?to=tomorrow'],
    ['from after to', '?from=2026-10-15T00:00:00Z&to=2026-10-01T00:00:00Z'],
    ['range over 366 days', '?from=2025-01-01T00:00:00Z&to=2026-06-01T00:00:00Z']
  ])('returns 400 for %s', async (_label, query) => {
    const res = await app.inject({ method: 'GET', url: `/api/usage/overview${query}` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
    expect(mocks.summarizeUsageOverview).not.toHaveBeenCalled();
  });
});

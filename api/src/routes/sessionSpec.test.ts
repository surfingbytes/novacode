import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  writeSessionSpec: vi.fn(),
  buildSessionSpecStatus: vi.fn(),
  broadcastSessionSpecStatus: vi.fn()
}));

vi.mock('../classes/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/database')>()),
  db: {
    getSession: (...args: unknown[]) => mocks.getSession(...args)
  }
}));

vi.mock('../classes/auth', () => ({
  jwtPreHandler: async (): Promise<void> => {}
}));

// No disk: the spec file writer is stubbed.
vi.mock('../classes/sessionSpec', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/sessionSpec')>()),
  writeSessionSpec: (...args: unknown[]) => mocks.writeSessionSpec(...args)
}));

vi.mock('../classes/sessionSpecStatus', () => ({
  buildSessionSpecStatus: (...args: unknown[]) => mocks.buildSessionSpecStatus(...args)
}));

vi.mock('../classes/wsBroadcast', () => ({
  broadcastSessionSpecStatus: (...args: unknown[]) => mocks.broadcastSessionSpecStatus(...args)
}));

import { sessionSpecRoutes } from './sessionSpec';
import { registerErrorHandler } from '../classes/errorHandler';

let app: FastifyInstance;

const SPEC_URL = '/api/workspaces/w1/sessions/s1/spec';
const session = { id: 's1', workspaceId: 'w1', name: 'Chat', agentType: 'claude', modelSelection: '', updatedAt: '' };
const status = { sessionId: 's1', exists: true, hasContent: true };

function putSpec(payload: Record<string, unknown>) {
  return app.inject({ method: 'PUT', url: SPEC_URL, payload });
}

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);
  await app.register(sessionSpecRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockImplementation(async (id: string) => (id === 's1' ? { ...session } : null));
  mocks.writeSessionSpec.mockImplementation(async (_workspaceId: string, _sessionId: string, content: string) => ({
    path: '/config/specs/w1/s1.md',
    content: content.endsWith('\n') ? content : `${content}\n`,
    updatedAt: '2026-10-29T00:00:00.000Z'
  }));
  mocks.buildSessionSpecStatus.mockResolvedValue(status);
});

describe('PUT /api/workspaces/:workspaceId/sessions/:sessionId/spec', () => {
  it('writes the spec file, broadcasts the new status and answers both', async () => {
    const res = await putSpec({ content: '# Spec\n\nDecision one.' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status, content: '# Spec\n\nDecision one.\n' });
    expect(mocks.writeSessionSpec).toHaveBeenCalledWith('w1', 's1', '# Spec\n\nDecision one.');
    expect(mocks.buildSessionSpecStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    expect(mocks.broadcastSessionSpecStatus).toHaveBeenCalledWith('w1', status);
  });

  it('answers 400 for blank or missing content without writing', async () => {
    expect((await putSpec({ content: '   \n' })).statusCode).toBe(400);
    expect((await putSpec({})).statusCode).toBe(400);
    expect(mocks.writeSessionSpec).not.toHaveBeenCalled();
    expect(mocks.broadcastSessionSpecStatus).not.toHaveBeenCalled();
  });

  it('answers 404 for a session of another workspace', async () => {
    mocks.getSession.mockResolvedValue({ ...session, workspaceId: 'w2' });

    const res = await putSpec({ content: '# Spec' });

    expect(res.statusCode).toBe(404);
    expect(mocks.writeSessionSpec).not.toHaveBeenCalled();
  });
});

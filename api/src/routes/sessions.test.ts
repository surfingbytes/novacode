import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const mocks = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  listSessionsByWorkspace: vi.fn(),
  enrichSessionListPreviews: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
  deleteManySessions: vi.fn(),
  createSessionWithAgent: vi.fn(),
  disposeSession: vi.fn(),
  getActiveSessionIds: vi.fn(),
  getActiveBusySubagents: vi.fn(),
  broadcastWorkspaceSessionUpsert: vi.fn(),
  broadcastWorkspaceSessionDeleted: vi.fn(),
  broadcastWorkspaceSessionsRefresh: vi.fn()
}));

vi.mock('../classes/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../classes/database')>()),
  db: {
    listWorkspaces: (...args: unknown[]) => mocks.listWorkspaces(...args),
    listSessionsByWorkspace: (...args: unknown[]) => mocks.listSessionsByWorkspace(...args),
    enrichSessionListPreviews: (...args: unknown[]) => mocks.enrichSessionListPreviews(...args),
    getSession: (...args: unknown[]) => mocks.getSession(...args),
    deleteSession: (...args: unknown[]) => mocks.deleteSession(...args),
    deleteManySessions: (...args: unknown[]) => mocks.deleteManySessions(...args)
  }
}));

vi.mock('../classes/auth', () => ({
  jwtPreHandler: async (): Promise<void> => {}
}));

// No agent processes: session creation and the ACP run registry are stubbed.
vi.mock('../classes/sessionService', () => ({
  createSessionWithAgent: (...args: unknown[]) => mocks.createSessionWithAgent(...args)
}));

vi.mock('../classes/chatEngine', () => ({
  getActiveSessionIds: (...args: unknown[]) => mocks.getActiveSessionIds(...args),
  getActiveBusySubagents: (...args: unknown[]) => mocks.getActiveBusySubagents(...args),
  appendPlanUpdateToActiveRun: vi.fn(),
  setActiveRunApprovalPolicy: vi.fn()
}));

vi.mock('../classes/dispose', () => ({
  disposeSession: (...args: unknown[]) => mocks.disposeSession(...args)
}));

vi.mock('../classes/wsBroadcast', () => ({
  broadcastWorkspaceSessionUpsert: (...args: unknown[]) => mocks.broadcastWorkspaceSessionUpsert(...args),
  broadcastWorkspaceSessionDeleted: (...args: unknown[]) => mocks.broadcastWorkspaceSessionDeleted(...args),
  broadcastWorkspaceSessionsRefresh: (...args: unknown[]) => mocks.broadcastWorkspaceSessionsRefresh(...args)
}));

import { sessionsRoutes } from './sessions';
import { registerErrorHandler } from '../classes/errorHandler';

let app: FastifyInstance;

function sessionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    workspaceId: 'w1',
    name: 'Chat',
    agentType: 'claude',
    sessionId: null,
    tags: ['a', 'A', ' b '],
    sessionConfigJson: JSON.stringify({ mode: 'plan', __novaInternal: 'x' }),
    lastUsageJson: null,
    ...overrides
  };
}

beforeAll(async () => {
  app = Fastify();
  registerErrorHandler(app);
  await app.register(sessionsRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getActiveSessionIds.mockReturnValue(new Set<string>());
  mocks.getActiveBusySubagents.mockReturnValue([]);
  mocks.enrichSessionListPreviews.mockResolvedValue(undefined);
  mocks.disposeSession.mockResolvedValue(undefined);
});

describe('POST /api/workspaces/:workspaceId/sessions', () => {
  it('creates a session through the agent service and broadcasts it', async () => {
    mocks.createSessionWithAgent.mockResolvedValue({ session: sessionRow() });

    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/w1/sessions',
      payload: { name: '  My chat  ', tags: 'x, y', agentType: 'claude', approvalPolicy: 'allow_all' }
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.createSessionWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'w1',
        name: 'My chat',
        tags: ['x', 'y'],
        agentType: 'claude',
        approvalPolicy: 'allow_all'
      })
    );
    const body = res.json();
    expect(body).toMatchObject({ id: 's1', tags: ['a', 'b'], sessionConfigJson: { mode: 'plan' } });
    expect(body).not.toHaveProperty('lastUsageJson');
    expect(mocks.broadcastWorkspaceSessionUpsert).toHaveBeenCalledWith('w1', expect.objectContaining({ id: 's1' }));
  });

  it('answers 404 for an unknown workspace', async () => {
    mocks.createSessionWithAgent.mockResolvedValue({ error: 'Workspace not found' });

    const res = await app.inject({ method: 'POST', url: '/api/workspaces/nope/sessions', payload: {} });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Workspace not found', message: 'Workspace not found' });
    expect(mocks.broadcastWorkspaceSessionUpsert).not.toHaveBeenCalled();
  });

  it('answers 502 with the agent error details when the agent fails to start', async () => {
    mocks.createSessionWithAgent.mockResolvedValue({
      error: 'ACP spawn failed',
      errorCode: 'auth_required',
      errorDetails: 'login first'
    });

    const res = await app.inject({ method: 'POST', url: '/api/workspaces/w1/sessions', payload: { agentType: 'claude' } });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: 'Failed to create chat',
      message: 'ACP spawn failed',
      code: 'auth_required',
      details: 'login first'
    });
  });

  it('answers 500 when the service returns neither a session nor an error', async () => {
    mocks.createSessionWithAgent.mockResolvedValue({});

    const res = await app.inject({ method: 'POST', url: '/api/workspaces/w1/sessions', payload: {} });

    expect(res.statusCode).toBe(500);
  });
});

describe('GET sessions', () => {
  it('lists a workspace with busy flags and archived filter', async () => {
    mocks.listSessionsByWorkspace.mockResolvedValue([sessionRow(), sessionRow({ id: 's2', tags: null })]);
    mocks.getActiveSessionIds.mockReturnValue(new Set(['s2']));
    mocks.getActiveBusySubagents.mockImplementation((id: string) => (id === 's2' ? ['sub'] : []));

    const res = await app.inject({ url: '/api/workspaces/w1/sessions?archived=true' });

    expect(res.statusCode).toBe(200);
    expect(mocks.listSessionsByWorkspace).toHaveBeenCalledWith('w1', { archived: true });
    expect(res.json()).toMatchObject([
      { id: 's1', busy: false, busySubagents: [] },
      { id: 's2', busy: true, busySubagents: ['sub'], tags: null }
    ]);
    expect(mocks.enrichSessionListPreviews).toHaveBeenCalledTimes(1);
  });

  it('leaves the archived filter off for other values', async () => {
    mocks.listSessionsByWorkspace.mockResolvedValue([]);

    await app.inject({ url: '/api/workspaces/w1/sessions?archived=maybe' });

    expect(mocks.listSessionsByWorkspace).toHaveBeenCalledWith('w1', { archived: undefined });
  });

  it('lists active and archived sessions of every workspace', async () => {
    mocks.listWorkspaces.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
    mocks.listSessionsByWorkspace.mockImplementation(async (workspaceId: string, opts: { archived: boolean }) => [
      sessionRow({ id: `${workspaceId}-${opts.archived ? 'old' : 'new'}`, workspaceId })
    ]);

    const res = await app.inject({ url: '/api/sessions' });

    expect(res.statusCode).toBe(200);
    expect(mocks.listWorkspaces).toHaveBeenCalledWith({ includeArchived: true });
    expect(res.json().map((s: { id: string }) => s.id)).toEqual(['w1-new', 'w1-old', 'w2-new', 'w2-old']);
  });
});

describe('DELETE /api/workspaces/:workspaceId/sessions/:sessionId', () => {
  it('disposes the agent, deletes the row and broadcasts', async () => {
    mocks.getSession.mockResolvedValue(sessionRow());
    mocks.deleteSession.mockResolvedValue(true);

    const res = await app.inject({ method: 'DELETE', url: '/api/workspaces/w1/sessions/s1' });

    expect(res.statusCode).toBe(204);
    expect(mocks.disposeSession).toHaveBeenCalledWith('s1', 'w1');
    expect(mocks.disposeSession.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteSession.mock.invocationCallOrder[0]!
    );
    expect(mocks.broadcastWorkspaceSessionDeleted).toHaveBeenCalledWith('w1', 's1');
  });

  it('answers 404 for a session of another workspace', async () => {
    mocks.getSession.mockResolvedValue(sessionRow({ workspaceId: 'w2' }));

    const res = await app.inject({ method: 'DELETE', url: '/api/workspaces/w1/sessions/s1' });

    expect(res.statusCode).toBe(404);
    expect(mocks.disposeSession).not.toHaveBeenCalled();
    expect(mocks.deleteSession).not.toHaveBeenCalled();
  });

  it('answers 500 when the delete fails', async () => {
    mocks.getSession.mockResolvedValue(sessionRow());
    mocks.deleteSession.mockResolvedValue(false);

    const res = await app.inject({ method: 'DELETE', url: '/api/workspaces/w1/sessions/s1' });

    expect(res.statusCode).toBe(500);
    expect(mocks.broadcastWorkspaceSessionDeleted).not.toHaveBeenCalled();
  });

  it('bulk-deletes after disposing each session', async () => {
    mocks.deleteManySessions.mockResolvedValue(2);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces/w1/sessions/bulk-delete',
      payload: { ids: ['s1', 's2'] }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 2 });
    expect(mocks.disposeSession.mock.calls).toEqual([['s1', 'w1'], ['s2', 'w1']]);
    expect(mocks.deleteManySessions).toHaveBeenCalledWith(['s1', 's2'], 'w1');
    expect(mocks.broadcastWorkspaceSessionsRefresh).toHaveBeenCalledWith('w1');
  });
});

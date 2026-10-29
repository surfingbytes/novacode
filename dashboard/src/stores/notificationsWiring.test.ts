// @vitest-environment jsdom

// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// classes
import { createManagedSocket } from '@/lib/wsClient';

// stores
import { useNotificationsStore } from '@/stores/notifications';
import { useOrchestratorsStore } from '@/stores/orchestrators';
import { useWorkspacesStore } from '@/stores/workspaces';
import { setViewingSession } from '@/utils/sessionUnread';

// types
import type { Orchestrator, Session, SubTask } from '@/@types/index';

vi.mock('@/classes/api', () => ({
  workspaceApi: {
    listAll: vi.fn(() => Promise.resolve({ data: [] }))
  },
  sessionsApi: {
    listAll: vi.fn(() => Promise.resolve({ data: [] })),
    markRead: vi.fn(() => Promise.resolve({ data: {} }))
  },
  orchestratorApi: {
    listAll: vi.fn(() => Promise.resolve({ data: [] })),
    markRead: vi.fn(() => Promise.resolve({ data: {} }))
  },
  buildSessionsWsUrl: () => 'ws://localhost/api/ws/sessions',
  isApiUnreachableError: () => false
}));

vi.mock('@/lib/wsClient', () => ({
  createManagedSocket: vi.fn(() => ({
    send: vi.fn(),
    close: vi.fn(),
    bConnected: false
  }))
}));

function sessionFixture(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-1',
    name: 'Fix login',
    tags: null,
    sessionId: null,
    agentType: 'claude',
    modelSelection: 'auto',
    sessionMode: 'agent',
    approvalPolicy: 'ask',
    workspaceId: 'ws-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archived: false,
    isFavorite: false,
    ...overrides
  };
}

function orchestratorFixture(subtasks: Partial<SubTask>[], overrides: Partial<Orchestrator> = {}): Orchestrator {
  return {
    id: 'orch-1',
    name: 'Bell plan',
    tags: null,
    agentType: 'claude',
    messageJson: '[]',
    subtasksJson: JSON.stringify({
      sharedContext: '',
      handoffLog: '',
      subtasks: subtasks.map((task, index) => ({ name: `Step ${index}`, prompt: 'do it', ...task }))
    }),
    workspaceId: 'ws-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    runStatus: 'running',
    ...overrides
  };
}

async function connect(): Promise<(message: unknown) => void> {
  const store = useWorkspacesStore();
  store.workspaces = [
    { id: 'ws-1', name: 'Nova', path: 'nova', createdAt: '2026-01-01T00:00:00.000Z', archived: false, isFavorite: false }
  ];
  await store.ensureSessionsInitialized();
  const options = vi.mocked(createManagedSocket).mock.calls.at(-1)?.[0];
  if (!options) {
    throw new Error('sessions socket was not created');
  }
  return (message) => options.onMessage(JSON.stringify(message));
}

describe('notification wiring on the sessions socket', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(createManagedSocket).mockClear();
  });

  afterEach(() => {
    setViewingSession(null);
  });

  it('does not notify for a snapshot', async () => {
    const send = await connect();
    send({
      type: 'global-snapshot',
      sessions: [sessionFixture({ busy: false })],
      orchestrators: [orchestratorFixture([{ waitingQuestion: 'Which DB?' }], { runStatus: 'completed' })]
    });

    expect(useNotificationsStore().items).toEqual([]);
  });

  it('notifies once when a session goes busy then idle', async () => {
    const send = await connect();
    send({ type: 'global-snapshot', sessions: [sessionFixture({ busy: false })] });
    send({ type: 'busy-changed', id: 'sess-1', busy: true });
    expect(useNotificationsStore().items).toHaveLength(0);

    send({ type: 'busy-changed', id: 'sess-1', busy: false });
    send({ type: 'busy-changed', id: 'sess-1', busy: false });

    const items = useNotificationsStore().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'session-finished',
      title: 'Fix login',
      body: 'Nova',
      href: '/workspace/ws-1/session/sess-1',
      read: false
    });
  });

  it('does not notify for the session being viewed', async () => {
    const send = await connect();
    send({ type: 'global-snapshot', sessions: [sessionFixture({ busy: true })] });
    setViewingSession('sess-1');

    send({ type: 'busy-changed', id: 'sess-1', busy: false });

    expect(useNotificationsStore().items).toHaveLength(0);
  });

  it('notifies when an orchestrator step starts waiting for input', async () => {
    const send = await connect();
    send({ type: 'global-snapshot', sessions: [], orchestrators: [orchestratorFixture([{}, {}])] });

    const question = 'x'.repeat(200);
    send({ type: 'orchestrator-upsert', orchestrator: orchestratorFixture([{}, { waitingQuestion: question }]) });
    send({ type: 'orchestrator-upsert', orchestrator: orchestratorFixture([{}, { waitingQuestion: question }]) });

    const items = useNotificationsStore().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'orchestrator-needs-input',
      title: 'Bell plan',
      href: '/workspace/ws-1/orchestrator/orch-1'
    });
    expect(items[0].body).toHaveLength(140);
    expect(useOrchestratorsStore().byId('orch-1')).not.toBeNull();
  });

  it('notifies when an orchestrator run completes or fails', async () => {
    const send = await connect();
    send({ type: 'global-snapshot', sessions: [], orchestrators: [orchestratorFixture([{}])] });

    send({ type: 'orchestrator-upsert', orchestrator: orchestratorFixture([{}], { runStatus: 'completed' }) });
    send({ type: 'orchestrator-upsert', orchestrator: orchestratorFixture([{}], { runStatus: 'running' }) });
    send({ type: 'orchestrator-upsert', orchestrator: orchestratorFixture([{}], { runStatus: 'failed' }) });

    expect(useNotificationsStore().items.map((item) => item.kind)).toEqual([
      'orchestrator-failed',
      'orchestrator-finished'
    ]);
  });

  it('notifies only for failed automation runs', async () => {
    const send = await connect();
    const base = {
      type: 'automation-run-finished',
      automationId: 'auto-1',
      workspaceId: 'ws-1',
      automationName: 'Nightly',
      finishedAt: '2026-10-29T10:00:00.000Z'
    };
    send({ ...base, status: 'success', error: null });
    send({ ...base, status: 'failed', error: null });

    const items = useNotificationsStore().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'automation-failed',
      title: 'Nightly',
      body: 'Run failed',
      href: '/automations'
    });
  });
});

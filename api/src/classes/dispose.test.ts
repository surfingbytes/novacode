// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    listSessionsByWorkspace: vi.fn(),
    listOrchestratorsByWorkspace: vi.fn()
  },
  cancelRun: vi.fn(),
  closeAcpSessionForNovaSession: vi.fn(),
  terminals: { stop: vi.fn(), stopMany: vi.fn() },
  cancelOrchestratorStep: vi.fn(),
  deleteSessionImages: vi.fn(),
  updateOrchestratorAndBroadcast: vi.fn()
}));

vi.mock('./database', () => ({ db: mocks.db }));
vi.mock('./chatEngine', () => ({ cancelRun: mocks.cancelRun }));
vi.mock('./acpSessionClose', () => ({ closeAcpSessionForNovaSession: mocks.closeAcpSessionForNovaSession }));
vi.mock('./workspaceTerminalManager', () => ({ workspaceTerminalManager: mocks.terminals }));
vi.mock('./orchestratorRunner', () => ({ cancelOrchestratorStep: mocks.cancelOrchestratorStep }));
vi.mock('./sessionImages', () => ({ deleteSessionImages: mocks.deleteSessionImages }));
vi.mock('./orchestratorEvents', () => ({ updateOrchestratorAndBroadcast: mocks.updateOrchestratorAndBroadcast }));

// classes
import { disposeSession, disposeWorkspace } from './dispose';

beforeEach(() => {
  mocks.closeAcpSessionForNovaSession.mockResolvedValue(undefined);
  mocks.deleteSessionImages.mockResolvedValue(undefined);
  mocks.cancelOrchestratorStep.mockReturnValue(false);
  mocks.updateOrchestratorAndBroadcast.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('disposeSession', () => {
  it('tears down every part of the session', async () => {
    await disposeSession('s1', 'w1');

    expect(mocks.cancelOrchestratorStep).toHaveBeenCalledWith('s1', expect.any(String));
    expect(mocks.cancelRun).toHaveBeenCalledWith('s1');
    expect(mocks.terminals.stop).toHaveBeenCalledWith('s1');
    expect(mocks.closeAcpSessionForNovaSession).toHaveBeenCalledWith('s1');
    expect(mocks.deleteSessionImages).toHaveBeenCalledWith('s1');
  });

  it('keeps going and never throws when parts fail', async () => {
    mocks.cancelRun.mockImplementation(() => {
      throw new Error('boom');
    });
    mocks.closeAcpSessionForNovaSession.mockRejectedValue(new Error('acp down'));

    await expect(disposeSession('s1', 'w1')).resolves.toBeUndefined();
    expect(mocks.terminals.stop).toHaveBeenCalledWith('s1');
    expect(mocks.deleteSessionImages).toHaveBeenCalledWith('s1');
  });
});

describe('disposeWorkspace', () => {
  it('fails running orchestrators, disposes every session and stops terminals', async () => {
    mocks.db.listOrchestratorsByWorkspace.mockResolvedValue([
      { id: 'o1', runStatus: 'running' },
      { id: 'o2', runStatus: 'completed' }
    ]);
    mocks.db.listSessionsByWorkspace.mockResolvedValue([{ id: 's1' }, { id: 's2' }]);

    await disposeWorkspace('w1');

    expect(mocks.updateOrchestratorAndBroadcast).toHaveBeenCalledTimes(1);
    expect(mocks.updateOrchestratorAndBroadcast).toHaveBeenCalledWith('w1', 'o1', { runStatus: 'failed' });
    expect(mocks.cancelOrchestratorStep.mock.calls).toEqual([
      ['s1', 'workspace deleted'],
      ['s2', 'workspace deleted']
    ]);
    expect(mocks.cancelRun.mock.calls).toEqual([['s1'], ['s2']]);
    expect(mocks.closeAcpSessionForNovaSession.mock.calls).toEqual([['s1'], ['s2']]);
    expect(mocks.deleteSessionImages.mock.calls).toEqual([['s1'], ['s2']]);
    expect(mocks.terminals.stopMany).toHaveBeenCalledWith(['s1', 's2']);
  });

  it('never throws when listing fails', async () => {
    mocks.db.listOrchestratorsByWorkspace.mockRejectedValue(new Error('db down'));
    mocks.db.listSessionsByWorkspace.mockRejectedValue(new Error('db down'));

    await expect(disposeWorkspace('w1')).resolves.toBeUndefined();
    expect(mocks.cancelRun).not.toHaveBeenCalled();
    expect(mocks.terminals.stopMany).toHaveBeenCalledWith([]);
  });
});

// node_modules
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  killAllAcpSubprocesses: vi.fn(),
  disposeAllClaudeAgents: vi.fn()
}));

vi.mock('./acpSubprocessRunner', () => ({ killAllAcpSubprocesses: mocks.killAllAcpSubprocesses }));
vi.mock('./claudeAcp', () => ({
  closeClaudeAcpForNovaSession: vi.fn(),
  disposeAllClaudeAgents: mocks.disposeAllClaudeAgents
}));

// classes
import { closeAllAcpSessions } from './acpSessionClose';

describe('closeAllAcpSessions', () => {
  it('kills running ACP subprocesses and disposes embedded Claude agents', async () => {
    mocks.killAllAcpSubprocesses.mockReturnValue(2);
    mocks.disposeAllClaudeAgents.mockResolvedValue(undefined);

    await closeAllAcpSessions('server shutdown');

    expect(mocks.killAllAcpSubprocesses).toHaveBeenCalledOnce();
    expect(mocks.disposeAllClaudeAgents).toHaveBeenCalledWith('server shutdown');
  });
});

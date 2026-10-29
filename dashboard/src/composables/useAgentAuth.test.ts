// @vitest-environment jsdom
// node_modules
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Hoisted so the mocks survive vi.resetModules (status is module-level state).
const { agentAuthApi, settingsApi } = vi.hoisted(() => ({
  agentAuthApi: {
    cursorStatus: vi.fn(),
    cursorLogin: vi.fn(),
    cursorLogout: vi.fn(),
    claudeStatus: vi.fn(),
    claudeLogin: vi.fn(),
    claudeLogout: vi.fn(),
    claudeSaveToken: vi.fn(),
    openCodeStatus: vi.fn(),
    openCodeLogin: vi.fn(),
    openCodeLogout: vi.fn(),
    codexStatus: vi.fn(),
    codexLogin: vi.fn(),
    codexLogout: vi.fn()
  },
  settingsApi: {
    getVibeApiKeyStatus: vi.fn(),
    setVibeApiKey: vi.fn(),
    clearVibeApiKey: vi.fn()
  }
}));

vi.mock('@/classes/api', () => ({
  isGloballyToasted: () => false,
  agentAuthApi,
  settingsApi
}));

type Deferred = { promise: Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void };
const deferred = (): Deferred => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const mockAllStatuses = (authenticated: boolean): void => {
  vi.mocked(agentAuthApi.cursorStatus).mockResolvedValue({
    data: { authenticated, status: authenticated ? 'authenticated' : 'unauthenticated' }
  });
  vi.mocked(agentAuthApi.claudeStatus).mockResolvedValue({ data: { authenticated } });
  vi.mocked(settingsApi.getVibeApiKeyStatus).mockResolvedValue({ data: { configured: authenticated } });
  vi.mocked(agentAuthApi.openCodeStatus).mockResolvedValue({ data: { authenticated } });
  vi.mocked(agentAuthApi.codexStatus).mockResolvedValue({ data: { authenticated } });
};

// Fresh module per test: status is module-level shared state.
const load = async (): Promise<typeof import('./useAgentAuth')> => {
  vi.resetModules();
  return import('./useAgentAuth');
};

describe('useAgentAuth', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('refreshAll issues every status probe in parallel', async () => {
    const { useAgentAuth } = await load();
    const probes = [
      agentAuthApi.cursorStatus,
      agentAuthApi.claudeStatus,
      settingsApi.getVibeApiKeyStatus,
      agentAuthApi.openCodeStatus,
      agentAuthApi.codexStatus
    ];
    const pending = probes.map(() => deferred());
    probes.forEach((probe, i) => vi.mocked(probe).mockReturnValue(pending[i].promise));

    const { status, refreshAll } = useAgentAuth();
    const done = refreshAll();

    // All five requests are in flight before any of them resolves.
    for (const probe of probes) {
      expect(probe).toHaveBeenCalledTimes(1);
    }
    expect(status.claude.loading).toBe(true);

    pending[0].resolve({ data: { authenticated: true, status: 'authenticated' } });
    pending[1].resolve({ data: { authenticated: true } });
    pending[2].resolve({ data: { configured: true } });
    pending[3].resolve({ data: { authenticated: true } });
    pending[4].resolve({ data: { authenticated: true } });
    await done;

    expect(Object.values(status).every((entry) => entry.authenticated && !entry.loading)).toBe(true);
  });

  it('a failing probe does not reject refreshAll or block the others', async () => {
    const { useAgentAuth } = await load();
    mockAllStatuses(true);
    vi.mocked(agentAuthApi.claudeStatus).mockRejectedValue(new Error('down'));
    vi.mocked(agentAuthApi.cursorStatus).mockRejectedValue(new Error('down'));

    const { status, cursorAuthStatus, cursorAuthMessage, refreshAll } = useAgentAuth();
    await expect(refreshAll()).resolves.toBeUndefined();

    expect(status.claude.authenticated).toBe(false);
    expect(status.claude.message).toMatch(/Could not verify/);
    expect(status.cursor.authenticated).toBe(false);
    expect(cursorAuthStatus.value).toBe('error');
    expect(cursorAuthMessage.value).toBe('Could not verify Cursor CLI authentication.');
    expect(status.vibe.authenticated).toBe(true);
    expect(status.opencode.authenticated).toBe(true);
    expect(status.codex.authenticated).toBe(true);
  });

  it('keeps cursor status and message from the probe', async () => {
    const { useAgentAuth } = await load();
    mockAllStatuses(false);
    vi.mocked(agentAuthApi.cursorStatus).mockResolvedValue({
      data: { authenticated: false, status: 'timeout', message: 'CLI timed out' }
    });

    const { cursorAuthStatus, cursorAuthMessage, refresh } = useAgentAuth();
    await refresh('cursor');

    expect(cursorAuthStatus.value).toBe('timeout');
    expect(cursorAuthMessage.value).toBe('CLI timed out');
  });

  it('shares status between callers', async () => {
    const { useAgentAuth } = await load();
    mockAllStatuses(true);
    await useAgentAuth().refreshAll();
    expect(useAgentAuth().status.codex.authenticated).toBe(true);
  });

  it('logout clears the agent status', async () => {
    const { useAgentAuth } = await load();
    mockAllStatuses(true);
    const { status, refreshAll, logoutClaude, logoutCursor, isBusy } = useAgentAuth();
    await refreshAll();

    mockAllStatuses(false);
    vi.mocked(agentAuthApi.claudeLogout).mockResolvedValue({});
    vi.mocked(agentAuthApi.cursorLogout).mockResolvedValue({});
    const pendingLogout = logoutClaude();
    expect(isBusy('claude', 'logout')).toBe(true);
    await pendingLogout;
    await logoutCursor();

    expect(isBusy('claude', 'logout')).toBe(false);
    expect(status.claude.authenticated).toBe(false);
    expect(status.cursor.authenticated).toBe(false);
  });

  it('startClaudeLogin opens the auth session and a saved token marks Claude authenticated', async () => {
    const { useAgentAuth } = await load();
    mockAllStatuses(false);
    vi.mocked(agentAuthApi.claudeLogin).mockResolvedValue({ data: { sessionId: 's1' } });
    vi.mocked(agentAuthApi.claudeSaveToken).mockResolvedValue({ data: { ok: true } });

    const { status, authSessionId, authKind, bClaudeAuthSuccess, startClaudeLogin, onAuthTokenFound } = useAgentAuth();
    await startClaudeLogin();
    expect(authSessionId.value).toBe('s1');
    expect(authKind.value).toBe('claude');

    vi.mocked(agentAuthApi.claudeStatus).mockResolvedValue({ data: { authenticated: true } });
    await onAuthTokenFound('  tok  ');

    expect(agentAuthApi.claudeSaveToken).toHaveBeenCalledWith('tok');
    expect(status.claude.authenticated).toBe(true);
    expect(bClaudeAuthSuccess.value).toBe(true);
    expect(authSessionId.value).toBeNull();
  });

  it('ignores tokens printed by the Cursor login terminal', async () => {
    const { useAgentAuth } = await load();
    vi.mocked(agentAuthApi.cursorLogin).mockResolvedValue({ data: { sessionId: 's2' } });
    const { startCursorLogin, onAuthTokenFound } = useAgentAuth();
    await startCursorLogin();
    await onAuthTokenFound('tok');
    expect(agentAuthApi.claudeSaveToken).not.toHaveBeenCalled();
  });

  it('submitAuthCode types the code into the terminal then presses enter', async () => {
    vi.useFakeTimers();
    const { useAgentAuth } = await load();
    const sendInput = vi.fn();
    const { authCode, authTerminalRef, submitAuthCode } = useAgentAuth();
    authTerminalRef.value = { sendInput } as never;
    authCode.value = ' abc ';

    const done = submitAuthCode();
    await vi.advanceTimersByTimeAsync(100);
    await done;
    vi.useRealTimers();

    expect(sendInput.mock.calls).toEqual([['abc'], ['\r']]);
    expect(authCode.value).toBe('');
  });

  it('saveApiKey reports rejected keys and updates status on success', async () => {
    const { useAgentAuth } = await load();
    mockAllStatuses(false);
    const { status, saveApiKey } = useAgentAuth();

    vi.mocked(agentAuthApi.codexLogin).mockResolvedValue({ data: { ok: false } });
    expect(await saveApiKey('codex', 'bad')).toMatch(/Authentication failed/);
    expect(status.codex.authenticated).toBe(false);

    vi.mocked(settingsApi.setVibeApiKey).mockResolvedValue({ data: { configured: true } });
    vi.mocked(settingsApi.getVibeApiKeyStatus).mockResolvedValue({ data: { configured: true } });
    expect(await saveApiKey('vibe', ' key ')).toBeNull();
    expect(settingsApi.setVibeApiKey).toHaveBeenCalledWith('key');
    expect(status.vibe.authenticated).toBe(true);
  });

  it('clearApiKey clears status, and returns an error when the request fails', async () => {
    const { useAgentAuth } = await load();
    mockAllStatuses(true);
    const { status, refreshAll, clearApiKey } = useAgentAuth();
    await refreshAll();

    vi.mocked(agentAuthApi.openCodeLogout).mockResolvedValue({});
    vi.mocked(agentAuthApi.openCodeStatus).mockResolvedValue({ data: { authenticated: false } });
    expect(await clearApiKey('opencode')).toBeNull();
    expect(status.opencode.authenticated).toBe(false);

    vi.mocked(agentAuthApi.codexLogout).mockRejectedValue(new Error('nope'));
    expect(await clearApiKey('codex')).toBe('Failed to remove API key.');
    expect(status.codex.authenticated).toBe(true);
  });
});

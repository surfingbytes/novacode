/**
 * Agent authentication status and login/logout/API-key actions.
 * Status is shared module-level state so Setup, Settings and the workspace list
 * all see the same values. The interactive login flow (auth terminal session,
 * pasted code, Claude token result) is per composable call.
 */

// node_modules
import { computed, reactive, ref } from 'vue';

// classes
import { agentAuthApi, settingsApi, type CursorAuthStatus } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';

// types
import type AppTerminal from '@/components/AppTerminal.vue';

export type AuthAgent = 'cursor' | 'claude' | 'vibe' | 'opencode' | 'codex';
export type ApiKeyAgent = 'vibe' | 'opencode' | 'codex';
export type AgentAuthAction = 'login' | 'logout' | 'save' | 'clear';

export interface AgentAuthState {
  authenticated: boolean;
  loading: boolean;
  message: string | null;
}

const AGENTS: AuthAgent[] = ['cursor', 'claude', 'vibe', 'opencode', 'codex'];

const AGENT_LABELS: Record<AuthAgent, string> = {
  cursor: 'Cursor',
  claude: 'Claude',
  vibe: 'Vibe',
  opencode: 'OpenCode',
  codex: 'Codex'
};

// -------------------------------------------------- Shared state --------------------------------------------------

const status = reactive<Record<AuthAgent, AgentAuthState>>({
  cursor: { authenticated: false, loading: false, message: null },
  claude: { authenticated: false, loading: false, message: null },
  vibe: { authenticated: false, loading: false, message: null },
  opencode: { authenticated: false, loading: false, message: null },
  codex: { authenticated: false, loading: false, message: null }
});
const cursorAuthStatus = ref<CursorAuthStatus>('error');
/** In-flight user actions, keyed `${agent}:${action}`. */
const busy = reactive<Record<string, boolean>>({});

// -------------------------------------------------- Methods --------------------------------------------------

const probe = async (agent: AuthAgent): Promise<boolean> => {
  switch (agent) {
    case 'cursor': {
      const { data } = await agentAuthApi.cursorStatus();
      cursorAuthStatus.value = data.status;
      status.cursor.message = data.message ?? null;
      return data.authenticated;
    }
    case 'claude':
      return (await agentAuthApi.claudeStatus()).data.authenticated;
    case 'vibe':
      return (await settingsApi.getVibeApiKeyStatus()).data.configured;
    case 'opencode':
      return (await agentAuthApi.openCodeStatus()).data.authenticated;
    case 'codex':
      return (await agentAuthApi.codexStatus()).data.authenticated;
  }
};

/** Re-read one agent's status. Never rejects; a failed probe keeps the previous value (Cursor reports `error`). */
const refresh = async (agent: AuthAgent): Promise<void> => {
  const entry = status[agent];
  entry.loading = true;
  try {
    entry.authenticated = await probe(agent);
    if (agent !== 'cursor') {
      entry.message = null;
    }
  } catch {
    if (agent === 'cursor') {
      entry.authenticated = false;
      cursorAuthStatus.value = 'error';
      entry.message = 'Could not verify Cursor CLI authentication.';
    } else {
      entry.message = `Could not verify ${AGENT_LABELS[agent]} status.`;
    }
  } finally {
    entry.loading = false;
  }
};

/** Probe every agent in parallel; one failing probe does not affect the others. */
const refreshAll = async (): Promise<void> => {
  await Promise.allSettled(AGENTS.map((agent) => refresh(agent)));
};

const isBusy = (agent: AuthAgent, action: AgentAuthAction): boolean => busy[`${agent}:${action}`] === true;

const withBusy = async <T>(agent: AuthAgent, action: AgentAuthAction, fn: () => Promise<T>): Promise<T> => {
  const key = `${agent}:${action}`;
  busy[key] = true;
  try {
    return await fn();
  } finally {
    busy[key] = false;
  }
};

/**
 * Save an API key for a key-based agent. Resolves to an error message, or
 * `null` on success (status is refreshed afterwards).
 */
const saveApiKey = (agent: ApiKeyAgent, apiKey: string): Promise<string | null> =>
  withBusy(agent, 'save', async () => {
    const key = apiKey.trim();
    if (!key) {
      return 'Enter an API key.';
    }
    try {
      if (agent === 'vibe') {
        await settingsApi.setVibeApiKey(key);
      } else {
        const response = agent === 'opencode' ? await agentAuthApi.openCodeLogin(key) : await agentAuthApi.codexLogin(key);
        if (!response.data?.ok) {
          return 'Authentication failed. Check your API key and try again.';
        }
      }
      status[agent].authenticated = true;
      await refresh(agent);
      return null;
    } catch {
      return 'Failed to save API key.';
    }
  });

/** Remove a key-based agent's API key. Resolves to an error message (already toasted), or `null` on success. */
const clearApiKey = (agent: ApiKeyAgent): Promise<string | null> =>
  withBusy(agent, 'clear', async () => {
    try {
      if (agent === 'vibe') {
        await settingsApi.clearVibeApiKey();
      } else if (agent === 'opencode') {
        await agentAuthApi.openCodeLogout();
      } else {
        await agentAuthApi.codexLogout();
      }
      status[agent].authenticated = false;
      await refresh(agent);
      return null;
    } catch (err) {
      notifyApiError(err, `Remove ${AGENT_LABELS[agent]} API key failed`);
      return 'Failed to remove API key.';
    }
  });

const logout = (agent: 'cursor' | 'claude'): Promise<void> =>
  withBusy(agent, 'logout', async () => {
    try {
      await (agent === 'cursor' ? agentAuthApi.cursorLogout() : agentAuthApi.claudeLogout());
      status[agent].authenticated = false;
      await refresh(agent);
    } catch (err) {
      notifyApiError(err, `${AGENT_LABELS[agent]} logout failed`);
    }
  });

const logoutCursor = (): Promise<void> => logout('cursor');
const logoutClaude = (): Promise<void> => logout('claude');

// -------------------------------------------------- Composable --------------------------------------------------

export interface UseAgentAuthOptions {
  /** Called whenever the auth terminal flow ends (dismissed, stored or session ended). */
  onFlowEnded?: () => void;
}

export function useAgentAuth(options: UseAgentAuthOptions = {}) {
  // Login flow state: per caller, so a terminal left open in one view never resurfaces in another.
  const authKind = ref<'cursor' | 'claude' | null>(null);
  const authSessionId = ref<string | null>(null);
  const authCode = ref<string>('');
  const authUrl = ref<string | null>(null);
  const authTerminalRef = ref<InstanceType<typeof AppTerminal>>();
  const bClaudeAuthSuccess = ref<boolean>(false);
  const claudeAuthError = ref<string>('');

  const cursorAuthMessage = computed((): string => status.cursor.message ?? '');

  const startLogin = (agent: 'cursor' | 'claude'): Promise<void> =>
    withBusy(agent, 'login', async () => {
      try {
        authUrl.value = null;
        authCode.value = '';
        authKind.value = agent;
        const response = await (agent === 'cursor' ? agentAuthApi.cursorLogin() : agentAuthApi.claudeLogin());
        authSessionId.value = response.data.sessionId;
      } catch (err) {
        authKind.value = null;
        notifyApiError(err, `${AGENT_LABELS[agent]} login failed`);
      }
    });

  const startCursorLogin = (): Promise<void> => startLogin('cursor');
  const startClaudeLogin = (): Promise<void> => startLogin('claude');

  const refreshFlowAgent = (): void => {
    if (authKind.value) {
      void refresh(authKind.value);
    } else {
      void refreshAll();
    }
  };

  const dismissAuthTerminal = (): void => {
    refreshFlowAgent();
    authSessionId.value = null;
    authUrl.value = null;
    authCode.value = '';
    authKind.value = null;
    options.onFlowEnded?.();
  };

  const onAuthSessionEnded = (): void => {
    refreshFlowAgent();
    options.onFlowEnded?.();
  };

  const openAuthUrl = (url: string): void => {
    authUrl.value = url;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  /** Type the pasted auth code into the login terminal, then press Enter. */
  const submitAuthCode = async (): Promise<void> => {
    const code = authCode.value.trim();
    if (!code) {
      return;
    }
    authTerminalRef.value?.sendInput(code);
    await new Promise((resolve) => setTimeout(resolve, 100));
    authTerminalRef.value?.sendInput('\r');
    authCode.value = '';
  };

  /** The Claude login terminal printed a long-lived token: store it and close the terminal. */
  const onAuthTokenFound = async (token: string): Promise<void> => {
    if (authKind.value !== 'claude') {
      return;
    }
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      return;
    }
    try {
      claudeAuthError.value = '';
      const response = await agentAuthApi.claudeSaveToken(trimmedToken);
      if (response.data?.ok) {
        status.claude.authenticated = true;
        bClaudeAuthSuccess.value = true;
        dismissAuthTerminal();
        setTimeout(() => {
          bClaudeAuthSuccess.value = false;
        }, 3000);
      } else {
        claudeAuthError.value = 'Failed to save Claude token.';
      }
      await refresh('claude');
    } catch {
      claudeAuthError.value = 'Failed to save Claude token.';
    }
  };

  return {
    status,
    cursorAuthStatus,
    cursorAuthMessage,
    refreshAll,
    refresh,
    isBusy,
    startCursorLogin,
    startClaudeLogin,
    submitAuthCode,
    onAuthTokenFound,
    logoutCursor,
    logoutClaude,
    saveApiKey,
    clearApiKey,
    authKind,
    authSessionId,
    authCode,
    authUrl,
    authTerminalRef,
    bClaudeAuthSuccess,
    claudeAuthError,
    openAuthUrl,
    dismissAuthTerminal,
    onAuthSessionEnded
  };
}

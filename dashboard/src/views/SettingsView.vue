<script setup lang="ts">
// node_modules
import { ref, onMounted } from 'vue';

// components
import AppTerminal from '@/components/AppTerminal.vue';
import PageShell from '@/components/layout/PageShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';

// classes
import { agentAuthApi, settingsApi } from '@/classes/api';

// lib
import {
  themes,
  applyTheme,
  DEFAULT_THEME_ID,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  resolveAutoTheme,
  resolveStoredThemeId,
  startAutoThemeWatcher,
  stopAutoThemeWatcher
} from '@/lib/themes';
import {
  isNotificationsEnabled,
  setNotificationsEnabled,
  canRequestPermission,
  getPermissionState,
  requestPermission,
  syncPushSubscription
} from '@/lib/notifications';

// types
import type { McpClientServer, McpConnectivityCheckResult } from '@/@types/index';

// -------------------------------------------------- Refs --------------------------------------------------
const activeTab = ref<'general' | 'git' | 'integrations' | 'mcp'>('general');
const bCursorAuthenticated = ref<boolean>(false);
const bClaudeAuthenticated = ref<boolean>(false);
const bOpenCodeAuthenticated = ref<boolean>(false);
const bCodexAuthenticated = ref<boolean>(false);
const bOpenCodeAvailable = ref<boolean>(false);
const bStartingCursorLogin = ref<boolean>(false);
const bStartingClaudeLogin = ref<boolean>(false);
const bLoggingOutCursor = ref<boolean>(false);
const bLoggingOutClaude = ref<boolean>(false);
const bLoggingOutOpenCode = ref<boolean>(false);
const bLoggingOutCodex = ref<boolean>(false);
const bShowOpenCodeApiKeyModal = ref<boolean>(false);
const bShowCodexApiKeyModal = ref<boolean>(false);
const openCodeApiKeyInput = ref<string>('');
const codexApiKeyInput = ref<string>('');
const bSavingOpenCodeApiKey = ref<boolean>(false);
const bSavingCodexApiKey = ref<boolean>(false);
const openCodeApiKeyError = ref<string>('');
const codexApiKeyError = ref<string>('');
const bOpenCodeAuthSuccess = ref<boolean>(false);
const bCodexAuthSuccess = ref<boolean>(false);
const authSessionId = ref<string | null>(null);
const authCode = ref<string>('');
const authUrl = ref<string | null>(null);
const bClaudeAuthSuccess = ref<boolean>(false);
const claudeAuthError = ref<string>('');
const authTerminalRef = ref<InstanceType<typeof AppTerminal> | null>(null);

const gitForm = ref<{ name: string; email: string }>({ name: '', email: '' });
const bSavingGit = ref<boolean>(false);
const bGitSaved = ref<boolean>(false);
const sshPublicKey = ref<string>('');
const sshPrivateKey = ref<string>('');
const bCopiedSshPublic = ref<boolean>(false);
const bCopiedSshPrivate = ref<boolean>(false);

const activeThemeId = ref<string>(
  resolveStoredThemeId(localStorage.getItem('theme') ?? DEFAULT_THEME_ID)
);
const bAutoTheme = ref<boolean>(
  localStorage.getItem('autoTheme') === null ? true : localStorage.getItem('autoTheme') === 'true'
);
const darkThemeId = ref<string>(
  resolveStoredThemeId(localStorage.getItem('darkTheme') ?? DEFAULT_DARK_THEME_ID)
);
const lightThemeId = ref<string>(
  resolveStoredThemeId(localStorage.getItem('lightTheme') ?? DEFAULT_LIGHT_THEME_ID)
);
const bSavingTheme = ref<boolean>(false);

const bNotifications = ref<boolean>(isNotificationsEnabled());
const notifPermission = ref<NotificationPermission | 'unsupported'>(getPermissionState());

// Claude Auto-Continue
const bClaudeAutoContinue = ref<boolean>(false);
const bSavingClaudeAutoContinue = ref<boolean>(false);

// Mistral Vibe API key
const bVibeConfigured = ref<boolean>(false);
const bLoadingVibeStatus = ref<boolean>(false);
const bShowVibeApiKeyModal = ref<boolean>(false);
const vibeApiKeyInput = ref<string>('');
const bSavingVibeApiKey = ref<boolean>(false);
const vibeApiKeyError = ref<string>('');
const bDeletingVibeApiKey = ref<boolean>(false);

// MCP client servers (external MCP — written to Cursor / Claude config on the server)
const mcpClients = ref<Record<string, McpClientServer>>({});
const bLoadingMcpClients = ref<boolean>(false);
const bSavingMcpClients = ref<boolean>(false);
const bShowMcpClientModal = ref<boolean>(false);
const mcpClientEditName = ref<string | null>(null);
const mcpClientForm = ref<{
  name: string;
  type: 'command' | 'url';
  command: string;
  args: string;
  env: string;
  url: string;
  headers: string;
}>({ name: '', type: 'command', command: '', args: '', env: '', url: '', headers: '' });
const mcpClientFormError = ref<string>('');
const bCheckingMcpConnectivity = ref<boolean>(false);
const mcpConnectivityResults = ref<Record<string, McpConnectivityCheckResult> | null>(null);
const mcpConnectivityError = ref<string>('');

// -------------------------------------------------- Computed --------------------------------------------------
// (none)

// -------------------------------------------------- Methods --------------------------------------------------
const toggleNotifications = async (): Promise<void> => {
  if (!canRequestPermission()) {
    return;
  }
  const enabling = !bNotifications.value;
  if (enabling && Notification.permission !== 'granted') {
    const perm = await requestPermission();
    notifPermission.value = perm;
    if (perm !== 'granted') {
      return;
    }
  }
  bNotifications.value = enabling;
  setNotificationsEnabled(enabling);
  try {
    await syncPushSubscription(enabling);
  } catch {
    // ignore push registration failures
  }
};

const refreshAuthStatus = async (): Promise<void> => {
  try {
    const cursorResponse = await agentAuthApi.cursorStatus();
    bCursorAuthenticated.value = cursorResponse.data.authenticated;
  } catch {
    // ignore
  }

  try {
    const claudeResponse = await agentAuthApi.claudeStatus();
    bClaudeAuthenticated.value = claudeResponse.data.authenticated;
  } catch {
    // ignore
  }

  try {
    const openCodeResponse = await agentAuthApi.openCodeStatus();
    bOpenCodeAuthenticated.value = openCodeResponse.data.authenticated;
  } catch {
    // ignore
  }
  try {
    const codexResponse = await agentAuthApi.codexStatus();
    bCodexAuthenticated.value = codexResponse.data.authenticated;
  } catch {
    // ignore
  }

  try {
    const capsResponse = await settingsApi.getAgentCapabilities();
    bOpenCodeAvailable.value = capsResponse.data.openCodeAvailable;
  } catch {
    // ignore
  }
};

const selectTheme = async (themeId: string): Promise<void> => {
  if (themeId === activeThemeId.value || bSavingTheme.value) {
    return;
  }
  activeThemeId.value = themeId;
  localStorage.setItem('theme', themeId);
  applyTheme(themeId);
  bSavingTheme.value = true;
  try {
    await settingsApi.update({ theme: themeId });
  } catch {
    // ignore
  } finally {
    bSavingTheme.value = false;
  }
};

const selectDarkTheme = async (themeId: string): Promise<void> => {
  if (themeId === darkThemeId.value || bSavingTheme.value) {
    return;
  }
  darkThemeId.value = themeId;
  localStorage.setItem('darkTheme', themeId);
  if (bAutoTheme.value) {
    applyTheme(resolveAutoTheme());
  }
  bSavingTheme.value = true;
  try {
    await settingsApi.update({ darkTheme: themeId });
  } catch {
    // ignore
  } finally {
    bSavingTheme.value = false;
  }
};

const selectLightTheme = async (themeId: string): Promise<void> => {
  if (themeId === lightThemeId.value || bSavingTheme.value) {
    return;
  }
  lightThemeId.value = themeId;
  localStorage.setItem('lightTheme', themeId);
  if (bAutoTheme.value) {
    applyTheme(resolveAutoTheme());
  }
  bSavingTheme.value = true;
  try {
    await settingsApi.update({ lightTheme: themeId });
  } catch {
    // ignore
  } finally {
    bSavingTheme.value = false;
  }
};

const toggleAutoTheme = async (): Promise<void> => {
  bAutoTheme.value = !bAutoTheme.value;
  localStorage.setItem('autoTheme', String(bAutoTheme.value));
  if (bAutoTheme.value) {
    applyTheme(resolveAutoTheme());
    startAutoThemeWatcher();
  } else {
    stopAutoThemeWatcher();
    applyTheme(activeThemeId.value);
  }
  bSavingTheme.value = true;
  try {
    await settingsApi.update({ autoTheme: bAutoTheme.value });
  } catch {
    // ignore
  } finally {
    bSavingTheme.value = false;
  }
};

const toggleClaudeAutoContinue = async (): Promise<void> => {
  bClaudeAutoContinue.value = !bClaudeAutoContinue.value;
  bSavingClaudeAutoContinue.value = true;
  try {
    await settingsApi.update({ claudeAutoContinue: bClaudeAutoContinue.value });
  } catch {
    // ignore
    bClaudeAutoContinue.value = !bClaudeAutoContinue.value; // Revert on error
  } finally {
    bSavingClaudeAutoContinue.value = false;
  }
};

const loadSettings = async (): Promise<void> => {
  try {
    const response = await settingsApi.get();
    gitForm.value.name = response.data.gitUserName ?? '';
    gitForm.value.email = response.data.gitUserEmail ?? '';
    if (response.data.darkTheme) {
      darkThemeId.value = response.data.darkTheme;
      localStorage.setItem('darkTheme', response.data.darkTheme);
    }
    if (response.data.lightTheme) {
      lightThemeId.value = response.data.lightTheme;
      localStorage.setItem('lightTheme', response.data.lightTheme);
    }
    if (typeof response.data.autoTheme === 'boolean') {
      const existingAutoTheme = localStorage.getItem('autoTheme');
      if (existingAutoTheme !== null) {
        bAutoTheme.value = response.data.autoTheme;
        localStorage.setItem('autoTheme', String(response.data.autoTheme));
      } else {
        // Default behavior: follow OS/browser unless the user has explicitly set
        // auto-theme in localStorage.
        bAutoTheme.value = true;
        if (response.data.autoTheme === true) {
          localStorage.setItem('autoTheme', 'true');
        }
      }
    }
    if (response.data.theme) {
      activeThemeId.value = response.data.theme;
      localStorage.setItem('theme', response.data.theme);
    }
    sshPublicKey.value = response.data.sshPublicKey ?? '';
    sshPrivateKey.value = response.data.sshPrivateKey ?? '';
    
    // Load Claude Auto-Continue preference
    if (typeof response.data.claudeAutoContinue === 'boolean') {
      bClaudeAutoContinue.value = response.data.claudeAutoContinue;
    }
    
    if (bAutoTheme.value) {
      applyTheme(resolveAutoTheme());
      startAutoThemeWatcher();
    } else if (response.data.theme) {
      applyTheme(response.data.theme);
    }
  } catch {
    // ignore
  }
};

const copySshPublic = async (): Promise<void> => {
  if (!sshPublicKey.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(sshPublicKey.value);
    bCopiedSshPublic.value = true;
    setTimeout(() => {
      bCopiedSshPublic.value = false;
    }, 2000);
  } catch {
    // ignore
  }
};

const copySshPrivate = async (): Promise<void> => {
  if (!sshPrivateKey.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(sshPrivateKey.value);
    bCopiedSshPrivate.value = true;
    setTimeout(() => {
      bCopiedSshPrivate.value = false;
    }, 2000);
  } catch {
    // ignore
  }
};

const saveGitSettings = async (): Promise<void> => {
  bSavingGit.value = true;
  bGitSaved.value = false;
  try {
    const response = await settingsApi.update({
      gitUserName: gitForm.value.name.trim() || null,
      gitUserEmail: gitForm.value.email.trim() || null
    });
    sshPublicKey.value = response.data.sshPublicKey ?? '';
    sshPrivateKey.value = response.data.sshPrivateKey ?? '';
    bGitSaved.value = true;
    setTimeout(() => {
      bGitSaved.value = false;
    }, 2000);
  } catch {
    // ignore
  } finally {
    bSavingGit.value = false;
  }
};

const startCursorLogin = async (): Promise<void> => {
  bStartingCursorLogin.value = true;
  try {
    authUrl.value = null;
    authCode.value = '';
    const response = await agentAuthApi.cursorLogin();
    authSessionId.value = response.data.sessionId;
  } catch {
    // ignore
  } finally {
    bStartingCursorLogin.value = false;
  }
};

const startClaudeLogin = async (): Promise<void> => {
  bStartingClaudeLogin.value = true;
  try {
    authUrl.value = null;
    authCode.value = '';
    const response = await agentAuthApi.claudeLogin();
    authSessionId.value = response.data.sessionId;
  } catch {
    // ignore
  } finally {
    bStartingClaudeLogin.value = false;
  }
};

const logoutCursor = async (): Promise<void> => {
  bLoggingOutCursor.value = true;
  try {
    await agentAuthApi.cursorLogout();
    await refreshAuthStatus();
  } catch {
    // ignore
  } finally {
    bLoggingOutCursor.value = false;
  }
};

const logoutClaude = async (): Promise<void> => {
  bLoggingOutClaude.value = true;
  try {
    await agentAuthApi.claudeLogout();
    await refreshAuthStatus();
  } catch {
    // ignore
  } finally {
    bLoggingOutClaude.value = false;
  }
};

const openOpenCodeApiKeyModal = (): void => {
  openCodeApiKeyInput.value = '';
  openCodeApiKeyError.value = '';
  bShowOpenCodeApiKeyModal.value = true;
};

const closeOpenCodeApiKeyModal = (): void => {
  bShowOpenCodeApiKeyModal.value = false;
  openCodeApiKeyError.value = '';
  refreshAuthStatus();
};

const saveOpenCodeApiKey = async (): Promise<void> => {
  const key = openCodeApiKeyInput.value.trim();
  openCodeApiKeyError.value = '';
  if (!key) {
    openCodeApiKeyError.value = 'Enter your OpenCode API key.';
    return;
  }
  bSavingOpenCodeApiKey.value = true;
  try {
    const response = await agentAuthApi.openCodeLogin(key);
    if (response.data?.ok) {
      bOpenCodeAuthSuccess.value = true;
      closeOpenCodeApiKeyModal();
      setTimeout(() => { bOpenCodeAuthSuccess.value = false; }, 3000);
    } else {
      openCodeApiKeyError.value = 'Authentication failed. Check your API key and try again.';
    }
  } catch {
    openCodeApiKeyError.value = 'Failed to authenticate. Try again.';
  } finally {
    bSavingOpenCodeApiKey.value = false;
  }
};

const logoutOpenCode = async (): Promise<void> => {
  bLoggingOutOpenCode.value = true;
  try {
    await agentAuthApi.openCodeLogout();
    await refreshAuthStatus();
  } catch {
    // ignore
  } finally {
    bLoggingOutOpenCode.value = false;
  }
};

const openCodexApiKeyModal = (): void => {
  codexApiKeyInput.value = '';
  codexApiKeyError.value = '';
  bShowCodexApiKeyModal.value = true;
};

const closeCodexApiKeyModal = (): void => {
  bShowCodexApiKeyModal.value = false;
  codexApiKeyError.value = '';
  refreshAuthStatus();
};

const saveCodexApiKey = async (): Promise<void> => {
  const key = codexApiKeyInput.value.trim();
  codexApiKeyError.value = '';
  if (!key) {
    codexApiKeyError.value = 'Enter your Codex API key.';
    return;
  }
  bSavingCodexApiKey.value = true;
  try {
    const response = await agentAuthApi.codexLogin(key);
    if (response.data?.ok) {
      bCodexAuthSuccess.value = true;
      closeCodexApiKeyModal();
      setTimeout(() => { bCodexAuthSuccess.value = false; }, 3000);
    } else {
      codexApiKeyError.value = 'Authentication failed. Check your API key and try again.';
    }
  } catch {
    codexApiKeyError.value = 'Failed to authenticate. Try again.';
  } finally {
    bSavingCodexApiKey.value = false;
  }
};

const logoutCodex = async (): Promise<void> => {
  bLoggingOutCodex.value = true;
  try {
    await agentAuthApi.codexLogout();
    await refreshAuthStatus();
  } catch {
    // ignore
  } finally {
    bLoggingOutCodex.value = false;
  }
};

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

const onAuthTokenFound = async (token: string): Promise<void> => {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return;
  }
  try {
    claudeAuthError.value = '';
    const response = await agentAuthApi.claudeSaveToken(trimmedToken);
    if (response.data?.ok) {
      bClaudeAuthSuccess.value = true;
      dismissAuthTerminal();
      setTimeout(() => {
        bClaudeAuthSuccess.value = false;
      }, 3000);
    } else {
      claudeAuthError.value = 'Failed to save Claude token.';
    }
    await refreshAuthStatus();
  } catch {
    claudeAuthError.value = 'Failed to save Claude token.';
  }
};

const openAuthUrl = (url: string): void => {
  authUrl.value = url;
  window.open(url, '_blank', 'noopener,noreferrer');
};

const dismissAuthTerminal = (): void => {
  authSessionId.value = null;
  authUrl.value = null;
  authCode.value = '';
  refreshAuthStatus();
};

const onAuthSessionEnded = (): void => {
  refreshAuthStatus();
};

const loadVibeApiKeyStatus = async (): Promise<void> => {
  bLoadingVibeStatus.value = true;
  try {
    const response = await settingsApi.getVibeApiKeyStatus();
    bVibeConfigured.value = response.data.configured;
  } catch {
    bVibeConfigured.value = false;
  } finally {
    bLoadingVibeStatus.value = false;
  }
};

const openVibeApiKeyModal = (): void => {
  vibeApiKeyInput.value = '';
  vibeApiKeyError.value = '';
  bShowVibeApiKeyModal.value = true;
};

const closeVibeApiKeyModal = (): void => {
  bShowVibeApiKeyModal.value = false;
  vibeApiKeyError.value = '';
  loadVibeApiKeyStatus();
};

const saveVibeApiKey = async (): Promise<void> => {
  const key = vibeApiKeyInput.value.trim();
  vibeApiKeyError.value = '';
  if (!key) {
    vibeApiKeyError.value = 'Enter your Mistral API key.';
    return;
  }
  bSavingVibeApiKey.value = true;
  try {
    await settingsApi.setVibeApiKey(key);
    closeVibeApiKeyModal();
  } catch {
    vibeApiKeyError.value = 'Failed to save API key.';
  } finally {
    bSavingVibeApiKey.value = false;
  }
};

const deleteVibeApiKey = async (): Promise<void> => {
  vibeApiKeyError.value = '';
  bDeletingVibeApiKey.value = true;
  try {
    await settingsApi.clearVibeApiKey();
    bVibeConfigured.value = false;
    closeVibeApiKeyModal();
  } catch {
    vibeApiKeyError.value = 'Failed to remove API key.';
  } finally {
    bDeletingVibeApiKey.value = false;
  }
};

const loadMcpClients = async (): Promise<void> => {
  bLoadingMcpClients.value = true;
  try {
    const response = await settingsApi.getMcpClients();
    mcpClients.value = response.data.servers;
  } catch {
    mcpClients.value = {};
  } finally {
    bLoadingMcpClients.value = false;
  }
};

const openAddMcpClient = (): void => {
  mcpClientEditName.value = null;
  mcpClientForm.value = {
    name: '', type: 'command', command: '', args: '', env: '', url: '', headers: ''
  };
  mcpClientFormError.value = '';
  bShowMcpClientModal.value = true;
};

const openEditMcpClient = (name: string): void => {
  const server = mcpClients.value[name];
  if (!server) {
    return;
  }
  mcpClientEditName.value = name;
  const isUrl =
    (!!server.url && !server.command) || server.type === 'http' || server.type === 'sse';
  mcpClientForm.value = {
    name,
    type: isUrl ? 'url' : 'command',
    command: server.command ?? '',
    args: (server.args ?? []).join('\n'),
    env: Object.entries(server.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    url: server.url ?? '',
    headers: Object.entries(server.headers ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n')
  };
  mcpClientFormError.value = '';
  bShowMcpClientModal.value = true;
};

const saveMcpClient = async (): Promise<void> => {
  const form = mcpClientForm.value;
  const name = form.name.trim();
  if (!name) {
    mcpClientFormError.value = 'Server name is required.';
    return;
  }
  if (mcpClientEditName.value !== name && name in mcpClients.value) {
    mcpClientFormError.value = 'A server with this name already exists.';
    return;
  }

  const server: McpClientServer = {};
  if (form.type === 'command') {
    if (!form.command.trim()) {
      mcpClientFormError.value = 'Command is required.';
      return;
    }
    server.command = form.command.trim();
    const args = form.args
      .split('\n')
      .map((argument) => argument.trim())
      .filter(Boolean);
    if (args.length > 0) {
      server.args = args;
    }
    const env: Record<string, string> = {};
    for (const line of form.env.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex > 0) {
        env[trimmed.slice(0, equalsIndex).trim()] = trimmed.slice(equalsIndex + 1).trim();
      }
    }
    if (Object.keys(env).length > 0) {
      server.env = env;
    }
  } else {
    if (!form.url.trim()) {
      mcpClientFormError.value = 'URL is required.';
      return;
    }
    server.url = form.url.trim();
    const headers: Record<string, string> = {};
    for (const line of form.headers.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        headers[trimmed.slice(0, colonIndex).trim()] = trimmed.slice(colonIndex + 1).trim();
      }
    }
    if (Object.keys(headers).length > 0) {
      server.headers = headers;
    }
  }

  const updated = { ...mcpClients.value };
  if (mcpClientEditName.value && mcpClientEditName.value !== name) {
    delete updated[mcpClientEditName.value];
  }
  updated[name] = server;

  bSavingMcpClients.value = true;
  try {
    const response = await settingsApi.saveMcpClients(updated);
    mcpClients.value = response.data.servers;
    bShowMcpClientModal.value = false;
  } catch {
    mcpClientFormError.value = 'Failed to save.';
  } finally {
    bSavingMcpClients.value = false;
  }
};

const deleteMcpClient = async (name: string): Promise<void> => {
  const updated = { ...mcpClients.value };
  delete updated[name];
  bSavingMcpClients.value = true;
  try {
    const response = await settingsApi.saveMcpClients(updated);
    mcpClients.value = response.data.servers;
  } catch {
    // ignore
  } finally {
    bSavingMcpClients.value = false;
  }
};

const runMcpConnectivityCheck = async (): Promise<void> => {
  if (Object.keys(mcpClients.value).length === 0) {
    return;
  }
  mcpConnectivityError.value = '';
  bCheckingMcpConnectivity.value = true;
  mcpConnectivityResults.value = null;
  try {
    const response = await settingsApi.checkMcpClients();
    mcpConnectivityResults.value = response.data.results;
  } catch {
    mcpConnectivityError.value = 'Connectivity check failed.';
  } finally {
    bCheckingMcpConnectivity.value = false;
  }
};

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted((): void => {
  refreshAuthStatus();
  loadSettings();
  loadVibeApiKeyStatus();
  loadMcpClients();
});
</script>

<template>
  <PageShell>
    <PageHeader
      eyebrow="// settings"
      title="Settings"
      subtitle="Configure appearance and preferences."
    />

      <!-- Tab bar -->
      <div class="settings-tabs" role="tablist">
        <button
          v-for="tab in [
            { id: 'general',      label: 'General' },
            { id: 'git',          label: 'Git' },
            { id: 'integrations', label: 'Integrations' },
            { id: 'mcp',          label: 'MCP' },
          ]"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.id"
          class="settings-tab"
          :class="activeTab === tab.id ? 'settings-tab--active' : ''"
          @click="(activeTab as any) = tab.id"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- Tab panel: General -->
      <div v-show="activeTab === 'general'" role="tabpanel">

        <!-- Appearance -->
        <div class="settings-section-label nc-eyebrow">Appearance</div>
        <div class="settings-pref-list">
          <div class="settings-pref-row">
            <div class="settings-pref-row__text">
              <div class="settings-pref-row__title">Automatic dark / light mode</div>
              <div class="settings-pref-row__desc">Switches between your chosen dark and light themes based on your browser or OS preference.</div>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="bAutoTheme"
              :disabled="bSavingTheme"
              class="nc-toggle"
              :class="bAutoTheme ? 'on' : ''"
              @click="toggleAutoTheme"
            ><span class="nc-toggle-knob" /></button>
          </div>
          <div class="settings-pref-row">
            <div class="settings-pref-row__text">
              <div class="settings-pref-row__title">Auto-continue Claude conversations</div>
              <div class="settings-pref-row__desc">Automatically continue conversations when Claude API limits reset.</div>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="bClaudeAutoContinue"
              :disabled="bSavingClaudeAutoContinue"
              class="nc-toggle"
              :class="bClaudeAutoContinue ? 'on' : ''"
              @click="toggleClaudeAutoContinue"
            ><span class="nc-toggle-knob" /></button>
          </div>
        </div>

        <!-- Dark Theme -->
        <div class="settings-section-label nc-eyebrow" style="margin-top: 36px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>
          Dark Theme
        </div>
        <div class="settings-theme-grid">
          <button
            v-for="theme in themes.filter(t => t.dark)"
            :key="theme.id"
            type="button"
            class="settings-theme-swatch"
            :class="(bAutoTheme ? darkThemeId === theme.id : activeThemeId === theme.id) ? 'settings-theme-swatch--active' : ''"
            @click="bAutoTheme ? selectDarkTheme(theme.id) : selectTheme(theme.id)"
          >
            <div class="settings-theme-swatch__dots">
              <span v-for="(dot, i) in theme.previewDots" :key="i" class="settings-theme-swatch__dot" :style="{ background: dot }" />
            </div>
            <div class="settings-theme-swatch__name">{{ theme.name }}</div>
            <div v-if="bAutoTheme ? darkThemeId === theme.id : activeThemeId === theme.id" class="settings-theme-swatch__active-dot" />
          </button>
        </div>

        <!-- Light Theme -->
        <div class="settings-section-label nc-eyebrow" style="margin-top: 36px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4 M12 7a5 5 0 100 10 5 5 0 000-10z"/></svg>
          Light Theme
        </div>
        <div class="settings-theme-grid">
          <button
            v-for="theme in themes.filter(t => !t.dark)"
            :key="theme.id"
            type="button"
            class="settings-theme-swatch"
            :class="(bAutoTheme ? lightThemeId === theme.id : activeThemeId === theme.id) ? 'settings-theme-swatch--active' : ''"
            @click="bAutoTheme ? selectLightTheme(theme.id) : selectTheme(theme.id)"
          >
            <div class="settings-theme-swatch__dots">
              <span v-for="(dot, i) in theme.previewDots" :key="i" class="settings-theme-swatch__dot" :style="{ background: dot }" />
            </div>
            <div class="settings-theme-swatch__name">{{ theme.name }}</div>
            <div v-if="bAutoTheme ? lightThemeId === theme.id : activeThemeId === theme.id" class="settings-theme-swatch__active-dot" />
          </button>
        </div>

        <!-- Notifications -->
        <template v-if="canRequestPermission()">
          <div class="settings-section-label nc-eyebrow" style="margin-top: 36px;">Notifications</div>
          <div class="settings-pref-list">
            <div class="settings-pref-row">
              <div class="settings-pref-row__text">
                <div class="settings-pref-row__title">Task completion notifications</div>
                <div class="settings-pref-row__desc">
                  Get a browser notification when an agent task finishes while the tab is in the background.
                  <span v-if="notifPermission === 'denied'" class="settings-pref-row__warn">
                    Notifications are blocked by your browser. Allow them in your browser's site settings.
                  </span>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="bNotifications"
                :disabled="notifPermission === 'denied'"
                class="nc-toggle"
                :class="bNotifications ? 'on' : ''"
                @click="toggleNotifications"
              ><span class="nc-toggle-knob" /></button>
            </div>
          </div>
        </template>

      </div>

      <!-- Tab panel: Git -->
      <div v-show="activeTab === 'git'" role="tabpanel">
        <!-- Git Identity -->
        <div>
          <div class="settings-section-label nc-eyebrow">Git Identity</div>
          <p class="settings-section-desc">
            Global git user name and email. Individual workspaces can override these.
          </p>
          <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5 space-y-4">
            <div>
              <label class="block text-sm font-medium text-text-primary mb-1.5">Name</label>
              <input
                v-model="gitForm.name"
                type="text"
                placeholder="Your Name"
                class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              />
            </div>
            <div>
              <label class="block text-sm font-medium text-text-primary mb-1.5">Email</label>
              <input
                v-model="gitForm.email"
                type="email"
                placeholder="you@example.com"
                class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              />
            </div>
            <div class="flex items-center gap-3 pt-1">
              <button
                class="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-all"
                :disabled="bSavingGit"
                @click="saveGitSettings"
              >
                <div
                  v-if="bSavingGit"
                  class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
                ></div>
                Save
              </button>
              <span v-if="bGitSaved" class="text-xs text-success">Saved.</span>
            </div>
          </div>
        </div>

        <!-- SSH key (Docker / server identity for git push) -->
        <div style="margin-top: 36px;">
          <div class="settings-section-label nc-eyebrow">SSH key for Git remotes</div>
          <p class="settings-section-desc">
            On first startup the server creates an ed25519 keypair under your config volume (
            <code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded text-text-primary font-mono text-[11px]"
              >.ssh/id_ed25519</code
            >
            ). Add the <strong class="text-text-primary font-medium">public</strong> key to your
            Git host (GitHub, GitLab, Gitea, etc.) so
            <code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded font-mono text-[11px]"
              >git push</code
            >
            over SSH works from the container. The private key is shown only here — protect it like
            any deploy key.
          </p>
          <div class="space-y-4">
            <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5">
              <div class="flex items-center justify-between gap-2 mb-2">
                <label class="text-sm font-medium text-text-primary">Public key</label>
                <button
                  type="button"
                  class="text-xs font-medium px-3 py-1.5 rounded-lg border border-fg/[0.12] bg-fg/[0.05] hover:bg-fg/[0.09] text-text-primary transition-colors disabled:opacity-40"
                  :disabled="!sshPublicKey"
                  @click="copySshPublic"
                >
                  {{ bCopiedSshPublic ? 'Copied' : 'Copy' }}
                </button>
              </div>
              <pre
                class="text-xs font-mono text-text-muted whitespace-pre-wrap break-all bg-fg/[0.05] border border-fg/[0.08] rounded-lg px-3 py-2.5 min-h-[2.5rem]"
                >{{ sshPublicKey || '—' }}</pre
              >
            </div>
            <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5">
              <div class="flex items-center justify-between gap-2 mb-2">
                <label class="text-sm font-medium text-text-primary">Private key</label>
                <button
                  type="button"
                  class="text-xs font-medium px-3 py-1.5 rounded-lg border border-fg/[0.12] bg-fg/[0.05] hover:bg-fg/[0.09] text-text-primary transition-colors disabled:opacity-40"
                  :disabled="!sshPrivateKey"
                  @click="copySshPrivate"
                >
                  {{ bCopiedSshPrivate ? 'Copied' : 'Copy' }}
                </button>
              </div>
              <pre
                class="text-xs font-mono text-text-muted whitespace-pre-wrap break-all bg-fg/[0.05] border border-fg/[0.08] rounded-lg px-3 py-2.5 min-h-[2.5rem] max-h-48 overflow-y-auto"
                >{{ sshPrivateKey || '—' }}</pre
              >
              <p class="text-xs text-warning mt-2">
                Anyone with this key can push as you to any host that trusts the public key. Do not
                share it.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab panel: Integrations -->
      <div v-show="activeTab === 'integrations'" role="tabpanel">
        <div class="settings-section-label nc-eyebrow">Agent Authentication</div>
        <p class="settings-section-desc">Log in to AI services. Credentials are stored in the config volume and persist across restarts.</p>
        <div class="settings-auth-list">
          <div class="settings-auth-card">
            <div class="settings-auth-card__top">
              <div class="settings-auth-card__info">
                <div class="settings-auth-card__name">Cursor</div>
                <div class="settings-auth-card__desc">Uses <code class="settings-mono-chip">cursor-agent login</code> — sign in with your Cursor account</div>
              </div>
              <span class="nc-chip" :class="bCursorAuthenticated ? 'success' : ''">{{ bCursorAuthenticated ? 'Authenticated' : 'Not authenticated' }}</span>
            </div>
            <div class="settings-auth-card__actions">
              <button v-if="!bCursorAuthenticated" class="settings-btn-primary" :disabled="bStartingCursorLogin" @click="startCursorLogin">
                <span v-if="bStartingCursorLogin" class="settings-spinner" />Login to Cursor
              </button>
              <button v-else class="settings-btn" :disabled="bLoggingOutCursor" @click="logoutCursor">
                <span v-if="bLoggingOutCursor" class="settings-spinner" />Logout
              </button>
              <a href="https://cursor.com/dashboard?tab=spending" target="_blank" rel="noopener noreferrer" class="settings-auth-link">View account &amp; usage →</a>
            </div>
          </div>
          <div class="settings-auth-card">
            <div class="settings-auth-card__top">
              <div class="settings-auth-card__info">
                <div class="settings-auth-card__name">Claude Code</div>
                <div class="settings-auth-card__desc">Uses <code class="settings-mono-chip">claude setup-token</code> — sign in with your Claude account and paste the issued token.</div>
              </div>
              <span class="nc-chip" :class="bClaudeAuthenticated ? 'success' : ''">{{ bClaudeAuthenticated ? 'Configured' : 'Not configured' }}</span>
            </div>
            <div class="settings-auth-card__actions">
              <button v-if="!bClaudeAuthenticated" class="settings-btn-primary" :disabled="bStartingClaudeLogin" @click="startClaudeLogin">
                <span v-if="bStartingClaudeLogin" class="settings-spinner" />Login to Claude
              </button>
              <button v-else class="settings-btn" :disabled="bLoggingOutClaude" @click="logoutClaude">
                <span v-if="bLoggingOutClaude" class="settings-spinner" />Logout
              </button>
              <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" class="settings-auth-link">Manage account &amp; usage →</a>
            </div>
            <p v-if="bClaudeAuthSuccess" class="settings-auth-card__success">Claude token saved.</p>
            <p v-if="claudeAuthError" class="settings-auth-card__error">{{ claudeAuthError }}</p>
          </div>
          <div class="settings-auth-card">
            <div class="settings-auth-card__top">
              <div class="settings-auth-card__info">
                <div class="settings-auth-card__name">Mistral Vibe</div>
                <div class="settings-auth-card__desc">API key for the Vibe CLI. Stored in <code class="settings-mono-chip">~/.vibe/.env</code>.</div>
              </div>
              <span class="nc-chip" :class="bVibeConfigured ? 'success' : ''">{{ bLoadingVibeStatus ? '…' : bVibeConfigured ? 'Configured' : 'Not configured' }}</span>
            </div>
            <div class="settings-auth-card__actions">
              <button class="settings-btn-accent" :disabled="bLoadingVibeStatus" @click="openVibeApiKeyModal">{{ bVibeConfigured ? 'Update API key' : 'Set API key' }}</button>
            </div>
          </div>
          <div class="settings-auth-card">
            <div class="settings-auth-card__top">
              <div class="settings-auth-card__info">
                <div class="settings-auth-card__name">OpenCode</div>
                <div class="settings-auth-card__desc">Open-source AI coding assistant. API key stored via <code class="settings-mono-chip">opencode auth login -p opencode</code>.</div>
              </div>
              <span class="nc-chip" :class="bOpenCodeAuthenticated ? 'success' : ''">{{ bOpenCodeAuthenticated ? 'Configured' : 'Not configured' }}</span>
            </div>
            <div class="settings-auth-card__actions">
              <button class="settings-btn-accent" @click="openOpenCodeApiKeyModal">{{ bOpenCodeAuthenticated ? 'Update API key' : 'Set API key' }}</button>
              <button v-if="bOpenCodeAuthenticated" class="settings-btn" :disabled="bLoggingOutOpenCode" @click="logoutOpenCode">
                <span v-if="bLoggingOutOpenCode" class="settings-spinner" />Logout
              </button>
            </div>
            <p v-if="bOpenCodeAuthSuccess" class="settings-auth-card__success">OpenCode API key saved.</p>
          </div>
          <div class="settings-auth-card">
            <div class="settings-auth-card__top">
              <div class="settings-auth-card__info">
                <div class="settings-auth-card__name">OpenAI Codex ACP</div>
                <div class="settings-auth-card__desc">API key for Codex ACP. Stored in <code class="settings-mono-chip">~/.codex/auth.json</code>.</div>
              </div>
              <span class="nc-chip" :class="bCodexAuthenticated ? 'success' : ''">{{ bCodexAuthenticated ? 'Configured' : 'Not configured' }}</span>
            </div>
            <div class="settings-auth-card__actions">
              <button class="settings-btn-accent" @click="openCodexApiKeyModal">{{ bCodexAuthenticated ? 'Update API key' : 'Set API key' }}</button>
              <button v-if="bCodexAuthenticated" class="settings-btn" :disabled="bLoggingOutCodex" @click="logoutCodex">
                <span v-if="bLoggingOutCodex" class="settings-spinner" />Logout
              </button>
            </div>
            <p v-if="bCodexAuthSuccess" class="settings-auth-card__success">Codex API key saved.</p>
          </div>
        </div>
      </div>

      <!-- Tab panel: MCP clients -->
      <div v-show="activeTab === 'mcp'" role="tabpanel">
        <!-- MCP client servers -->
        <div>
          <div class="settings-section-label nc-eyebrow">MCP client servers</div>
          <p class="settings-section-desc">
            Register <strong class="text-text-primary font-medium">external</strong> MCP servers (stdio or HTTP) for
            Cursor and Claude Code. The API writes your config volume (<code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded text-text-primary font-mono text-[11px]"
              >CONFIG_DIR</code
            >): Cursor reads
            <code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded text-text-primary font-mono text-[11px]"
              >.cursor/mcp.json</code>
            ; Claude merges
            <code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded text-text-primary font-mono text-[11px]"
              >mcpServers</code>
            into
            <code
              class="bg-fg/[0.06] border border-fg/[0.08] px-1.5 py-0.5 rounded text-text-primary font-mono text-[11px]"
              >.claude.json</code>
            (applies to all workspaces using this server).
          </p>

          <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
              <span class="text-sm text-text-primary">Configured servers</span>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="flex items-center gap-2 bg-fg/[0.05] hover:bg-fg/[0.09] disabled:opacity-50 disabled:cursor-not-allowed border border-fg/[0.1] text-text-primary text-sm font-medium px-4 py-2.5 rounded-lg transition-all"
                  :disabled="
                    bSavingMcpClients ||
                    bLoadingMcpClients ||
                    bCheckingMcpConnectivity ||
                    Object.keys(mcpClients).length === 0
                  "
                  @click="runMcpConnectivityCheck"
                >
                  <span
                    v-if="bCheckingMcpConnectivity"
                    class="w-3.5 h-3.5 border-2 border-fg/30 border-t-fg rounded-full animate-spin"
                  ></span>
                  Test connectivity
                </button>
                <button
                  class="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-all"
                  :disabled="bSavingMcpClients"
                  @click="openAddMcpClient"
                >
                  Add server
                </button>
              </div>
            </div>
            <p class="text-xs text-text-muted mb-4">
              Dry-run: command (stdio) servers are spawned briefly on the host; HTTP servers are
              requested with GET. Fix failures here before agents load MCP mid-session.
            </p>
            <p v-if="mcpConnectivityError" class="text-xs text-destructive mb-3">
              {{ mcpConnectivityError }}
            </p>
            <div
              v-if="mcpConnectivityResults && Object.keys(mcpConnectivityResults).length > 0"
              class="mb-4 rounded-lg border border-fg/[0.08] bg-fg/[0.03] divide-y divide-fg/[0.06]"
            >
              <div
                v-for="(connectivityResult, name) in mcpConnectivityResults"
                :key="name"
                class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1 px-3 py-2.5 text-sm"
              >
                <span class="font-medium text-text-primary">{{ name }}</span>
                <span
                  class="text-xs font-medium shrink-0"
                  :class="connectivityResult.ok ? 'text-success' : 'text-destructive'"
                >
                  {{ connectivityResult.ok ? `${connectivityResult.kind === 'http' ? 'HTTP' : 'stdio'} OK` : 'Failed' }}
                  <span v-if="connectivityResult.detail" class="text-text-muted font-normal"> — {{ connectivityResult.detail }}</span>
                  <span v-if="connectivityResult.error" class="text-destructive"> — {{ connectivityResult.error }}</span>
                </span>
              </div>
            </div>
            <div v-if="bLoadingMcpClients" class="text-sm text-text-muted py-4">Loading…</div>
            <div
              v-else-if="Object.keys(mcpClients).length === 0"
              class="text-sm text-text-muted py-4"
            >
              No MCP servers configured yet.
            </div>
            <ul v-else class="space-y-3">
              <li
                v-for="(server, name) in mcpClients"
                :key="name"
                class="flex items-center justify-between gap-4 py-3 border-b border-fg/[0.06] last:border-0"
              >
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <p class="text-sm font-medium text-text-primary truncate">{{ name }}</p>
                    <span
                      class="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border"
                      :class="
                        server.url && !server.command
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : 'bg-fg/[0.06] text-text-muted border-fg/[0.1]'
                      "
                    >
                      {{
                        server.url && !server.command
                          ? server.type === 'sse'
                            ? 'SSE'
                            : 'HTTP'
                          : 'stdio'
                      }}
                    </span>
                  </div>
                  <p class="text-xs text-text-muted font-mono mt-0.5 truncate">
                    {{
                      server.command
                        ? `${server.command} ${(server.args ?? []).join(' ')}`
                        : server.url
                    }}
                  </p>
                </div>
                <div class="flex items-center gap-1 flex-shrink-0">
                  <button
                    class="text-xs text-text-muted hover:text-text-primary hover:bg-fg/[0.08] px-2.5 py-1.5 rounded-lg transition-colors"
                    @click="openEditMcpClient(name as string)"
                  >
                    Edit
                  </button>
                  <button
                    class="text-xs text-destructive hover:bg-destructive/10 px-2.5 py-1.5 rounded-lg transition-colors"
                    :disabled="bSavingMcpClients"
                    @click="deleteMcpClient(name as string)"
                  >
                    Delete
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
  </PageShell>

    <!-- MCP client server modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div
          v-if="bShowMcpClientModal"
          class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          @click.self="bShowMcpClientModal = false"
        >
          <div
            class="modal-panel w-full max-w-md flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
            @click.stop
          >
            <div
              class="flex flex-shrink-0 items-center justify-between border-b border-border px-4 py-3"
            >
              <p class="text-sm font-medium text-text-primary">
                {{ mcpClientEditName ? 'Edit MCP server' : 'Add MCP server' }}
              </p>
              <button
                class="text-sm px-3 py-2 text-text-muted hover:text-text-primary hover:bg-fg/[0.08] rounded-lg transition-all"
                @click="bShowMcpClientModal = false"
              >
                Cancel
              </button>
            </div>
            <div class="max-h-[70vh] min-h-0 flex-1 space-y-4 overflow-y-auto bg-surface p-4">
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">Server name</label>
                <input
                  v-model="mcpClientForm.name"
                  type="text"
                  placeholder="e.g. filesystem"
                  class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                  :disabled="bSavingMcpClients"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">Type</label>
                <div class="flex gap-1 p-0.5 rounded-lg bg-fg/[0.04] border border-fg/[0.07]">
                  <button
                    type="button"
                    class="flex-1 text-sm font-medium py-2 rounded-md transition-colors"
                    :class="
                      mcpClientForm.type === 'command'
                        ? 'bg-fg/[0.08] text-text-primary'
                        : 'text-text-muted hover:text-text-primary'
                    "
                    @click="mcpClientForm.type = 'command'"
                  >
                    Command (stdio)
                  </button>
                  <button
                    type="button"
                    class="flex-1 text-sm font-medium py-2 rounded-md transition-colors"
                    :class="
                      mcpClientForm.type === 'url'
                        ? 'bg-fg/[0.08] text-text-primary'
                        : 'text-text-muted hover:text-text-primary'
                    "
                    @click="mcpClientForm.type = 'url'"
                  >
                    URL (HTTP)
                  </button>
                </div>
              </div>
              <template v-if="mcpClientForm.type === 'command'">
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">Command</label>
                  <input
                    v-model="mcpClientForm.command"
                    type="text"
                    placeholder="npx"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                    :disabled="bSavingMcpClients"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">
                    Arguments
                    <span class="text-text-muted font-normal">(one per line)</span>
                  </label>
                  <textarea
                    v-model="mcpClientForm.args"
                    rows="3"
                    placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/dir"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
                    :disabled="bSavingMcpClients"
                  ></textarea>
                </div>
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">
                    Environment variables
                    <span class="text-text-muted font-normal">(KEY=VALUE, one per line)</span>
                  </label>
                  <textarea
                    v-model="mcpClientForm.env"
                    rows="2"
                    placeholder="API_KEY=…"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
                    :disabled="bSavingMcpClients"
                  ></textarea>
                </div>
              </template>
              <template v-else>
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">URL</label>
                  <input
                    v-model="mcpClientForm.url"
                    type="url"
                    placeholder="https://example.com/mcp"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                    :disabled="bSavingMcpClients"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">
                    Headers
                    <span class="text-text-muted font-normal">(Key: Value, one per line)</span>
                  </label>
                  <textarea
                    v-model="mcpClientForm.headers"
                    rows="2"
                    placeholder="Authorization: Bearer …"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
                    :disabled="bSavingMcpClients"
                  ></textarea>
                </div>
              </template>
              <p v-if="mcpClientFormError" class="text-xs text-destructive">
                {{ mcpClientFormError }}
              </p>
            </div>
            <div class="flex flex-shrink-0 gap-2 border-t border-border bg-surface p-4 pt-3">
              <button
                class="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-all"
                :disabled="!mcpClientForm.name.trim() || bSavingMcpClients"
                @click="saveMcpClient"
              >
                {{ bSavingMcpClients ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Codex API key modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div
          v-if="bShowCodexApiKeyModal"
          class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          @click.self="closeCodexApiKeyModal"
        >
          <div
            class="modal-panel w-full max-w-md flex flex-col bg-fg/[0.04] border border-fg/[0.12] rounded-xl shadow-2xl"
            @click.stop
          >
            <div class="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-fg/[0.08]">
              <p class="text-sm font-medium text-text-primary">Codex API key</p>
              <button
                class="text-sm px-3 py-2 text-text-muted hover:text-text-primary hover:bg-fg/[0.08] rounded-lg transition-all"
                @click="closeCodexApiKeyModal"
              >
                Cancel
              </button>
            </div>
            <div class="flex-1 min-h-0 p-4 space-y-4">
              <p class="text-sm text-text-muted">
                Enter your OpenAI API key for Codex ACP authentication.
              </p>
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">API key</label>
                <input
                  v-model="codexApiKeyInput"
                  type="password"
                  placeholder="Your OpenAI API key"
                  class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                  :disabled="bSavingCodexApiKey"
                  autocomplete="off"
                  @keydown.enter="saveCodexApiKey"
                />
              </div>
              <p v-if="codexApiKeyError" class="text-xs text-destructive">{{ codexApiKeyError }}</p>
            </div>
            <div class="flex flex-shrink-0 gap-2 p-4 pt-0">
              <button
                class="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-all"
                :disabled="!codexApiKeyInput.trim() || bSavingCodexApiKey"
                @click="saveCodexApiKey"
              >
                {{ bSavingCodexApiKey ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Mistral Vibe API key setup modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div
          v-if="bShowVibeApiKeyModal"
          class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          @click.self="closeVibeApiKeyModal"
        >
          <div
            class="modal-panel w-full max-w-md flex flex-col bg-fg/[0.04] border border-fg/[0.12] rounded-xl shadow-2xl"
            @click.stop
          >
            <div
              class="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-fg/[0.08]"
            >
              <p class="text-sm font-medium text-text-primary">Mistral Vibe API key</p>
              <button
                class="text-sm px-3 py-2 text-text-muted hover:text-text-primary hover:bg-fg/[0.08] rounded-lg transition-all"
                @click="closeVibeApiKeyModal"
              >
                Cancel
              </button>
            </div>
            <div class="flex-1 min-h-0 p-4 space-y-4">
              <p class="text-sm text-text-muted">
                Enter your Mistral API key. It will be saved to
                <code class="bg-fg/[0.06] px-1 py-0.5 rounded text-[11px]">~/.vibe/.env</code>
                and used when running Vibe.
              </p>
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">API key</label>
                <input
                  v-model="vibeApiKeyInput"
                  type="password"
                  placeholder="Your Mistral API key"
                  class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                  :disabled="bSavingVibeApiKey"
                  autocomplete="off"
                  @keydown.enter="saveVibeApiKey"
                />
              </div>
              <p v-if="vibeApiKeyError" class="text-xs text-destructive">{{ vibeApiKeyError }}</p>
            </div>
            <div class="flex flex-shrink-0 gap-2 p-4 pt-0">
              <button
                class="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-all"
                :disabled="!vibeApiKeyInput.trim() || bSavingVibeApiKey"
                @click="saveVibeApiKey"
              >
                {{ bSavingVibeApiKey ? 'Saving…' : 'Save' }}
              </button>
              <button
                v-if="bVibeConfigured"
                class="flex-1 bg-destructive/10 hover:bg-destructive/20 text-destructive text-sm font-medium py-2.5 rounded-lg border border-destructive/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="bDeletingVibeApiKey"
                @click="deleteVibeApiKey"
              >
                {{ bDeletingVibeApiKey ? 'Removing…' : 'Remove key' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- OpenCode API key modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div
          v-if="bShowOpenCodeApiKeyModal"
          class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          @click.self="closeOpenCodeApiKeyModal"
        >
          <div
            class="modal-panel w-full max-w-md flex flex-col bg-fg/[0.04] border border-fg/[0.12] rounded-xl shadow-2xl"
            @click.stop
          >
            <div class="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-fg/[0.08]">
              <p class="text-sm font-medium text-text-primary">OpenCode API key</p>
              <button
                class="text-sm px-3 py-2 text-text-muted hover:text-text-primary hover:bg-fg/[0.08] rounded-lg transition-all"
                @click="closeOpenCodeApiKeyModal"
              >
                Cancel
              </button>
            </div>
            <div class="flex-1 min-h-0 p-4 space-y-4">
              <p class="text-sm text-text-muted">
                Enter your OpenCode API key. It will be stored via
                <code class="bg-fg/[0.06] px-1 py-0.5 rounded text-[11px]">opencode auth login -p opencode</code>.
              </p>
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">API key</label>
                <input
                  v-model="openCodeApiKeyInput"
                  type="password"
                  placeholder="Your OpenCode API key"
                  class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                  :disabled="bSavingOpenCodeApiKey"
                  autocomplete="off"
                  @keydown.enter="saveOpenCodeApiKey"
                />
              </div>
              <p v-if="openCodeApiKeyError" class="text-xs text-destructive">{{ openCodeApiKeyError }}</p>
            </div>
            <div class="flex flex-shrink-0 gap-2 p-4 pt-0">
              <button
                class="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-all"
                :disabled="!openCodeApiKeyInput.trim() || bSavingOpenCodeApiKey"
                @click="saveOpenCodeApiKey"
              >
                {{ bSavingOpenCodeApiKey ? 'Saving…' : 'Save' }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Authentication terminal overlay (Claude/Cursor login) -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div
          v-if="authSessionId"
          class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          @click.self="dismissAuthTerminal"
        >
          <div
            class="modal-panel w-full max-w-3xl flex flex-col bg-fg/[0.04] border border-fg/[0.12] rounded-xl shadow-2xl"
            @click.stop
          >
            <div
              class="flex flex-shrink-0 items-center justify-between px-4 py-3 border-b border-fg/[0.08]"
            >
              <p class="text-sm font-medium text-text-primary">Authentication terminal</p>
              <button
                class="text-sm px-3 py-2 text-text-muted hover:text-text-primary hover:bg-fg/[0.08] rounded-lg transition-all"
                @click="dismissAuthTerminal"
              >
                Dismiss
              </button>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto p-4">
              <div class="h-96 rounded-lg overflow-hidden bg-black/40">
                <AppTerminal
                  ref="authTerminalRef"
                  :session-id="authSessionId"
                  :scan-urls="true"
                  class="w-full h-full"
                  @session-ended="onAuthSessionEnded"
                  @url-found="openAuthUrl"
                  @token-found="onAuthTokenFound"
                  @authentication-stored="dismissAuthTerminal"
                />
              </div>
            </div>
            <div class="flex flex-shrink-0 gap-2 p-4 pt-0 border-fg/[0.06]">
              <div class="flex-1 flex flex-col gap-2">
                <input
                  v-model="authCode"
                  type="text"
                  class="flex-1 min-w-0 bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                  placeholder="Paste the code or token from your browser here"
                  @keydown.enter="submitAuthCode"
                />
                <div
                  v-if="authUrl"
                  class="flex items-center justify-between gap-2 text-xs text-text-muted"
                >
                  <span class="truncate">
                    Browser didn't open? Use this button to open your sign-in link.
                  </span>
                  <button
                    class="flex-shrink-0 bg-fg/[0.08] hover:bg-fg/[0.12] text-text-primary text-xs font-medium px-3 py-1.5 rounded-lg border border-fg/[0.15] transition-all"
                    type="button"
                    @click="openAuthUrl(authUrl)"
                  >
                    Open sign-in link
                  </button>
                </div>
              </div>
              <button
                class="flex-shrink-0 bg-primary hover:bg-primary-hover disabled:opacity-40 text-white text-sm px-4 py-2.5 rounded-lg transition-all"
                :disabled="!authCode.trim()"
                @click="submitAuthCode"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
</template>

<style scoped>
/* Tab bar */
.settings-tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
  margin-top: 6px;
  margin-bottom: 28px;
  overflow-x: auto;
  gap: 0;
}

.settings-tab {
  padding: 10px 14px;
  font-size: 13px;
  color: var(--fg-muted);
  font-weight: 500;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  background: transparent;
  white-space: nowrap;
  transition: color 0.12s, border-color 0.12s;
  font-family: inherit;
}

.settings-tab:hover {
  color: var(--fg);
}

.settings-tab--active {
  color: var(--fg);
  border-bottom-color: var(--accent);
}

/* Section labels */
.settings-section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 36px;
  margin-bottom: 12px;
}

.settings-section-label:first-child {
  margin-top: 0;
}

.settings-section-desc {
  font-size: 12.5px;
  color: var(--fg-subtle);
  margin: -4px 0 12px;
  line-height: 1.55;
}

/* Pref rows */
.settings-pref-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-pref-row {
  background: var(--bg-elev);
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 18px;
}

.settings-pref-row__text {
  flex: 1;
  min-width: 0;
}

.settings-pref-row__title {
  font-size: 13.5px;
  font-weight: 550;
  color: var(--fg);
}

.settings-pref-row__desc {
  font-size: 12.5px;
  color: var(--fg-subtle);
  margin-top: 3px;
  line-height: 1.5;
}

.settings-pref-row__warn {
  color: var(--danger);
  display: block;
  margin-top: 4px;
}

/* Theme swatches */
.settings-theme-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

@media (max-width: 767px) {
  .settings-theme-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.settings-theme-swatch {
  padding: 12px 14px;
  border-radius: 10px;
  cursor: pointer;
  background: var(--bg-elev);
  box-shadow: inset 0 0 0 1px var(--line);
  position: relative;
  text-align: left;
  border: none;
  font-family: inherit;
  transition: box-shadow 0.12s;
}

.settings-theme-swatch:hover {
  box-shadow: inset 0 0 0 1px var(--line-strong);
}

.settings-theme-swatch--active {
  box-shadow: inset 0 0 0 1.5px var(--accent);
}

.settings-theme-swatch__dots {
  display: flex;
  gap: 6px;
  margin-bottom: 18px;
}

.settings-theme-swatch__dot {
  width: 16px;
  height: 16px;
  border-radius: 8px;
  border: 1px solid var(--line);
  display: inline-block;
  flex-shrink: 0;
}

.settings-theme-swatch__name {
  font-size: 13px;
  font-weight: 500;
  color: var(--fg);
}

.settings-theme-swatch__active-dot {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
}

/* Auth cards (General + Integrations tabs) */
.settings-auth-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-auth-card {
  background: var(--bg-elev);
  border-radius: 10px;
  padding: 16px 18px;
}

.settings-auth-card__top {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.settings-auth-card__info {
  flex: 1;
  min-width: 0;
}

.settings-auth-card__name {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}

.settings-auth-card__desc {
  font-size: 12.5px;
  color: var(--fg-subtle);
  margin-top: 4px;
  line-height: 1.55;
}

.settings-auth-card__actions {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 14px;
  flex-wrap: wrap;
}

.settings-auth-card__hint {
  font-size: 12.5px;
  color: var(--fg-subtle);
  margin-top: 10px;
}

.settings-auth-card__success {
  font-size: 12.5px;
  color: var(--success);
  margin-top: 8px;
}

.settings-auth-card__error {
  font-size: 12.5px;
  color: var(--danger);
  margin-top: 8px;
}

.settings-mono-chip {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  background: var(--bg);
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--fg-muted);
  border: 1px solid var(--line);
}

.settings-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  background: transparent;
  color: var(--fg);
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.settings-btn:hover { background: var(--bg-hover); border-color: var(--fg-faint); }
.settings-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.settings-btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  background: var(--fg);
  color: var(--bg);
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s;
}
.settings-btn-primary:hover { opacity: 0.92; }
.settings-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.settings-btn-accent {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  background: var(--accent);
  color: #fff;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.12s;
}
.settings-btn-accent:hover { opacity: 0.88; }
.settings-btn-accent:disabled { opacity: 0.5; cursor: not-allowed; }

.settings-auth-link {
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
  transition: opacity 0.12s;
}
.settings-auth-link:hover { opacity: 0.8; }

.settings-inline-link {
  background: none;
  border: none;
  color: var(--accent);
  font: inherit;
  font-size: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
}

.settings-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>

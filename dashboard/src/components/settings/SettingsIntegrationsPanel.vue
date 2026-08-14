<script setup lang="ts">
// node_modules
import { computed, ref, onMounted } from 'vue';

// components
import ApiKeyModal from '@/components/ApiKeyModal.vue';
import AppTerminal from '@/components/AppTerminal.vue';
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// classes
import { agentAuthApi, apiErrorMessage, settingsApi, type CursorAuthStatus } from '@/classes/api';

// types
import type { OpenCodeProvider, OpenCodeProviderAdapter } from '@/@types/index';

// -------------------------------------------------- Refs --------------------------------------------------
const bCursorAuthenticated = ref<boolean>(false);
const cursorAuthStatus = ref<CursorAuthStatus>('error');
const cursorAuthMessage = ref<string>('');
const bClaudeAuthenticated = ref<boolean>(false);
const bOpenCodeAuthenticated = ref<boolean>(false);
const bCodexAuthenticated = ref<boolean>(false);
const bOpenCodeAvailable = ref<boolean>(false);
const openCodeProviders = ref<OpenCodeProvider[]>([]);
const bLoadingOpenCodeProviders = ref<boolean>(false);
const bSavingOpenCodeProvider = ref<boolean>(false);
const bShowOpenCodeProviderModal = ref<boolean>(false);
const openCodeProviderEditId = ref<string | null>(null);
const openCodeProviderError = ref<string>('');
const bOpenCodeProviderSuccess = ref<boolean>(false);
const openCodeProviderForm = ref<{
  id: string;
  name: string;
  adapter: OpenCodeProviderAdapter;
  npm: string;
  baseURL: string;
  models: string;
  apiKey: string;
}>({
  id: '',
  name: '',
  adapter: 'openai-compatible',
  npm: '',
  baseURL: '',
  models: '',
  apiKey: ''
});
const bStartingCursorLogin = ref<boolean>(false);
const bStartingClaudeLogin = ref<boolean>(false);
const bLoggingOutCursor = ref<boolean>(false);
const bLoggingOutClaude = ref<boolean>(false);
const bLoggingOutOpenCode = ref<boolean>(false);
const bLoggingOutCodex = ref<boolean>(false);
const bShowOpenCodeApiKeyModal = ref<boolean>(false);
const bShowCodexApiKeyModal = ref<boolean>(false);
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

// Mistral Vibe API key
const bVibeConfigured = ref<boolean>(false);
const bLoadingVibeStatus = ref<boolean>(false);
const bShowVibeApiKeyModal = ref<boolean>(false);
const bSavingVibeApiKey = ref<boolean>(false);
const vibeApiKeyError = ref<string>('');
const bDeletingVibeApiKey = ref<boolean>(false);

// -------------------------------------------------- Computed --------------------------------------------------
const cursorAuthChipText = computed(() => {
  if (cursorAuthStatus.value === 'authenticated') return 'Authenticated';
  if (cursorAuthStatus.value === 'timeout') return 'Could not verify';
  if (cursorAuthStatus.value === 'error') return 'Check failed';
  return 'Not authenticated';
});

const cursorAuthChipClass = computed(() => {
  if (cursorAuthStatus.value === 'authenticated') return 'success';
  if (cursorAuthStatus.value === 'timeout') return 'warning';
  return '';
});

const openCodeProviderCountLabel = computed(() => {
  const total = openCodeProviders.value.length;
  const authed = openCodeProviders.value.filter((provider) => provider.authenticated).length;
  if (total === 0) {
    return 'No providers';
  }
  if (authed === 0) {
    return `${total} provider${total === 1 ? '' : 's'}, no keys`;
  }
  return `${authed}/${total} configured`;
});

// -------------------------------------------------- Methods --------------------------------------------------
const refreshAuthStatus = async (): Promise<void> => {
  try {
    const cursorResponse = await agentAuthApi.cursorStatus();
    bCursorAuthenticated.value = cursorResponse.data.authenticated;
    cursorAuthStatus.value = cursorResponse.data.status;
    cursorAuthMessage.value = cursorResponse.data.message ?? '';
  } catch {
    bCursorAuthenticated.value = false;
    cursorAuthStatus.value = 'error';
    cursorAuthMessage.value = 'Could not verify Cursor CLI authentication.';
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

const loadOpenCodeProviders = async (): Promise<void> => {
  bLoadingOpenCodeProviders.value = true;
  try {
    const response = await settingsApi.getOpenCodeProviders();
    openCodeProviders.value = response.data.providers;
  } catch {
    openCodeProviders.value = [];
  } finally {
    bLoadingOpenCodeProviders.value = false;
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
  openCodeApiKeyError.value = '';
  bShowOpenCodeApiKeyModal.value = true;
};

const closeOpenCodeApiKeyModal = (): void => {
  bShowOpenCodeApiKeyModal.value = false;
  openCodeApiKeyError.value = '';
  refreshAuthStatus();
  loadOpenCodeProviders();
};

const saveOpenCodeApiKey = async (apiKey: string): Promise<void> => {
  const key = apiKey.trim();
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

const openAddOpenCodeProvider = (): void => {
  openCodeProviderEditId.value = null;
  openCodeProviderError.value = '';
  openCodeProviderForm.value = {
    id: '',
    name: '',
    adapter: 'openai-compatible',
    npm: '',
    baseURL: '',
    models: '',
    apiKey: ''
  };
  bShowOpenCodeProviderModal.value = true;
};

const openAddKimiProvider = (): void => {
  openCodeProviderEditId.value = null;
  openCodeProviderError.value = '';
  openCodeProviderForm.value = {
    id: 'moonshot',
    name: 'Moonshot',
    adapter: 'openai-compatible',
    npm: '',
    baseURL: 'https://api.moonshot.ai/v1',
    models: 'kimi-k3=Kimi K3',
    apiKey: ''
  };
  bShowOpenCodeProviderModal.value = true;
};

const openEditOpenCodeProvider = (provider: OpenCodeProvider): void => {
  openCodeProviderEditId.value = provider.id;
  openCodeProviderError.value = '';
  openCodeProviderForm.value = {
    id: provider.id,
    name: provider.name,
    adapter: provider.adapter,
    npm: provider.adapter === 'custom' ? provider.npm : '',
    baseURL: provider.baseURL,
    models: provider.models.map((model) => `${model.id}=${model.name}`).join('\n'),
    apiKey: ''
  };
  bShowOpenCodeProviderModal.value = true;
};

const closeOpenCodeProviderModal = (): void => {
  bShowOpenCodeProviderModal.value = false;
  openCodeProviderError.value = '';
};

const parseOpenCodeProviderModels = (): Array<{ id: string; name: string }> => {
  return openCodeProviderForm.value.models
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const equalsIndex = line.indexOf('=');
      if (equalsIndex === -1) {
        return { id: line, name: line };
      }
      const id = line.slice(0, equalsIndex).trim();
      const name = line.slice(equalsIndex + 1).trim() || id;
      return { id, name };
    });
};

const saveOpenCodeProvider = async (): Promise<void> => {
  const form = openCodeProviderForm.value;
  openCodeProviderError.value = '';
  const providerId = form.id.trim();
  if (!providerId) {
    openCodeProviderError.value = 'Provider id is required.';
    return;
  }
  if (!form.baseURL.trim()) {
    openCodeProviderError.value = 'Base URL is required.';
    return;
  }
  const models = parseOpenCodeProviderModels();
  if (models.length === 0) {
    openCodeProviderError.value = 'Add at least one model id.';
    return;
  }
  if (form.adapter === 'custom' && !form.npm.trim()) {
    openCodeProviderError.value = 'Custom provider package is required.';
    return;
  }

  bSavingOpenCodeProvider.value = true;
  try {
    const response = await settingsApi.saveOpenCodeProvider({
      id: providerId,
      name: form.name.trim() || providerId,
      adapter: form.adapter,
      ...(form.adapter === 'custom' ? { npm: form.npm.trim() } : {}),
      baseURL: form.baseURL.trim(),
      models,
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {})
    });
    const next = openCodeProviders.value.filter((provider) => provider.id !== response.data.id);
    next.push(response.data);
    openCodeProviders.value = next.sort((a, b) => a.name.localeCompare(b.name));
    bOpenCodeProviderSuccess.value = true;
    closeOpenCodeProviderModal();
    await refreshAuthStatus();
    setTimeout(() => { bOpenCodeProviderSuccess.value = false; }, 3000);
  } catch (err) {
    openCodeProviderError.value = apiErrorMessage(err, 'Failed to save provider.');
  } finally {
    bSavingOpenCodeProvider.value = false;
  }
};

const deleteOpenCodeProvider = async (providerId: string): Promise<void> => {
  bSavingOpenCodeProvider.value = true;
  try {
    await settingsApi.deleteOpenCodeProvider(providerId);
    openCodeProviders.value = openCodeProviders.value.filter((provider) => provider.id !== providerId);
    await refreshAuthStatus();
  } catch {
    // ignore
  } finally {
    bSavingOpenCodeProvider.value = false;
  }
};

const openCodexApiKeyModal = (): void => {
  codexApiKeyError.value = '';
  bShowCodexApiKeyModal.value = true;
};

const closeCodexApiKeyModal = (): void => {
  bShowCodexApiKeyModal.value = false;
  codexApiKeyError.value = '';
  refreshAuthStatus();
};

const saveCodexApiKey = async (apiKey: string): Promise<void> => {
  const key = apiKey.trim();
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
  vibeApiKeyError.value = '';
  bShowVibeApiKeyModal.value = true;
};

const closeVibeApiKeyModal = (): void => {
  bShowVibeApiKeyModal.value = false;
  vibeApiKeyError.value = '';
  loadVibeApiKeyStatus();
};

const saveVibeApiKey = async (apiKey: string): Promise<void> => {
  const key = apiKey.trim();
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

onMounted((): void => {
  refreshAuthStatus();
  loadVibeApiKeyStatus();
  loadOpenCodeProviders();
});
</script>

<template>
  <div role="tabpanel">
        <div class="settings-section-label nc-eyebrow">Agent Authentication</div>
        <p class="settings-section-desc">Log in to AI services. Credentials are stored in the config volume and persist across restarts.</p>
        <div class="settings-auth-list">
          <div class="settings-auth-card">
            <div class="settings-auth-card__top">
              <div class="settings-auth-card__info">
                <div class="settings-auth-card__name">Cursor</div>
                <div class="settings-auth-card__desc">Uses <code class="settings-mono-chip">cursor-agent login</code> — sign in with your Cursor account</div>
              </div>
              <span class="nc-chip" :class="cursorAuthChipClass">{{ cursorAuthChipText }}</span>
            </div>
            <div class="settings-auth-card__actions">
              <button v-if="cursorAuthStatus === 'unauthenticated'" class="settings-btn-primary" :disabled="bStartingCursorLogin" @click="startCursorLogin">
                <span v-if="bStartingCursorLogin" class="settings-spinner" />Login to Cursor
              </button>
              <button v-else-if="cursorAuthStatus === 'timeout' || cursorAuthStatus === 'error'" class="settings-btn" @click="refreshAuthStatus">
                Check again
              </button>
              <button v-else class="settings-btn" :disabled="bLoggingOutCursor" @click="logoutCursor">
                <span v-if="bLoggingOutCursor" class="settings-spinner" />Logout
              </button>
              <a href="https://cursor.com/dashboard?tab=spending" target="_blank" rel="noopener noreferrer" class="settings-auth-link">View account &amp; usage →</a>
            </div>
            <p v-if="cursorAuthMessage" class="settings-auth-card__error">{{ cursorAuthMessage }}</p>
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
                <div class="settings-auth-card__desc">
                  Open-source AI coding assistant. Configure OpenCode providers such as Moonshot/Kimi,
                  proxies, or other OpenAI-compatible endpoints.
                </div>
              </div>
              <span class="nc-chip" :class="bOpenCodeAuthenticated ? 'success' : ''">{{ openCodeProviderCountLabel }}</span>
            </div>
            <div class="settings-auth-card__actions">
              <button class="settings-btn-accent" @click="openAddKimiProvider">Add Moonshot/Kimi</button>
              <button class="settings-btn" @click="openAddOpenCodeProvider">Add custom provider</button>
              <button class="settings-btn" @click="openOpenCodeApiKeyModal">Legacy OpenCode key</button>
              <button v-if="bOpenCodeAuthenticated" class="settings-btn" :disabled="bLoggingOutOpenCode" @click="logoutOpenCode">
                <span v-if="bLoggingOutOpenCode" class="settings-spinner" />Clear legacy key
              </button>
            </div>
            <p v-if="bOpenCodeAuthSuccess" class="settings-auth-card__success">Legacy OpenCode API key saved.</p>
            <p v-if="bOpenCodeProviderSuccess" class="settings-auth-card__success">OpenCode provider saved.</p>
            <div class="mt-4 rounded-lg border border-fg/[0.08] bg-fg/[0.025] divide-y divide-fg/[0.06]">
              <div v-if="bLoadingOpenCodeProviders" class="px-3 py-3 text-sm text-text-muted">
                Loading providers...
              </div>
              <div v-else-if="openCodeProviders.length === 0" class="px-3 py-3 text-sm text-text-muted">
                No OpenCode providers configured yet.
              </div>
              <template v-else>
                <div
                  v-for="provider in openCodeProviders"
                  :key="provider.id"
                  class="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-sm font-medium text-text-primary">{{ provider.name }}</span>
                      <span class="settings-mono-chip">{{ provider.id }}</span>
                      <span class="nc-chip" :class="provider.authenticated ? 'success' : ''">
                        {{ provider.authenticated ? 'Key stored' : 'No key' }}
                      </span>
                    </div>
                    <p class="mt-1 truncate font-mono text-xs text-text-muted">{{ provider.baseURL }}</p>
                    <p class="mt-1 text-xs text-text-muted">
                      {{ provider.models.map((model) => model.name || model.id).join(', ') }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <button class="settings-btn" @click="openEditOpenCodeProvider(provider)">Edit</button>
                    <button
                      class="settings-btn text-destructive"
                      :disabled="bSavingOpenCodeProvider"
                      @click="deleteOpenCodeProvider(provider.id)"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </template>
            </div>
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

    <!-- Codex API key modal -->
    <ApiKeyModal
      :model-value="bShowCodexApiKeyModal"
      provider-name="Codex"
      eyebrow="// codex api key"
      description="Enter your OpenAI API key for Codex ACP authentication."
      placeholder="Your OpenAI API key"
      :b-configured="bCodexAuthenticated"
      :b-saving="bSavingCodexApiKey"
      :error-message="codexApiKeyError"
      @update:model-value="(v: boolean) => { if (!v) closeCodexApiKeyModal(); }"
      @save="saveCodexApiKey"
    />

    <!-- Mistral Vibe API key setup modal -->
    <ApiKeyModal
      :model-value="bShowVibeApiKeyModal"
      provider-name="Mistral Vibe"
      eyebrow="// mistral vibe api key"
      placeholder="Your Mistral API key"
      :b-configured="bVibeConfigured"
      :b-saving="bSavingVibeApiKey"
      :b-deleting="bDeletingVibeApiKey"
      :error-message="vibeApiKeyError"
      @update:model-value="(v: boolean) => { if (!v) closeVibeApiKeyModal(); }"
      @save="saveVibeApiKey"
      @delete="deleteVibeApiKey"
    >
      <template #description>
        Enter your Mistral API key. It will be saved to
        <code class="bg-fg/[0.06] px-1 py-0.5 rounded text-[11px]">~/.vibe/.env</code>
        and used when running Vibe.
      </template>
    </ApiKeyModal>

    <!-- OpenCode provider modal -->
    <BaseModal
      :model-value="bShowOpenCodeProviderModal"
      labelledby="opencode-provider-modal-title"
      panel-class="max-w-md"
      @update:model-value="(v: boolean) => { if (!v) closeOpenCodeProviderModal(); }"
    >
            <ModalHeader
              :eyebrow="openCodeProviderEditId ? '// edit opencode provider' : '// add opencode provider'"
              :title="openCodeProviderEditId ? 'Edit OpenCode provider' : 'Add OpenCode provider'"
              title-id="opencode-provider-modal-title"
              @close="closeOpenCodeProviderModal"
            />
            <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <p class="text-sm text-text-muted">
                Nova writes OpenCode-native provider config and stores the key under the same provider id in
                <code class="settings-mono-chip">~/.opencode/auth.json</code>.
              </p>
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">Provider id</label>
                  <input
                    v-model="openCodeProviderForm.id"
                    type="text"
                    placeholder="moonshot"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                    :disabled="!!openCodeProviderEditId || bSavingOpenCodeProvider"
                    autocomplete="off"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-text-primary mb-1.5">Display name</label>
                  <input
                    v-model="openCodeProviderForm.name"
                    type="text"
                    placeholder="Moonshot"
                    class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                    :disabled="bSavingOpenCodeProvider"
                    autocomplete="off"
                  />
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">Base URL</label>
                <input
                  v-model="openCodeProviderForm.baseURL"
                  type="url"
                  placeholder="https://api.moonshot.ai/v1"
                  class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                  :disabled="bSavingOpenCodeProvider"
                  autocomplete="off"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">API type</label>
                <select
                  v-model="openCodeProviderForm.adapter"
                  class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                  :disabled="bSavingOpenCodeProvider"
                >
                  <option value="openai-compatible">OpenAI-compatible Chat Completions</option>
                  <option value="openai">OpenAI / Responses API</option>
                  <option value="custom">Custom provider package</option>
                </select>
              </div>
              <div v-if="openCodeProviderForm.adapter === 'custom'">
                <label class="block text-sm font-medium text-text-primary mb-1.5">Provider package</label>
                <input
                  v-model="openCodeProviderForm.npm"
                  type="text"
                  placeholder="@ai-sdk/cerebras"
                  class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                  :disabled="bSavingOpenCodeProvider"
                  autocomplete="off"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">
                  Models
                  <span class="text-text-muted font-normal">(one per line, id=name)</span>
                </label>
                <textarea
                  v-model="openCodeProviderForm.models"
                  rows="4"
                  placeholder="kimi-k3=Kimi K3"
                  class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary font-mono placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
                  :disabled="bSavingOpenCodeProvider"
                ></textarea>
              </div>
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">
                  API key
                  <span class="text-text-muted font-normal">{{ openCodeProviderEditId ? '(leave blank to keep existing)' : '' }}</span>
                </label>
                <input
                  v-model="openCodeProviderForm.apiKey"
                  type="password"
                  placeholder="Provider API key"
                  class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                  :disabled="bSavingOpenCodeProvider"
                  autocomplete="off"
                  @keydown.enter="saveOpenCodeProvider"
                />
              </div>
              <p v-if="openCodeProviderError" class="text-xs text-destructive">{{ openCodeProviderError }}</p>
            </div>
            <div class="flex flex-shrink-0 gap-2 p-4 pt-0">
              <button
                class="flex-1 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-all"
                :disabled="!openCodeProviderForm.id.trim() || !openCodeProviderForm.baseURL.trim() || bSavingOpenCodeProvider"
                @click="saveOpenCodeProvider"
              >
                {{ bSavingOpenCodeProvider ? 'Saving...' : 'Save provider' }}
              </button>
            </div>
    </BaseModal>

    <!-- OpenCode API key modal -->
    <ApiKeyModal
      :model-value="bShowOpenCodeApiKeyModal"
      provider-name="OpenCode"
      eyebrow="// opencode api key"
      placeholder="Your OpenCode API key"
      :b-configured="bOpenCodeAuthenticated"
      :b-saving="bSavingOpenCodeApiKey"
      :error-message="openCodeApiKeyError"
      @update:model-value="(v: boolean) => { if (!v) closeOpenCodeApiKeyModal(); }"
      @save="saveOpenCodeApiKey"
    >
      <template #description>
        Enter your OpenCode API key. It will be stored via
        <code class="bg-fg/[0.06] px-1 py-0.5 rounded text-[11px]">opencode auth login -p opencode</code>.
      </template>
    </ApiKeyModal>

    <!-- Authentication terminal overlay (Claude/Cursor login) -->
    <BaseModal
      :model-value="authSessionId !== null"
      labelledby="auth-terminal-modal-title"
      panel-class="max-w-3xl"
      @update:model-value="(v: boolean) => { if (!v) dismissAuthTerminal(); }"
    >
            <ModalHeader
              :eyebrow="'// agent authentication'"
              :title="'Authentication terminal'"
              title-id="auth-terminal-modal-title"
              @close="dismissAuthTerminal"
            />

            <div class="flex-1 min-h-0 overflow-y-auto p-4">
              <div class="h-96 rounded-lg overflow-hidden bg-black/40">
                <AppTerminal
                  v-if="authSessionId"
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
    </BaseModal>
</template>

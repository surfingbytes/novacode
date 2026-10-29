<script setup lang="ts">
// node_modules
import { computed, ref, onMounted, defineAsyncComponent } from 'vue';

// components
import ApiKeyModal from '@/components/ApiKeyModal.vue';
import BaseModal from '@/components/BaseModal.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// classes
import { agentAuthApi, apiErrorMessage, settingsApi } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';
import { formatUsageBar, formatUsdFromCents } from '@/utils/cursorUsageDisplay';

// stores

// types
import type {
  CursorUsageSummaryResponse,
  OpenCodeProvider,
  OpenCodeProviderAdapter
} from '@/@types/index';

// composables
import { useAgentAuth } from '@/composables/useAgentAuth';

// -------------------------------------------------- Components --------------------------------------------------
const AppTerminal = defineAsyncComponent(() => import('@/components/AppTerminal.vue'));

// -------------------------------------------------- Stores --------------------------------------------------

// -------------------------------------------------- Refs --------------------------------------------------
const {
  status: agentStatus,
  cursorAuthStatus,
  cursorAuthMessage,
  refreshAll,
  refresh: refreshAgent,
  isBusy,
  startCursorLogin,
  startClaudeLogin,
  submitAuthCode,
  onAuthTokenFound,
  logoutCursor: logoutCursorAuth,
  logoutClaude,
  saveApiKey,
  clearApiKey,
  authSessionId,
  authCode,
  authUrl,
  authTerminalRef,
  bClaudeAuthSuccess,
  claudeAuthError,
  openAuthUrl,
  dismissAuthTerminal,
  onAuthSessionEnded
} = useAgentAuth({ onFlowEnded: () => void loadCursorUsage() });
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
const bShowOpenCodeApiKeyModal = ref<boolean>(false);
const bShowCodexApiKeyModal = ref<boolean>(false);
const openCodeApiKeyError = ref<string>('');
const codexApiKeyError = ref<string>('');
const bOpenCodeAuthSuccess = ref<boolean>(false);
const bCodexAuthSuccess = ref<boolean>(false);

// Mistral Vibe API key
const bShowVibeApiKeyModal = ref<boolean>(false);
const vibeApiKeyError = ref<string>('');

// Cursor account usage (from agent login → usage-summary)
const cursorUsage = ref<CursorUsageSummaryResponse | null>(null);

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

const cursorUsageLabel = computed(() => {
  const bucket = cursorUsage.value?.individual;
  if (!bucket) return null;
  return formatUsageBar({ usedCents: bucket.usedCents, limitCents: bucket.limitCents });
});

const cursorRemainingLabel = computed(() => {
  const remaining = cursorUsage.value?.individual?.remainingCents;
  if (remaining == null) return null;
  return formatUsdFromCents(remaining);
});

const cursorCycleEndLabel = computed(() => {
  const end = cursorUsage.value?.billingCycleEnd;
  if (!end) return null;
  const d = new Date(end);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
});

// -------------------------------------------------- Methods --------------------------------------------------
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

const logoutCursor = async (): Promise<void> => {
  await logoutCursorAuth();
  cursorUsage.value = null;
  void loadCursorUsage();
};

const openOpenCodeApiKeyModal = (): void => {
  openCodeApiKeyError.value = '';
  bShowOpenCodeApiKeyModal.value = true;
};

const closeOpenCodeApiKeyModal = (): void => {
  bShowOpenCodeApiKeyModal.value = false;
  openCodeApiKeyError.value = '';
  void refreshAgent('opencode');
  void loadOpenCodeProviders();
};

const saveOpenCodeApiKey = async (apiKey: string): Promise<void> => {
  openCodeApiKeyError.value = '';
  if (!apiKey.trim()) {
    openCodeApiKeyError.value = 'Enter your OpenCode API key.';
    return;
  }
  const error = await saveApiKey('opencode', apiKey);
  if (error) {
    openCodeApiKeyError.value = error;
    return;
  }
  bOpenCodeAuthSuccess.value = true;
  closeOpenCodeApiKeyModal();
  setTimeout(() => { bOpenCodeAuthSuccess.value = false; }, 3000);
};

const logoutOpenCode = async (): Promise<void> => {
  await clearApiKey('opencode');
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

const openAddOpenAIProvider = (): void => {
  openCodeProviderEditId.value = null;
  openCodeProviderError.value = '';
  openCodeProviderForm.value = {
    id: 'openai',
    name: 'OpenAI',
    adapter: 'openai',
    npm: '',
    baseURL: 'https://api.openai.com/v1',
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
  const usesApiCatalog = form.adapter === 'openai' || form.adapter === 'openai-compatible';
  if (models.length === 0 && !usesApiCatalog) {
    openCodeProviderError.value = 'Add at least one model id.';
    return;
  }
  if (models.length === 0 && usesApiCatalog && !form.apiKey.trim() && !openCodeProviderEditId.value) {
    openCodeProviderError.value = 'Paste an API key to load models, or add model ids.';
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
    await refreshAgent('opencode');
    setTimeout(() => { bOpenCodeProviderSuccess.value = false; }, 3000);
  } catch (err) {
    openCodeProviderError.value = apiErrorMessage(err, 'Failed to save provider.');
  } finally {
    bSavingOpenCodeProvider.value = false;
  }
};

const pendingDelete = ref<OpenCodeProvider | null>(null);

const deleteOpenCodeProvider = async (): Promise<void> => {
  if (!pendingDelete.value) {
    return;
  }
  const providerId = pendingDelete.value.id;
  bSavingOpenCodeProvider.value = true;
  try {
    await settingsApi.deleteOpenCodeProvider(providerId);
    openCodeProviders.value = openCodeProviders.value.filter((provider) => provider.id !== providerId);
    pendingDelete.value = null;
    await refreshAgent('opencode');
  } catch (err) {
    notifyApiError(err, 'Delete provider failed');
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
  void refreshAgent('codex');
};

const saveCodexApiKey = async (apiKey: string): Promise<void> => {
  codexApiKeyError.value = '';
  if (!apiKey.trim()) {
    codexApiKeyError.value = 'Enter your Codex API key.';
    return;
  }
  const error = await saveApiKey('codex', apiKey);
  if (error) {
    codexApiKeyError.value = error;
    return;
  }
  bCodexAuthSuccess.value = true;
  closeCodexApiKeyModal();
  setTimeout(() => { bCodexAuthSuccess.value = false; }, 3000);
};

const logoutCodex = async (): Promise<void> => {
  await clearApiKey('codex');
};

const loadCursorUsage = async (): Promise<void> => {
  try {
    const response = await agentAuthApi.cursorUsage();
    cursorUsage.value = response.data;
  } catch {
    cursorUsage.value = null;
  }
};

const openVibeApiKeyModal = (): void => {
  vibeApiKeyError.value = '';
  bShowVibeApiKeyModal.value = true;
};

const closeVibeApiKeyModal = (): void => {
  bShowVibeApiKeyModal.value = false;
  vibeApiKeyError.value = '';
  void refreshAgent('vibe');
};

const saveVibeApiKey = async (apiKey: string): Promise<void> => {
  vibeApiKeyError.value = '';
  if (!apiKey.trim()) {
    vibeApiKeyError.value = 'Enter your Mistral API key.';
    return;
  }
  const error = await saveApiKey('vibe', apiKey);
  if (error) {
    vibeApiKeyError.value = error;
    return;
  }
  closeVibeApiKeyModal();
};

const deleteVibeApiKey = async (): Promise<void> => {
  vibeApiKeyError.value = '';
  const error = await clearApiKey('vibe');
  if (error) {
    vibeApiKeyError.value = error;
    return;
  }
  closeVibeApiKeyModal();
};

onMounted((): void => {
  void refreshAll();
  void loadOpenCodeProviders();
  void loadCursorUsage();
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
              <button v-if="cursorAuthStatus === 'unauthenticated'" class="settings-btn-primary" :disabled="isBusy('cursor', 'login')" @click="startCursorLogin">
                <span v-if="isBusy('cursor', 'login')" class="settings-spinner" />Login to Cursor
              </button>
              <button v-else-if="cursorAuthStatus === 'timeout' || cursorAuthStatus === 'error'" class="settings-btn" @click="refreshAgent('cursor')">
                Check again
              </button>
              <button v-else class="settings-btn" :disabled="isBusy('cursor', 'logout')" @click="logoutCursor">
                <span v-if="isBusy('cursor', 'logout')" class="settings-spinner" />Logout
              </button>
              <a href="https://cursor.com/dashboard?tab=spending" target="_blank" rel="noopener noreferrer" class="settings-auth-link">View account &amp; usage →</a>
            </div>
            <p v-if="cursorUsageLabel" class="settings-auth-card__usage">
              Monthly usage {{ cursorUsageLabel }}
              <template v-if="cursorRemainingLabel">
                · Remaining {{ cursorRemainingLabel }}
              </template>
              <template v-if="cursorCycleEndLabel">
                · Resets {{ cursorCycleEndLabel }}
              </template>
            </p>
            <p v-else-if="cursorUsage?.authenticated && cursorUsage.error" class="settings-auth-card__error">
              Usage: {{ cursorUsage.error }}
            </p>
            <p v-if="cursorAuthMessage" class="settings-auth-card__error">{{ cursorAuthMessage }}</p>
          </div>
          <div class="settings-auth-card">
            <div class="settings-auth-card__top">
              <div class="settings-auth-card__info">
                <div class="settings-auth-card__name">Claude Code</div>
                <div class="settings-auth-card__desc">Uses <code class="settings-mono-chip">claude setup-token</code> — sign in with your Claude account and paste the issued token.</div>
              </div>
              <span class="nc-chip" :class="agentStatus.claude.authenticated ? 'success' : ''">{{ agentStatus.claude.authenticated ? 'Configured' : 'Not configured' }}</span>
            </div>
            <div class="settings-auth-card__actions">
              <button v-if="!agentStatus.claude.authenticated" class="settings-btn-primary" :disabled="isBusy('claude', 'login')" @click="startClaudeLogin">
                <span v-if="isBusy('claude', 'login')" class="settings-spinner" />Login to Claude
              </button>
              <button v-else class="settings-btn" :disabled="isBusy('claude', 'logout')" @click="logoutClaude">
                <span v-if="isBusy('claude', 'logout')" class="settings-spinner" />Logout
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
              <span class="nc-chip" :class="agentStatus.vibe.authenticated ? 'success' : ''">{{ agentStatus.vibe.loading ? '…' : agentStatus.vibe.authenticated ? 'Configured' : 'Not configured' }}</span>
            </div>
            <div class="settings-auth-card__actions">
              <button class="settings-btn-accent" :disabled="agentStatus.vibe.loading" @click="openVibeApiKeyModal">{{ agentStatus.vibe.authenticated ? 'Update API key' : 'Set API key' }}</button>
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
              <span class="nc-chip" :class="agentStatus.opencode.authenticated ? 'success' : ''">{{ openCodeProviderCountLabel }}</span>
            </div>
            <div class="settings-auth-card__actions">
              <button class="settings-btn-accent" @click="openAddOpenAIProvider">Add OpenAI</button>
              <button class="settings-btn-accent" @click="openAddKimiProvider">Add Moonshot/Kimi</button>
              <button class="settings-btn" @click="openAddOpenCodeProvider">Add custom provider</button>
              <button class="settings-btn" @click="openOpenCodeApiKeyModal">Legacy OpenCode key</button>
              <button v-if="agentStatus.opencode.authenticated" class="settings-btn" :disabled="isBusy('opencode', 'clear')" @click="logoutOpenCode">
                <span v-if="isBusy('opencode', 'clear')" class="settings-spinner" />Clear legacy key
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
                      {{
                        provider.models.length > 0
                          ? provider.models.map((model) => model.name || model.id).join(', ')
                          : 'Uses provider catalog'
                      }}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <button class="settings-btn" @click="openEditOpenCodeProvider(provider)">Edit</button>
                    <button
                      class="settings-btn text-destructive"
                      :disabled="bSavingOpenCodeProvider"
                      @click="pendingDelete = provider"
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
              <span class="nc-chip" :class="agentStatus.codex.authenticated ? 'success' : ''">{{ agentStatus.codex.authenticated ? 'Configured' : 'Not configured' }}</span>
            </div>
            <div class="settings-auth-card__actions">
              <button class="settings-btn-accent" @click="openCodexApiKeyModal">{{ agentStatus.codex.authenticated ? 'Update API key' : 'Set API key' }}</button>
              <button v-if="agentStatus.codex.authenticated" class="settings-btn" :disabled="isBusy('codex', 'clear')" @click="logoutCodex">
                <span v-if="isBusy('codex', 'clear')" class="settings-spinner" />Logout
              </button>
            </div>
            <p v-if="bCodexAuthSuccess" class="settings-auth-card__success">Codex API key saved.</p>
          </div>
        </div>
  </div>

    <ConfirmModal
      :model-value="pendingDelete !== null"
      title="Delete OpenCode provider"
      :description="`Delete provider '${pendingDelete?.name ?? ''}'? Its stored API key will also be deleted.`"
      confirm-label="Delete"
      variant="danger"
      :loading="bSavingOpenCodeProvider"
      @update:model-value="
        (v: boolean) => {
          if (!v) {
            pendingDelete = null;
          }
        }
      "
      @confirm="deleteOpenCodeProvider"
    />

    <!-- Codex API key modal -->
    <ApiKeyModal
      :model-value="bShowCodexApiKeyModal"
      provider-name="Codex"
      eyebrow="// codex api key"
      description="Enter your OpenAI API key for Codex ACP authentication."
      placeholder="Your OpenAI API key"
      :b-configured="agentStatus.codex.authenticated"
      :b-saving="isBusy('codex', 'save')"
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
      :b-configured="agentStatus.vibe.authenticated"
      :b-saving="isBusy('vibe', 'save')"
      :b-deleting="isBusy('vibe', 'clear')"
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
                  <span class="text-text-muted font-normal">(one per line, id=name; leave empty to load from the API)</span>
                </label>
                <textarea
                  v-model="openCodeProviderForm.models"
                  rows="4"
                  placeholder="Leave empty to load all chat models"
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
      :b-configured="agentStatus.opencode.authenticated"
      :b-saving="isBusy('opencode', 'save')"
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

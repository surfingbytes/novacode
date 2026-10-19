<script setup lang="ts">
// node_modules
import { computed, onMounted, ref } from 'vue';

// classes
import { apiErrorMessage, forgeApi } from '@/classes/api';

// types
import type { ForgeConnectionTestResult, ForgeProvider, ForgeSettingsStatus } from '@/@types/index';

// -------------------------------------------------- Refs --------------------------------------------------
const status = ref<ForgeSettingsStatus | null>(null);
const urlInput = ref<string>('');
const tokenInput = ref<string>('');
const bTesting = ref<boolean>(false);
const bSaving = ref<boolean>(false);
const bRemoving = ref<boolean>(false);
const testResult = ref<ForgeConnectionTestResult | null>(null);
const error = ref<string>('');
const bSaved = ref<boolean>(false);

// -------------------------------------------------- Computed --------------------------------------------------
const bEnvLocked = computed((): boolean => status.value?.source === 'env');
const bBusy = computed((): boolean => bTesting.value || bSaving.value || bRemoving.value);
const bHasStoredToken = computed((): boolean => Boolean(status.value?.configured));

function providerLabel(provider: ForgeProvider | null | undefined): string {
  return provider === 'forgejo' ? 'Forgejo' : provider === 'gitea' ? 'Gitea' : 'Forge';
}

const connectedLabel = computed((): string | null => {
  const s = status.value;
  if (!s?.configured) return null;
  return [providerLabel(s.provider), s.version].filter(Boolean).join(' ');
});

// -------------------------------------------------- Methods --------------------------------------------------
const load = async (): Promise<void> => {
  try {
    const { data } = await forgeApi.settings();
    status.value = data;
    urlInput.value = data.url ?? '';
  } catch {
    status.value = null;
  }
};

const testConnection = async (): Promise<void> => {
  error.value = '';
  testResult.value = null;
  if (!urlInput.value.trim()) {
    error.value = 'Enter the forge URL.';
    return;
  }
  bTesting.value = true;
  try {
    const { data } = await forgeApi.test(urlInput.value.trim(), tokenInput.value.trim() || undefined);
    testResult.value = data;
  } catch (err) {
    error.value = apiErrorMessage(err, 'Connection test failed.');
  } finally {
    bTesting.value = false;
  }
};

const save = async (): Promise<void> => {
  error.value = '';
  testResult.value = null;
  if (!urlInput.value.trim()) {
    error.value = 'Enter the forge URL.';
    return;
  }
  if (!tokenInput.value.trim() && !bHasStoredToken.value) {
    error.value = 'Enter an access token.';
    return;
  }
  bSaving.value = true;
  try {
    const { data } = await forgeApi.save(urlInput.value.trim(), tokenInput.value.trim() || undefined);
    status.value = data;
    urlInput.value = data.url ?? urlInput.value;
    tokenInput.value = '';
    bSaved.value = true;
    setTimeout(() => {
      bSaved.value = false;
    }, 2000);
  } catch (err) {
    error.value = apiErrorMessage(err, 'Failed to save forge settings.');
  } finally {
    bSaving.value = false;
  }
};

const remove = async (): Promise<void> => {
  error.value = '';
  testResult.value = null;
  bRemoving.value = true;
  try {
    const { data } = await forgeApi.clear();
    status.value = data;
    urlInput.value = data.url ?? '';
    tokenInput.value = '';
  } catch (err) {
    error.value = apiErrorMessage(err, 'Failed to remove forge settings.');
  } finally {
    bRemoving.value = false;
  }
};

onMounted((): void => {
  void load();
});
</script>

<template>
  <div style="margin-top: 36px;">
    <div class="settings-section-label nc-eyebrow">Gitea / Forgejo</div>
    <p class="settings-section-desc">
      Connect a self-hosted Gitea or Forgejo to show CI status for the checked-out branch on the Git tab,
      send failed builds to the agent, and get build notifications. Repositories are detected from each
      workspace's git remote; override them in the workspace settings. The token needs
      <code class="settings-mono-chip">read:repository</code> and
      <code class="settings-mono-chip">read:user</code>.
    </p>
    <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5 space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <span class="nc-chip" :class="status?.configured ? 'success' : ''">
          {{ status?.configured ? `Connected · ${connectedLabel}` : 'Not configured' }}
        </span>
        <span v-if="bEnvLocked" class="text-xs text-text-muted">
          Set via <code class="settings-mono-chip">FORGE_URL</code> / <code class="settings-mono-chip">FORGE_TOKEN</code>
        </span>
      </div>

      <template v-if="!bEnvLocked">
        <div>
          <label class="block text-sm font-medium text-text-primary mb-1.5" for="forge-url">Server URL</label>
          <input
            id="forge-url"
            v-model="urlInput"
            type="url"
            placeholder="https://git.example.com"
            autocomplete="off"
            :disabled="bBusy"
            class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
          />
          <p class="text-xs text-text-muted mt-1.5">
            The address this server can reach (an internal Docker hostname works).
          </p>
        </div>
        <div>
          <label class="block text-sm font-medium text-text-primary mb-1.5" for="forge-token">Access token</label>
          <input
            id="forge-token"
            v-model="tokenInput"
            type="password"
            :placeholder="bHasStoredToken ? 'Stored — leave blank to keep' : 'Personal access token'"
            autocomplete="off"
            :disabled="bBusy"
            class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
            @keydown.enter="save"
          />
          <p class="text-xs text-text-muted mt-1.5">
            Create one under <span class="font-mono">Settings → Applications</span> on your forge. Stored in
            <code class="settings-mono-chip">forge.json</code> in the config volume.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" class="settings-btn" :disabled="bBusy" @click="testConnection">
            <span v-if="bTesting" class="settings-spinner" />Test connection
          </button>
          <button type="button" class="settings-btn-primary" :disabled="bBusy" @click="save">
            <span v-if="bSaving" class="settings-spinner" />Save
          </button>
          <button
            v-if="status?.configured && status.source === 'file'"
            type="button"
            class="settings-btn text-destructive"
            :disabled="bBusy"
            @click="remove"
          >
            <span v-if="bRemoving" class="settings-spinner" />Remove
          </button>
          <span v-if="bSaved" class="text-xs text-success">Saved.</span>
        </div>
      </template>
      <div v-else class="flex flex-wrap items-center gap-2">
        <span class="font-mono text-xs text-text-muted">{{ status?.url }}</span>
        <button type="button" class="settings-btn" :disabled="bBusy" @click="testConnection">
          <span v-if="bTesting" class="settings-spinner" />Test connection
        </button>
      </div>

      <p v-if="testResult?.ok" class="text-xs text-success">
        Connected to {{ providerLabel(testResult.provider) }} {{ testResult.version
        }}<template v-if="testResult.username"> as {{ testResult.username }}</template>.
      </p>
      <p v-else-if="testResult && !testResult.ok" class="text-xs text-destructive">
        {{ testResult.error ?? 'Connection failed.' }}
      </p>
      <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
    </div>
  </div>
</template>

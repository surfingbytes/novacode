<script setup lang="ts">
// node_modules
import { computed, onMounted, ref } from 'vue';

// classes
import { apiErrorMessage, forgeApi } from '@/classes/api';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';

// utils
import { forgeProviderLabel } from '@/utils/ciStatusDisplay';

// types
import type { ForgeConnectionStatus, ForgeConnectionTestResult, ForgeProvider } from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------
/** What the user picks; `gitea` covers Forgejo (the server detects which). */
type ForgeKind = 'gitea' | 'github' | 'gitlab';

interface EditorState {
  id: string | null;
  kind: ForgeKind;
  name: string;
  url: string;
  token: string;
  remoteHosts: string;
}

const KINDS: { value: ForgeKind; label: string; defaultUrl: string; urlHint: string; tokenHint: string }[] = [
  {
    value: 'gitea',
    label: 'Gitea / Forgejo',
    defaultUrl: '',
    urlHint: 'The address this server can reach (an internal Docker hostname works).',
    tokenHint: 'Settings → Applications on your forge. Scopes: read:repository and read:user.'
  },
  {
    value: 'github',
    label: 'GitHub',
    defaultUrl: 'https://github.com',
    urlHint: 'https://github.com, or your GitHub Enterprise Server URL.',
    tokenHint: 'Fine-grained token with read access to Actions, Commit statuses and Metadata (classic: repo).'
  },
  {
    value: 'gitlab',
    label: 'GitLab',
    defaultUrl: 'https://gitlab.com',
    urlHint: 'https://gitlab.com, or your self-managed GitLab URL.',
    tokenHint: 'Personal or project access token with the read_api scope.'
  }
];

// -------------------------------------------------- Refs --------------------------------------------------
const connections = ref<ForgeConnectionStatus[]>([]);
const bLoaded = ref<boolean>(false);
const editor = ref<EditorState | null>(null);
const bTesting = ref<boolean>(false);
const bSaving = ref<boolean>(false);
const testResult = ref<ForgeConnectionTestResult | null>(null);
const error = ref<string>('');
const deleting = ref<ForgeConnectionStatus | null>(null);
const bDeleting = ref<boolean>(false);

// -------------------------------------------------- Computed --------------------------------------------------
const bBusy = computed((): boolean => bTesting.value || bSaving.value);
const editorKind = computed(() => KINDS.find((k) => k.value === editor.value?.kind) ?? KINDS[0]);

// -------------------------------------------------- Methods --------------------------------------------------
function kindOf(provider: ForgeProvider): ForgeKind {
  return provider === 'github' || provider === 'gitlab' ? provider : 'gitea';
}

function parseHosts(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean);
}

const load = async (): Promise<void> => {
  try {
    const { data } = await forgeApi.connections();
    connections.value = data.connections;
  } catch {
    connections.value = [];
  } finally {
    bLoaded.value = true;
  }
};

const openCreate = (kind: ForgeKind): void => {
  const def = KINDS.find((k) => k.value === kind) ?? KINDS[0];
  editor.value = { id: null, kind, name: '', url: def.defaultUrl, token: '', remoteHosts: '' };
  testResult.value = null;
  error.value = '';
};

const openEdit = (connection: ForgeConnectionStatus): void => {
  editor.value = {
    id: connection.id,
    kind: kindOf(connection.provider),
    name: connection.name,
    url: connection.url,
    token: '',
    remoteHosts: connection.remoteHosts.join(', ')
  };
  testResult.value = null;
  error.value = '';
};

const closeEditor = (): void => {
  editor.value = null;
  testResult.value = null;
  error.value = '';
};

const validateEditor = (): EditorState | null => {
  const state = editor.value;
  error.value = '';
  testResult.value = null;
  if (!state) return null;
  if (!state.url.trim()) {
    error.value = 'Enter the server URL.';
    return null;
  }
  if (!state.id && !state.token.trim()) {
    error.value = 'Enter an access token.';
    return null;
  }
  return state;
};

const testConnection = async (): Promise<void> => {
  const state = validateEditor();
  if (!state) return;
  bTesting.value = true;
  try {
    const { data } = await forgeApi.test({
      provider: state.kind,
      url: state.url.trim(),
      ...(state.token.trim() ? { token: state.token.trim() } : {}),
      ...(state.id ? { connectionId: state.id } : {})
    });
    testResult.value = data;
  } catch (err) {
    error.value = apiErrorMessage(err, 'Connection test failed.');
  } finally {
    bTesting.value = false;
  }
};

const save = async (): Promise<void> => {
  const state = validateEditor();
  if (!state) return;
  bSaving.value = true;
  const payload = {
    provider: state.kind,
    url: state.url.trim(),
    name: state.name.trim() || undefined,
    remoteHosts: parseHosts(state.remoteHosts),
    ...(state.token.trim() ? { token: state.token.trim() } : {})
  };
  try {
    if (state.id) await forgeApi.updateConnection(state.id, payload);
    else await forgeApi.createConnection(payload);
    closeEditor();
    await load();
  } catch (err) {
    error.value = apiErrorMessage(err, 'Failed to save the connection.');
  } finally {
    bSaving.value = false;
  }
};

const confirmDelete = async (): Promise<void> => {
  if (!deleting.value) return;
  bDeleting.value = true;
  try {
    await forgeApi.deleteConnection(deleting.value.id);
    if (editor.value?.id === deleting.value.id) closeEditor();
    deleting.value = null;
    await load();
  } catch (err) {
    error.value = apiErrorMessage(err, 'Failed to remove the connection.');
    deleting.value = null;
  } finally {
    bDeleting.value = false;
  }
};

onMounted((): void => {
  void load();
});
</script>

<template>
  <div style="margin-top: 36px;">
    <div class="settings-section-label nc-eyebrow">CI providers</div>
    <p class="settings-section-desc">
      Connect Gitea, Forgejo, GitHub or GitLab — several at once — to show CI status for the checked-out
      branch on the Git tab, send failed builds to the agent, and get build notifications. Each workspace is
      matched to a connection by its git remote's host; override it in the workspace settings. Tokens are
      stored in <code class="settings-mono-chip">forge.json</code> in the config volume.
    </p>

    <div class="space-y-3">
      <div
        v-for="connection in connections"
        :key="connection.id"
        class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
      >
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-medium text-text-primary">{{ connection.name }}</span>
            <span class="nc-chip success">
              {{ forgeProviderLabel(connection.provider) }}{{ connection.version ? ` ${connection.version}` : '' }}
            </span>
            <span v-if="connection.source === 'env'" class="text-xs text-text-muted">
              from <code class="settings-mono-chip">FORGE_*</code> env
            </span>
          </div>
          <p class="mt-1 truncate font-mono text-xs text-text-muted">{{ connection.url }}</p>
          <p v-if="connection.remoteHosts.length" class="mt-1 text-xs text-text-muted">
            Remote hosts: <span class="font-mono">{{ connection.remoteHosts.join(', ') }}</span>
          </p>
        </div>
        <div v-if="connection.source === 'file'" class="flex shrink-0 items-center gap-1">
          <button type="button" class="settings-btn" :disabled="bBusy" @click="openEdit(connection)">Edit</button>
          <button type="button" class="settings-btn text-destructive" :disabled="bBusy" @click="deleting = connection">
            Remove
          </button>
        </div>
      </div>

      <p v-if="bLoaded && connections.length === 0 && !editor" class="text-sm text-text-muted">
        No CI providers connected yet.
      </p>

      <!-- Add / edit form -->
      <div v-if="editor" class="bg-fg/[0.02] border border-primary/30 rounded-xl p-5 space-y-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium text-text-primary">{{ editor.id ? 'Edit connection' : 'New connection' }}</span>
          <div
            v-if="!editor.id"
            class="inline-flex items-center rounded-md border border-border bg-input p-0.5 gap-0.5"
            role="group"
            aria-label="Provider"
          >
            <button
              v-for="kind in KINDS"
              :key="kind.value"
              type="button"
              class="h-7 px-2.5 rounded text-xs font-medium transition-colors"
              :class="editor.kind === kind.value ? 'bg-surface text-primary' : 'text-text-muted hover:text-text-primary'"
              :aria-pressed="editor.kind === kind.value"
              :disabled="bBusy"
              @click="openCreate(kind.value)"
            >
              {{ kind.label }}
            </button>
          </div>
          <span v-else class="nc-chip">{{ editorKind.label }}</span>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="block text-sm font-medium text-text-primary mb-1.5" for="forge-name">Name (optional)</label>
            <input
              id="forge-name"
              v-model="editor.name"
              type="text"
              :placeholder="editorKind.label"
              autocomplete="off"
              :disabled="bBusy"
              class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-text-primary mb-1.5" for="forge-url">Server URL</label>
            <input
              id="forge-url"
              v-model="editor.url"
              type="url"
              placeholder="https://git.example.com"
              autocomplete="off"
              :disabled="bBusy"
              class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
            />
            <p class="text-xs text-text-muted mt-1.5">{{ editorKind.urlHint }}</p>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-text-primary mb-1.5" for="forge-token">Access token</label>
          <input
            id="forge-token"
            v-model="editor.token"
            type="password"
            :placeholder="editor.id ? 'Stored — leave blank to keep' : 'Access token'"
            autocomplete="off"
            :disabled="bBusy"
            class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
            @keydown.enter="save"
          />
          <p class="text-xs text-text-muted mt-1.5">{{ editorKind.tokenHint }}</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-text-primary mb-1.5" for="forge-remote-hosts">
            Git remote hosts (optional)
          </label>
          <input
            id="forge-remote-hosts"
            v-model="editor.remoteHosts"
            type="text"
            placeholder="git.example.com"
            autocomplete="off"
            :disabled="bBusy"
            class="w-full bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
          />
          <p class="text-xs text-text-muted mt-1.5">
            Only needed when clone URLs use a different hostname than the server URL (e.g. an SSH domain).
            Comma-separated. With a single self-hosted connection, other private hosts match it automatically.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2 pt-1">
          <button type="button" class="settings-btn" :disabled="bBusy" @click="testConnection">
            <span v-if="bTesting" class="settings-spinner" />Test connection
          </button>
          <button type="button" class="settings-btn-primary" :disabled="bBusy" @click="save">
            <span v-if="bSaving" class="settings-spinner" />{{ editor.id ? 'Save' : 'Add connection' }}
          </button>
          <button type="button" class="settings-btn" :disabled="bBusy" @click="closeEditor">Cancel</button>
        </div>
      </div>

      <div v-else class="flex flex-wrap items-center gap-2">
        <button
          v-for="kind in KINDS"
          :key="kind.value"
          type="button"
          class="settings-btn"
          @click="openCreate(kind.value)"
        >
          Add {{ kind.label }}
        </button>
      </div>

      <p v-if="testResult?.ok" class="text-xs text-success">
        Connected to {{ forgeProviderLabel(testResult.provider ?? 'gitea') }}{{ testResult.version ? ` ${testResult.version}` : ''
        }}<template v-if="testResult.username"> as {{ testResult.username }}</template>.
      </p>
      <p v-else-if="testResult && !testResult.ok" class="text-xs text-destructive">
        {{ testResult.error ?? 'Connection failed.' }}
      </p>
      <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
    </div>

    <ConfirmModal
      :model-value="deleting !== null"
      title="Remove connection"
      eyebrow="// ci provider"
      :description="`Remove '${deleting?.name ?? ''}'? Workspaces pinned to it fall back to remote detection.`"
      confirm-label="Remove"
      :loading="bDeleting"
      @update:model-value="(v: boolean) => { if (!v) deleting = null; }"
      @confirm="confirmDelete"
    />
  </div>
</template>

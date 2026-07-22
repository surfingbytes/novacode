<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onBeforeUnmount, inject } from 'vue';
import { useRoute, RouterLink } from 'vue-router';

// components
import PageShell from '@/components/layout/PageShell.vue';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';
import { useOrchestratorsStore } from '@/stores/orchestrators';

// classes
import { settingsApi } from '@/classes/api';

// types
import { APP_NAV_TOGGLE_KEY } from '@/constants/layout';

// -------------------------------------------------- Store --------------------------------------------------

const store = useWorkspacesStore();
const orchestratorsStore = useOrchestratorsStore();
const route = useRoute();
const toggleAppNav = inject(APP_NAV_TOGGLE_KEY, null);

// -------------------------------------------------- Refs --------------------------------------------------

const bOrchestratorsLoading = ref(false);
const viewMode = ref<'list' | 'grid'>(
  (localStorage.getItem('sessionsViewMode') as 'list' | 'grid') ?? 'list'
);
const orchestratorsViewMode = ref<'list' | 'grid'>(
  (localStorage.getItem('orchestratorsViewMode') as 'list' | 'grid') ?? 'list'
);
const bShowArchived = ref(false);
const selectedIds = ref<Set<string>>(new Set());
const bClaudeAvailable = ref(false);
const bCursorAvailable = ref(false);
const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const orchLongPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);

// -------------------------------------------------- Computed --------------------------------------------------

const workspaceId = computed((): string => route.params.id as string);
const workspace = computed(() => store.workspaces.find((w) => w.id === workspaceId.value));
const isFilesRoute = computed(() => route.name === 'workspace-files');

// -------------------------------------------------- Watchers --------------------------------------------------

watch(viewMode, (v) => {
  localStorage.setItem('sessionsViewMode', v);
});
watch(orchestratorsViewMode, (v) => {
  localStorage.setItem('orchestratorsViewMode', v);
});
watch(workspaceId, (id) => {
  if (!id) {
    return;
  }
  ensureData();
  store.setActiveWorkspace(id);
  fetchOrchestrators();
});
watch(bShowArchived, () => {
  clearSelection();
});

// -------------------------------------------------- Methods --------------------------------------------------

function clearSelection(): void {
  selectedIds.value = new Set();
}

const ensureData = async (): Promise<void> => {
  if (store.workspaces.some((w) => w.id === workspaceId.value)) {
    return;
  }
  await store.fetchAll();
};

const loadAgentCapabilities = async (): Promise<void> => {
  try {
    const { data } = await settingsApi.getAgentCapabilities();
    bClaudeAvailable.value = data.claudeAvailable;
    bCursorAvailable.value = data.cursorAvailable;
  } catch {
    bClaudeAvailable.value = false;
    bCursorAvailable.value = false;
  }
};

const fetchOrchestrators = async (): Promise<void> => {
  if (!workspaceId.value) {
    return;
  }
  bOrchestratorsLoading.value = true;
  try {
    await orchestratorsStore.ensureFetched(workspaceId.value, true);
  } finally {
    bOrchestratorsLoading.value = false;
  }
};

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  ensureData();
  loadAgentCapabilities();
  store.setActiveWorkspace(workspaceId.value);
  fetchOrchestrators();
});

onBeforeUnmount(() => {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
  }
  if (orchLongPressTimer.value) {
    clearTimeout(orchLongPressTimer.value);
  }
});
</script>

<template>
  <PageShell>
    <!-- Header -->
    <div class="wd-header">
      <div class="nc-eyebrow wd-eyebrow">// workspace</div>
      <h1 class="wd-title">
        <button
          v-if="toggleAppNav && isFilesRoute"
          type="button"
          class="button is-transparent is-icon wd-app-menu lg:hidden shrink-0"
          title="App menu"
          aria-label="App menu"
          @click="toggleAppNav()"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18 M3 12h18 M3 18h18" /></svg>
        </button>
        <div
          class="wd-icon"
          :style="{
            background: `color-mix(in oklab, ${workspace?.color || 'var(--accent)'} 22%, transparent)`,
            color: workspace?.color || 'var(--accent)'
          }"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
        </div>
        <template v-if="workspace?.group">
          <span class="wd-group">{{ workspace.group }}</span>
          <span class="wd-sep" />
        </template>
        <span>{{ workspace?.name ?? '…' }}</span>
      </h1>
      <p class="wd-subtitle nc-mono">
        {{ workspace?.path }}
      </p>
    </div>

    <!-- Workspace tabs -->
    <nav v-if="workspace" class="tab-navigation">
      <RouterLink
        :to="{ name: 'workspace-sessions', params: { id: workspaceId } }"
        :class="{
          'is-active': route.name === 'workspace-sessions'
        }"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        <span> Sessions </span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'workspace-files', params: { id: workspaceId } }"
        :class="{
          'is-active': route.name === 'workspace-files'
        }"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><path d="M9 12l-2 2 2 2M13 12l2 2-2 2"/></svg>
        <span> Files </span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'workspace-git', params: { id: workspaceId } }"
        :class="{
          'is-active': route.name === 'workspace-git'
        }"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 009 9"/></svg>
        <span> Git </span>
      </RouterLink>

      <RouterLink
        :to="{ name: 'workspace-rules', params: { id: workspaceId } }"
        :class="{
          'is-active': route.name === 'workspace-rules'
        }"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/></svg>
        <span> Rules </span>
      </RouterLink>
    </nav>

    <!-- Loading -->
    <div
      v-if="store.bIsLoading && !workspace"
      key="loading"
      class="wd-state"
    >
      <div class="wd-spinner" />
      <p class="wd-state-text">Loading workspace…</p>
    </div>
    <RouterView
      v-else-if="workspace"
      :workspace="workspace"
      :class="[
        isFilesRoute ? 'flex-1 min-h-0' : '',
        // Reserve space for the fixed mobile tab navigation.
        'pb-[calc(3rem+env(safe-area-inset-bottom,0px)+1rem)] md:pb-0'
      ]"
    />

    <!-- Not found -->
    <div v-else key="notfound" class="wd-state">
      <p class="wd-state-title">Workspace not found</p>
      <RouterLink
        :to="{ name: 'workspaces' }"
        class="wd-back-link"
      >
        Back to workspaces
      </RouterLink>
    </div>
  </PageShell>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.wd-header {
  margin-bottom: 28px;
}

.wd-eyebrow {
  margin-bottom: 10px;
}

.wd-title {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 4px 0 6px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--fg);
}

.wd-app-menu {
  margin-right: -2px;
}

.wd-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.wd-group {
  color: var(--fg-muted);
  font-weight: 500;
}

.wd-sep {
  display: inline-block;
  width: 1px;
  height: 14px;
  background: var(--line-strong);
}

.wd-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--fg-subtle);
  line-height: 1.5;
}

.wd-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 72px 24px;
  gap: 10px;
  text-align: center;
}

.wd-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--line-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: ws-spin 0.7s linear infinite;
}

@keyframes ws-spin {
  to { transform: rotate(360deg); }
}

.wd-state-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
}

.wd-state-text {
  margin: 0;
  font-size: 13px;
  color: var(--fg-subtle);
  line-height: 1.5;
  max-width: 340px;
}

.wd-back-link {
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid var(--accent-line);
  transition: border-color 0.12s;
}

.wd-back-link:hover {
  border-bottom-color: var(--accent);
}
</style>

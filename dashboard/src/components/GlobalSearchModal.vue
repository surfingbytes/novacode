<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';

// types
interface SearchResult {
  id: string;
  name: string;
  type: 'workspace' | 'session' | 'orchestrator' | 'role-template' | 'automation' | 'settings' | 'command';
  workspaceId?: string;
  workspaceName?: string;
}

interface SearchResultsGrouped {
  workspaces: SearchResult[];
  sessions: SearchResult[];
  orchestrators: SearchResult[];
  roleTemplates: SearchResult[];
  automations: SearchResult[];
  settings: SearchResult[];
}

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  isOpen: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'navigate'): void;
}>();

// -------------------------------------------------- Constants --------------------------------------------------
const SETTINGS_SEARCH_TERMS: string[] = [
  'setting',
  'settings',
  'general',
  'preferences',
  'preference',
  'config',
  'configuration',
  'appearance',
  'theme',
  'themes',
  'oled',
  'amoled',
  'dark',
  'light',
  'auto theme',
  'auto-theme',
  'notification',
  'notifications',
  'push',
  'git',
  'git identity',
  'ssh',
  'ssh key',
  'integrations',
  'integration',
  'agent auth',
  'authentication',
  'auth',
  'cursor',
  'claude',
  'mistral',
  'vibe',
  'api key',
  'token',
  'mcp',
  'mcp client',
  'mcp clients',
  'mcp server',
  'mcp servers',
  'model context protocol',
  'connectivity'
];

interface PaletteCommand {
  id: string;
  name: string;
  keywords: string[];
}

function commandMatches(command: PaletteCommand, query: string): boolean {
  if (!query) {
    return true;
  }
  const haystack = `${command.name} ${command.keywords.join(' ')}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .every((token) => haystack.includes(token));
}

// -------------------------------------------------- Store --------------------------------------------------
const router = useRouter();
const route = useRoute();

// -------------------------------------------------- Refs --------------------------------------------------
const searchQuery = ref('');
const searchResults = ref<SearchResultsGrouped>({
  workspaces: [],
  sessions: [],
  orchestrators: [],
  roleTemplates: [],
  automations: [],
  settings: []
});
const bLoading = ref(false);
const errorMessage = ref<string | null>(null);
const modalRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);
const activeResultIndex = ref<number>(-1);

// -------------------------------------------------- Computed --------------------------------------------------
const currentWorkspaceId = computed((): string => {
  const id = route.params.id;
  return typeof id === 'string' ? id : '';
});

const paletteCommands = computed<PaletteCommand[]>(() => {
  const commands: PaletteCommand[] = [
    {
      id: 'workspaces',
      name: 'Go to Workspaces',
      keywords: ['home', 'workspaces', 'projects', 'list']
    },
    {
      id: 'automations',
      name: 'Go to Automations',
      keywords: ['automation', 'workflow', 'schedule']
    },
    {
      id: 'settings',
      name: 'Go to Settings',
      keywords: ['settings', 'preferences', 'config']
    },
    {
      id: 'account',
      name: 'Go to Account',
      keywords: ['account', 'profile', 'user']
    },
    {
      id: 'integrations',
      name: 'Settings → Integrations',
      keywords: ['integrations', 'auth', 'cursor', 'claude', 'api key', 'token']
    }
  ];
  const workspaceId = currentWorkspaceId.value;
  if (workspaceId) {
    commands.push(
      {
        id: 'ws-files',
        name: 'Open Files',
        keywords: ['files', 'editor', 'monaco']
      },
      {
        id: 'ws-git',
        name: 'Open Git',
        keywords: ['git', 'diff', 'commit']
      },
      {
        id: 'ws-rules',
        name: 'Open Rules',
        keywords: ['rules', 'cursor rules']
      },
      {
        id: 'ws-new-session',
        name: 'New session',
        keywords: ['new', 'session', 'chat', 'create']
      }
    );
  }
  if (route.name === 'session') {
    commands.push({
      id: 'find-in-chat',
      name: 'Find in conversation',
      keywords: ['find', 'search', 'chat', 'thread']
    });
  }
  return commands;
});

const commandResults = computed<SearchResult[]>(() => {
  const query = searchQuery.value.trim();
  return paletteCommands.value.filter((command) => commandMatches(command, query)).map((command) => ({
    id: `cmd:${command.id}`,
    name: command.name,
    type: 'command' as const
  }));
});

const hasResults = computed(() => {
  return (
    commandResults.value.length > 0 ||
    searchResults.value.workspaces.length > 0 ||
    searchResults.value.sessions.length > 0 ||
    searchResults.value.orchestrators.length > 0 ||
    searchResults.value.roleTemplates.length > 0 ||
    searchResults.value.automations.length > 0 ||
    searchResults.value.settings.length > 0
  );
});

const totalResults = computed(() => {
  return (
    commandResults.value.length +
    searchResults.value.workspaces.length +
    searchResults.value.sessions.length +
    searchResults.value.orchestrators.length +
    searchResults.value.roleTemplates.length +
    searchResults.value.automations.length +
    searchResults.value.settings.length
  );
});

/**
 * Flat result list in the exact render order of the template groups
 * (commands → workspaces → sessions → orchestrators → automations → roleTemplates → settings) so
 * ArrowUp/Down and Enter map 1:1 onto what the user sees.
 */
const flatResults = computed<SearchResult[]>(() => [
  ...commandResults.value,
  ...searchResults.value.workspaces,
  ...searchResults.value.sessions,
  ...searchResults.value.orchestrators,
  ...searchResults.value.automations,
  ...searchResults.value.roleTemplates,
  ...searchResults.value.settings
]);

function resultKey(result: SearchResult): string {
  return `${result.type}:${result.id}`;
}

const resultIndexByKey = computed<Map<string, number>>(() => {
  return new Map(flatResults.value.map((result, index) => [resultKey(result), index]));
});

// -------------------------------------------------- Methods --------------------------------------------------
async function performSearch(): Promise<void> {
  if (!searchQuery.value.trim()) {
    searchResults.value = {
      workspaces: [],
      sessions: [],
      orchestrators: [],
      roleTemplates: [],
      automations: [],
      settings: []
    };
    return;
  }

  bLoading.value = true;
  errorMessage.value = null;

  try {
    const query = searchQuery.value.trim();

    // Use server-side search API
    const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Add client-side navigation shortcuts for non-entity pages.
    const normalizedQuery = query.toLowerCase();
    const automationKeywords = [
      'automation',
      'automations',
      'workflow',
      'workflows',
      'schedule',
      'scheduled'
    ];
    const settingsResults: SearchResult[] = [];
    const automationShortcutResults: SearchResult[] = [];

    if (automationKeywords.some((keyword) => normalizedQuery.includes(keyword))) {
      automationShortcutResults.push({
        id: 'automations',
        name: 'Automations',
        type: 'automation'
      });
    }

    if (matchesSettingsQuery(query)) {
      settingsResults.push({
        id: 'settings',
        name: 'Settings',
        type: 'settings'
      });
    }

    const serverAutomations = Array.isArray(data.automations) ? data.automations : [];
    const mergedAutomations = [
      ...automationShortcutResults,
      ...serverAutomations.filter((automation: SearchResult) => automation.id !== 'automations')
    ];

    searchResults.value = {
      workspaces: Array.isArray(data.workspaces) ? data.workspaces : [],
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      orchestrators: Array.isArray(data.orchestrators) ? data.orchestrators : [],
      roleTemplates: Array.isArray(data.roleTemplates) ? data.roleTemplates : [],
      automations: mergedAutomations,
      settings: settingsResults
    };
  } catch (error) {
    console.error('Search failed:', error);
    errorMessage.value = 'Failed to perform search. Please try again.';
  } finally {
    bLoading.value = false;
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (!props.isOpen || event.key !== 'Escape') {
    return;
  }
  emit('close');
}

function scrollActiveResultIntoView(): void {
  nextTick(() => {
    const el = modalRef.value?.querySelector(
      `[data-flat-index="${activeResultIndex.value}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  });
}

function onSearchInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const count = flatResults.value.length;
    if (count === 0) {
      return;
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    activeResultIndex.value = (activeResultIndex.value + delta + count) % count;
    scrollActiveResultIntoView();
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    const target = flatResults.value[activeResultIndex.value] ?? flatResults.value[0];
    if (target) {
      navigateToResult(target);
    }
  }
}

function runPaletteCommand(commandId: string): void {
  const workspaceId = currentWorkspaceId.value;
  switch (commandId) {
    case 'workspaces':
      void router.push({ name: 'workspaces' });
      break;
    case 'automations':
      void router.push('/automations');
      break;
    case 'settings':
      void router.push('/settings');
      break;
    case 'account':
      void router.push('/account');
      break;
    case 'integrations':
      void router.push({ name: 'settings', query: { tab: 'integrations' } });
      break;
    case 'ws-files':
      if (route.name === 'session' && workspaceId && typeof route.params.sessionId === 'string') {
        void router.push({
          name: 'session',
          params: { id: workspaceId, sessionId: route.params.sessionId },
          query: { tab: 'files' }
        });
      } else if (workspaceId) {
        void router.push({ name: 'workspace-files', params: { id: workspaceId } });
      }
      break;
    case 'ws-git':
      if (workspaceId) {
        void router.push({ name: 'workspace-git', params: { id: workspaceId } });
      }
      break;
    case 'ws-rules':
      if (workspaceId) {
        void router.push({ name: 'workspace-rules', params: { id: workspaceId } });
      }
      break;
    case 'ws-new-session':
      if (route.name === 'session' || route.name === 'workspace-sessions') {
        window.dispatchEvent(new CustomEvent('novacode:new-session'));
      } else if (workspaceId) {
        void router.push({
          name: 'workspace-sessions',
          params: { id: workspaceId },
          query: { newSession: '1' }
        });
      }
      break;
    case 'find-in-chat':
      window.dispatchEvent(new CustomEvent('novacode:find-in-chat'));
      break;
    default:
      break;
  }
}

function navigateToResult(result: SearchResult): void {
  emit('close');
  emit('navigate');

  switch (result.type) {
    case 'command': {
      const commandId = result.id.startsWith('cmd:') ? result.id.slice(4) : result.id;
      runPaletteCommand(commandId);
      break;
    }
    case 'workspace':
      router.push({ name: 'workspace-sessions', params: { id: result.id } });
      break;
    case 'session':
      if (result.workspaceId) {
        router.push({
          name: 'session',
          params: { id: result.workspaceId, sessionId: result.id }
        });
      }
      break;
    case 'orchestrator':
      if (result.workspaceId) {
        router.push({
          name: 'orchestrator',
          params: { id: result.workspaceId, orchestratorId: result.id }
        });
      }
      break;
    case 'role-template':
      router.push({ name: 'settings', query: { tab: 'templates' } });
      break;
    case 'automation':
      router.push('/automations');
      break;
    case 'settings':
      router.push('/settings');
      break;
  }
}

function matchesSettingsQuery(rawQuery: string): boolean {
  const normalizedQuery = rawQuery.toLowerCase().trim();
  if (!normalizedQuery) {
    return false;
  }

  if (
    SETTINGS_SEARCH_TERMS.some(
      (term) => normalizedQuery.includes(term) || term.includes(normalizedQuery)
    )
  ) {
    return true;
  }

  const queryTokens = normalizedQuery.split(/\s+/).filter((token) => token.length >= 2);
  if (queryTokens.length === 0) {
    return false;
  }

  return queryTokens.some((token) => SETTINGS_SEARCH_TERMS.some((term) => term.includes(token)));
}

async function focusSearchInput(): Promise<void> {
  await nextTick();
  searchInputRef.value?.focus();
  searchInputRef.value?.select();
}

// -------------------------------------------------- Watchers --------------------------------------------------
watch(
  searchQuery,
  () => {
    activeResultIndex.value = -1;
    performSearch();
  },
  { immediate: false }
);

watch(
  () => props.isOpen,
  async (isOpen) => {
    if (isOpen) {
      await focusSearchInput();
    }
  },
  { immediate: true }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(() => {
  document.addEventListener('keydown', handleDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleDocumentKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="search-fade">
      <div
        v-if="isOpen"
        class="search-overlay"
        aria-modal="true"
        role="dialog"
        @click="emit('close')"
      >
        <div ref="modalRef" class="search-panel" @click.stop>
          <!-- Search input -->
          <div class="search-input-row">
            <svg
              class="search-input-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M16.5 16.5L21 21" />
            </svg>
            <input
              ref="searchInputRef"
              v-model="searchQuery"
              type="text"
              placeholder="Search or jump to…"
              class="search-input"
              autocomplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="search-results-list"
              :aria-activedescendant="
                activeResultIndex >= 0 ? `search-result-${activeResultIndex}` : undefined
              "
              @keydown="onSearchInputKeydown"
            />
            <button
              v-if="searchQuery"
              class="search-clear"
              aria-label="Clear search"
              @click="searchQuery = ''"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6L6 18 M6 6l12 12" />
              </svg>
            </button>
            <button class="search-close lg:hidden" aria-label="Close" @click="emit('close')">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6L6 18 M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Results -->
          <div id="search-results-list" class="search-results" role="listbox">
            <!-- Loading -->
            <div v-if="bLoading" class="search-state">
              <div class="search-spinner" />
              <span>Searching…</span>
            </div>

            <!-- Error -->
            <div v-else-if="errorMessage" class="search-state search-state--error">
              {{ errorMessage }}
            </div>

            <!-- No results -->
            <div v-else-if="searchQuery && !hasResults" class="search-state">
              No results for "{{ searchQuery }}"
            </div>

            <!-- Results (commands when empty; commands + matches when typing) -->
            <template v-else-if="hasResults">
              <div v-if="commandResults.length > 0" class="search-group">
                <div class="search-group-label nc-eyebrow">Commands</div>
                <button
                  v-for="result in commandResults"
                  :id="`search-result-${resultIndexByKey.get(resultKey(result))}`"
                  :key="result.id"
                  class="search-result-row nc-row-hover"
                  :class="{
                    'is-active': resultIndexByKey.get(resultKey(result)) === activeResultIndex
                  }"
                  :data-flat-index="resultIndexByKey.get(resultKey(result))"
                  role="option"
                  :aria-selected="resultIndexByKey.get(resultKey(result)) === activeResultIndex"
                  @click="navigateToResult(result)"
                  @mouseenter="activeResultIndex = resultIndexByKey.get(resultKey(result)) ?? -1"
                >
                  <svg
                    class="search-result-icon"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 17l6-6-6-6 M12 19h8" />
                  </svg>
                  <div class="search-result-text">
                    <div class="search-result-name">{{ result.name }}</div>
                  </div>
                </button>
              </div>
              <template
                v-for="group in [
                  {
                    key: 'workspaces',
                    label: 'Workspaces',
                    items: searchResults.workspaces,
                    icon: 'folder'
                  },
                  {
                    key: 'sessions',
                    label: 'Sessions',
                    items: searchResults.sessions,
                    icon: 'terminal'
                  },
                  {
                    key: 'orchestrators',
                    label: 'Orchestrators',
                    items: searchResults.orchestrators,
                    icon: 'layers'
                  },
                  {
                    key: 'automations',
                    label: 'Automations',
                    items: searchResults.automations,
                    icon: 'clock'
                  },
                  {
                    key: 'roleTemplates',
                    label: 'Rule Templates',
                    items: searchResults.roleTemplates,
                    icon: 'ruler'
                  },
                  {
                    key: 'settings',
                    label: 'Settings',
                    items: searchResults.settings,
                    icon: 'settings'
                  }
                ]"
                :key="group.key"
              >
                <div v-if="group.items.length > 0" class="search-group">
                  <div class="search-group-label nc-eyebrow">{{ group.label }}</div>
                  <button
                    v-for="result in group.items"
                    :id="`search-result-${resultIndexByKey.get(resultKey(result))}`"
                    :key="result.id"
                    class="search-result-row nc-row-hover"
                    :class="{
                      'is-active': resultIndexByKey.get(resultKey(result)) === activeResultIndex
                    }"
                    :data-flat-index="resultIndexByKey.get(resultKey(result))"
                    role="option"
                    :aria-selected="
                      resultIndexByKey.get(resultKey(result)) === activeResultIndex
                    "
                    @click="navigateToResult(result)"
                    @mouseenter="
                      activeResultIndex = resultIndexByKey.get(resultKey(result)) ?? -1
                    "
                  >
                    <svg
                      class="search-result-icon"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                    >
                      <path
                        v-if="group.icon === 'folder'"
                        d="M3 7a2 2 0 012-2h3.5l2 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
                      />
                      <path v-else-if="group.icon === 'terminal'" d="M4 7l4 5-4 5 M12 19h8" />
                      <path
                        v-else-if="group.icon === 'layers'"
                        d="M12 2l9 5-9 5-9-5 9-5z M3 12l9 5 9-5 M3 17l9 5 9-5"
                      />
                      <path
                        v-else-if="group.icon === 'clock'"
                        d="M12 7v5l3 2 M12 21a9 9 0 100-18 9 9 0 000 18z"
                      />
                      <path
                        v-else-if="group.icon === 'ruler'"
                        d="M4 14l10-10 6 6-10 10z M8 10l2 2 M11 7l2 2 M5 13l2 2"
                      />
                      <path
                        v-else-if="group.icon === 'settings'"
                        d="M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6 1.65 1.65 0 0010 3.09V3a2 2 0 014 0v.09c0 .67.4 1.27 1 1.51a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06c-.45.45-.58 1.15-.33 1.82.24.6.84 1 1.51 1H21a2 2 0 110 4h-.09c-.67 0-1.27.4-1.51 1z"
                      />
                    </svg>
                    <div class="search-result-text">
                      <div class="search-result-name">{{ result.name }}</div>
                      <div v-if="result.workspaceName" class="search-result-sub nc-mono">
                        {{ result.workspaceName }}
                      </div>
                    </div>
                  </button>
                </div>
              </template>
            </template>
          </div>

          <!-- Footer -->
          <div v-if="hasResults" class="search-footer nc-mono">
            {{
              searchQuery
                ? `${totalResults} result${totalResults !== 1 ? 's' : ''}`
                : '⌘K search · ⌘N new session · ⌘F find · ⌘S save'
            }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.search-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 64px 16px 16px;
  background: color-mix(in oklab, var(--bg) 75%, transparent);
  backdrop-filter: blur(4px);
}

.search-panel {
  width: 100%;
  max-width: 640px;
  background: var(--bg-elev-2);
  border-radius: 12px;
  border: 1px solid var(--line-strong);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 80px);
}

.search-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.search-input-icon {
  color: var(--fg-subtle);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  font: inherit;
  font-size: 13.5px;
  color: var(--fg);
  padding: 0;
  height: auto;
  min-height: 0;
  border-radius: 0;
}
.search-input::placeholder {
  color: var(--fg-subtle);
}

.search-clear,
.search-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--fg-subtle);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.1s,
    color 0.1s;
}
.search-clear:hover,
.search-close:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.search-results {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.search-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px 16px;
  font-size: 13px;
  color: var(--fg-muted);
}

.search-state--error {
  color: var(--danger);
}

.search-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--line-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.search-group {
  margin-bottom: 12px;
}

.search-group-label {
  padding: 6px 10px 4px;
}

.search-result-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: var(--fg);
  transition: background 0.1s;
}
.search-result-row:hover,
.search-result-row.is-active {
  background: var(--bg-hover);
}

.search-result-icon {
  color: var(--fg-subtle);
  flex-shrink: 0;
}

.search-result-text {
  flex: 1;
  min-width: 0;
}

.search-result-name {
  font-size: 13.5px;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-result-sub {
  font-size: 11px;
  color: var(--fg-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 1px;
}

.search-footer {
  padding: 8px 14px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--fg-subtle);
  flex-shrink: 0;
}

.search-fade-enter-active,
.search-fade-leave-active {
  transition: opacity 0.12s;
}
.search-fade-enter-from,
.search-fade-leave-to {
  opacity: 0;
}
</style>

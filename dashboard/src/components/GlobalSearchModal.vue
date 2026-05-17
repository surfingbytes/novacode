<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';

// stores
import { useAuthStore } from '@/stores/auth';

// types
interface SearchResult {
  id: string;
  name: string;
  type: 'workspace' | 'session' | 'role-template' | 'automation' | 'settings';
  workspaceId?: string;
  workspaceName?: string;
}

interface SearchResultsGrouped {
  workspaces: SearchResult[];
  sessions: SearchResult[];
  roleTemplates: SearchResult[];
  automations: SearchResult[];
  settings: SearchResult[];
}

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  isOpen: boolean;
  onClose: () => void;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
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

// -------------------------------------------------- Store --------------------------------------------------
const auth = useAuthStore();
const router = useRouter();

// -------------------------------------------------- Refs --------------------------------------------------
const searchQuery = ref('');
const searchResults = ref<SearchResultsGrouped>({
  workspaces: [],
  sessions: [],
  roleTemplates: [],
  automations: [],
  settings: []
});
const bLoading = ref(false);
const errorMessage = ref<string | null>(null);
const modalRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);

// -------------------------------------------------- Computed --------------------------------------------------
const hasResults = computed(() => {
  return (
    searchResults.value.workspaces.length > 0 ||
    searchResults.value.sessions.length > 0 ||
    searchResults.value.roleTemplates.length > 0 ||
    searchResults.value.automations.length > 0 ||
    searchResults.value.settings.length > 0
  );
});

const totalResults = computed(() => {
  return (
    searchResults.value.workspaces.length +
    searchResults.value.sessions.length +
    searchResults.value.roleTemplates.length +
    searchResults.value.automations.length +
    searchResults.value.settings.length
  );
});

// -------------------------------------------------- Methods --------------------------------------------------
async function performSearch(): Promise<void> {
  if (!searchQuery.value.trim()) {
    searchResults.value = {
      workspaces: [],
      sessions: [],
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
      headers: {
        Authorization: `Bearer ${auth.token}`,
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

function handleDocumentClick(event: MouseEvent): void {
  if (!props.isOpen || !modalRef.value) {
    return;
  }
  if (!modalRef.value.contains(event.target as Node)) {
    props.onClose();
  }
}

function handleDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    props.onClose();
  }
}

function navigateToResult(result: SearchResult): void {
  props.onClose();
  emit('navigate');

  switch (result.type) {
    case 'workspace':
      router.push({ name: 'workspace', params: { id: result.id } });
      break;
    case 'session':
      if (result.workspaceId) {
        router.push({
          name: 'session',
          params: { id: result.workspaceId, sessionId: result.id }
        });
      }
      break;
    case 'role-template':
      router.push('/role-templates');
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
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
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
        @click="props.onClose()"
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
              placeholder="Search sessions, files, workspaces…"
              class="search-input"
              autocomplete="off"
              @keydown.enter="$event.preventDefault()"
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
            <button class="search-close lg:hidden" aria-label="Close" @click="props.onClose()">
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
          <div class="search-results">
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

            <!-- Empty -->
            <div v-else-if="!searchQuery" class="search-state">
              Type to search sessions, workspaces, automations, and more
            </div>

            <!-- Results -->
            <template v-else>
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
                    :key="result.id"
                    class="search-result-row nc-row-hover"
                    @click="navigateToResult(result)"
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
          <div v-if="searchQuery && totalResults > 0" class="search-footer nc-mono">
            {{ totalResults }} result{{ totalResults !== 1 ? 's' : '' }}
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
.search-result-row:hover {
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

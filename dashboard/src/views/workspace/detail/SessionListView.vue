<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import SessionEditModal from '@/components/SessionEditModal.vue';
import NewSessionModal from '@/components/NewSessionModal.vue';
import PromptModal from '@/components/PromptModal.vue';
import ListPageSkeleton from '@/components/ui/ListPageSkeleton.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import SessionListToolbar from './session-list/SessionListToolbar.vue';
import SessionListGrid from './session-list/SessionListGrid.vue';
import SessionListRows from './session-list/SessionListRows.vue';
import SessionListArchived from './session-list/SessionListArchived.vue';
import SessionListMultiselectBar from './session-list/SessionListMultiselectBar.vue';

// composables
import { useLongPress } from '@/composables/useLongPress';
import { useOrchestratorActions } from '@/composables/useOrchestratorActions';
import { useSessionListActions } from '@/composables/useSessionListActions';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';
import { useOrchestratorsStore } from '@/stores/orchestrators';

// classes
import { sessionsApi, orchestratorApi } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';
import { safeGetItem, safeSetItem } from '@/lib/safeLocalStorage';
import { subtasksFromStoredJson } from '@/utils/orchestratorPayload';

// composables
import { useAgentCapabilities } from '@/composables/useAgentCapabilities';
import { useCreateSession, type NewSessionMode } from '@/composables/useCreateSession';

// types
import type { ContextMenuItem } from '@/components/ContextMenu.vue';
import type { Session, Orchestrator, Workspace } from '@/@types/index';
import type { CombinedItem } from './session-list/types';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  workspace: Workspace; // required
}>();

// -------------------------------------------------- Store --------------------------------------------------
const store = useWorkspacesStore();
const orchestratorsStore = useOrchestratorsStore();
const route = useRoute();
const router = useRouter();

// -------------------------------------------------- Refs --------------------------------------------------
const orchestrators = computed<Orchestrator[]>(() =>
  orchestratorsStore.forWorkspace(workspaceId.value)
);
const bOrchestratorsLoading = ref(false);
/** After first successful fetch; avoids showing step sessions at top level before orchestrator data exists. */
const bOrchestratorsInitialFetched = ref(false);
const sessionActions = useSessionListActions();
const orchestratorActions = useOrchestratorActions();
const { sessionToEdit, sessionPendingDelete } = sessionActions;
const { orchestratorToEdit, orchestratorPendingDelete } = orchestratorActions;
const viewMode = ref<'list' | 'grid'>(
  (safeGetItem('sessionsViewMode') as 'list' | 'grid') ?? 'list'
);
const orchestratorsViewMode = ref<'list' | 'grid'>(
  (safeGetItem('orchestratorsViewMode') as 'list' | 'grid') ?? 'list'
);
const bShowArchived = ref(false);

// multiselect
const selectedIds = ref<Set<string>>(new Set());
const bBulkArchiving = ref(false);
const bShowBulkDeleteCombined = ref(false);
const bBulkDeletingCombined = ref(false);
const orchestratorSelectedIds = ref<Set<string>>(new Set());

// Multiselect bar alignment with list items
const listViewRef = ref<HTMLElement | null>(null);
const archivedListViewRef = ref<HTMLElement | null>(null);
const multiselectLeft = ref<number | null>(null);
const multiselectWidth = ref<number | null>(null);
const {
  claudeAvailable: bClaudeAvailable,
  cursorAvailable: bCursorAvailable,
  mistralVibeAvailable: bMistralVibeAvailable,
  openCodeAvailable: bOpenCodeAvailable,
  codexAvailable: bCodexAvailable,
  bCapabilitiesLoaded,
  ensureLoaded: ensureAgentCapabilitiesLoaded
} = useAgentCapabilities();
const { bShowNewSession, newSessionMode, bCreating, createError, openNewSession, createSession } =
  useCreateSession();
const activeFilter = ref<string | null>(null);

// -------------------------------------------------- Computed --------------------------------------------------
const sessions = computed<Session[]>(() => store.activeSessions);
const archivedSessions = computed<Session[]>(() => store.archivedSessions);
const sessionsLoading = computed<boolean>(() => store.bSessionsLoading);
const workspaceId = computed((): string => route.params.id as string);

/** Unique tags used by sessions (for filter chips and autocomplete). */
const sessionTags = computed((): string[] => {
  const all = [...sessions.value, ...archivedSessions.value];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of all) {
    const tags = s.tags;
    if (!tags?.length) continue;
    for (const t of tags) {
      if (typeof t !== 'string' || !t.trim()) continue;
      const k = t.trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t.trim());
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
});

/**
 * Sessions that were created by orchestrator runs, grouped by orchestrator.
 * Uses the optional sessionId field on each SubTask stored in subtasksJson.
 */
const orchestratorSessionsByOrchestrator = computed(() => {
  const sessionsById = new Map(sessions.value.map((s) => [s.id, s]));
  const groups: Array<{ orchestrator: Orchestrator; sessions: Session[] }> = [];

  for (const orch of orchestrators.value) {
    if (!orch.subtasksJson || !orch.subtasksJson.trim()) continue;
    const tasks = subtasksFromStoredJson(orch.subtasksJson);
    if (tasks.length === 0) continue;
    const seen = new Set<string>();
    const groupSessions: Session[] = [];
    for (const task of tasks) {
      const sid = task.sessionId ?? null;
      if (!sid || seen.has(sid)) continue;
      const session = sessionsById.get(sid);
      if (session) {
        seen.add(sid);
        groupSessions.push(session);
      }
    }
    if (groupSessions.length > 0) {
      groups.push({ orchestrator: orch, sessions: groupSessions });
    }
  }

  return groups;
});

/** Set of session ids that belong to any orchestrator (for filtering the main list). */
const sessionsAttachedToOrchestrators = computed<Set<string>>(() => {
  const ids = new Set<string>();
  for (const group of orchestratorSessionsByOrchestrator.value) {
    for (const s of group.sessions) ids.add(s.id);
  }
  return ids;
});

/** Step sessions under an orchestrator, in subtask order (for nested list UI). */
function orderedNestedSessions(orch: Orchestrator): Session[] {
  const tasks = subtasksFromStoredJson(orch.subtasksJson);
  const sessionsById = new Map(sessions.value.map((s) => [s.id, s]));
  const out: Session[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    const sid = task.sessionId ?? null;
    if (!sid || seen.has(sid)) continue;
    const s = sessionsById.get(sid);
    if (s) {
      seen.add(sid);
      out.push(s);
    }
  }
  return out;
}

const filteredOrchestrators = computed(() => {
  let list = orchestrators.value.filter((o) => !o.archived);
  if (activeFilter.value) {
    list = list.filter((o) => o.tags === activeFilter.value);
  }
  return [...list].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
});

const filteredArchivedOrchestrators = computed(() => {
  let list = orchestrators.value.filter((o) => o.archived);
  if (activeFilter.value) {
    list = list.filter((o) => o.tags === activeFilter.value);
  }
  return [...list].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
});

const filteredSessions = computed(() => {
  const excludedIds = sessionsAttachedToOrchestrators.value;
  let list = sessions.value.filter((s) => !excludedIds.has(s.id));
  if (activeFilter.value) {
    list = list.filter((s) => sessionHasTag(s, activeFilter.value));
  }
  return [...list].sort((a, b) => {
    // Favorites first, then busy, then by updatedAt descending
    const favDiff = (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0);
    if (favDiff !== 0) return favDiff;
    const busyDiff = (b.busy ? 1 : 0) - (a.busy ? 1 : 0);
    if (busyDiff !== 0) return busyDiff;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
});

const archivedCount = computed(
  () => archivedSessions.value.length + orchestrators.value.filter((o) => o.archived).length
);

const filteredArchivedSessions = computed(() => {
  let list = archivedSessions.value;
  if (activeFilter.value) {
    list = list.filter((s) => sessionHasTag(s, activeFilter.value));
  }
  return [...list].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
});

const combinedItems = computed<CombinedItem[]>(() => {
  const sessionItems = filteredSessions.value.map((session) => ({
    kind: 'session' as const,
    session
  }));
  const orchestratorItems = filteredOrchestrators.value.map((orchestrator) => ({
    kind: 'orchestrator' as const,
    orchestrator,
    nestedSessions: orderedNestedSessions(orchestrator)
  }));
  const merged: CombinedItem[] = [...sessionItems, ...orchestratorItems];
  const itemBusy = (item: CombinedItem): boolean =>
    item.kind === 'session' ? !!item.session.busy : item.nestedSessions.some((s) => s.busy);
  return merged.sort((a, b) => {
    const aFav = a.kind === 'session' && a.session.isFavorite ? 1 : 0;
    const bFav = b.kind === 'session' && b.session.isFavorite ? 1 : 0;
    if (bFav !== aFav) return bFav - aFav;
    const busyDiff = (itemBusy(b) ? 1 : 0) - (itemBusy(a) ? 1 : 0);
    if (busyDiff !== 0) return busyDiff;
    const aUpdated = a.kind === 'session' ? a.session.updatedAt : a.orchestrator.updatedAt;
    const bUpdated = b.kind === 'session' ? b.session.updatedAt : b.orchestrator.updatedAt;
    return new Date(bUpdated).getTime() - new Date(aUpdated).getTime();
  });
});

const showDeleteModal = (item: CombinedItem): void => {
  if (item.kind === 'session') {
    sessionActions.requestRemove(item.session);
  } else {
    orchestratorActions.requestRemove(item.orchestrator);
  }
};

const selectionActive = computed(() => selectedIds.value.size > 0);
const visibleSelectableSessions = computed<Session[]>(() =>
  bShowArchived.value
    ? [...filteredSessions.value, ...filteredArchivedSessions.value]
    : filteredSessions.value
);
const orchestratorSelectionActive = computed(() => orchestratorSelectedIds.value.size > 0);

/** Total selected rows (sessions + orchestrators) for the multiselect bar. */
const multiselectTotalCount = computed(
  () => selectedIds.value.size + orchestratorSelectedIds.value.size
);

/** True when every visible session and every visible orchestrator is selected. */
const multiselectAllSelected = computed(() => {
  const sessionsOk =
    visibleSelectableSessions.value.length === 0 ||
    visibleSelectableSessions.value.every((s) => selectedIds.value.has(s.id));
  const orchOk =
    filteredOrchestrators.value.length === 0 ||
    filteredOrchestrators.value.every((o) => orchestratorSelectedIds.value.has(o.id));
  return sessionsOk && orchOk;
});

function toggleSelectAllMultiselect(): void {
  if (multiselectAllSelected.value) {
    selectedIds.value = new Set();
    orchestratorSelectedIds.value = new Set();
  } else {
    selectedIds.value = new Set(visibleSelectableSessions.value.map((s) => s.id));
    orchestratorSelectedIds.value = new Set(filteredOrchestrators.value.map((o) => o.id));
  }
}

const selectedVisibleSessions = computed<Session[]>(() =>
  visibleSelectableSessions.value.filter((s) => selectedIds.value.has(s.id))
);

const selectedVisibleOrchestrators = computed(() =>
  orchestrators.value.filter((o) => orchestratorSelectedIds.value.has(o.id))
);

/** True when every selected session and orchestrator is archived (unarchive mode for the archive action). */
const multiselectArchiveShouldUnarchive = computed(() => {
  const sessions = selectedVisibleSessions.value;
  const orchs = selectedVisibleOrchestrators.value;
  if (sessions.length === 0 && orchs.length === 0) return false;
  const sessionsAllArchived = sessions.length === 0 || sessions.every((s) => s.archived);
  const orchAllArchived = orchs.length === 0 || orchs.every((o) => o.archived ?? false);
  return sessionsAllArchived && orchAllArchived;
});

function toggleSelect(id: string): void {
  const next = new Set(selectedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedIds.value = next;
}

function clearSelection(): void {
  selectedIds.value = new Set();
}

// long-press to enter selection mode
const sessionLongPress = useLongPress<string>((id) => {
  if (!selectedIds.value.has(id)) {
    toggleSelect(id);
  }
});

const orchestratorLongPress = useLongPress<string>((id) => {
  if (!orchestratorSelectedIds.value.has(id)) {
    toggleSelectOrchestrator(id);
  }
});

function toggleSelectOrchestrator(id: string): void {
  const next = new Set(orchestratorSelectedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  orchestratorSelectedIds.value = next;
}

function handleOrchestratorClick(orchestrator: Orchestrator, e: Event): void {
  if (orchestratorLongPress.bTriggered.value) {
    e.preventDefault();
    orchestratorLongPress.bTriggered.value = false;
    return;
  }
  if (orchestratorSelectionActive.value) {
    e.preventDefault();
    e.stopPropagation();
    toggleSelectOrchestrator(orchestrator.id);
  }
}

function handleSessionClick(session: Session, e: Event): void {
  if (sessionLongPress.bTriggered.value) {
    e.preventDefault();
    sessionLongPress.bTriggered.value = false;
    return;
  }
  if (selectionActive.value) {
    e.preventDefault();
    e.stopPropagation();
    toggleSelect(session.id);
    return;
  }
}

function setArchivedListViewEl(el: unknown): void {
  archivedListViewRef.value = el instanceof HTMLElement ? el : null;
}

function pickMultiselectAnchorEl(): HTMLElement | null {
  if (viewMode.value !== 'list') {
    return null;
  }
  if (bShowArchived.value && archivedListViewRef.value) {
    return archivedListViewRef.value;
  }
  return listViewRef.value;
}

function updateMultiselectBarPosition(): void {
  const anchor = pickMultiselectAnchorEl();
  if (!anchor) {
    multiselectLeft.value = null;
    multiselectWidth.value = null;
    return;
  }

  const rect = anchor.getBoundingClientRect();
  // Position the fixed bar to match the list container geometry.
  multiselectLeft.value = rect.left;
  multiselectWidth.value = rect.width;
}

function scheduleUpdateMultiselectBarPosition(): void {
  void nextTick(() => updateMultiselectBarPosition());
}

function sessionHasTag(s: Session, tag: string | null): boolean {
  if (!tag) {
    return true;
  }
  const list = s.tags;
  if (!list?.length) {
    return false;
  }
  return list.some((x) => x.toLowerCase() === tag.toLowerCase());
}

// -------------------------------------------------- Watchers --------------------------------------------------
watch(viewMode, (v) => {
  safeSetItem('sessionsViewMode', v);
});
watch(orchestratorsViewMode, (v) => {
  safeSetItem('orchestratorsViewMode', v);
});

// -------------------------------------------------- Methods --------------------------------------------------
const ensureData = async (): Promise<void> => {
  if (store.workspaces.some((w) => w.id === workspaceId.value)) {
    return;
  }
  await store.fetchAll();
};

const fetchOrchestrators = async (opts?: { silent?: boolean }): Promise<void> => {
  if (!workspaceId.value) return;
  const silent = opts?.silent === true;
  if (!silent) bOrchestratorsLoading.value = true;
  try {
    await orchestratorsStore.ensureFetched(workspaceId.value, true);
  } finally {
    if (!silent) bOrchestratorsLoading.value = false;
    bOrchestratorsInitialFetched.value = true;
  }
};

const bulkDeleteCombinedDescription = computed((): string => {
  const nS = selectedIds.value.size;
  const nO = orchestratorSelectedIds.value.size;
  if (nS > 0 && nO > 0) {
    return `Delete ${nS} session${nS === 1 ? '' : 's'} and ${nO} orchestrator${nO === 1 ? '' : 's'}? Step sessions tied to the selected orchestrators are removed too. This cannot be undone.`;
  }
  if (nS > 0) {
    return `Delete ${nS} selected session${nS === 1 ? '' : 's'}? This cannot be undone.`;
  }
  return `Delete ${nO} selected orchestrator${nO === 1 ? '' : 's'}? Their step sessions will be removed too. This cannot be undone.`;
});

const bulkDeleteCombined = async (): Promise<void> => {
  if (!props.workspace) return;
  const sessionIds = [...selectedIds.value];
  const orchIds = [...orchestratorSelectedIds.value];
  if (sessionIds.length === 0 && orchIds.length === 0) return;
  bBulkDeletingCombined.value = true;
  try {
    if (sessionIds.length > 0) {
      await sessionsApi.bulkDelete(props.workspace.id, sessionIds);
      for (const id of sessionIds) {
        store.removeSession(id);
      }
      selectedIds.value = new Set();
    }
    if (orchIds.length > 0) {
      const orchSet = new Set(orchIds);
      await Promise.all(orchIds.map((id) => orchestratorApi.remove(props.workspace.id, id)));
      for (const id of orchSet) {
        orchestratorsStore.removeOrchestrator(id, props.workspace.id);
      }
      orchestratorSelectedIds.value = new Set();
    }
    bShowBulkDeleteCombined.value = false;
  } catch (err) {
    notifyApiError(err, 'Failed to delete selection');
  } finally {
    bBulkDeletingCombined.value = false;
  }
};

const onMultiselectArchive = async (): Promise<void> => {
  if (!props.workspace) return;
  const wantArchived = !multiselectArchiveShouldUnarchive.value;
  const sessionIds = [...selectedIds.value];
  const orchIds = [...orchestratorSelectedIds.value];
  if (sessionIds.length === 0 && orchIds.length === 0) return;
  bBulkArchiving.value = true;
  try {
    if (sessionIds.length > 0) {
      await sessionsApi.bulkArchive(props.workspace.id, sessionIds, wantArchived);
    }
    if (orchIds.length > 0) {
      await Promise.all(
        orchIds.map(async (id) => {
          const { data } = await orchestratorApi.update(props.workspace.id, id, {
            archived: wantArchived
          });
          if (data) orchestratorsStore.upsertOrchestrator(data);
        })
      );
    }
    selectedIds.value = new Set();
    orchestratorSelectedIds.value = new Set();
  } catch (err) {
    notifyApiError(err, 'Failed to archive selection');
  } finally {
    bBulkArchiving.value = false;
  }
};

// -------------------------------------------------- Context menu --------------------------------------------------
const bCtxMenuOpen = ref(false);
const ctxMenuX = ref(0);
const ctxMenuY = ref(0);
const ctxMenuItems = ref<ContextMenuItem[]>([]);
let ctxPickHandler: ((key: string) => void) | null = null;

function openContextMenu(
  e: MouseEvent,
  items: ContextMenuItem[],
  onPick: (key: string) => void
): void {
  e.preventDefault();
  e.stopPropagation();
  ctxMenuItems.value = items;
  ctxPickHandler = onPick;
  ctxMenuX.value = e.clientX;
  ctxMenuY.value = e.clientY;
  bCtxMenuOpen.value = true;
}

function onContextMenuPick(key: string): void {
  const fn = ctxPickHandler;
  ctxPickHandler = null;
  fn?.(key);
}

function onSessionContextMenu(e: MouseEvent, session: Session): void {
  openContextMenu(e, sessionActions.menuItems(session), (key) => sessionActions.pick(session, key));
}

function onOrchestratorContextMenu(e: MouseEvent, orchestrator: Orchestrator): void {
  openContextMenu(e, orchestratorActions.menuItems(orchestrator), (key) =>
    orchestratorActions.pick(orchestrator, key)
  );
}

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(() => {
  void ensureData();
  ensureAgentCapabilitiesLoaded();
  void fetchOrchestrators();
  consumeNewSessionQuery();

  // Keep the fixed bar aligned with the list when layout changes.
  window.addEventListener('resize', updateMultiselectBarPosition);
  window.addEventListener('novacode:new-session', openNewSessionFromShortcut);
  scheduleUpdateMultiselectBarPosition();
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateMultiselectBarPosition);
  window.removeEventListener('novacode:new-session', openNewSessionFromShortcut);
});
watch(workspaceId, (id) => {
  if (!id) return;
  bOrchestratorsInitialFetched.value = false;
  void ensureData();
  void fetchOrchestrators();
});

function consumeNewSessionQuery(): void {
  if (route.query.newSession !== '1') {
    return;
  }
  openNewSessionModal();
  const nextQuery = { ...route.query };
  delete nextQuery.newSession;
  void router.replace({ name: route.name as string, params: route.params, query: nextQuery });
}

function openNewSessionFromShortcut(): void {
  openNewSessionModal();
}

function openNewSessionModal(mode: NewSessionMode = 'session'): void {
  openNewSession(props.workspace, mode);
}

watch(
  () => route.query.newSession,
  () => {
    consumeNewSessionQuery();
  }
);
watch(bShowArchived, () => {
  clearSelection();
  scheduleUpdateMultiselectBarPosition();
});

watch(
  () => [selectionActive.value, orchestratorSelectionActive.value, viewMode.value],
  ([selActive, orchSelActive]) => {
    if (selActive || orchSelActive) scheduleUpdateMultiselectBarPosition();
  }
);
</script>

<template>
  <div v-if="sessionTags.length > 0" class="flex flex-wrap items-center gap-2 mb-3">
    <span class="text-xs text-text-muted shrink-0">Tags</span>
    <button
      type="button"
      class="text-xs px-2.5 py-1 rounded-full border transition-colors"
      :class="
        activeFilter === null
          ? 'bg-primary/15 text-primary border-primary/30'
          : 'border-border text-text-muted hover:text-text-primary'
      "
      @click="activeFilter = null"
    >
      All
    </button>
    <button
      v-for="t in sessionTags"
      :key="t"
      type="button"
      class="text-xs px-2.5 py-1 rounded-full border transition-colors"
      :class="
        activeFilter === t
          ? 'bg-primary/15 text-primary border-primary/30'
          : 'border-border text-text-muted hover:text-text-primary'
      "
      @click="activeFilter = activeFilter === t ? null : t"
    >
      {{ t }}
    </button>
  </div>

  <SessionListToolbar
    :view-mode="viewMode"
    @update:view-mode="viewMode = $event"
    @new-session="openNewSessionModal"
    @new-orchestrator="openNewSessionModal('orchestrator')"
  />

  <ListPageSkeleton
    v-if="sessionsLoading || !bOrchestratorsInitialFetched"
    :variant="viewMode === 'grid' ? 'cards' : 'rows'"
    :count="6"
    label="Loading sessions"
  />
  <template v-else>
    <EmptyState
      v-if="combinedItems.length === 0"
      icon="terminal"
      :title="activeFilter ? `No sessions tagged ${activeFilter}` : 'No sessions yet'"
      :description="activeFilter ? undefined : 'Start a session to work in this workspace.'"
    >
      <button v-if="activeFilter" type="button" class="button" @click="activeFilter = null">
        Clear filter
      </button>
      <button v-else type="button" class="button is-primary" @click="openNewSessionModal()">
        New session
      </button>
    </EmptyState>
    <SessionListGrid
      v-else-if="viewMode === 'grid'"
      :items="combinedItems"
      :workspace-id="workspaceId"
      @session-context-menu="onSessionContextMenu"
      @orchestrator-context-menu="onOrchestratorContextMenu"
      @edit="sessionActions.edit"
      @archive="sessionActions.toggleArchive"
      @archive-orchestrator="orchestratorActions.toggleArchive"
      @delete="showDeleteModal"
    />
    <div v-else-if="viewMode === 'list'" ref="listViewRef" class="list-view shrink-0">
      <SessionListRows
        :items="combinedItems"
        :workspace-id="workspaceId"
        :selected-ids="selectedIds"
        :orchestrator-selected-ids="orchestratorSelectedIds"
        :b-selection-active="selectionActive || orchestratorSelectionActive"
        @session-context-menu="onSessionContextMenu"
        @orchestrator-context-menu="onOrchestratorContextMenu"
        @edit="sessionActions.edit"
        @archive="sessionActions.toggleArchive"
        @archive-orchestrator="orchestratorActions.toggleArchive"
        @delete="showDeleteModal"
        @toggle-select="toggleSelect"
        @toggle-select-orchestrator="toggleSelectOrchestrator"
        @session-click="handleSessionClick"
        @orchestrator-click="handleOrchestratorClick"
        @session-pointer-down="sessionLongPress.onPointerDown"
        @session-pointer-up="sessionLongPress.onPointerUp"
        @session-pointer-move="sessionLongPress.onPointerMove"
        @orchestrator-pointer-down="orchestratorLongPress.onPointerDown"
        @orchestrator-pointer-up="orchestratorLongPress.onPointerUp"
        @orchestrator-pointer-move="orchestratorLongPress.onPointerMove"
      />
    </div>

    <SessionListArchived
      v-if="archivedCount > 0"
      :b-show-archived="bShowArchived"
      :archived-count="archivedCount"
      :sessions-loading="sessionsLoading"
      :view-mode="viewMode"
      :workspace-id="workspaceId"
      :sessions="filteredArchivedSessions"
      :orchestrators="filteredArchivedOrchestrators"
      :selected-ids="selectedIds"
      :orchestrator-selected-ids="orchestratorSelectedIds"
      :b-selection-active="selectionActive || orchestratorSelectionActive"
      :ordered-nested-sessions="orderedNestedSessions"
      :set-list-view-el="setArchivedListViewEl"
      @update:b-show-archived="bShowArchived = $event"
      @session-context-menu="onSessionContextMenu"
      @orchestrator-context-menu="onOrchestratorContextMenu"
      @archive="sessionActions.toggleArchive"
      @archive-orchestrator="orchestratorActions.toggleArchive"
      @delete="showDeleteModal"
      @toggle-select="toggleSelect"
      @toggle-select-orchestrator="toggleSelectOrchestrator"
    />
  </template>

  <SessionListMultiselectBar
    :b-visible="selectionActive || orchestratorSelectionActive"
    :total-count="multiselectTotalCount"
    :b-all-selected="multiselectAllSelected"
    :b-bulk-archiving="bBulkArchiving"
    :b-should-unarchive="multiselectArchiveShouldUnarchive"
    :b-has-selection="selectedIds.size > 0 || orchestratorSelectedIds.size > 0"
    :left="multiselectLeft"
    :width="multiselectWidth"
    @toggle-select-all="toggleSelectAllMultiselect"
    @archive="onMultiselectArchive"
    @delete="bShowBulkDeleteCombined = true"
  />

  <ConfirmModal
    :model-value="sessionPendingDelete !== null"
    title="Delete session"
    :description="`Delete '${sessionPendingDelete?.name}'? This cannot be undone.`"
    confirm-label="Delete"
    :loading="sessionActions.bDeleting.value"
    @update:model-value="
      (v) => {
        if (!v) sessionPendingDelete = null;
      }
    "
    @confirm="sessionActions.confirmRemove"
  />

  <ConfirmModal
    :model-value="bShowBulkDeleteCombined"
    title="Delete selected"
    :description="bulkDeleteCombinedDescription"
    confirm-label="Delete all"
    :loading="bBulkDeletingCombined"
    @update:model-value="
      (v: boolean) => {
        if (!v) bShowBulkDeleteCombined = false;
      }
    "
    @confirm="bulkDeleteCombined"
  />

  <ConfirmModal
    :model-value="orchestratorPendingDelete !== null"
    title="Delete orchestrator"
    :description="`Delete '${orchestratorPendingDelete?.name}'? Step sessions created for this plan will be removed too. This cannot be undone.`"
    confirm-label="Delete"
    :loading="orchestratorActions.bDeleting.value"
    @update:model-value="
      (v) => {
        if (!v) orchestratorPendingDelete = null;
      }
    "
    @confirm="orchestratorActions.confirmRemove"
  />

  <SessionEditModal
    :model-value="sessionToEdit !== null"
    :session="sessionToEdit"
    :loading="sessionActions.bSavingEdit.value"
    :existing-tags="sessionTags"
    @update:model-value="
      (v) => {
        if (!v) sessionToEdit = null;
      }
    "
    @save="sessionActions.saveEdit"
  />

  <PromptModal
    :model-value="orchestratorToEdit !== null"
    title="Edit orchestrator name"
    label="Name"
    :initial-value="orchestratorToEdit?.name ?? ''"
    confirm-label="Save"
    :loading="orchestratorActions.bSavingEdit.value"
    @update:model-value="
      (v) => {
        if (!v) orchestratorToEdit = null;
      }
    "
    @confirm="orchestratorActions.saveEdit"
  />

  <NewSessionModal
    v-model="bShowNewSession"
    :loading="bCreating"
    :error="createError"
    :default-agent-type="(workspace && workspace.defaultAgentType) || null"
    :claude-available="bClaudeAvailable"
    :cursor-available="bCursorAvailable"
    :mistral-vibe-available="bMistralVibeAvailable"
    :open-code-available="bOpenCodeAvailable"
    :codex-available="bCodexAvailable"
    :agents-loaded="bCapabilitiesLoaded"
    :existing-tags="sessionTags"
    allow-orchestrator
    :initial-mode="newSessionMode"
    @create="createSession"
  />

  <ContextMenu
    v-model="bCtxMenuOpen"
    :x="ctxMenuX"
    :y="ctxMenuY"
    :items="ctxMenuItems"
    @pick="onContextMenuPick"
  />
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
</style>

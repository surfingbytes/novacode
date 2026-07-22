<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import SessionEditModal from '@/components/SessionEditModal.vue';
import NewSessionModal from '@/components/NewSessionModal.vue';
import NewOrchestratorModal from '@/components/NewOrchestratorModal.vue';
import SessionCard from '@/components/workspace/SessionCard.vue';
import OrchestratorCard from '@/components/workspace/OrchestratorCard.vue';

// composables
import { useLongPress } from '@/composables/useLongPress';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';
import { useToastStore } from '@/stores/toasts';
import { useOrchestratorsStore } from '@/stores/orchestrators';

// classes
import { apiErrorMessage, sessionsApi, orchestratorApi } from '@/classes/api';
import { subtasksFromStoredJson } from '@/utils/orchestratorPayload';

// composables
import { useAgentCapabilities } from '@/composables/useAgentCapabilities';

// types
import type { ContextMenuItem } from '@/components/ContextMenu.vue';
import type { Session, Orchestrator, AgentType, Workspace } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  workspace: Workspace; // required
}>();

// -------------------------------------------------- Store --------------------------------------------------
const store = useWorkspacesStore();
const toastStore = useToastStore();
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
const bShowNewSessionModal = ref(false);
const bSubmittingSession = ref(false);
const createSessionError = ref<string | null>(null);
const sessionToDelete = ref<Session | null>(null);
const bDeletingSession = ref(false);
const sessionToEdit = ref<Session | null>(null);
const bSavingEdit = ref(false);
const bShowNewOrchestratorModal = ref(false);
const viewMode = ref<'list' | 'grid'>(
  (localStorage.getItem('sessionsViewMode') as 'list' | 'grid') ?? 'list'
);
const orchestratorsViewMode = ref<'list' | 'grid'>(
  (localStorage.getItem('orchestratorsViewMode') as 'list' | 'grid') ?? 'list'
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
  ensureLoaded: ensureAgentCapabilitiesLoaded
} = useAgentCapabilities();
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
    // Busy sessions first
    const busyDiff = (b.busy ? 1 : 0) - (a.busy ? 1 : 0);
    if (busyDiff !== 0) return busyDiff;
    // Then by updatedAt descending (newest first)
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

type CombinedItem =
  | { kind: 'session'; session: Session }
  | { kind: 'orchestrator'; orchestrator: Orchestrator; nestedSessions: Session[] };

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
  return merged.sort((a, b) => {
    const aUpdated = a.kind === 'session' ? a.session.updatedAt : a.orchestrator.updatedAt;
    const bUpdated = b.kind === 'session' ? b.session.updatedAt : b.orchestrator.updatedAt;
    return new Date(bUpdated).getTime() - new Date(aUpdated).getTime();
  });
});

const showDeleteModal = (item: CombinedItem): void => {
  if (item.kind === 'session') {
    sessionToDelete.value = item.session;
  } else {
    orchestratorToDelete.value = item.orchestrator;
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
  localStorage.setItem('sessionsViewMode', v);
});
watch(orchestratorsViewMode, (v) => {
  localStorage.setItem('orchestratorsViewMode', v);
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

const createSession = async (payload: {
  name: string;
  tags?: string[] | null;
  agentType?: AgentType;
}): Promise<void> => {
  if (!props.workspace || bSubmittingSession.value) return;
  bSubmittingSession.value = true;
  createSessionError.value = null;
  try {
    const { data: newSession } = await sessionsApi.create(props.workspace.id, payload);
    bShowNewSessionModal.value = false;
    await router.push({
      name: 'session',
      params: { id: props.workspace.id, sessionId: newSession.id }
    });
  } catch (error) {
    toastStore.error('Failed to create session');
    createSessionError.value = apiErrorMessage(error, 'Failed to create session');
  } finally {
    bSubmittingSession.value = false;
  }
};

const bCreatingOrchestrator = ref(false);
const createOrchestrator = async (payload: {
  name: string;
  tags?: string | null;
  agentType?: AgentType;
}): Promise<void> => {
  if (!props.workspace || bCreatingOrchestrator.value) return;
  bCreatingOrchestrator.value = true;
  try {
    const { data: newOrchestrator } = await orchestratorApi.create(props.workspace.id, payload);
    orchestratorsStore.upsertOrchestrator(newOrchestrator);
    bShowNewOrchestratorModal.value = false;
    await router.push({
      name: 'orchestrator',
      params: { id: props.workspace.id, orchestratorId: newOrchestrator.id }
    });
  } catch {
    toastStore.error('Failed to create orchestrator');
  } finally {
    bCreatingOrchestrator.value = false;
  }
};

const deleteSession = async (): Promise<void> => {
  if (!sessionToDelete.value || !props.workspace) return;
  bDeletingSession.value = true;
  try {
    await sessionsApi.remove(props.workspace.id, sessionToDelete.value.id);
    sessionToDelete.value = null;
  } catch {
    toastStore.error('Failed to delete session');
  } finally {
    bDeletingSession.value = false;
  }
};

const orchestratorToDelete = ref<Orchestrator | null>(null);
const bDeletingOrchestrator = ref(false);

const deleteOrchestrator = async (): Promise<void> => {
  if (!orchestratorToDelete.value || !props.workspace) return;
  bDeletingOrchestrator.value = true;
  try {
    await orchestratorApi.remove(props.workspace.id, orchestratorToDelete.value.id);
    orchestratorsStore.removeOrchestrator(orchestratorToDelete.value.id, props.workspace.id);
    orchestratorToDelete.value = null;
  } catch {
    toastStore.error('Failed to delete orchestrator');
  } finally {
    bDeletingOrchestrator.value = false;
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
      selectedIds.value = new Set();
    }
    if (orchIds.length > 0) {
      const orchSet = new Set(orchIds);
      await Promise.all(orchIds.map((id) => orchestratorApi.remove(props.workspace!.id, id)));
      for (const id of orchSet) {
        orchestratorsStore.removeOrchestrator(id, props.workspace.id);
      }
      orchestratorSelectedIds.value = new Set();
    }
    bShowBulkDeleteCombined.value = false;
  } catch {
    toastStore.error('Failed to delete selection');
  } finally {
    bBulkDeletingCombined.value = false;
  }
};

const saveEditSession = async (payload: {
  name: string;
  tags?: string[] | null;
}): Promise<void> => {
  if (!sessionToEdit.value || !props.workspace) return;
  bSavingEdit.value = true;
  try {
    await sessionsApi.update(props.workspace.id, sessionToEdit.value.id, payload);
    sessionToEdit.value = null;
  } catch {
    toastStore.error('Failed to update session');
  } finally {
    bSavingEdit.value = false;
  }
};

const toggleArchive = async (session: Session): Promise<void> => {
  if (!props.workspace) return;
  try {
    const nextArchived = !session.archived;
    await sessionsApi.update(props.workspace.id, session.id, {
      archived: nextArchived
    });
  } catch {
    toastStore.error('Failed to toggle archive');
  }
};

const toggleArchiveOrchestrator = async (orchestrator: Orchestrator): Promise<void> => {
  if (!props.workspace) return;
  try {
    const nextArchived = !orchestrator.archived;
    const { data } = await orchestratorApi.update(props.workspace.id, orchestrator.id, {
      archived: nextArchived
    });
    const idx = orchestrators.value.findIndex((o) => o.id === orchestrator.id);
    if (idx >= 0 && data) orchestrators.value[idx] = data;
  } catch {
    toastStore.error('Failed to toggle orchestrator archive');
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
          const idx = orchestrators.value.findIndex((o) => o.id === id);
          if (idx >= 0 && data) orchestrators.value[idx] = data;
        })
      );
    }
    selectedIds.value = new Set();
    orchestratorSelectedIds.value = new Set();
  } catch {
    toastStore.error('Failed to archive selection');
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

function contextItemsForSession(session: Session): ContextMenuItem[] {
  const arch = session.archived;
  return [
    { key: 'open', label: 'Open', icon: 'open_in_new' },
    { key: 'edit', label: 'Edit…', icon: 'edit' },
    {
      key: 'archive',
      label: arch ? 'Unarchive' : 'Archive',
      icon: arch ? 'unarchive' : 'inventory_2'
    },
    { key: 'delete', label: 'Delete…', icon: 'delete', danger: true }
  ];
}

function contextItemsForOrchestrator(orchestrator: Orchestrator): ContextMenuItem[] {
  const arch = orchestrator.archived === true;
  return [
    { key: 'open', label: 'Open', icon: 'open_in_new' },
    {
      key: 'archive',
      label: arch ? 'Unarchive' : 'Archive',
      icon: arch ? 'unarchive' : 'inventory_2'
    },
    { key: 'delete', label: 'Delete…', icon: 'delete', danger: true }
  ];
}

function onSessionContextMenu(e: MouseEvent, session: Session): void {
  openContextMenu(e, contextItemsForSession(session), (key) => {
    const wid = workspaceId.value;
    if (key === 'open') {
      router.push({ name: 'session', params: { id: wid, sessionId: session.id } });
      return;
    }
    if (key === 'edit') {
      sessionToEdit.value = session;
      return;
    }
    if (key === 'archive') {
      void toggleArchive(session);
      return;
    }
    if (key === 'delete') {
      showDeleteModal({ kind: 'session', session });
    }
  });
}

function onOrchestratorContextMenu(e: MouseEvent, orchestrator: Orchestrator): void {
  openContextMenu(e, contextItemsForOrchestrator(orchestrator), (key) => {
    const wid = workspaceId.value;
    if (key === 'open') {
      router.push({ name: 'orchestrator', params: { id: wid, orchestratorId: orchestrator.id } });
      return;
    }
    if (key === 'archive') {
      void toggleArchiveOrchestrator(orchestrator);
      return;
    }
    if (key === 'delete') {
      showDeleteModal({
        kind: 'orchestrator',
        orchestrator,
        nestedSessions: orderedNestedSessions(orchestrator)
      });
    }
  });
}

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(() => {
  ensureData();
  ensureAgentCapabilitiesLoaded();
  fetchOrchestrators();

  // Keep the fixed bar aligned with the list when layout changes.
  window.addEventListener('resize', updateMultiselectBarPosition);
  scheduleUpdateMultiselectBarPosition();
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateMultiselectBarPosition);
});
watch(workspaceId, (id) => {
  if (!id) return;
  bOrchestratorsInitialFetched.value = false;
  ensureData();
  fetchOrchestrators();
});
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

  <!-- Top: view mode selector + new session / orchestrator -->
  <div class="flex flex-wrap justify-between sm:justify-end gap-y-2 mb-3">
    <div class="button-select-small mr-2 mt-0">
      <button
        class="button is-icon"
        :class="{ 'is-active': viewMode === 'list' }"
        aria-label="List view"
        :aria-pressed="viewMode === 'list'"
        @click="viewMode = 'list'"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>
      <button
        class="button is-icon"
        :class="{ 'is-active': viewMode === 'grid' }"
        aria-label="Grid view"
        :aria-pressed="viewMode === 'grid'"
        @click="viewMode = 'grid'"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      </button>
    </div>
    <div class="flex flex-wrap items-center gap-2 shrink-0">
      <button type="button" class="button" @click="bShowNewOrchestratorModal = true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <path d="M21 3H15v4h6V3zM9 3H3v4h6V3zM15 17H9v4h6v-4z" />
          <path d="M12 7v4M6 7v6h12V7" />
        </svg>
        New orchestrator
      </button>
      <button type="button" @click="bShowNewSessionModal = true" class="button is-primary">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        New Session
      </button>
    </div>
  </div>

  <div
    v-if="sessionsLoading || !bOrchestratorsInitialFetched"
    class="flex flex-col items-center justify-center py-14 gap-4"
  >
    <div class="w-8 h-8 border-2 border-surface border-t-primary rounded-full animate-spin"></div>
    <p class="text-sm text-text-muted">Loading sessions…</p>
  </div>
  <template v-else>
    <!-- Grid View -->
    <div class="grid-view" v-if="viewMode === 'grid'">
      <TransitionGroup name="list-stagger" tag="div" class="grid-view-items">
        <template
          v-for="(item, index) in combinedItems"
          :key="item.kind === 'session' ? item.session.id : item.orchestrator.id"
        >
          <SessionCard
            v-if="item.kind === 'session'"
            :session="item.session"
            :workspace-id="workspaceId"
            b-grid
            :style="{ '--stagger-index': index }"
            @contextmenu.prevent.stop="onSessionContextMenu($event, item.session)"
            @edit="sessionToEdit = item.session"
            @archive="toggleArchive(item.session)"
            @delete="showDeleteModal(item)"
          />
          <OrchestratorCard
            v-else
            :orchestrator="item.orchestrator"
            :workspace-id="workspaceId"
            b-grid
            :style="{ '--stagger-index': index }"
            @contextmenu.prevent.stop="onOrchestratorContextMenu($event, item.orchestrator)"
            @archive="toggleArchiveOrchestrator(item.orchestrator)"
            @delete="showDeleteModal(item)"
          />
        </template>
      </TransitionGroup>
    </div>
    <div v-else-if="viewMode === 'list'" ref="listViewRef" class="list-view">
      <TransitionGroup name="list-stagger" tag="div" class="list-view-items">
        <div
          v-for="(item, index) in combinedItems"
          :key="item.kind === 'session' ? item.session.id : item.orchestrator.id"
          :style="{ '--stagger-index': index }"
          class="flex flex-col"
        >
          <SessionCard
            v-if="item.kind === 'session'"
            :session="item.session"
            :workspace-id="workspaceId"
            :b-selected="selectedIds.has(item.session.id)"
            :b-selection-active="selectionActive"
            @pointerdown="sessionLongPress.onPointerDown($event, item.session.id)"
            @pointerup="sessionLongPress.onPointerUp"
            @pointerleave="sessionLongPress.onPointerUp"
            @pointercancel="sessionLongPress.onPointerUp"
            @pointermove="sessionLongPress.onPointerMove"
            @click="handleSessionClick(item.session, $event)"
            @contextmenu.prevent.stop="onSessionContextMenu($event, item.session)"
            @edit="sessionToEdit = item.session"
            @archive="toggleArchive(item.session)"
            @delete="showDeleteModal(item)"
            @toggle-select="toggleSelect(item.session.id)"
          />

          <template v-else>
            <OrchestratorCard
              :orchestrator="item.orchestrator"
              :workspace-id="workspaceId"
              :b-selected="orchestratorSelectedIds.has(item.orchestrator.id)"
              :b-selection-active="orchestratorSelectionActive"
              @pointerdown="orchestratorLongPress.onPointerDown($event, item.orchestrator.id)"
              @pointerup="orchestratorLongPress.onPointerUp"
              @pointerleave="orchestratorLongPress.onPointerUp"
              @pointercancel="orchestratorLongPress.onPointerUp"
              @pointermove="orchestratorLongPress.onPointerMove"
              @click="handleOrchestratorClick(item.orchestrator, $event)"
              @contextmenu.prevent.stop="onOrchestratorContextMenu($event, item.orchestrator)"
              @archive="toggleArchiveOrchestrator(item.orchestrator)"
              @delete="showDeleteModal(item)"
              @toggle-select="toggleSelectOrchestrator(item.orchestrator.id)"
            />

            <SessionCard
              v-for="child in item.nestedSessions"
              :key="child.id"
              :session="child"
              :workspace-id="workspaceId"
              b-nested
              @contextmenu.prevent.stop="onSessionContextMenu($event, child)"
            />
          </template>
        </div>
      </TransitionGroup>
    </div>

    <!-- Archived sessions toggle (matches workspace list behavior) -->
    <div v-if="archivedCount > 0" class="mt-6">
      <button
        class="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors font-medium select-none"
        :disabled="sessionsLoading"
        @click="bShowArchived = !bShowArchived"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
          class="transition-transform duration-200"
          :class="bShowArchived ? 'rotate-90' : ''"
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        Archived
        <span class="text-xs bg-fg/[0.07] border border-fg/[0.1] rounded-full px-2 py-0.5">{{
          archivedCount
        }}</span>
      </button>

      <Transition name="fade">
        <div v-if="bShowArchived" class="mt-4">
          <div class="grid-view" v-if="viewMode === 'grid'">
            <TransitionGroup name="list-stagger" tag="div" class="grid-view-items">
              <SessionCard
                v-for="(session, index) in filteredArchivedSessions"
                :key="'arch-' + session.id"
                :session="session"
                :workspace-id="workspaceId"
                b-grid
                b-archived
                :style="{ '--stagger-index': index }"
                @contextmenu.prevent.stop="onSessionContextMenu($event, session)"
                @archive="toggleArchive(session)"
                @delete="showDeleteModal({ kind: 'session', session })"
              />
            </TransitionGroup>

            <template v-if="filteredArchivedOrchestrators.length > 0">
              <p
                v-if="filteredArchivedSessions.length > 0"
                class="text-xs font-medium text-text-muted mt-6 mb-2"
              >
                Orchestrators
              </p>
              <TransitionGroup name="list-stagger" tag="div" class="grid-view-items">
                <OrchestratorCard
                  v-for="(orch, index) in filteredArchivedOrchestrators"
                  :key="'arch-orch-' + orch.id"
                  :orchestrator="orch"
                  :workspace-id="workspaceId"
                  b-grid
                  b-archived
                  :style="{ '--stagger-index': index }"
                  @contextmenu.prevent.stop="onOrchestratorContextMenu($event, orch)"
                  @archive="toggleArchiveOrchestrator(orch)"
                  @delete="
                    showDeleteModal({
                      kind: 'orchestrator',
                      orchestrator: orch,
                      nestedSessions: orderedNestedSessions(orch)
                    })
                  "
                />
              </TransitionGroup>
            </template>
          </div>

          <div v-else class="list-view" ref="archivedListViewRef">
            <TransitionGroup name="list-stagger" tag="div" class="list-view-items">
              <SessionCard
                v-for="(session, index) in filteredArchivedSessions"
                :key="'arch-' + session.id"
                :session="session"
                :workspace-id="workspaceId"
                :b-selected="selectedIds.has(session.id)"
                :b-selection-active="selectionActive"
                b-archived
                :style="{ '--stagger-index': index }"
                @contextmenu.prevent.stop="onSessionContextMenu($event, session)"
                @archive="toggleArchive(session)"
                @delete="showDeleteModal({ kind: 'session', session })"
                @toggle-select="toggleSelect(session.id)"
              />
            </TransitionGroup>

            <template v-if="filteredArchivedOrchestrators.length > 0">
              <p
                v-if="filteredArchivedSessions.length > 0"
                class="text-xs font-medium text-text-muted mt-6 mb-2 px-2"
              >
                Orchestrators
              </p>
              <TransitionGroup name="list-stagger" tag="div" class="list-view-items">
                <div
                  v-for="(orch, oix) in filteredArchivedOrchestrators"
                  :key="'arch-orch-' + orch.id"
                  :style="{ '--stagger-index': oix }"
                  class="flex flex-col"
                >
                  <OrchestratorCard
                    :orchestrator="orch"
                    :workspace-id="workspaceId"
                    :b-selected="orchestratorSelectedIds.has(orch.id)"
                    :b-selection-active="orchestratorSelectionActive"
                    b-archived
                    @contextmenu.prevent.stop="onOrchestratorContextMenu($event, orch)"
                    @archive="toggleArchiveOrchestrator(orch)"
                    @delete="
                      showDeleteModal({
                        kind: 'orchestrator',
                        orchestrator: orch,
                        nestedSessions: orderedNestedSessions(orch)
                      })
                    "
                    @toggle-select="toggleSelectOrchestrator(orch.id)"
                  />

                  <SessionCard
                    v-for="child in orderedNestedSessions(orch)"
                    :key="'arch-orch-' + orch.id + '-sub-' + child.id"
                    :session="child"
                    :workspace-id="workspaceId"
                    b-nested
                    b-archived
                    @contextmenu.prevent.stop="onSessionContextMenu($event, child)"
                  />
                </div>
              </TransitionGroup>
            </template>
          </div>
        </div>
      </Transition>
    </div>
  </template>

  <Transition name="fade">
    <div
      v-if="selectionActive || orchestratorSelectionActive"
      class="fixed bottom-4 z-40 bg-surface border border-border rounded-xl px-3 py-2 shadow-xl"
      :class="
        multiselectLeft === null ? 'left-1/2 -translate-x-1/2 w-[min(960px,calc(100%-1rem))]' : ''
      "
      :style="
        multiselectLeft === null
          ? undefined
          : {
              left: `${multiselectLeft}px`,
              width: `${multiselectWidth ?? 0}px`,
              transform: 'translateX(0)'
            }
      "
    >
      <div class="flex flex-wrap items-center justify-between gap-y-2 gap-x-3 w-full">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-2 min-w-0">
          <span class="text-sm text-text-muted whitespace-nowrap">
            {{ multiselectTotalCount }} item{{ multiselectTotalCount === 1 ? '' : 's' }}
          </span>
          <button type="button" class="button" @click="toggleSelectAllMultiselect">
            {{ multiselectAllSelected ? 'Clear all' : 'Select all' }}
          </button>
        </div>
        <div class="flex items-center gap-2 shrink-0 ml-auto">
          <button
            v-if="selectedIds.size > 0 || orchestratorSelectedIds.size > 0"
            type="button"
            class="button is-icon hover:bg-warning/10! hover:border-warning!"
            :disabled="bBulkArchiving"
            @click="onMultiselectArchive"
            :aria-label="
              multiselectArchiveShouldUnarchive ? 'Unarchive selected' : 'Archive selected'
            "
            :title="multiselectArchiveShouldUnarchive ? 'Unarchive selected' : 'Archive selected'"
          >
            <svg
              v-if="multiselectArchiveShouldUnarchive"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="14"
              height="14"
              class="text-warning"
              aria-hidden="true"
            >
              <path
                d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"
              />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="14"
              height="14"
              class="text-warning"
              aria-hidden="true"
            >
              <path
                d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"
              />
            </svg>
          </button>
          <button
            v-if="selectedIds.size > 0 || orchestratorSelectedIds.size > 0"
            type="button"
            class="button is-icon is-primary"
            @click="bShowBulkDeleteCombined = true"
            aria-label="Delete selected"
            title="Delete selected"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="14"
              height="14"
              aria-hidden="true"
            >
              <path
                d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <ConfirmModal
    :model-value="sessionToDelete !== null"
    title="Delete session"
    :description="`Delete '${sessionToDelete?.name}'? This cannot be undone.`"
    confirm-label="Delete"
    :loading="bDeletingSession"
    @update:model-value="
      (v) => {
        if (!v) sessionToDelete = null;
      }
    "
    @confirm="deleteSession"
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
    :model-value="orchestratorToDelete !== null"
    title="Delete orchestrator"
    :description="`Delete '${orchestratorToDelete?.name}'? Step sessions created for this plan will be removed too. This cannot be undone.`"
    confirm-label="Delete"
    :loading="bDeletingOrchestrator"
    @update:model-value="
      (v) => {
        if (!v) orchestratorToDelete = null;
      }
    "
    @confirm="deleteOrchestrator"
  />

  <SessionEditModal
    :model-value="sessionToEdit !== null"
    :session="sessionToEdit"
    :loading="bSavingEdit"
    :existing-tags="sessionTags"
    @update:model-value="
      (v) => {
        if (!v) sessionToEdit = null;
      }
    "
    @save="saveEditSession"
  />

  <NewSessionModal
    v-model="bShowNewSessionModal"
    :loading="bSubmittingSession"
    :error="createSessionError"
    :default-agent-type="(workspace && workspace.defaultAgentType) || null"
    :claude-available="bClaudeAvailable"
    :cursor-available="bCursorAvailable"
    :mistral-vibe-available="bMistralVibeAvailable"
    :open-code-available="bOpenCodeAvailable"
    :codex-available="bCodexAvailable"
    :existing-tags="sessionTags"
    @create="createSession"
  />

  <NewOrchestratorModal
    v-model="bShowNewOrchestratorModal"
    :loading="bCreatingOrchestrator"
    :default-agent-type="(workspace && workspace.defaultAgentType) || null"
    :claude-available="bClaudeAvailable"
    :cursor-available="bCursorAvailable"
    :mistral-vibe-available="bMistralVibeAvailable"
    :open-code-available="bOpenCodeAvailable"
    :codex-available="bCodexAvailable"
    @create="createOrchestrator"
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

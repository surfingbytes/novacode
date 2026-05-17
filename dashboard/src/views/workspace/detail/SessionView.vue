<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter, RouterLink } from 'vue-router';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import SessionEditModal from '@/components/SessionEditModal.vue';
import NewSessionModal from '@/components/NewSessionModal.vue';
import NewOrchestratorModal from '@/components/NewOrchestratorModal.vue';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';

// classes
import { sessionsApi, orchestratorApi, settingsApi } from '@/classes/api';
import { subtasksFromStoredJson } from '@/utils/orchestratorPayload';

// types
import type { ContextMenuItem } from '@/components/ContextMenu.vue';
import type { Session, Orchestrator, AgentType, Workspace } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  workspace: Workspace; // required
}>();

// -------------------------------------------------- Constants --------------------------------------------------
const AGENT_TYPE_TEXT = {
  claude: 'Claude',
  'cursor-agent': 'Cursor',
  'mistral-vibe': 'Mistral Vibe',
  'open-code': 'OpenCode',
  codex: 'Codex'
};
const AGENT_TYPE_COLOR = {
  claude: 'bg-orange-500/15! text-orange-400! border-orange-500/20!',
  'cursor-agent': 'bg-violet-500/15! text-violet-400! border-violet-500/20!',
  'mistral-vibe': 'bg-emerald-500/15! text-emerald-400! border-emerald-500/20!',
  'open-code': 'bg-cyan-500/15! text-cyan-400! border-cyan-500/20!',
  codex: 'bg-sky-500/15! text-sky-400! border-sky-500/20!'
};

// -------------------------------------------------- Store --------------------------------------------------
const store = useWorkspacesStore();
const route = useRoute();
const router = useRouter();

// -------------------------------------------------- Refs --------------------------------------------------
const orchestrators = ref<Orchestrator[]>([]);
const bOrchestratorsLoading = ref(false);
/** After first successful fetch; avoids showing step sessions at top level before orchestrator data exists. */
const bOrchestratorsInitialFetched = ref(false);
const bShowNewSessionModal = ref(false);
const bSubmittingSession = ref(false);
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
const bClaudeAvailable = ref(false);
const bCursorAvailable = ref(false);
const bMistralVibeAvailable = ref(false);
const bOpenCodeAvailable = ref(false);
const bCodexAvailable = ref(false);
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
const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const bLongPressTriggered = ref(false);
const pointerStart = ref<{ x: number; y: number } | null>(null);

const orchLongPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const bOrchLongPressTriggered = ref(false);
const orchPointerStart = ref<{ x: number; y: number } | null>(null);

function onItemPointerDown(session: Session, e: PointerEvent): void {
  bLongPressTriggered.value = false;
  pointerStart.value = { x: e.clientX, y: e.clientY };
  longPressTimer.value = setTimeout(() => {
    bLongPressTriggered.value = true;
    if (!selectedIds.value.has(session.id)) {
      toggleSelect(session.id);
    }
    if (navigator.vibrate) navigator.vibrate(30);
  }, 500);
}

function onItemPointerUp(): void {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value);
    longPressTimer.value = null;
  }
}

function onItemPointerMove(e: PointerEvent): void {
  if (longPressTimer.value && pointerStart.value) {
    const dx = e.clientX - pointerStart.value.x;
    const dy = e.clientY - pointerStart.value.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearTimeout(longPressTimer.value);
      longPressTimer.value = null;
    }
  }
}

function toggleSelectOrchestrator(id: string): void {
  const next = new Set(orchestratorSelectedIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  orchestratorSelectedIds.value = next;
}

function onOrchItemPointerDown(orchestrator: Orchestrator, e: PointerEvent): void {
  bOrchLongPressTriggered.value = false;
  orchPointerStart.value = { x: e.clientX, y: e.clientY };
  orchLongPressTimer.value = setTimeout(() => {
    bOrchLongPressTriggered.value = true;
    if (!orchestratorSelectedIds.value.has(orchestrator.id)) {
      toggleSelectOrchestrator(orchestrator.id);
    }
    if (navigator.vibrate) navigator.vibrate(30);
  }, 500);
}

function onOrchItemPointerUp(): void {
  if (orchLongPressTimer.value) {
    clearTimeout(orchLongPressTimer.value);
    orchLongPressTimer.value = null;
  }
}

function onOrchItemPointerMove(e: PointerEvent): void {
  if (orchLongPressTimer.value && orchPointerStart.value) {
    const dx = e.clientX - orchPointerStart.value.x;
    const dy = e.clientY - orchPointerStart.value.y;
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      clearTimeout(orchLongPressTimer.value);
      orchLongPressTimer.value = null;
    }
  }
}

function handleOrchestratorClick(orchestrator: Orchestrator, e: Event): void {
  if (bOrchLongPressTriggered.value) {
    e.preventDefault();
    bOrchLongPressTriggered.value = false;
    return;
  }
  if (orchestratorSelectionActive.value) {
    e.preventDefault();
    e.stopPropagation();
    toggleSelectOrchestrator(orchestrator.id);
  }
}

function handleSessionClick(session: Session, e: Event): void {
  if (bLongPressTriggered.value) {
    e.preventDefault();
    bLongPressTriggered.value = false;
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

const loadAgentCapabilities = async (): Promise<void> => {
  try {
    const { data } = await settingsApi.getAgentCapabilities();
    bClaudeAvailable.value = data.claudeAvailable;
    bCursorAvailable.value = data.cursorAvailable;
    bMistralVibeAvailable.value = data.mistralVibeAvailable;
    bOpenCodeAvailable.value = data.openCodeAvailable;
    bCodexAvailable.value = data.codexAvailable;
  } catch {
    bClaudeAvailable.value = false;
    bCursorAvailable.value = false;
    bMistralVibeAvailable.value = false;
    bOpenCodeAvailable.value = false;
    bCodexAvailable.value = false;
  }
};

const fetchOrchestrators = async (opts?: { silent?: boolean }): Promise<void> => {
  if (!workspaceId.value) return;
  const silent = opts?.silent === true;
  if (!silent) bOrchestratorsLoading.value = true;
  try {
    const { data } = await orchestratorApi.list(workspaceId.value);
    orchestrators.value = data ?? [];
  } catch (error) {
    console.error('Failed to fetch orchestrators:', error);
    orchestrators.value = [];
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
  try {
    const { data: newSession } = await sessionsApi.create(props.workspace.id, payload);
    bShowNewSessionModal.value = false;
    await router.push({
      name: 'session',
      params: { id: props.workspace.id, sessionId: newSession.id }
    });
  } catch (error) {
    console.error('Failed to create session:', error);
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
    orchestrators.value = [newOrchestrator, ...orchestrators.value];
    bShowNewOrchestratorModal.value = false;
    await router.push({
      name: 'orchestrator',
      params: { id: props.workspace.id, orchestratorId: newOrchestrator.id }
    });
  } catch (error) {
    console.error('Failed to create orchestrator:', error);
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
  } catch (error) {
    console.error('Failed to delete session:', error);
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
    orchestrators.value = orchestrators.value.filter(
      (o) => o.id !== orchestratorToDelete.value!.id
    );
    orchestratorToDelete.value = null;
  } catch (error) {
    console.error('Failed to delete orchestrator:', error);
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
      orchestrators.value = orchestrators.value.filter((o) => !orchSet.has(o.id));
      orchestratorSelectedIds.value = new Set();
    }
    bShowBulkDeleteCombined.value = false;
  } catch (error) {
    console.error('Failed to delete selection:', error);
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
  } catch (error) {
    console.error('Failed to update session:', error);
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
  } catch (error) {
    console.error('Failed to toggle archive:', error);
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
  } catch (error) {
    console.error('Failed to toggle orchestrator archive:', error);
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
  } catch (error) {
    console.error('Failed to archive selection:', error);
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
  loadAgentCapabilities();
  fetchOrchestrators();

  // Keep the fixed bar aligned with the list when layout changes.
  window.addEventListener('resize', updateMultiselectBarPosition);
  scheduleUpdateMultiselectBarPosition();
});
onBeforeUnmount(() => {
  if (longPressTimer.value) clearTimeout(longPressTimer.value);
  if (orchLongPressTimer.value) clearTimeout(orchLongPressTimer.value);
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

// Poll orchestrators list while any is running (so list shows run state)
const orchestratorPollId = ref<ReturnType<typeof setInterval> | null>(null);
watch(
  () => orchestrators.value.some((o) => o.runStatus === 'running'),
  (anyRunning) => {
    if (orchestratorPollId.value) {
      clearInterval(orchestratorPollId.value);
      orchestratorPollId.value = null;
    }
    if (anyRunning && props.workspace) {
      orchestratorPollId.value = setInterval(() => {
        fetchOrchestrators({ silent: true });
      }, 3000);
    }
  },
  { immediate: true }
);
onBeforeUnmount(() => {
  if (orchestratorPollId.value) {
    clearInterval(orchestratorPollId.value);
  }
});
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
        <RouterLink
          v-for="(item, index) in combinedItems"
          :key="item.kind === 'session' ? item.session.id : item.orchestrator.id"
          :style="{ '--stagger-index': index }"
          class="group grid-item"
          :to="{
            name: item.kind === 'session' ? 'session' : 'orchestrator',
            params: {
              id: workspaceId,
              sessionId: item.kind === 'session' ? item.session.id : undefined,
              orchestratorId: item.kind === 'orchestrator' ? item.orchestrator.id : undefined
            }
          }"
          @contextmenu.prevent.stop="
            item.kind === 'session'
              ? onSessionContextMenu($event, item.session)
              : onOrchestratorContextMenu($event, item.orchestrator)
          "
        >
          <div class="top">
            <div class="icon">
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
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </div>
            <div class="info">
              <p class="title flex items-center gap-2">
                <span>{{
                  item.kind === 'session' ? item.session.name : item.orchestrator.name
                }}</span>
                <span
                  v-if="item.kind === 'session' && item.session.busy"
                  class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                  title="Session is running"
                >
                  <span class="busy-spinner"></span>
                  Busy
                </span>
              </p>
              <p
                class="tag"
                :class="
                  AGENT_TYPE_COLOR[
                    item.kind === 'session' ? item.session.agentType : item.orchestrator.agentType
                  ]
                "
              >
                {{
                  AGENT_TYPE_TEXT[
                    item.kind === 'session' ? item.session.agentType : item.orchestrator.agentType
                  ]
                }}
              </p>
              <div
                v-if="item.kind === 'session' && item.session.tags?.length"
                class="flex flex-wrap gap-1 mt-2"
              >
                <span
                  v-for="tag in item.session.tags"
                  :key="tag"
                  class="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20 font-medium"
                >
                  {{ tag }}
                </span>
              </div>
            </div>
            <div class="buttons">
              <button
                class="button is-icon"
                @click.prevent.stop="item.kind === 'session' && (sessionToEdit = item.session)"
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
                  <path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6" />
                  <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
                </svg>
              </button>
              <button
                class="button is-icon hover:bg-warning/10! hover:border-warning!"
                @click.prevent.stop="
                  item.kind === 'session'
                    ? toggleArchive(item.session)
                    : toggleArchiveOrchestrator(item.orchestrator)
                "
              >
                <svg
                  v-if="
                    item.kind === 'session' ? item.session.archived : item.orchestrator.archived
                  "
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
                class="button is-icon hover:bg-destructive/10! hover:border-destructive!"
                @click.prevent.stop="showDeleteModal(item)"
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
                  class="text-destructive"
                  aria-hidden="true"
                >
                  <path
                    d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                  />
                </svg>
              </button>
            </div>
          </div>
        </RouterLink>
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
          <RouterLink
            v-if="item.kind === 'session'"
            class="group list-item"
            :to="{
              name: 'session',
              params: { id: workspaceId, sessionId: item.session.id }
            }"
            @pointerdown="onItemPointerDown(item.session, $event)"
            @pointerup="onItemPointerUp"
            @pointerleave="onItemPointerUp"
            @pointercancel="onItemPointerUp"
            @pointermove="onItemPointerMove"
            @click="handleSessionClick(item.session, $event)"
            @contextmenu.prevent.stop="onSessionContextMenu($event, item.session)"
          >
            <div class="cell !flex-none pr-0">
              <button
                type="button"
                class="w-6 h-6 rounded border border-border bg-bg/90 text-primary flex items-center justify-center"
                @click.prevent.stop="toggleSelect(item.session.id)"
                :aria-label="
                  selectedIds.has(item.session.id) ? 'Deselect session' : 'Select session'
                "
              >
                <svg
                  v-if="selectedIds.has(item.session.id)"
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
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
            </div>
            <div class="cell flex-1 min-w-0">
              <p class="title flex items-center gap-2">
                <span>{{ item.session.name }}</span>
                <span
                  v-if="item.session.busy"
                  class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                  title="Session is running"
                >
                  <span class="busy-spinner"></span>
                  Busy
                </span>
              </p>
              <div v-if="item.session.tags?.length" class="flex flex-wrap gap-1 mt-1">
                <span
                  v-for="tag in item.session.tags"
                  :key="tag"
                  class="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20 font-medium"
                >
                  {{ tag }}
                </span>
              </div>
            </div>
            <div class="cell">
              <p class="tag" :class="AGENT_TYPE_COLOR[item.session.agentType]">
                {{ AGENT_TYPE_TEXT[item.session.agentType] }}
              </p>
            </div>
            <div class="cell buttons">
              <button class="button is-icon" @click.prevent.stop="sessionToEdit = item.session">
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
                  <path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6" />
                  <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
                </svg>
              </button>
              <button
                class="button is-icon hover:bg-warning/10! hover:border-warning!"
                @click.prevent.stop="toggleArchive(item.session)"
              >
                <svg
                  v-if="item.session.archived"
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
                class="button is-icon hover:bg-destructive/10! hover:border-destructive!"
                @click.prevent.stop="showDeleteModal(item)"
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
                  class="text-destructive"
                  aria-hidden="true"
                >
                  <path
                    d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                  />
                </svg>
              </button>
            </div>
          </RouterLink>

          <template v-else>
            <RouterLink
              class="group list-item"
              :to="{
                name: 'orchestrator',
                params: { id: workspaceId, orchestratorId: item.orchestrator.id }
              }"
              @pointerdown="onOrchItemPointerDown(item.orchestrator, $event)"
              @pointerup="onOrchItemPointerUp"
              @pointerleave="onOrchItemPointerUp"
              @pointercancel="onOrchItemPointerUp"
              @pointermove="onOrchItemPointerMove"
              @click="handleOrchestratorClick(item.orchestrator, $event)"
              @contextmenu.prevent.stop="onOrchestratorContextMenu($event, item.orchestrator)"
            >
              <div class="cell !flex-none pr-0">
                <button
                  type="button"
                  class="w-6 h-6 rounded border border-border bg-bg/90 text-primary flex items-center justify-center"
                  @click.prevent.stop="toggleSelectOrchestrator(item.orchestrator.id)"
                  :aria-label="
                    orchestratorSelectedIds.has(item.orchestrator.id)
                      ? 'Deselect orchestrator'
                      : 'Select orchestrator'
                  "
                >
                  <svg
                    v-if="orchestratorSelectedIds.has(item.orchestrator.id)"
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
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
              </div>
              <div class="cell flex-1 min-w-0">
                <p class="title flex items-center gap-2">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    width="16"
                    height="16"
                    class="text-text-muted shrink-0"
                    aria-hidden="true"
                  >
                    <path d="M21 3H15v4h6V3zM9 3H3v4h6V3zM15 17H9v4h6v-4z" />
                    <path d="M12 7v4M6 7v6h12V7" />
                  </svg>
                  <span>{{ item.orchestrator.name }}</span>
                  <span
                    v-if="item.orchestrator.runStatus === 'running'"
                    class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                    title="Orchestrator is running"
                  >
                    <span class="busy-spinner"></span>
                    Running
                  </span>
                </p>
              </div>
              <div class="cell">
                <p class="tag" :class="AGENT_TYPE_COLOR[item.orchestrator.agentType]">
                  {{ AGENT_TYPE_TEXT[item.orchestrator.agentType] }}
                </p>
              </div>
              <div class="cell buttons">
                <button class="button is-icon" @click.prevent.stop>
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
                    <path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6" />
                    <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
                  </svg>
                </button>
                <button
                  class="button is-icon hover:bg-warning/10! hover:border-warning!"
                  @click.prevent.stop="toggleArchiveOrchestrator(item.orchestrator)"
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
                    class="text-warning"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"
                    />
                  </svg>
                </button>
                <button
                  class="button is-icon hover:bg-destructive/10! hover:border-destructive!"
                  @click.prevent.stop="showDeleteModal(item)"
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
                    class="text-destructive"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                    />
                  </svg>
                </button>
              </div>
            </RouterLink>

            <RouterLink
              v-for="child in item.nestedSessions"
              :key="child.id"
              class="group list-item bg-fg/[0.02] border-l-2 border-l-primary/25 ml-4 pl-2 !cursor-pointer"
              :to="{
                name: 'session',
                params: { id: workspaceId, sessionId: child.id }
              }"
              @contextmenu.prevent.stop="onSessionContextMenu($event, child)"
            >
              <div class="cell flex-1 min-w-0 flex items-start gap-2">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  width="14"
                  height="14"
                  class="text-text-muted shrink-0 mt-0.5"
                  aria-hidden="true"
                >
                  <path d="M3 9l9 9 9-9" />
                </svg>
                <div class="min-w-0 flex-1">
                  <p class="title flex items-center gap-2 flex-wrap">
                    <span>{{ child.name }}</span>
                    <span
                      v-if="child.busy"
                      class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                      title="Session is running"
                    >
                      <span class="busy-spinner"></span>
                      Busy
                    </span>
                  </p>
                  <div v-if="child.tags?.length" class="flex flex-wrap gap-1 mt-1">
                    <span
                      v-for="tag in child.tags"
                      :key="tag"
                      class="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20 font-medium"
                    >
                      {{ tag }}
                    </span>
                  </div>
                </div>
              </div>
              <div class="cell shrink-0">
                <p class="tag" :class="AGENT_TYPE_COLOR[child.agentType]">
                  {{ AGENT_TYPE_TEXT[child.agentType] }}
                </p>
              </div>
            </RouterLink>
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
              <RouterLink
                v-for="(session, index) in filteredArchivedSessions"
                :key="'arch-' + session.id"
                :style="{ '--stagger-index': index }"
                class="group grid-item opacity-60 hover:opacity-80 transition-opacity"
                :to="{
                  name: 'session',
                  params: { id: workspaceId, sessionId: session.id }
                }"
                @contextmenu.prevent.stop="onSessionContextMenu($event, session)"
              >
                <div class="top">
                  <div class="icon">
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
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                  </div>
                  <div class="info">
                    <p class="title flex items-center gap-2">
                      <span>{{ session.name }}</span>
                      <span
                        v-if="session.busy"
                        class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                        title="Session is running"
                      >
                        <span class="busy-spinner"></span>
                        Busy
                      </span>
                    </p>
                    <p class="tag" :class="AGENT_TYPE_COLOR[session.agentType]">
                      {{ AGENT_TYPE_TEXT[session.agentType] }}
                    </p>
                    <div v-if="session.tags?.length" class="flex flex-wrap gap-1 mt-2">
                      <span
                        v-for="tag in session.tags"
                        :key="tag"
                        class="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20 font-medium"
                      >
                        {{ tag }}
                      </span>
                    </div>
                  </div>
                  <div class="buttons">
                    <button
                      class="button is-icon"
                      @click.prevent.stop="toggleArchive(session)"
                      title="Unarchive"
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
                        class="text-primary"
                        aria-hidden="true"
                      >
                        <path
                          d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"
                        />
                      </svg>
                    </button>
                    <button
                      class="button is-icon hover:bg-destructive/10! hover:border-destructive!"
                      @click.prevent.stop="showDeleteModal({ kind: 'session', session })"
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
                        class="text-destructive"
                        aria-hidden="true"
                      >
                        <path
                          d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </RouterLink>
            </TransitionGroup>

            <template v-if="filteredArchivedOrchestrators.length > 0">
              <p
                v-if="filteredArchivedSessions.length > 0"
                class="text-xs font-medium text-text-muted mt-6 mb-2"
              >
                Orchestrators
              </p>
              <TransitionGroup name="list-stagger" tag="div" class="grid-view-items">
                <RouterLink
                  v-for="(orch, index) in filteredArchivedOrchestrators"
                  :key="'arch-orch-' + orch.id"
                  :style="{ '--stagger-index': index }"
                  class="group grid-item opacity-60 hover:opacity-80 transition-opacity"
                  :to="{
                    name: 'orchestrator',
                    params: { id: workspaceId, orchestratorId: orch.id }
                  }"
                  @contextmenu.prevent.stop="onOrchestratorContextMenu($event, orch)"
                >
                  <div class="top">
                    <div class="icon">
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
                    </div>
                    <div class="info">
                      <p class="title flex items-center gap-2">
                        <span>{{ orch.name }}</span>
                        <span
                          v-if="orch.runStatus === 'running'"
                          class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                          title="Orchestrator is running"
                        >
                          <span class="busy-spinner"></span>
                          Running
                        </span>
                      </p>
                      <p class="tag" :class="AGENT_TYPE_COLOR[orch.agentType]">
                        {{ AGENT_TYPE_TEXT[orch.agentType] }}
                      </p>
                    </div>
                    <div class="buttons">
                      <button
                        class="button is-icon"
                        @click.prevent.stop="toggleArchiveOrchestrator(orch)"
                        title="Unarchive"
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
                          class="text-primary"
                          aria-hidden="true"
                        >
                          <path
                            d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"
                          />
                        </svg>
                      </button>
                      <button
                        class="button is-icon hover:bg-destructive/10! hover:border-destructive!"
                        @click.prevent.stop="
                          showDeleteModal({
                            kind: 'orchestrator',
                            orchestrator: orch,
                            nestedSessions: orderedNestedSessions(orch)
                          })
                        "
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
                          class="text-destructive"
                          aria-hidden="true"
                        >
                          <path
                            d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </RouterLink>
              </TransitionGroup>
            </template>
          </div>

          <div v-else class="list-view" ref="archivedListViewRef">
            <TransitionGroup name="list-stagger" tag="div" class="list-view-items">
              <RouterLink
                v-for="(session, index) in filteredArchivedSessions"
                :key="'arch-' + session.id"
                :style="{ '--stagger-index': index }"
                class="group list-item opacity-60 hover:opacity-80 transition-opacity"
                :to="{
                  name: 'session',
                  params: { id: workspaceId, sessionId: session.id }
                }"
                @contextmenu.prevent.stop="onSessionContextMenu($event, session)"
              >
                <div class="cell !flex-none pr-0">
                  <button
                    type="button"
                    class="w-6 h-6 rounded border border-border bg-bg/90 text-primary flex items-center justify-center"
                    @click.prevent.stop="toggleSelect(session.id)"
                    :aria-label="
                      selectedIds.has(session.id) ? 'Deselect session' : 'Select session'
                    "
                  >
                    <svg
                      v-if="selectedIds.has(session.id)"
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
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </button>
                </div>
                <div class="cell flex-1 min-w-0">
                  <p class="title flex items-center gap-2">
                    <span>{{ session.name }}</span>
                    <span
                      v-if="session.busy"
                      class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                      title="Session is running"
                    >
                      <span class="busy-spinner"></span>
                      Busy
                    </span>
                  </p>
                  <div v-if="session.tags?.length" class="flex flex-wrap gap-1 mt-1">
                    <span
                      v-for="tag in session.tags"
                      :key="tag"
                      class="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20 font-medium"
                    >
                      {{ tag }}
                    </span>
                  </div>
                </div>
                <div class="cell">
                  <p class="tag" :class="AGENT_TYPE_COLOR[session.agentType]">
                    {{ AGENT_TYPE_TEXT[session.agentType] }}
                  </p>
                </div>
                <div class="cell buttons">
                  <button class="button is-icon" @click.prevent.stop="toggleArchive(session)">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      width="14"
                      height="14"
                      class="text-primary"
                      aria-hidden="true"
                    >
                      <path
                        d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"
                      />
                    </svg>
                  </button>
                  <button
                    class="button is-icon hover:bg-destructive/10! hover:border-destructive!"
                    @click.prevent.stop="showDeleteModal({ kind: 'session', session })"
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
                      class="text-destructive"
                      aria-hidden="true"
                    >
                      <path
                        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                      />
                    </svg>
                  </button>
                </div>
              </RouterLink>
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
                  <RouterLink
                    class="group list-item opacity-60 hover:opacity-80 transition-opacity"
                    :to="{
                      name: 'orchestrator',
                      params: { id: workspaceId, orchestratorId: orch.id }
                    }"
                    @contextmenu.prevent.stop="onOrchestratorContextMenu($event, orch)"
                  >
                    <div class="cell !flex-none pr-0">
                      <button
                        type="button"
                        class="w-6 h-6 rounded border border-border bg-bg/90 text-primary flex items-center justify-center"
                        @click.prevent.stop="toggleSelectOrchestrator(orch.id)"
                        :aria-label="
                          orchestratorSelectedIds.has(orch.id)
                            ? 'Deselect orchestrator'
                            : 'Select orchestrator'
                        "
                      >
                        <svg
                          v-if="orchestratorSelectedIds.has(orch.id)"
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
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                    </div>
                    <div class="cell flex-1 min-w-0">
                      <p class="title flex items-center gap-2">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.6"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          width="16"
                          height="16"
                          class="text-text-muted shrink-0"
                          aria-hidden="true"
                        >
                          <path d="M21 3H15v4h6V3zM9 3H3v4h6V3zM15 17H9v4h6v-4z" />
                          <path d="M12 7v4M6 7v6h12V7" />
                        </svg>
                        <span>{{ orch.name }}</span>
                        <span
                          v-if="orch.runStatus === 'running'"
                          class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                          title="Orchestrator is running"
                        >
                          <span class="busy-spinner"></span>
                          Running
                        </span>
                      </p>
                    </div>
                    <div class="cell">
                      <p class="tag" :class="AGENT_TYPE_COLOR[orch.agentType]">
                        {{ AGENT_TYPE_TEXT[orch.agentType] }}
                      </p>
                    </div>
                    <div class="cell buttons">
                      <button
                        class="button is-icon"
                        @click.prevent.stop="toggleArchiveOrchestrator(orch)"
                        title="Unarchive"
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
                          class="text-primary"
                          aria-hidden="true"
                        >
                          <path
                            d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"
                          />
                        </svg>
                      </button>
                      <button
                        class="button is-icon hover:bg-destructive/10! hover:border-destructive!"
                        @click.prevent.stop="
                          showDeleteModal({
                            kind: 'orchestrator',
                            orchestrator: orch,
                            nestedSessions: orderedNestedSessions(orch)
                          })
                        "
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
                          class="text-destructive"
                          aria-hidden="true"
                        >
                          <path
                            d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                          />
                        </svg>
                      </button>
                    </div>
                  </RouterLink>

                  <RouterLink
                    v-for="child in orderedNestedSessions(orch)"
                    :key="'arch-orch-' + orch.id + '-sub-' + child.id"
                    class="group list-item bg-fg/[0.02] border-l-2 border-l-primary/25 ml-4 pl-2 !cursor-pointer opacity-60 hover:opacity-80 transition-opacity"
                    :to="{
                      name: 'session',
                      params: { id: workspaceId, sessionId: child.id }
                    }"
                    @contextmenu.prevent.stop="onSessionContextMenu($event, child)"
                  >
                    <div class="cell flex-1 min-w-0 flex items-start gap-2">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        width="14"
                        height="14"
                        class="text-text-muted shrink-0 mt-0.5"
                        aria-hidden="true"
                      >
                        <path d="M3 9l9 9 9-9" />
                      </svg>
                      <div class="min-w-0 flex-1">
                        <p class="title flex items-center gap-2 flex-wrap">
                          <span>{{ child.name }}</span>
                          <span
                            v-if="child.busy"
                            class="busy-badge text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                            title="Session is running"
                          >
                            <span class="busy-spinner"></span>
                            Busy
                          </span>
                        </p>
                        <div v-if="child.tags?.length" class="flex flex-wrap gap-1 mt-1">
                          <span
                            v-for="tag in child.tags"
                            :key="tag"
                            class="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20 font-medium"
                          >
                            {{ tag }}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div class="cell shrink-0">
                      <p class="tag" :class="AGENT_TYPE_COLOR[child.agentType]">
                        {{ AGENT_TYPE_TEXT[child.agentType] }}
                      </p>
                    </div>
                  </RouterLink>
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

.busy-badge {
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
  animation: busy-glow 2s ease-in-out infinite;
}

@keyframes busy-glow {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 0%, transparent);
  }
  50% {
    box-shadow: 0 0 8px 2px color-mix(in srgb, var(--color-primary) 25%, transparent);
  }
}

.busy-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--color-primary) 30%, transparent);
  border-top-color: var(--color-primary);
  animation: busy-spin 0.8s linear infinite;
}

@keyframes busy-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

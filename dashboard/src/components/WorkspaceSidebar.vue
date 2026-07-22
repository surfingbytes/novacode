<script setup lang="ts">
// node_modules
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

// components
import AgentSessionAvatar from '@/components/AgentSessionAvatar.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import SessionEditModal from '@/components/SessionEditModal.vue';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';

// types
import type { Session, Orchestrator } from '@/@types/index';
import type { ContextMenuItem } from '@/components/ContextMenu.vue';

// utils
import { subtasksFromStoredJson } from '@/utils/orchestratorPayload';
import { formatSessionSidebarPreview, previewFromMessageJson } from '@/utils/sessionListPreview';
import { tagColorClass as categoryColorClass } from '@/utils/tagColors';

// classes
import { orchestratorApi, sessionsApi } from '@/classes/api';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  workspaceId: string;
  activeKind: 'session' | 'orchestrator';
  activeId: string | null;
  showOnMobile?: boolean;
  desktopVisible?: boolean;
  showBackButton?: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'new-session'): void;
  (e: 'close-mobile'): void;
  (e: 'back'): void;
}>();

// -------------------------------------------------- Store --------------------------------------------------

const router = useRouter();
const workspacesStore = useWorkspacesStore();

// -------------------------------------------------- Constants --------------------------------------------------

type CtxTarget =
  | { kind: 'session'; session: Session }
  | { kind: 'orchestrator'; orchestrator: Orchestrator };

type SidebarItem =
  | { kind: 'session'; session: Session }
  | { kind: 'orchestrator'; orchestrator: Orchestrator; nestedSessions: Session[] };

// -------------------------------------------------- Refs --------------------------------------------------

const orchestrators = ref<Orchestrator[]>([]);
const bOrchestratorsLoading = ref<boolean>(false);

const bCtxMenuOpen = ref(false);
const ctxMenuX = ref(0);
const ctxMenuY = ref(0);
const ctxMenuItems = ref<ContextMenuItem[]>([]);
const ctxTarget = ref<CtxTarget | null>(null);

const sessionToEdit = ref<Session | null>(null);
const bSavingSessionEdit = ref(false);
const sessionPendingDelete = ref<Session | null>(null);
const orchestratorPendingDelete = ref<Orchestrator | null>(null);
const bDeletingSession = ref(false);
const bDeletingOrchestrator = ref(false);

// -------------------------------------------------- Computed --------------------------------------------------

/** Session ids that appear as orchestrator step runs (nested under orchestrator, not top-level). */
const sessionsAttachedToOrchestrators = computed(() => {
  const ids = new Set<string>();
  const sessionsById = new Map(workspacesStore.activeSessions.map((s) => [s.id, s]));
  for (const orch of orchestrators.value) {
    const tasks = subtasksFromStoredJson(orch.subtasksJson);
    for (const task of tasks) {
      const sid = task.sessionId ?? null;
      if (!sid || !sessionsById.has(sid)) {
        continue;
      }
      ids.add(sid);
    }
  }
  return ids;
});

const items = computed<SidebarItem[]>(() => {
  const excluded = sessionsAttachedToOrchestrators.value;
  const sessionItems: SidebarItem[] = workspacesStore.activeSessions
    .filter((s) => !excluded.has(s.id))
    .map((s) => ({ kind: 'session' as const, session: s }));

  const orchestratorItems: SidebarItem[] = orchestrators.value
    .filter((o) => !o.archived)
    .map((o) => ({
      kind: 'orchestrator' as const,
      orchestrator: o,
      nestedSessions: orderedNestedSessions(o)
    }));

  const list: SidebarItem[] = [...sessionItems, ...orchestratorItems];
  return list.sort((a, b) => {
    const aUpdated = a.kind === 'session' ? a.session.updatedAt : a.orchestrator.updatedAt;
    const bUpdated = b.kind === 'session' ? b.session.updatedAt : b.orchestrator.updatedAt;
    return new Date(bUpdated).getTime() - new Date(aUpdated).getTime();
  });
});

const bSidebarLoading = computed(
  () => workspacesStore.bSessionsLoading || bOrchestratorsLoading.value
);

const existingSessionTags = computed((): string[] => {
  const workspaceId = props.workspaceId;
  const all = workspacesStore.allSessions.filter((session) => session.workspaceId === workspaceId);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const session of all) {
    const tags = session.tags;
    if (!tags?.length) {
      continue;
    }
    for (const tag of tags) {
      if (typeof tag !== 'string' || !tag.trim()) {
        continue;
      }
      const normalized = tag.trim().toLowerCase();
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      out.push(tag.trim());
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
});

const workspaceNameById = computed(() => {
  return (
    workspacesStore.workspaces.find((workspace) => workspace.id === props.workspaceId)?.name ??
    'Workspace'
  );
});

// -------------------------------------------------- Methods --------------------------------------------------

function orderedNestedSessions(orch: Orchestrator): Session[] {
  const tasks = subtasksFromStoredJson(orch.subtasksJson);
  const sessionsById = new Map(workspacesStore.activeSessions.map((s) => [s.id, s]));
  const out: Session[] = [];
  const seen = new Set<string>();
  for (const task of tasks) {
    const sid = task.sessionId ?? null;
    if (!sid || seen.has(sid)) {
      continue;
    }
    const nestedSession = sessionsById.get(sid);
    if (nestedSession) {
      seen.add(sid);
      out.push(nestedSession);
    }
  }
  return out;
}

function sessionPreviewLine(session: Session): string {
  const fromColumns = formatSessionSidebarPreview(session.lastPreviewText, session.lastPreviewRole);
  if (fromColumns) {
    return fromColumns;
  }
  const fromHistory = previewFromMessageJson(session.messageJson ?? null);
  return fromHistory ? formatSessionSidebarPreview(fromHistory.text, fromHistory.role) : '';
}

function orchestratorPreviewLine(orch: Orchestrator): string {
  const preview = previewFromMessageJson(orch.messageJson);
  return preview ? formatSessionSidebarPreview(preview.text, preview.role) : '';
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(dateStr).toLocaleDateString();
}

async function load(): Promise<void> {
  bOrchestratorsLoading.value = true;
  try {
    const [orchestratorsResponse] = await Promise.all([orchestratorApi.list(props.workspaceId)]);
    orchestrators.value = orchestratorsResponse.data ?? [];
  } catch (error) {
    console.error('Failed to load sidebar data:', error);
    orchestrators.value = [];
  } finally {
    bOrchestratorsLoading.value = false;
  }
}

function open(item: SidebarItem): void {
  if (props.showOnMobile) {
    emit('close-mobile');
  }
  if (item.kind === 'session') {
    if (props.activeKind === 'session' && props.activeId === item.session.id) {
      return;
    }
    router.push({
      name: 'session',
      params: { id: props.workspaceId, sessionId: item.session.id }
    });
    return;
  }
  if (props.activeKind === 'orchestrator' && props.activeId === item.orchestrator.id) {
    return;
  }
  router.push({
    name: 'orchestrator',
    params: { id: props.workspaceId, orchestratorId: item.orchestrator.id }
  });
}

function sessionContextItems(session: Session): ContextMenuItem[] {
  const arch = session.archived;
  return [
    { key: 'open', label: 'Open', icon: 'open_in_new' },
    { key: 'edit', label: 'Edit…', icon: 'edit' },
    { key: 'archive', label: arch ? 'Unarchive' : 'Archive', icon: arch ? 'unarchive' : 'inventory_2' },
    { key: 'delete', label: 'Delete…', icon: 'delete', danger: true }
  ];
}

function orchestratorContextItems(orch: Orchestrator): ContextMenuItem[] {
  const arch = orch.archived === true;
  return [
    { key: 'open', label: 'Open', icon: 'open_in_new' },
    { key: 'archive', label: arch ? 'Unarchive' : 'Archive', icon: arch ? 'unarchive' : 'inventory_2' },
    { key: 'delete', label: 'Delete…', icon: 'delete', danger: true }
  ];
}

function openSessionContextMenu(e: MouseEvent, session: Session): void {
  e.preventDefault();
  ctxTarget.value = { kind: 'session', session };
  ctxMenuItems.value = sessionContextItems(session);
  ctxMenuX.value = e.clientX;
  ctxMenuY.value = e.clientY;
  bCtxMenuOpen.value = true;
}

function openOrchestratorContextMenu(e: MouseEvent, orch: Orchestrator): void {
  e.preventDefault();
  ctxTarget.value = { kind: 'orchestrator', orchestrator: orch };
  ctxMenuItems.value = orchestratorContextItems(orch);
  ctxMenuX.value = e.clientX;
  ctxMenuY.value = e.clientY;
  bCtxMenuOpen.value = true;
}

function onCtxPick(key: string): void {
  const target = ctxTarget.value;
  if (!target) {
    return;
  }

  if (target.kind === 'session') {
    const session = target.session;
    if (key === 'open') {
      open({ kind: 'session', session });
      return;
    }
    if (key === 'edit') {
      sessionToEdit.value = session;
      return;
    }
    if (key === 'archive') {
      void sessionsApi.update(props.workspaceId, session.id, { archived: !session.archived });
      return;
    }
    if (key === 'delete') {
      sessionPendingDelete.value = session;
    }
    return;
  }

  const orchestrator = target.orchestrator;
  if (key === 'open') {
    open({
      kind: 'orchestrator',
      orchestrator,
      nestedSessions: orderedNestedSessions(orchestrator)
    });
    return;
  }
  if (key === 'archive') {
    void orchestratorApi
      .update(props.workspaceId, orchestrator.id, { archived: !(orchestrator.archived === true) })
      .then(({ data: updatedOrchestrator }) => {
        if (updatedOrchestrator) {
          const orchestratorIndex = orchestrators.value.findIndex(
            (orch) => orch.id === orchestrator.id
          );
          if (orchestratorIndex >= 0) {
            orchestrators.value[orchestratorIndex] = updatedOrchestrator;
          }
        }
      })
      .catch((err) => console.error('Failed to archive orchestrator:', err));
    return;
  }
  if (key === 'delete') {
    orchestratorPendingDelete.value = orchestrator;
  }
}

async function saveSessionEdit(payload: { name: string; tags?: string[] | null }): Promise<void> {
  if (!sessionToEdit.value) {
    return;
  }
  bSavingSessionEdit.value = true;
  try {
    await sessionsApi.update(props.workspaceId, sessionToEdit.value.id, payload);
    sessionToEdit.value = null;
  } catch (err) {
    console.error('Failed to update session:', err);
  } finally {
    bSavingSessionEdit.value = false;
  }
}

async function confirmDeleteSession(): Promise<void> {
  if (!sessionPendingDelete.value) {
    return;
  }
  bDeletingSession.value = true;
  try {
    await sessionsApi.remove(props.workspaceId, sessionPendingDelete.value.id);
    sessionPendingDelete.value = null;
  } catch (err) {
    console.error('Failed to delete session:', err);
  } finally {
    bDeletingSession.value = false;
  }
}

async function confirmDeleteOrchestrator(): Promise<void> {
  if (!orchestratorPendingDelete.value) {
    return;
  }
  bDeletingOrchestrator.value = true;
  try {
    await orchestratorApi.remove(props.workspaceId, orchestratorPendingDelete.value.id);
    orchestrators.value = orchestrators.value.filter(
      (orch) => orch.id !== orchestratorPendingDelete.value!.id
    );
    orchestratorPendingDelete.value = null;
  } catch (err) {
    console.error('Failed to delete orchestrator:', err);
  } finally {
    bDeletingOrchestrator.value = false;
  }
}

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  void load();
});

watch(
  () => props.workspaceId,
  (workspaceId) => {
    if (workspaceId) {
      void load();
    }
  }
);
</script>

<template>
  <aside
    class="flex flex-col border-r bg-bg/95 border-border backdrop-blur-sm shrink-0 overflow-hidden transition-[width,opacity,border-color] duration-200 ease-in-out"
    :class="
      props.showOnMobile
        ? 'w-full lg:w-96 xl:w-[26rem]'
        : props.desktopVisible === false
          ? 'hidden lg:flex lg:w-0 lg:opacity-0 lg:border-r-transparent lg:pointer-events-none'
          : 'hidden lg:flex lg:w-96 xl:w-[26rem] lg:opacity-100'
    "
  >
    <div class="h-16 px-4 border-b border-border bg-surface/50 flex items-center gap-2 shrink-0">
      <button
        v-if="props.showBackButton"
        type="button"
        class="inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-muted hover:text-text-primary transition-colors"
        title="Back to sessions"
        @click="emit('back')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <div class="flex flex-col min-w-0">
        <span class="text-sm font-medium text-text-primary truncate"> Sessions </span>
        <span class="text-xs text-text-muted truncate">
          {{ workspaceNameById }}
        </span>
      </div>
      <button
        type="button"
        class="ml-auto inline-flex items-center justify-center w-9 h-9 rounded-lg border border-fg/[0.10] bg-fg/[0.03] text-text-muted hover:text-text-primary hover:bg-fg/[0.06] transition-colors"
        title="New session"
        @click="emit('new-session')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M12 5v14M5 12h14"/></svg>
      </button>
    </div>

    <div class="flex-1 overflow-y-auto px-3 py-3 space-y-2">
      <!-- Loading skeleton -->
      <div v-if="bSidebarLoading" class="space-y-2">
        <div
          v-for="i in 6"
          :key="'sidebar-skel-' + i"
          class="flex items-center gap-3 px-3 py-2 rounded-lg border border-fg/10 bg-fg/[0.02]"
        >
          <div class="w-9 h-9 rounded-full bg-fg/10 animate-pulse shrink-0" />
          <div class="flex-1 space-y-1.5">
            <div class="h-3 rounded bg-fg/10 animate-pulse w-3/4" />
            <div class="h-3 rounded bg-fg/10 animate-pulse w-1/2" />
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else-if="items.length === 0" class="px-2 py-6 text-xs text-text-muted text-center">
        No sessions or orchestrators yet.
      </div>

      <!-- Items -->
      <ul v-else class="space-y-1">
        <li
          v-for="item in items"
          :key="item.kind === 'session' ? item.session.id : item.orchestrator.id"
          class="space-y-0.5"
        >
          <template v-if="item.kind === 'session'">
            <button
              type="button"
              class="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors border"
              :class="[
                activeKind === 'session' && activeId === item.session.id
                  ? 'bg-primary/15 border-primary/40 text-text-primary'
                  : 'border-transparent text-text-muted hover:bg-fg/[0.06] hover:text-text-primary'
              ]"
              @click="open(item)"
              @contextmenu.prevent.stop="openSessionContextMenu($event, item.session)"
            >
              <AgentSessionAvatar :agent-type="item.session.agentType" />

              <div class="flex-1 min-w-0 flex flex-col gap-0.5 pt-0.5">
                <div class="flex items-baseline gap-2 min-w-0">
                  <span class="truncate flex-1 min-w-0 text-sm font-medium text-text-primary">
                    {{ item.session.name || 'Untitled session' }}
                  </span>
                  <span class="text-[11px] text-text-muted shrink-0 whitespace-nowrap tabular-nums">
                    {{ relativeTime(item.session.updatedAt) }}
                  </span>
                </div>
                <p
                  v-if="sessionPreviewLine(item.session)"
                  class="text-xs text-text-muted truncate min-w-0 leading-snug"
                >
                  {{ sessionPreviewLine(item.session) }}
                </p>
                <div
                  v-if="item.session.tags?.length"
                  class="inline-flex flex-wrap items-center gap-1 min-w-0 mt-0.5"
                >
                  <span
                    v-for="tag in item.session.tags"
                    :key="tag"
                    class="px-1.5 py-0.5 rounded-full border text-[11px]"
                    :class="categoryColorClass(tag)"
                  >
                    {{ tag }}
                  </span>
                </div>
              </div>

              <span
                v-if="item.session.busy"
                class="inline-flex items-center gap-1.5 text-[11px] text-primary shrink-0 self-center"
              >
                <span
                  class="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin"
                />
                Busy
              </span>
            </button>
          </template>

          <template v-else>
            <div class="rounded-lg border border-border/60 bg-fg/[0.02] overflow-hidden">
              <button
                type="button"
                class="w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors"
                :class="[
                  activeKind === 'orchestrator' && activeId === item.orchestrator.id
                    ? 'bg-primary/15 text-text-primary'
                    : 'text-text-muted hover:bg-fg/[0.06] hover:text-text-primary'
                ]"
                @click="open(item)"
                @contextmenu.prevent.stop="openOrchestratorContextMenu($event, item.orchestrator)"
              >
                <AgentSessionAvatar :agent-type="item.orchestrator.agentType" />

                <div class="flex-1 min-w-0 flex flex-col gap-0.5 pt-0.5">
                  <div class="flex items-baseline gap-2 min-w-0">
                    <span class="truncate flex-1 min-w-0 text-sm font-medium text-text-primary">
                      {{ item.orchestrator.name || 'Untitled orchestrator' }}
                    </span>
                    <span class="text-[11px] text-text-muted shrink-0 whitespace-nowrap tabular-nums">
                      {{ relativeTime(item.orchestrator.updatedAt) }}
                    </span>
                  </div>
                  <p
                    v-if="orchestratorPreviewLine(item.orchestrator)"
                    class="text-xs text-text-muted truncate min-w-0 leading-snug"
                  >
                    {{ orchestratorPreviewLine(item.orchestrator) }}
                  </p>
                </div>

                <span
                  v-if="item.orchestrator.runStatus === 'running'"
                  class="inline-flex items-center gap-1.5 text-[11px] text-primary shrink-0 self-center"
                >
                  <span
                    class="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin"
                  />
                  Running
                </span>
              </button>

              <ul
                v-if="item.nestedSessions.length > 0"
                class="border-t border-border/50 pl-4 ml-4 mr-2 mb-2 space-y-0.5 border-l border-border/40"
              >
                <li v-for="sub in item.nestedSessions" :key="sub.id">
                  <button
                    type="button"
                    class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors"
                    :class="[
                      activeKind === 'session' && activeId === sub.id
                        ? 'bg-primary/10 text-text-primary'
                        : 'text-text-muted hover:bg-fg/[0.06] hover:text-text-primary'
                    ]"
                    @click.prevent.stop="open({ kind: 'session', session: sub })"
                    @contextmenu.prevent.stop="openSessionContextMenu($event, sub)"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0 text-fg/50"><path d="M3 9l9 9 9-9"/></svg>
                    <span class="truncate flex-1">{{ sub.name || 'Untitled session' }}</span>
                    <span
                      v-if="sub.busy"
                      class="w-2.5 h-2.5 border border-primary/40 border-t-primary rounded-full animate-spin shrink-0"
                    />
                  </button>
                </li>
              </ul>
            </div>
          </template>
        </li>
      </ul>
    </div>
  </aside>

  <ContextMenu
    v-model="bCtxMenuOpen"
    :x="ctxMenuX"
    :y="ctxMenuY"
    :items="ctxMenuItems"
    @pick="onCtxPick"
  />

  <SessionEditModal
    :model-value="sessionToEdit !== null"
    :session="sessionToEdit"
    :loading="bSavingSessionEdit"
    :existing-tags="existingSessionTags"
    @update:model-value="(show) => !show && (sessionToEdit = null)"
    @save="saveSessionEdit"
  />

  <ConfirmModal
    :model-value="sessionPendingDelete !== null"
    title="Delete session"
    :description="`Delete '${sessionPendingDelete?.name ?? ''}'? This cannot be undone.`"
    confirm-label="Delete"
    :loading="bDeletingSession"
    @update:model-value="(show) => !show && (sessionPendingDelete = null)"
    @confirm="confirmDeleteSession"
  />

  <ConfirmModal
    :model-value="orchestratorPendingDelete !== null"
    title="Delete orchestrator"
    :description="`Delete '${orchestratorPendingDelete?.name ?? ''}'? Step sessions from this plan will be removed too. This cannot be undone.`"
    confirm-label="Delete"
    :loading="bDeletingOrchestrator"
    @update:model-value="(show) => !show && (orchestratorPendingDelete = null)"
    @confirm="confirmDeleteOrchestrator"
  />
</template>

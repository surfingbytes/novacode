<script setup lang="ts">
// node_modules
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { MoreHorizontal } from 'lucide-vue-next';

// components
import AgentSessionAvatar from '@/components/AgentSessionAvatar.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import OrchestratorProgressRing from '@/components/OrchestratorProgressRing.vue';
import StatusBadge from '@/components/ui/StatusBadge.vue';
import SessionEditModal from '@/components/SessionEditModal.vue';

import PromptModal from '@/components/PromptModal.vue';

// composables
import { useLongPress } from '@/composables/useLongPress';
import { useOrchestratorActions } from '@/composables/useOrchestratorActions';
import { useSessionListActions } from '@/composables/useSessionListActions';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';
import { useOrchestratorsStore } from '@/stores/orchestrators';

// types
import type { Session, Orchestrator } from '@/@types/index';
import type { ContextMenuItem } from '@/components/ContextMenu.vue';

// utils
import { subtasksFromStoredJson } from '@/utils/orchestratorPayload';
import { orchestratorProgress, type OrchestratorProgress } from '@/utils/orchestratorProgress';
import { relativeTimeShort } from '@/utils/relativeTime';
import { formatSessionSidebarPreview, previewFromMessageJson } from '@/utils/sessionListPreview';
import { isOrchestratorUnread, isSessionUnread } from '@/utils/sessionUnread';
import { sessionBusyLabel, sessionBusyTitle } from '@/utils/sessionBusyLabel';
import { tagColorClass as categoryColorClass } from '@/utils/tagColors';
import { workspaceColor } from '@/utils/workspaceColor';

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
  (e: 'close-desktop'): void;
  (e: 'back'): void;
}>();

// -------------------------------------------------- Store --------------------------------------------------

const router = useRouter();
const route = useRoute();
const workspacesStore = useWorkspacesStore();
const orchestratorsStore = useOrchestratorsStore();

// -------------------------------------------------- Constants --------------------------------------------------

type CtxTarget =
  { kind: 'session'; session: Session } | { kind: 'orchestrator'; orchestrator: Orchestrator };

type SidebarItem =
  | { kind: 'session'; session: Session }
  | { kind: 'orchestrator'; orchestrator: Orchestrator; nestedSessions: Session[] };

// -------------------------------------------------- Refs --------------------------------------------------

const orchestrators = computed<Orchestrator[]>(() =>
  orchestratorsStore.forWorkspace(props.workspaceId)
);
const bOrchestratorsLoading = ref<boolean>(false);

const bCtxMenuOpen = ref(false);
const ctxMenuX = ref(0);
const ctxMenuY = ref(0);
const ctxMenuItems = ref<ContextMenuItem[]>([]);
const ctxTarget = ref<CtxTarget | null>(null);

const sessionActions = useSessionListActions();
const orchestratorActions = useOrchestratorActions();
const { sessionToEdit, sessionPendingDelete } = sessionActions;
const { orchestratorToEdit, orchestratorPendingDelete } = orchestratorActions;

// -------------------------------------------------- Computed --------------------------------------------------

const sessionsById = computed(() => new Map(workspacesStore.allSessions.map((s) => [s.id, s])));
const ringColor = computed(() =>
  workspaceColor(workspacesStore.workspaces.find((w) => w.id === props.workspaceId))
);

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
    const aFav = (a.kind === 'session' ? a.session.isFavorite : a.orchestrator.isFavorite) ? 1 : 0;
    const bFav = (b.kind === 'session' ? b.session.isFavorite : b.orchestrator.isFavorite) ? 1 : 0;
    if (bFav !== aFav) return bFav - aFav;
    // Busy next, matching the nav sidebar's quick list
    const aBusy = itemBusy(a) ? 1 : 0;
    const bBusy = itemBusy(b) ? 1 : 0;
    if (bBusy !== aBusy) return bBusy - aBusy;
    const aUpdated = a.kind === 'session' ? a.session.updatedAt : a.orchestrator.updatedAt;
    const bUpdated = b.kind === 'session' ? b.session.updatedAt : b.orchestrator.updatedAt;
    return new Date(bUpdated).getTime() - new Date(aUpdated).getTime();
  });
});

// Skeleton only while nothing is on screen yet — a background refetch after a
// reconnect must not blank a list the user is looking at.
const bSidebarLoading = computed(
  () =>
    (workspacesStore.bSessionsLoading || bOrchestratorsLoading.value) && items.value.length === 0
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

function itemBusy(item: SidebarItem): boolean {
  return item.kind === 'session' ? !!item.session.busy : item.nestedSessions.some((s) => s.busy);
}

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

function orchestratorRowProgress(orch: Orchestrator): OrchestratorProgress {
  return orchestratorProgress(orch, sessionsById.value);
}

function orchestratorPreviewLine(orch: Orchestrator): string {
  const preview = previewFromMessageJson(orch.messageJson);
  return preview ? formatSessionSidebarPreview(preview.text, preview.role) : '';
}

async function load(): Promise<void> {
  bOrchestratorsLoading.value = true;
  try {
    await orchestratorsStore.ensureFetched(props.workspaceId, true);
  } finally {
    bOrchestratorsLoading.value = false;
  }
}

function open(item: SidebarItem): void {
  if (props.showOnMobile) {
    emit('close-mobile');
  }
  if (item.kind === 'session') {
    if (
      props.activeKind === 'session' &&
      props.activeId === item.session.id &&
      !route.query.tab
    ) {
      return;
    }
    void router.push({
      name: 'session',
      params: { id: props.workspaceId, sessionId: item.session.id }
    });
    return;
  }
  if (props.activeKind === 'orchestrator' && props.activeId === item.orchestrator.id) {
    return;
  }
  void router.push({
    name: 'orchestrator',
    params: { id: props.workspaceId, orchestratorId: item.orchestrator.id }
  });
}

function openCtxMenu(target: CtxTarget, x: number, y: number): void {
  ctxTarget.value = target;
  ctxMenuItems.value =
    target.kind === 'session'
      ? sessionActions.menuItems(target.session)
      : orchestratorActions.menuItems(target.orchestrator);
  ctxMenuX.value = x;
  ctxMenuY.value = y;
  bCtxMenuOpen.value = true;
}

function openSessionContextMenu(e: MouseEvent, session: Session): void {
  e.preventDefault();
  openCtxMenu({ kind: 'session', session }, e.clientX, e.clientY);
}

function openOrchestratorContextMenu(e: MouseEvent, orch: Orchestrator): void {
  e.preventDefault();
  openCtxMenu({ kind: 'orchestrator', orchestrator: orch }, e.clientX, e.clientY);
}

/** '⋯' button: open the row menu anchored below the button's right edge. */
function openCtxMenuFromButton(e: MouseEvent, target: CtxTarget): void {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  openCtxMenu(target, rect.right, rect.bottom);
}

// Long-press opens the same menu at the press point (touch has no right-click)
const rowLongPress = useLongPress<{ target: CtxTarget; x: number; y: number }>(({ target, x, y }) =>
  openCtxMenu(target, x, y)
);

function onRowPointerDown(e: PointerEvent, target: CtxTarget): void {
  rowLongPress.onPointerDown(e, { target, x: e.clientX, y: e.clientY });
}

/** Swallows the click that trails a long-press; returns true when the click should proceed. */
function consumeLongPressClick(): boolean {
  if (rowLongPress.bTriggered.value) {
    rowLongPress.bTriggered.value = false;
    return false;
  }
  return true;
}

function onRowClick(item: SidebarItem): void {
  if (consumeLongPressClick()) {
    open(item);
  }
}

function onCtxPick(key: string): void {
  const target = ctxTarget.value;
  if (!target) {
    return;
  }
  if (key === 'open') {
    // Row navigation: closes the mobile drawer and skips the active item
    open(
      target.kind === 'session'
        ? { kind: 'session', session: target.session }
        : { kind: 'orchestrator', orchestrator: target.orchestrator, nestedSessions: [] }
    );
    return;
  }
  if (target.kind === 'session') {
    sessionActions.pick(target.session, key);
  } else {
    orchestratorActions.pick(target.orchestrator, key);
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
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          class="select-none"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
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
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          class="select-none"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <button
        v-if="!props.showOnMobile"
        type="button"
        class="inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-muted hover:text-text-primary transition-colors"
        title="Hide session list"
        aria-label="Hide session list"
        @click="emit('close-desktop')"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          class="select-none"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
          <path d="M14 9l-3 3 3 3" />
        </svg>
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
            <div
              class="sidebar-row w-full flex items-center rounded-lg transition-colors border"
              :class="[
                activeKind === 'session' && activeId === item.session.id
                  ? 'bg-primary/15 border-primary/40 text-text-primary'
                  : 'border-transparent text-text-muted hover:bg-fg/[0.06] hover:text-text-primary'
              ]"
              @contextmenu.prevent.stop="openSessionContextMenu($event, item.session)"
            >
              <button
                type="button"
                class="sidebar-row-main flex-1 min-w-0 flex items-start gap-3 pl-3 pr-1 py-2.5 text-left"
                @click="onRowClick(item)"
                @pointerdown="onRowPointerDown($event, { kind: 'session', session: item.session })"
                @pointerup="rowLongPress.onPointerUp"
                @pointercancel="rowLongPress.onPointerUp"
                @pointerleave="rowLongPress.onPointerUp"
                @pointermove="rowLongPress.onPointerMove"
              >
                <AgentSessionAvatar :agent-type="item.session.agentType" />

                <div class="flex-1 min-w-0 flex flex-col gap-0.5 pt-0.5">
                  <div class="flex items-baseline gap-2 min-w-0">
                    <span
                      class="truncate flex-1 min-w-0 text-sm font-medium text-text-primary"
                      :title="item.session.name || 'Untitled session'"
                    >
                      {{ item.session.name || 'Untitled session' }}
                    </span>
                    <svg
                      v-if="item.session.isFavorite"
                      class="text-primary shrink-0 self-center"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-label="Favorite"
                      title="Favorite"
                    >
                      <path
                        d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"
                      />
                    </svg>
                    <span
                      class="text-[11px] text-text-muted shrink-0 whitespace-nowrap tabular-nums"
                    >
                      {{ relativeTimeShort(item.session.updatedAt) }}
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
                  :title="sessionBusyTitle(item.session)"
                >
                  <span
                    class="w-3 h-3 border-2 border-primary/40 border-t-primary rounded-full animate-spin"
                  />
                  {{ sessionBusyLabel(item.session) }}
                </span>
                <StatusBadge
                  v-else-if="isSessionUnread(item.session)"
                  kind="done"
                  class="self-center"
                  title="Finished — unread"
                />
              </button>
              <button
                type="button"
                class="sidebar-row-more shrink-0 self-center inline-flex items-center justify-center w-7 h-7 mr-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-fg/[0.08] transition-[opacity,colors]"
                aria-label="More actions"
                title="More actions"
                @click.stop="
                  openCtxMenuFromButton($event, { kind: 'session', session: item.session })
                "
              >
                <MoreHorizontal :size="16" aria-hidden="true" />
              </button>
            </div>
          </template>

          <template v-else>
            <div class="rounded-lg border border-border/60 bg-fg/[0.02] overflow-hidden">
              <div
                class="sidebar-row w-full flex items-center transition-colors"
                :class="[
                  activeKind === 'orchestrator' && activeId === item.orchestrator.id
                    ? 'bg-primary/15 text-text-primary'
                    : 'text-text-muted hover:bg-fg/[0.06] hover:text-text-primary'
                ]"
                @contextmenu.prevent.stop="openOrchestratorContextMenu($event, item.orchestrator)"
              >
                <button
                  type="button"
                  class="sidebar-row-main flex-1 min-w-0 flex items-start gap-3 pl-3 pr-1 py-2.5 text-left"
                  @click="onRowClick(item)"
                  @pointerdown="
                    onRowPointerDown($event, {
                      kind: 'orchestrator',
                      orchestrator: item.orchestrator
                    })
                  "
                  @pointerup="rowLongPress.onPointerUp"
                  @pointercancel="rowLongPress.onPointerUp"
                  @pointerleave="rowLongPress.onPointerUp"
                  @pointermove="rowLongPress.onPointerMove"
                >
                  <AgentSessionAvatar :agent-type="item.orchestrator.agentType" />

                  <div class="flex-1 min-w-0 flex flex-col gap-0.5 pt-0.5">
                    <div class="flex items-baseline gap-2 min-w-0">
                      <span
                        class="truncate flex-1 min-w-0 text-sm font-medium text-text-primary"
                        :title="item.orchestrator.name || 'Untitled orchestrator'"
                      >
                        {{ item.orchestrator.name || 'Untitled orchestrator' }}
                      </span>
                      <svg
                        v-if="item.orchestrator.isFavorite"
                        class="text-primary shrink-0 self-center"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-label="Favorite"
                        title="Favorite"
                      >
                        <path
                          d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z"
                        />
                      </svg>
                      <span
                        class="text-[11px] text-text-muted shrink-0 whitespace-nowrap tabular-nums"
                      >
                        {{ relativeTimeShort(item.orchestrator.updatedAt) }}
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
                    v-if="orchestratorRowProgress(item.orchestrator).bRunning"
                    class="inline-flex items-center gap-1.5 text-[11px] text-primary shrink-0 self-center tabular-nums"
                  >
                    <OrchestratorProgressRing
                      :progress="orchestratorRowProgress(item.orchestrator)"
                      :color="ringColor"
                    />
                    {{ orchestratorRowProgress(item.orchestrator).done }}/{{
                      orchestratorRowProgress(item.orchestrator).total
                    }}
                  </span>
                  <StatusBadge
                    v-else-if="isOrchestratorUnread(item.orchestrator)"
                    kind="done"
                    class="self-center"
                    title="Finished — unread"
                  />
                </button>
                <button
                  type="button"
                  class="sidebar-row-more shrink-0 self-center inline-flex items-center justify-center w-7 h-7 mr-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-fg/[0.08] transition-[opacity,colors]"
                  aria-label="More actions"
                  title="More actions"
                  @click.stop="
                    openCtxMenuFromButton($event, {
                      kind: 'orchestrator',
                      orchestrator: item.orchestrator
                    })
                  "
                >
                  <MoreHorizontal :size="16" aria-hidden="true" />
                </button>
              </div>

              <ul
                v-if="item.nestedSessions.length > 0"
                class="border-t border-border/50 pl-4 ml-4 mr-2 mb-2 space-y-0.5 border-l border-border/40"
              >
                <li v-for="sub in item.nestedSessions" :key="sub.id">
                  <div
                    class="sidebar-row w-full flex items-center rounded-md text-xs transition-colors"
                    :class="[
                      activeKind === 'session' && activeId === sub.id
                        ? 'bg-primary/10 text-text-primary'
                        : 'text-text-muted hover:bg-fg/[0.06] hover:text-text-primary'
                    ]"
                    @contextmenu.prevent.stop="openSessionContextMenu($event, sub)"
                  >
                    <button
                      type="button"
                      class="sidebar-row-main flex-1 min-w-0 flex items-center gap-2 pl-2 pr-1 py-1.5 text-left"
                      @click.prevent.stop="onRowClick({ kind: 'session', session: sub })"
                      @pointerdown="onRowPointerDown($event, { kind: 'session', session: sub })"
                      @pointerup="rowLongPress.onPointerUp"
                      @pointercancel="rowLongPress.onPointerUp"
                      @pointerleave="rowLongPress.onPointerUp"
                      @pointermove="rowLongPress.onPointerMove"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                        class="shrink-0 text-fg/50"
                      >
                        <path d="M3 9l9 9 9-9" />
                      </svg>
                      <span class="truncate flex-1" :title="sub.name || 'Untitled session'">
                        {{ sub.name || 'Untitled session' }}
                      </span>
                      <span
                        v-if="sub.busy"
                        class="w-2.5 h-2.5 border border-primary/40 border-t-primary rounded-full animate-spin shrink-0"
                      />
                    </button>
                    <button
                      type="button"
                      class="sidebar-row-more shrink-0 inline-flex items-center justify-center w-6 h-6 mr-1 rounded-md text-text-muted hover:text-text-primary hover:bg-fg/[0.08] transition-[opacity,colors]"
                      aria-label="More actions"
                      title="More actions"
                      @click.stop="openCtxMenuFromButton($event, { kind: 'session', session: sub })"
                    >
                      <MoreHorizontal :size="14" aria-hidden="true" />
                    </button>
                  </div>
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
    :loading="sessionActions.bSavingEdit.value"
    :existing-tags="existingSessionTags"
    @update:model-value="(show) => !show && (sessionToEdit = null)"
    @save="sessionActions.saveEdit"
  />

  <PromptModal
    :model-value="orchestratorToEdit !== null"
    title="Edit orchestrator name"
    label="Name"
    :initial-value="orchestratorToEdit?.name ?? ''"
    confirm-label="Save"
    :loading="orchestratorActions.bSavingEdit.value"
    @update:model-value="(show) => !show && (orchestratorToEdit = null)"
    @confirm="orchestratorActions.saveEdit"
  />

  <ConfirmModal
    :model-value="sessionPendingDelete !== null"
    title="Delete session"
    :description="`Delete '${sessionPendingDelete?.name ?? ''}'? This cannot be undone.`"
    confirm-label="Delete"
    :loading="sessionActions.bDeleting.value"
    @update:model-value="(show) => !show && (sessionPendingDelete = null)"
    @confirm="sessionActions.confirmRemove"
  />

  <ConfirmModal
    :model-value="orchestratorPendingDelete !== null"
    title="Delete orchestrator"
    :description="`Delete '${orchestratorPendingDelete?.name ?? ''}'? Step sessions from this plan will be removed too. This cannot be undone.`"
    confirm-label="Delete"
    :loading="orchestratorActions.bDeleting.value"
    @update:model-value="(show) => !show && (orchestratorPendingDelete = null)"
    @confirm="orchestratorActions.confirmRemove"
  />
</template>

<style scoped>
/* Row '⋯' button: revealed on hover / keyboard focus; always visible on touch-only devices */
.sidebar-row-more {
  opacity: 0;
}

.sidebar-row:hover .sidebar-row-more,
.sidebar-row:focus-within .sidebar-row-more {
  opacity: 1;
}

@media (hover: none) {
  .sidebar-row-more {
    opacity: 1;
  }
}

/* Long-press opens the row menu; suppress the iOS link/selection callout */
.sidebar-row-main {
  -webkit-touch-callout: none;
  user-select: none;
}
</style>

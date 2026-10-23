<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useWorkspacesStore } from '@/stores/workspaces';
import { useToastStore } from '@/stores/toasts';
import { useOrchestratorsStore } from '@/stores/orchestrators';
import ThemeToggleButton from '@/components/ThemeToggleButton.vue';
import NewSessionModal from '@/components/NewSessionModal.vue';
import OrchestratorProgressRing from '@/components/OrchestratorProgressRing.vue';
import { apiErrorMessage, sessionsApi } from '@/classes/api';
import { createPlanningSession, type NewOrchestratorOptions } from '@/lib/createPlanningSession';
import { useAgentCapabilities } from '@/composables/useAgentCapabilities';
import { PANE_LAYOUT_MIN_WIDTH } from '@/constants/layout';
import { agentTypeShortLabel } from '@/utils/agentTypeMeta';
import {
  sessionFavoriteStarStyle,
  sessionStatusDotStyle,
  sessionUnreadDoneStyle,
  workspaceColor
} from '@/utils/workspaceColor';
import { isOrchestratorUnread, isSessionUnread } from '@/utils/sessionUnread';
import { orchestratorProgress, type OrchestratorProgress } from '@/utils/orchestratorProgress';
import type { AgentType, ApprovalPolicy, Orchestrator, Session, Workspace } from '@/@types/index';

const props = withDefaults(
  defineProps<{
    isOpen?: boolean;
    collapsed?: boolean;
  }>(),
  { isOpen: false, collapsed: false }
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'search'): void;
  (e: 'toggle-collapsed'): void;
}>();

const route = useRoute();
const router = useRouter();
const workspacesStore = useWorkspacesStore();
const toastStore = useToastStore();
const orchestratorsStore = useOrchestratorsStore();
const {
  claudeAvailable,
  cursorAvailable,
  mistralVibeAvailable,
  openCodeAvailable,
  codexAvailable,
  bCapabilitiesLoaded,
  ensureLoaded: ensureAgentCapabilitiesLoaded
} = useAgentCapabilities();

const windowWidth = ref(window.innerWidth);
/** Persistent nav rail (foldable / tablet+), vs phone drawer. */
const bRailMode = computed(() => windowWidth.value >= PANE_LAYOUT_MIN_WIDTH);
const bIsCollapsed = computed(() => props.collapsed && bRailMode.value);

const bShowNewSessionModal = ref(false);
const newSessionWorkspace = ref<Workspace | undefined>(undefined);
const bSubmittingSession = ref(false);
const createSessionError = ref<string | null>(null);

function onWindowResize(): void {
  windowWidth.value = window.innerWidth;
}

function handleClose(): void {
  emit('close');
}

function handleBrandClick(event: MouseEvent): void {
  // Collapsed rail: logo expands the sidebar (Workspaces is the nav item below).
  if (bIsCollapsed.value) {
    event.preventDefault();
    emit('toggle-collapsed');
    return;
  }
  if (!bRailMode.value && props.isOpen) {
    if (route.path === '/') {
      event.preventDefault();
    }
    handleClose();
    return;
  }
  if (!bRailMode.value) {
    handleClose();
  }
}

const navItems = [
  {
    id: 'workspaces',
    label: 'Workspaces',
    to: { name: 'workspaces' },
    svgPath: 'M3 7a2 2 0 012-2h3.5l2 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z'
  },
  {
    id: 'automations',
    label: 'Automations',
    to: '/automations',
    svgPath: 'M12 7v5l3 2 M12 21a9 9 0 100-18 9 9 0 000 18z'
  }
];

const favoriteWorkspaces = computed(() => workspacesStore.favoriteWorkspaces);

type NavItem =
  | { kind: 'session'; session: Session }
  | { kind: 'orchestrator'; orchestrator: Orchestrator; progress: OrchestratorProgress };

const navItems10 = computed<NavItem[]>(() => {
  const byUpdatedDesc = (a: NavItem, b: NavItem) =>
    new Date(navItemUpdatedAt(b)).getTime() - new Date(navItemUpdatedAt(a)).getTime();
  const sessionsById = new Map(workspacesStore.allSessions.map((s) => [s.id, s]));
  // Step sessions are represented by their orchestrator row.
  const stepIds = orchestratorsStore.stepSessionIds;
  const sessionItems: NavItem[] = workspacesStore.allSessions
    .filter((s) => !s.archived && !stepIds.has(s.id))
    .map((session) => ({ kind: 'session', session }));
  const orchestratorItems: NavItem[] = Object.values(orchestratorsStore.orchestratorsByWorkspace)
    .flat()
    .filter((o) => !o.archived)
    .map((orchestrator) => ({
      kind: 'orchestrator',
      orchestrator,
      progress: orchestratorProgress(orchestrator, sessionsById)
    }));
  const all = [...sessionItems, ...orchestratorItems];
  const favorites = all.filter(isNavItemFavorite).sort(byUpdatedDesc);
  const busyRest = all.filter((i) => !isNavItemFavorite(i) && isNavItemBusy(i)).sort(byUpdatedDesc);
  const recentRest = all.filter((i) => !isNavItemFavorite(i) && !isNavItemBusy(i)).sort(byUpdatedDesc);
  return [...favorites, ...busyRest, ...recentRest].slice(0, 10);
});

function navItemUpdatedAt(item: NavItem): string {
  return item.kind === 'session' ? item.session.updatedAt : item.orchestrator.updatedAt;
}

function isNavItemFavorite(item: NavItem): boolean {
  return !!(item.kind === 'session' ? item.session.isFavorite : item.orchestrator.isFavorite);
}

function isOrchestratorDone(item: NavItem & { kind: 'orchestrator' }): boolean {
  return isOrchestratorUnread(item.orchestrator) && !item.progress.bRunning;
}

function isNavItemBusy(item: NavItem): boolean {
  return item.kind === 'session' ? !!item.session.busy : item.progress.bRunning;
}

const newSessionTags = computed((): string[] => {
  const workspaceId = newSessionWorkspace.value?.id;
  if (!workspaceId) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const session of workspacesStore.allSessions) {
    if (session.workspaceId !== workspaceId) continue;
    const tags = session.tags;
    if (!tags?.length) continue;
    for (const tag of tags) {
      if (typeof tag !== 'string' || !tag.trim()) continue;
      const key = tag.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag.trim());
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
});

function workspaceById(id: string): Workspace | undefined {
  return workspacesStore.workspaces.find((w) => w.id === id);
}

function workspaceNameById(id: string): string {
  return workspaceById(id)?.name ?? 'Workspace';
}

function favoriteInitial(workspace: Workspace): string {
  const trimmed = workspace.name.trim();
  if (!trimmed) {
    return '?';
  }
  return trimmed.charAt(0).toLocaleUpperCase();
}

function openFavoriteNewSession(workspace: Workspace): void {
  newSessionWorkspace.value = workspace;
  createSessionError.value = null;
  ensureAgentCapabilitiesLoaded();
  bShowNewSessionModal.value = true;
  handleClose();
}

async function createSession(payload: {
  name: string;
  tags?: string[] | null;
  agentType: AgentType;
  modelSelection?: string | null;
  approvalPolicy: ApprovalPolicy;
  orchestrator?: NewOrchestratorOptions;
}): Promise<void> {
  const workspace = newSessionWorkspace.value;
  if (!workspace || bSubmittingSession.value) return;
  bSubmittingSession.value = true;
  createSessionError.value = null;
  try {
    const { orchestrator, ...sessionPayload } = payload;
    const sessionId = orchestrator
      ? await createPlanningSession(workspace.id, { ...payload, orchestrator })
      : (await sessionsApi.create(workspace.id, sessionPayload)).data.id;
    bShowNewSessionModal.value = false;
    newSessionWorkspace.value = undefined;
    await router.push({
      name: 'session',
      params: { id: workspace.id, sessionId }
    });
  } catch (error) {
    createSessionError.value = apiErrorMessage(error, 'Failed to create session');
    toastStore.error(createSessionError.value);
  } finally {
    bSubmittingSession.value = false;
  }
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize);
  ensureAgentCapabilitiesLoaded();
  void workspacesStore.ensureWorkspacesInitialized();
  void workspacesStore.ensureSessionsInitialized();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize);
});
</script>

<template>
  <!-- Phone drawer backdrop -->
  <div
    v-if="isOpen"
    class="pane:hidden fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm transition-opacity duration-200"
    aria-hidden="true"
    @click="handleClose"
  />

  <aside
    class="sidebar flex flex-col fixed pane:relative inset-y-0 left-0 z-[70] transition-all duration-200 ease-out"
    :class="[
      isOpen || bRailMode ? 'translate-x-0' : '-translate-x-full',
      bIsCollapsed ? 'sidebar--collapsed' : 'sidebar--expanded'
    ]"
    aria-label="Main navigation"
  >
    <!-- Brand -->
    <div class="sidebar__brand">
      <RouterLink
        to="/"
        class="sidebar__logo-link"
        :title="bIsCollapsed ? 'Expand sidebar' : undefined"
        :aria-label="bIsCollapsed ? 'Expand sidebar' : 'Nova Code workspaces'"
        @click="handleBrandClick"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          class="sidebar__logo-mark"
          aria-hidden="true"
        >
          <rect
            x="1.5"
            y="1.5"
            width="21"
            height="21"
            rx="5"
            stroke="var(--accent)"
            stroke-width="1.4"
            fill="var(--accent-soft)"
          />
          <path
            d="M9 8l-3 4 3 4 M15 8l3 4-3 4"
            stroke="var(--accent)"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span v-if="!bIsCollapsed" class="sidebar__wordmark">Nova Code</span>
      </RouterLink>
      <button
        v-if="bRailMode && !bIsCollapsed"
        type="button"
        class="sidebar__collapse-toggle"
        aria-label="Collapse sidebar"
        title="Collapse sidebar"
        @click="emit('toggle-collapsed')"
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
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
        </svg>
      </button>
      <button
        v-else-if="!bRailMode"
        type="button"
        class="sidebar__close pane:hidden"
        aria-label="Close menu"
        @click="handleClose"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12 M18 6L6 18" />
        </svg>
      </button>
    </div>

    <!-- Primary nav -->
    <nav class="sidebar__nav">
      <RouterLink
        v-for="item in navItems"
        :key="item.id"
        :to="item.to"
        class="sidebar__nav-item"
        active-class="sidebar__nav-item--active"
        :title="bIsCollapsed ? item.label : undefined"
        @click="handleClose"
      >
        <span class="sidebar__nav-bar" aria-hidden="true" />
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="sidebar__nav-icon"
          aria-hidden="true"
        >
          <path :d="item.svgPath" />
        </svg>
        <span v-if="!bIsCollapsed" class="sidebar__nav-label">{{ item.label }}</span>
      </RouterLink>
    </nav>

    <!-- Favorite workspaces — quick new session -->
    <div
      v-if="favoriteWorkspaces.length > 0"
      class="sidebar__favorites"
      :class="{ 'sidebar__favorites--collapsed': bIsCollapsed }"
    >
      <button
        v-for="workspace in favoriteWorkspaces"
        :key="'fav-' + workspace.id"
        type="button"
        class="sidebar__fav-btn"
        :style="{
          color: workspaceColor(workspace),
          background: `color-mix(in oklab, ${workspaceColor(workspace)} 18%, transparent)`,
          borderColor: `color-mix(in oklab, ${workspaceColor(workspace)} 40%, transparent)`
        }"
        :title="`New session in ${workspace.name}`"
        :aria-label="`New session in ${workspace.name}`"
        @click="openFavoriteNewSession(workspace)"
      >
        {{ favoriteInitial(workspace) }}
      </button>
    </div>

    <!-- Sessions section -->
    <div v-if="!bIsCollapsed" class="sidebar__section-label nc-eyebrow">// sessions</div>

    <div class="sidebar__sessions">
      <div v-if="navItems10.length === 0" class="sidebar__sessions-empty">
        <template v-if="!bIsCollapsed">No active sessions</template>
      </div>

      <template v-for="item in navItems10" :key="item.kind === 'session' ? 'nav-' + item.session.id : 'nav-orch-' + item.orchestrator.id">
        <RouterLink
          v-if="item.kind === 'session'"
          :to="{ name: 'session', params: { id: item.session.workspaceId, sessionId: item.session.id } }"
          class="sidebar__session-item nc-row-hover"
          :class="{ 'sidebar__session-item--unread': isSessionUnread(item.session) && !item.session.busy }"
          active-class="sidebar__session-item--active"
          :title="
            isSessionUnread(item.session) && !item.session.busy
              ? `${item.session.name || 'Untitled'} — finished, unread`
              : bIsCollapsed
                ? item.session.name
                : undefined
          "
          @click="handleClose"
        >
          <svg
            v-if="item.session.isFavorite"
            class="sidebar__session-star"
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
            :style="sessionFavoriteStarStyle(workspaceById(item.session.workspaceId), item.session.busy)"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
          </svg>
          <svg
            v-else-if="bIsCollapsed && isSessionUnread(item.session) && !item.session.busy"
            class="sidebar__session-done-icon"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            :style="{ color: workspaceColor(workspaceById(item.session.workspaceId)) }"
          >
            <path d="M5 12l5 5L20 7" />
          </svg>
          <span
            v-else
            class="nc-status-dot"
            :style="sessionStatusDotStyle(workspaceById(item.session.workspaceId), item.session.busy)"
          />
          <template v-if="!bIsCollapsed">
            <div class="sidebar__session-info">
              <div class="sidebar__session-name-row">
                <div class="sidebar__session-name">
                  {{ item.session.name || 'Untitled' }}
                </div>
                <span
                  v-if="isSessionUnread(item.session) && !item.session.busy"
                  class="sidebar__session-done"
                  title="Finished — unread"
                  :style="sessionUnreadDoneStyle(workspaceById(item.session.workspaceId))"
                >
                  Done
                </span>
              </div>
              <div class="sidebar__session-path nc-mono">
                <span :style="{ color: workspaceColor(workspaceById(item.session.workspaceId)) }">{{
                  workspaceNameById(item.session.workspaceId)
                }}</span>
                <template v-if="item.session.agentType"> · {{ agentTypeShortLabel(item.session.agentType) }}</template>
              </div>
            </div>
          </template>
        </RouterLink>

        <RouterLink
          v-else
          :to="{ name: 'orchestrator', params: { id: item.orchestrator.workspaceId, orchestratorId: item.orchestrator.id } }"
          class="sidebar__session-item nc-row-hover"
          :class="{ 'sidebar__session-item--unread': isOrchestratorDone(item) }"
          active-class="sidebar__session-item--active"
          :title="
            isOrchestratorDone(item)
              ? `${item.orchestrator.name || 'Untitled orchestrator'} — finished, unread`
              : bIsCollapsed
                ? item.orchestrator.name || 'Untitled orchestrator'
                : undefined
          "
          @click="handleClose"
        >
          <!-- Running shows progress even when starred; finished favorites get the star. -->
          <svg
            v-if="item.orchestrator.isFavorite && !item.progress.bRunning"
            class="sidebar__session-star"
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
            :style="sessionFavoriteStarStyle(workspaceById(item.orchestrator.workspaceId), false)"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
          </svg>
          <svg
            v-else-if="bIsCollapsed && isOrchestratorDone(item)"
            class="sidebar__session-done-icon"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            :style="{ color: workspaceColor(workspaceById(item.orchestrator.workspaceId)) }"
          >
            <path d="M5 12l5 5L20 7" />
          </svg>
          <OrchestratorProgressRing
            v-else
            :progress="item.progress"
            :color="workspaceColor(workspaceById(item.orchestrator.workspaceId))"
          />
          <template v-if="!bIsCollapsed">
            <div class="sidebar__session-info">
              <div class="sidebar__session-name-row">
                <div class="sidebar__session-name">
                  {{ item.orchestrator.name || 'Untitled orchestrator' }}
                </div>
                <span
                  v-if="item.progress.waiting > 0"
                  class="sidebar__session-done sidebar__session-input"
                  title="A step waits for your answer"
                >
                  Input
                </span>
                <span
                  v-else-if="isOrchestratorDone(item)"
                  class="sidebar__session-done"
                  title="Finished — unread"
                  :style="sessionUnreadDoneStyle(workspaceById(item.orchestrator.workspaceId))"
                >
                  Done
                </span>
              </div>
              <div class="sidebar__session-path nc-mono">
                <span :style="{ color: workspaceColor(workspaceById(item.orchestrator.workspaceId)) }">{{
                  workspaceNameById(item.orchestrator.workspaceId)
                }}</span>
                · {{ item.progress.done }}/{{ item.progress.total }} steps
              </div>
            </div>
          </template>
        </RouterLink>
      </template>
    </div>

    <!-- Settings + Account + theme pinned -->
    <div class="sidebar__footer">
      <div class="sidebar__footer-row">
        <RouterLink
          to="/settings"
          class="sidebar__nav-item sidebar__footer-link"
          active-class="sidebar__nav-item--active"
          :title="bIsCollapsed ? 'Settings' : undefined"
          @click="handleClose"
        >
          <span class="sidebar__nav-bar" aria-hidden="true" />
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="sidebar__nav-icon"
            aria-hidden="true"
          >
            <path
              d="M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6 1.65 1.65 0 0010 3.09V3a2 2 0 014 0v.09c0 .67.4 1.27 1 1.51a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06c-.45.45-.58 1.15-.33 1.82.24.6.84 1 1.51 1H21a2 2 0 110 4h-.09c-.67 0-1.27.4-1.51 1z"
            />
          </svg>
          <span v-if="!bIsCollapsed" class="sidebar__nav-label">Settings</span>
        </RouterLink>

        <!-- Mobile only: top bar is hidden on full-height routes -->
        <div class="sidebar__footer-mobile">
          <RouterLink
            to="/account"
            class="sidebar__nav-item sidebar__footer-icon-link"
            active-class="sidebar__nav-item--active"
            title="Account"
            aria-label="Account"
            @click="handleClose"
          >
            <span class="sidebar__nav-bar" aria-hidden="true" />
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="sidebar__nav-icon"
              aria-hidden="true"
            >
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </RouterLink>

          <ThemeToggleButton compact class="sidebar__footer-theme" />
        </div>
      </div>
    </div>
  </aside>

  <NewSessionModal
    v-model="bShowNewSessionModal"
    :loading="bSubmittingSession"
    :error="createSessionError"
    :default-agent-type="newSessionWorkspace?.defaultAgentType ?? null"
    :claude-available="claudeAvailable"
    :cursor-available="cursorAvailable"
    :mistral-vibe-available="mistralVibeAvailable"
    :open-code-available="openCodeAvailable"
    :codex-available="codexAvailable"
    :agents-loaded="bCapabilitiesLoaded"
    :existing-tags="newSessionTags"
    allow-orchestrator
    @create="createSession"
  />
</template>

<style scoped>
@reference "tailwindcss";

.sidebar {
  width: 232px;
  background: var(--bg);
  border-right: 1px solid var(--line);
  height: 100%;
  overflow: hidden;
}

.sidebar--collapsed {
  width: 56px;
}

.sidebar--expanded {
  width: 232px;
}

/* Brand */
.sidebar__brand {
  height: 56px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  position: relative;
}

.sidebar__logo-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 17px;
  text-decoration: none;
  width: 100%;
  height: 100%;
}

.sidebar--collapsed .sidebar__logo-link {
  justify-content: center;
  padding: 0;
}

.sidebar__wordmark {
  font-weight: 600;
  font-size: 14.5px;
  letter-spacing: -0.01em;
  color: var(--fg);
  white-space: nowrap;
}

.sidebar__close,
.sidebar__collapse-toggle {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition:
    background 0.1s,
    color 0.1s;
}

.sidebar__close:hover,
.sidebar__collapse-toggle:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

/* Primary nav */
.sidebar__nav {
  padding: 4px 10px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex-shrink: 0;
}

.sidebar--collapsed .sidebar__nav {
  padding: 4px 8px;
}

.sidebar__nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 10px;
  border-radius: 6px;
  color: var(--fg-muted);
  font-size: 13.5px;
  font-weight: 400;
  text-decoration: none;
  position: relative;
  transition:
    background 0.1s,
    color 0.1s;
  white-space: nowrap;
  overflow: hidden;
}

.sidebar--collapsed .sidebar__nav-item {
  padding: 0;
  justify-content: center;
}

.sidebar__nav-item:hover {
  color: var(--fg);
  background: var(--bg-hover);
}

.sidebar__nav-item--active {
  color: var(--fg);
  background: var(--bg-elev);
  font-weight: 500;
}

.sidebar__nav-bar {
  display: none;
  position: absolute;
  left: -10px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: var(--accent);
  border-radius: 2px;
}

.sidebar__nav-item--active .sidebar__nav-bar {
  display: block;
}

.sidebar--collapsed .sidebar__nav-bar {
  left: 0;
  border-radius: 0 2px 2px 0;
}

.sidebar__nav-icon {
  flex-shrink: 0;
}

.sidebar__nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Favorites */
.sidebar__favorites {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  padding: 10px 14px 2px;
  flex-shrink: 0;
  overflow: hidden;
}

.sidebar__favorites--collapsed {
  flex-direction: column;
  padding: 8px;
  gap: 6px;
}

.sidebar__fav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 7px;
  border: 1px solid transparent;
  cursor: pointer;
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1;
  transition:
    background 0.12s,
    border-color 0.12s,
    transform 0.1s;
}

.sidebar__fav-btn:hover {
  transform: translateY(-1px);
  background: color-mix(in oklab, currentColor 28%, transparent) !important;
  border-color: color-mix(in oklab, currentColor 55%, transparent) !important;
}

.sidebar__fav-btn:active {
  transform: translateY(0);
}

/* Sessions */
.sidebar__section-label {
  padding: 18px 18px 6px;
  margin-top: 10px;
  flex-shrink: 0;
}

.sidebar__favorites + .sidebar__section-label {
  margin-top: 4px;
  padding-top: 10px;
}

.sidebar__sessions {
  flex: 1;
  overflow-y: auto;
  padding: 4px 10px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

.sidebar--collapsed .sidebar__sessions {
  padding: 4px 8px;
}

.sidebar__sessions-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--fg-faint);
}

.sidebar__session-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 10px;
  border-radius: 6px;
  text-decoration: none;
  color: var(--fg-muted);
  position: relative;
  transition: background 0.1s;
  overflow: hidden;
}

.sidebar--collapsed .sidebar__session-item {
  padding: 0;
  height: 32px;
  justify-content: center;
}

.sidebar__session-item:hover {
  background: var(--bg-hover);
}

.sidebar__session-item--active {
  background: var(--bg-elev);
}

.sidebar__session-info {
  flex: 1;
  min-width: 0;
}

.sidebar__session-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.sidebar__session-name {
  font-size: 13px;
  color: var(--fg);
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.sidebar__session-star {
  flex-shrink: 0;
}

.sidebar__session-done {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 1px 6px;
  line-height: 1.35;
}

.sidebar__session-input {
  color: var(--warn);
  border-color: color-mix(in oklab, var(--warn) 40%, transparent);
  background: color-mix(in oklab, var(--warn) 14%, transparent);
}

.sidebar__session-done-icon {
  flex-shrink: 0;
}

.sidebar__session-path {
  font-size: 10.5px;
  color: var(--fg-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Footer */
.sidebar__footer {
  padding: 10px 10px;
  border-top: 1px solid var(--line);
  flex-shrink: 0;
}

.sidebar__footer-row {
  display: flex;
  align-items: center;
  gap: 1px;
}

.sidebar__footer-link {
  flex: 1;
  min-width: 0;
}

.sidebar__footer-icon-link {
  flex-shrink: 0;
  width: 32px;
  padding: 0;
  justify-content: center;
}

.sidebar__footer-mobile {
  display: flex;
  align-items: center;
  gap: 1px;
  margin-left: auto;
  flex-shrink: 0;
}

.sidebar__footer-theme {
  flex-shrink: 0;
}

.sidebar--collapsed .sidebar__footer {
  padding: 10px 8px;
}

.sidebar--collapsed .sidebar__footer-row {
  justify-content: center;
}

.sidebar--collapsed .sidebar__footer-link {
  flex: none;
  width: 100%;
  justify-content: center;
  padding: 0;
}

@media (min-width: 37.5rem) {
  .sidebar__footer-mobile {
    display: none;
  }
}

</style>

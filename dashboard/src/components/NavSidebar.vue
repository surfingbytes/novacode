<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useWorkspacesStore } from '@/stores/workspaces';

const props = withDefaults(
  defineProps<{
    isOpen?: boolean;
    collapsed?: boolean;
    onNavigate?: () => void;
  }>(),
  { isOpen: false, collapsed: false }
);

defineEmits<{
  (e: 'search'): void;
}>();

const workspacesStore = useWorkspacesStore();

const bIsCollapsed = computed(() => props.collapsed && windowWidth.value > 1024);
const windowWidth = ref(window.innerWidth);

onMounted(() => {
  window.addEventListener('resize', () => {
    windowWidth.value = window.innerWidth;
  });
});

const navItems = [
  {
    id: 'home',
    label: 'Home',
    to: { name: 'home' },
    svgPath: 'M3 10.5L12 3l9 7.5V20a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z'
  },
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
  },
  {
    id: 'rules',
    label: 'Rule templates',
    to: '/role-templates',
    svgPath: 'M4 14l10-10 6 6-10 10z M8 10l2 2 M11 7l2 2 M5 13l2 2'
  }
];

const activeQuickSessions = computed(() => workspacesStore.activeBusySessions);
const mergedQuickSessions = computed(() => {
  const activeIds = new Set(activeQuickSessions.value.map((s) => s.id));
  const recentSessions = workspacesStore.allSessions
    .filter((s) => !s.archived && !activeIds.has(s.id))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return [...activeQuickSessions.value, ...recentSessions].slice(0, 6);
});

function workspaceNameById(id: string): string {
  return workspacesStore.workspaces.find((w) => w.id === id)?.name ?? 'Workspace';
}

function agentClass(agentType: string): string {
  if (agentType === 'claude') return 'agent-claude';
  if (agentType === 'cursor-agent') return 'agent-cursor';
  if (agentType === 'mistral-vibe') return 'agent-vibe';
  return '';
}

onMounted(() => {
  workspacesStore.ensureSessionsInitialized();
  if (workspacesStore.workspaces.length === 0) {
    workspacesStore.fetchAll();
  }
});
</script>

<template>
  <!-- Mobile backdrop -->
  <div
    class="lg:hidden fixed inset-0 z-40 pointer-events-none transition-opacity duration-200"
    :class="isOpen ? 'opacity-100 pointer-events-auto bg-black/40 backdrop-blur-sm' : 'opacity-0'"
    @click="onNavigate?.()"
  />

  <aside
    class="sidebar flex flex-col fixed lg:relative inset-y-0 left-0 z-50 transition-all duration-200 ease-out"
    :class="[
      isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
      bIsCollapsed ? 'sidebar--collapsed' : 'sidebar--expanded'
    ]"
    aria-label="Main navigation"
  >
    <!-- Brand -->
    <div class="sidebar__brand">
      <RouterLink to="/" class="sidebar__logo-link" @click="onNavigate?.()">
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
        @click="onNavigate?.()"
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

    <!-- Sessions section -->
    <div v-if="!bIsCollapsed" class="sidebar__section-label nc-eyebrow">// sessions</div>

    <div class="sidebar__sessions">
      <div v-if="mergedQuickSessions.length === 0" class="sidebar__sessions-empty">
        <template v-if="!bIsCollapsed">No active sessions</template>
      </div>

      <RouterLink
        v-for="session in mergedQuickSessions"
        :key="'nav-' + session.id"
        :to="{ name: 'session', params: { id: session.workspaceId, sessionId: session.id } }"
        class="sidebar__session-item nc-row-hover"
        active-class="sidebar__session-item--active"
        :title="bIsCollapsed ? session.name : undefined"
        @click="onNavigate?.()"
      >
        <span class="nc-status-dot" :class="session.busy ? 'busy' : 'idle'" />
        <template v-if="!bIsCollapsed">
          <div class="sidebar__session-info">
            <div class="sidebar__session-name">{{ session.name || 'Untitled' }}</div>
            <div class="sidebar__session-path nc-mono">
              {{ workspaceNameById(session.workspaceId) }}
            </div>
          </div>
          <span v-if="session.agentType" class="nc-chip" :class="agentClass(session.agentType)">{{
            session.agentType === 'cursor-agent'
              ? 'cursor'
              : session.agentType === 'mistral-vibe'
                ? 'vibe'
                : 'claude'
          }}</span>
        </template>
      </RouterLink>
    </div>

    <!-- Settings pinned -->
    <div class="sidebar__footer">
      <RouterLink
        to="/settings"
        class="sidebar__nav-item"
        active-class="sidebar__nav-item--active"
        :title="bIsCollapsed ? 'Settings' : undefined"
        @click="onNavigate?.()"
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
    </div>
  </aside>
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

/* Sessions */
.sidebar__section-label {
  padding: 18px 18px 6px;
  margin-top: 10px;
  flex-shrink: 0;
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

.sidebar__session-name {
  font-size: 13px;
  color: var(--fg);
  font-weight: 400;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.sidebar--collapsed .sidebar__footer {
  padding: 10px 8px;
}
</style>

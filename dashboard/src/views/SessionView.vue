<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// components
import WorkspaceSidebar from '@/components/WorkspaceSidebar.vue';
import SessionChat from '@/components/SessionChat.vue';
import OrchestratorContent from '@/components/OrchestratorContent.vue';
import NewSessionModal from '@/components/NewSessionModal.vue';

// classes
import { sessionsApi, settingsApi } from '@/classes/api';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';

// types
import type { AgentType } from '@/@types/index';

const route = useRoute();
const router = useRouter();
const store = useWorkspacesStore();

const workspaceId = computed(() => route.params.id as string);

const sessionId = computed(() => route.params.sessionId as string | undefined);
const orchestratorId = computed(() => route.params.orchestratorId as string | undefined);
const activeKind = computed<'session' | 'orchestrator'>(() =>
  sessionId.value ? 'session' : 'orchestrator'
);
const activeId = computed(() => sessionId.value ?? orchestratorId.value ?? null);
const mobileTab = ref<'sessions' | 'chat'>('chat');
const isDesktop = ref(false);
const desktopSidebarVisible = ref(true);
let desktopMediaQuery: MediaQueryList | null = null;
const handleDesktopMediaQueryChange = (event: MediaQueryListEvent): void => {
  setDesktopState(event.matches);
};

const workspace = computed(() => store.workspaces.find((w) => w.id === workspaceId.value));

const sessionTags = computed(() => {
  const wid = workspaceId.value;
  const all = store.allSessions.filter((s) => s.workspaceId === wid);
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

// New session modal
const showNewSessionModal = ref(false);
const isSubmittingSession = ref(false);
const claudeAvailable = ref(false);
const cursorAvailable = ref(false);
const mistralVibeAvailable = ref(false);
const openCodeAvailable = ref(false);
const codexAvailable = ref(false);

async function ensureWorkspaceLoaded(): Promise<void> {
  if (store.workspaces.some((w) => w.id === workspaceId.value)) return;
  await store.fetchAll();
}

async function loadAgentCapabilities(): Promise<void> {
  try {
    const { data } = await settingsApi.getAgentCapabilities();
    claudeAvailable.value = data.claudeAvailable;
    cursorAvailable.value = data.cursorAvailable;
    mistralVibeAvailable.value = data.mistralVibeAvailable;
    openCodeAvailable.value = data.openCodeAvailable;
    codexAvailable.value = data.codexAvailable;
  } catch {
    claudeAvailable.value = false;
    cursorAvailable.value = false;
    mistralVibeAvailable.value = false;
    openCodeAvailable.value = false;
    codexAvailable.value = false;
  }
}

async function createSession(payload: {
  name: string;
  tags?: string[] | null;
  agentType?: AgentType;
}): Promise<void> {
  if (isSubmittingSession.value) return;
  isSubmittingSession.value = true;
  try {
    const { data: newSession } = await sessionsApi.create(workspaceId.value, payload);
    showNewSessionModal.value = false;
    await router.push({
      name: 'session',
      params: { id: workspaceId.value, sessionId: newSession.id }
    });
  } catch (error) {
    console.error('Failed to create session:', error);
  } finally {
    isSubmittingSession.value = false;
  }
}

function setDesktopState(matchesDesktop: boolean): void {
  isDesktop.value = matchesDesktop;
  if (!matchesDesktop) {
    desktopSidebarVisible.value = true;
    mobileTab.value = 'chat';
  }
}

function handleSidebarToggle(): void {
  if (isDesktop.value) {
    desktopSidebarVisible.value = !desktopSidebarVisible.value;
    return;
  }
  mobileTab.value = 'sessions';
}

function handleBackToWorkspaceSessions(): void {
  router.push({ name: 'workspace-sessions', params: { id: workspaceId.value } });
}

// ── Visual viewport tracking (mobile keyboard) ──────────────────────────────
const viewportHeight = ref<number | null>(null);

function onViewportResize() {
  if (!window.visualViewport) return;
  viewportHeight.value = window.visualViewport.height;
}

onMounted(() => {
  desktopMediaQuery = window.matchMedia('(min-width: 1024px)');
  setDesktopState(desktopMediaQuery.matches);
  desktopMediaQuery.addEventListener('change', handleDesktopMediaQueryChange);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportResize);
  }
  ensureWorkspaceLoaded();
  store.setActiveWorkspace(workspaceId.value);
  loadAgentCapabilities();
});

watch(
  () => workspaceId.value,
  async (id) => {
    if (!id) return;
    await ensureWorkspaceLoaded();
    await store.setActiveWorkspace(id);
  }
);

watch(
  () => [sessionId.value, orchestratorId.value],
  () => {
    // On mobile, return to content after selecting from sidebar.
    mobileTab.value = 'chat';
  }
);

onUnmounted(() => {
  if (desktopMediaQuery) {
    desktopMediaQuery.removeEventListener('change', handleDesktopMediaQueryChange);
    desktopMediaQuery = null;
  }
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportResize);
  }
});
</script>

<template>
  <div class="bg-bg flex flex-col overflow-hidden h-full">
    <div class="flex-1 flex overflow-hidden min-h-0 relative">
      <WorkspaceSidebar
        v-if="isDesktop"
        :workspace-id="workspaceId"
        :active-kind="activeKind"
        :active-id="activeId"
        :show-on-mobile="false"
        :desktop-visible="desktopSidebarVisible"
        :show-back-button="activeKind === 'session'"
        @back="handleBackToWorkspaceSessions"
        @new-session="showNewSessionModal = true"
      />

      <Transition
        enter-active-class="transition-transform transition-opacity duration-200 ease-out"
        enter-from-class="-translate-x-full opacity-0"
        enter-to-class="translate-x-0 opacity-100"
        leave-active-class="transition-transform transition-opacity duration-200 ease-in"
        leave-from-class="translate-x-0 opacity-100"
        leave-to-class="-translate-x-full opacity-0"
      >
        <WorkspaceSidebar
          v-if="!isDesktop && mobileTab === 'sessions'"
          class="absolute inset-y-0 left-0 z-20 shadow-xl"
          :workspace-id="workspaceId"
          :active-kind="activeKind"
          :active-id="activeId"
          :show-on-mobile="true"
          :desktop-visible="true"
          :show-back-button="activeKind === 'session'"
          @close-mobile="mobileTab = 'chat'"
          @back="handleBackToWorkspaceSessions"
          @new-session="showNewSessionModal = true"
        />
      </Transition>

      <SessionChat
        v-if="mobileTab === 'chat' && activeKind === 'session' && sessionId"
        :workspace-id="workspaceId"
        :session-id="sessionId"
        :viewport-height="viewportHeight"
        :show-sidebar-toggle="true"
        @toggle-sidebar="handleSidebarToggle"
      />

      <OrchestratorContent
        v-else-if="mobileTab === 'chat' && activeKind === 'orchestrator' && orchestratorId"
        :workspace-id="workspaceId"
        :orchestrator-id="orchestratorId"
        :show-sidebar-toggle="true"
        @toggle-sidebar="handleSidebarToggle"
      />
    </div>
  </div>

  <NewSessionModal
    v-model="showNewSessionModal"
    :loading="isSubmittingSession"
    :default-agent-type="(workspace && workspace.defaultAgentType) || null"
    :claude-available="claudeAvailable"
    :cursor-available="cursorAvailable"
    :mistral-vibe-available="mistralVibeAvailable"
    :open-code-available="openCodeAvailable"
    :codex-available="codexAvailable"
    :existing-tags="sessionTags"
    @create="createSession"
  />
</template>

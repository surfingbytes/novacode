<script setup lang="ts">
// node_modules
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

// components
import PageShell from '@/components/layout/PageShell.vue';
import WorkspaceDeleteModal from '@/components/workspace/DeleteModal.vue';
import WorkspaceEditModal from '@/components/workspace/EditModal.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import type { ContextMenuItem } from '@/components/ContextMenu.vue';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';

// classes
import { agentAuthApi, settingsApi } from '@/classes/api';

// types
import type { AgentType, Workspace } from '@/@types/index';

// -------------------------------------------------- Store --------------------------------------------------
const store = useWorkspacesStore();
const router = useRouter();

// -------------------------------------------------- Refs --------------------------------------------------
const bShowWorkspaceModal = ref<boolean>(false);
const editingWorkspace = ref<Workspace | undefined>(undefined);
const deletingId = ref<string | null>(null);
const confirmingDeleteId = ref<string | null>(null);
const archivingId = ref<string | null>(null);
const bShowArchived = ref<boolean>(false);

// First-start overlay: show when no integration is active or no git credentials
const bFirstStartCheckDone = ref<boolean>(false);
const bCursorAuthenticated = ref<boolean>(false);
const bClaudeAuthenticated = ref<boolean>(false);
const bVibeConfigured = ref<boolean>(false);
const bHasGitCredentials = ref<boolean>(false);
const cursorAvailable = ref<boolean>(false);
const claudeAvailable = ref<boolean>(false);
const mistralVibeAvailable = ref<boolean>(false);
const openCodeAvailable = ref<boolean>(false);
const codexAvailable = ref<boolean>(false);
const newGroupNames = ref<string[]>([]);
const bShowWorkspaceDeleteModal = ref<boolean>(false);
const deletingWorkspace = ref<Workspace | undefined>(undefined);

const bCtxMenuOpen = ref<boolean>(false);
const ctxMenuX = ref(0);
const ctxMenuY = ref(0);
const ctxMenuItems = ref<ContextMenuItem[]>([]);
let ctxWorkspacePickHandler: ((key: string) => void) | null = null;

// -------------------------------------------------- Computed --------------------------------------------------
/** Groups for workspace modal suggestions (unique non-empty group names, sorted). */
const existingGroups = computed((): string[] => {
  const set = new Set<string>();
  store.workspaces.forEach((w) => {
    const g = w.group?.trim();
    if (g) {
      set.add(g);
    }
  });
  newGroupNames.value.forEach((g) => {
    set.add(g);
  });
  return [...set].sort((a, b) => a.localeCompare(b));
});

/** Tags from other workspaces for suggestions (when editing, exclude current workspace). */
const existingTags = computed((): string[] => {
  const currentId = editingWorkspace.value?.id;
  const set = new Set<string>();
  store.workspaces.forEach((w) => {
    if (w.id === currentId) {
      return;
    }
    const tags = w.tags;
    if (Array.isArray(tags)) {
      tags.forEach((t) => {
        const s = typeof t === 'string' ? t.trim() : '';
        if (s) {
          set.add(s);
        }
      });
    }
  });
  return [...set].sort((a, b) => a.localeCompare(b));
});

function buildGroupedList(
  workspaces: Workspace[]
): { groupLabel: string; workspaces: Workspace[] }[] {
  const byGroup = new Map<string, Workspace[]>();
  const ungrouped: Workspace[] = [];
  for (const workspace of workspaces) {
    const g = workspace.group?.trim() || null;
    if (!g) {
      ungrouped.push(workspace);
    } else {
      const list = byGroup.get(g) ?? [];
      list.push(workspace);
      byGroup.set(g, list);
    }
  }
  const result: { groupLabel: string; workspaces: Workspace[] }[] = [];
  const sortedGroups = [...byGroup.keys()].sort((a, b) => a.localeCompare(b));
  for (const label of sortedGroups) {
    result.push({ groupLabel: label, workspaces: byGroup.get(label)! });
  }
  if (ungrouped.length > 0) {
    result.push({ groupLabel: 'Ungrouped', workspaces: ungrouped });
  }
  return result;
}

/** Active (non-archived) workspaces grouped. */
const groupedWorkspaces = computed(() =>
  buildGroupedList(store.workspaces.filter((w) => !w.archived))
);

/** Archived workspaces grouped. */
const groupedArchivedWorkspaces = computed(() =>
  buildGroupedList(store.workspaces.filter((w) => w.archived))
);

const archivedCount = computed(() => store.workspaces.filter((w) => w.archived).length);

const busyWorkspaceIds = computed(() => {
  const ids = new Set<string>();
  store.allSessions.forEach((session) => {
    if (!session.archived && session.busy) {
      ids.add(session.workspaceId);
    }
  });
  return ids;
});

// -------------------------------------------------- Methods --------------------------------------------------
const openWorkspace = (id: string): void => {
  router.push(`/workspace/${id}`);
};

const workspaceHasBusySession = (id: string): boolean => busyWorkspaceIds.value.has(id);

const openCreateWorkspace = (): void => {
  editingWorkspace.value = undefined;
  bShowWorkspaceModal.value = true;
};

const openEditWorkspace = (workspace: Workspace): void => {
  editingWorkspace.value = workspace;
  bShowWorkspaceModal.value = true;
};

const handleSaveWorkspace = async (payload: {
  name: string;
  path: string;
  group: string | null;
  gitUserName: string | null;
  gitUserEmail: string | null;
  color: string | null;
  defaultAgentType: AgentType | null;
  tags: string[] | null;
}): Promise<void> => {
  if (editingWorkspace.value) {
    await store.updateWorkspace(editingWorkspace.value.id, payload);
  } else {
    await store.createWorkspace(payload);
  }
  bShowWorkspaceModal.value = false;
};

const openDeleteWorkspace = (workspace: Workspace): void => {
  deletingWorkspace.value = workspace;
  bShowWorkspaceDeleteModal.value = true;
};

const handleCreateGroup = (group: string): void => {
  newGroupNames.value.push(group);
};

const handleArchiveWorkspace = async (workspace: Workspace, archived: boolean): Promise<void> => {
  archivingId.value = workspace.id;
  try {
    await store.archiveWorkspace(workspace.id, archived);
  } catch {
    // ignore
  } finally {
    archivingId.value = null;
  }
};

const handleDeleteWorkspace = async (id: string): Promise<void> => {
  deletingId.value = id;
  try {
    await store.deleteWorkspace(id);
    confirmingDeleteId.value = null;
  } catch (err: unknown) {
    const msg =
      (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
      'Failed to delete workspace';
    alert(msg);
  } finally {
    deletingId.value = null;
    bShowWorkspaceDeleteModal.value = false;
  }
};

function workspaceContextItems(workspace: Workspace): ContextMenuItem[] {
  const arch = workspace.archived;
  return [
    { key: 'open', label: 'Open', icon: 'open_in_new' },
    { key: 'edit', label: 'Edit…', icon: 'edit' },
    { key: 'archive', label: arch ? 'Unarchive' : 'Archive', icon: arch ? 'unarchive' : 'inventory_2' },
    { key: 'delete', label: 'Delete…', icon: 'delete', danger: true }
  ];
}

function openWorkspaceContextMenu(e: MouseEvent, workspace: Workspace): void {
  e.preventDefault();
  e.stopPropagation();
  ctxMenuItems.value = workspaceContextItems(workspace);
  ctxWorkspacePickHandler = (key: string) => {
    if (key === 'open') {
      openWorkspace(workspace.id);
      return;
    }
    if (key === 'edit') {
      openEditWorkspace(workspace);
      return;
    }
    if (key === 'archive') {
      void handleArchiveWorkspace(workspace, !workspace.archived);
      return;
    }
    if (key === 'delete') {
      openDeleteWorkspace(workspace);
    }
  };
  ctxMenuX.value = e.clientX;
  ctxMenuY.value = e.clientY;
  bCtxMenuOpen.value = true;
}

function onWorkspaceContextPick(key: string): void {
  const fn = ctxWorkspacePickHandler;
  ctxWorkspacePickHandler = null;
  fn?.(key);
}

const fetchFirstStartStatus = async (): Promise<void> => {
  const [cursorResult, claudeResult, vibeResult, settingsResult, agentCapsResult] = await Promise.allSettled([
    agentAuthApi.cursorStatus(),
    agentAuthApi.claudeStatus(),
    settingsApi.getVibeApiKeyStatus(),
    settingsApi.get(),
    settingsApi.getAgentCapabilities()
  ]);
  if (cursorResult.status === 'fulfilled') {
    bCursorAuthenticated.value = cursorResult.value.data.authenticated;
  }
  if (claudeResult.status === 'fulfilled') {
    bClaudeAuthenticated.value = claudeResult.value.data.authenticated;
  }
  if (vibeResult.status === 'fulfilled') {
    bVibeConfigured.value = vibeResult.value.data.configured;
  }
  if (settingsResult.status === 'fulfilled') {
    const name = settingsResult.value.data.gitUserName?.trim() ?? '';
    const email = settingsResult.value.data.gitUserEmail?.trim() ?? '';
    bHasGitCredentials.value = name.length > 0 && email.length > 0;
  }
  if (agentCapsResult.status === 'fulfilled') {
    cursorAvailable.value = agentCapsResult.value.data.cursorAvailable;
    claudeAvailable.value = agentCapsResult.value.data.claudeAvailable;
    mistralVibeAvailable.value = agentCapsResult.value.data.mistralVibeAvailable;
    openCodeAvailable.value = agentCapsResult.value.data.openCodeAvailable;
  }
  bFirstStartCheckDone.value = true;
};

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted((): void => {
  store.fetchAll();
  store.ensureSessionsInitialized();
  fetchFirstStartStatus();
});
</script>

<template>
  <PageShell>
    <!-- Header -->
    <div class="ws-header">
      <div>
        <div class="nc-eyebrow ws-eyebrow">// workspaces</div>
        <h1 class="ws-title">Workspaces</h1>
        <p class="ws-subtitle">
          Select a workspace to browse files and manage git. Paths are under
          <code class="ws-path-pill nc-mono">/data-root</code>.
        </p>
      </div>
      <button
        v-if="!store.bIsLoading && store.workspaces.length > 0"
        class="ws-add-btn"
        @click="openCreateWorkspace"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14 M5 12h14"/></svg>
        Add workspace
      </button>
    </div>

    <!-- Loading -->
    <Transition name="fade" mode="out-in">
      <div v-if="store.bIsLoading" key="loading" class="ws-state">
        <div class="ws-spinner" />
        <p class="ws-state-text">Loading workspaces…</p>
      </div>

      <!-- Empty state -->
      <div v-else-if="store.workspaces.length === 0" key="empty" class="ws-state">
        <div class="ws-empty-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 012-2h3.5l2 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
        </div>
        <p class="ws-state-title">No workspaces yet</p>
        <p class="ws-state-text">Add your first workspace to manage projects and collaborate with AI.</p>
        <button class="ws-add-btn" @click="openCreateWorkspace">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14 M5 12h14"/></svg>
          Add workspace
        </button>
      </div>

      <!-- Workspace grid (grouped) -->
      <div v-else key="grid">
        <template v-for="section in groupedWorkspaces" :key="section.groupLabel">
          <div class="ws-group-header">
            <span class="nc-eyebrow">// {{ section.groupLabel.toLowerCase() }}</span>
            <span class="ws-group-count nc-mono">{{ section.workspaces.length }} workspace{{ section.workspaces.length === 1 ? '' : 's' }}</span>
          </div>
          <div class="ws-grid">
            <div
              v-for="workspace in section.workspaces"
              :key="workspace.id"
              class="ws-card nc-row-hover"
              @click="openWorkspace(workspace.id)"
              @contextmenu.prevent.stop="openWorkspaceContextMenu($event, workspace)"
            >
              <!-- 3px color bar -->
              <div class="ws-card__bar" :style="{ background: workspace.color || 'var(--accent)' }" />
              <!-- Top row: icon + name/path + actions -->
              <div class="ws-card__top">
                <div class="ws-card__folder-icon" :style="{ background: `color-mix(in oklab, ${workspace.color || 'var(--accent)'} 22%, transparent)`, color: workspace.color || 'var(--accent)' }">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 012-2h3.5l2 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                </div>
                <div class="ws-card__info">
                  <div class="ws-card__name">{{ workspace.name }}</div>
                  <div class="ws-card__path nc-mono">{{ workspace.path }}</div>
                </div>
                <!-- Busy indicator -->
                <span v-if="workspaceHasBusySession(workspace.id)" class="nc-status-dot busy" />
                <!-- Action cluster (hover-only) -->
                <div class="ws-card__actions">
                  <button class="ws-icon-btn" title="Edit" @click.prevent.stop="openEditWorkspace(workspace)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6 M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
                  </button>
                  <button class="ws-icon-btn ws-icon-btn--warn" title="Archive" :disabled="archivingId === workspace.id" @click.prevent.stop="handleArchiveWorkspace(workspace, true)">
                    <div v-if="archivingId === workspace.id" class="ws-btn-spinner" />
                    <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18 M5 7v12a2 2 0 002 2h10a2 2 0 002-2V7 M10 11h4"/></svg>
                  </button>
                  <button class="ws-icon-btn ws-icon-btn--danger" title="Delete" @click.prevent.stop="openDeleteWorkspace(workspace)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18 M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2 M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  </button>
                </div>
              </div>
              <!-- Bottom row: agent chip -->
              <div class="ws-card__bottom">
                <span v-if="workspace.defaultAgentType" class="nc-chip" :class="{
                  'agent-claude': workspace.defaultAgentType === 'claude',
                  'agent-cursor': workspace.defaultAgentType === 'cursor-agent',
                  'agent-vibe': workspace.defaultAgentType === 'mistral-vibe',
                  'agent-opencode': workspace.defaultAgentType === 'open-code',
                }">
                  {{ workspace.defaultAgentType === 'cursor-agent' ? 'cursor' : workspace.defaultAgentType === 'mistral-vibe' ? 'vibe' : workspace.defaultAgentType === 'claude' ? 'claude' : 'opencode' }}
                </span>
                <span v-if="workspace.defaultAgentType" class="ws-card__agent-label nc-mono">· default agent</span>
              </div>
            </div>
          </div>
        </template>

        <!-- Archived workspaces toggle -->
        <div v-if="archivedCount > 0" style="margin-top: 32px;">
          <button class="ws-archived-toggle" @click="bShowArchived = !bShowArchived">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: bShowArchived ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
            Archived
            <span class="ws-archived-count">{{ archivedCount }}</span>
          </button>

          <Transition name="fade">
            <div v-if="bShowArchived" style="margin-top: 16px;">
              <template v-for="section in groupedArchivedWorkspaces" :key="'arch-' + section.groupLabel">
                <div class="ws-group-header" style="opacity: 0.6;">
                  <span class="nc-eyebrow">// {{ section.groupLabel.toLowerCase() }}</span>
                </div>
                <div class="ws-grid" style="opacity: 0.55;">
                  <div
                    v-for="workspace in section.workspaces"
                    :key="workspace.id"
                    class="ws-card"
                    @contextmenu.prevent.stop="openWorkspaceContextMenu($event, workspace)"
                  >
                    <div class="ws-card__bar" :style="{ background: workspace.color || 'var(--accent)' }" />
                    <div class="ws-card__top">
                      <div class="ws-card__folder-icon" :style="{ background: `color-mix(in oklab, ${workspace.color || 'var(--accent)'} 22%, transparent)`, color: workspace.color || 'var(--accent)' }">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h3.5l2 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
                      </div>
                      <div class="ws-card__info">
                        <div class="ws-card__name">{{ workspace.name }}</div>
                        <div class="ws-card__path nc-mono">{{ workspace.path }}</div>
                      </div>
                      <div class="ws-card__actions">
                        <button class="ws-icon-btn" title="Unarchive" :disabled="archivingId === workspace.id" @click.prevent.stop="handleArchiveWorkspace(workspace, false)">
                          <div v-if="archivingId === workspace.id" class="ws-btn-spinner" />
                          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18 M5 7l2-4h10l2 4 M9 11v6 M15 11v6"/></svg>
                        </button>
                        <button class="ws-icon-btn ws-icon-btn--danger" title="Delete" @click.prevent.stop="openDeleteWorkspace(workspace)">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18 M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2 M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </PageShell>

  <WorkspaceEditModal
    v-model="bShowWorkspaceModal"
    :workspace="editingWorkspace"
    :existing-groups="existingGroups"
    :existing-tags="existingTags"
    :cursor-available="cursorAvailable"
    :claude-available="claudeAvailable"
    :mistral-vibe-available="mistralVibeAvailable"
    :open-code-available="openCodeAvailable"
    :codex-available="codexAvailable"
    @create-group="handleCreateGroup"
    @save="handleSaveWorkspace"
  />

  <WorkspaceDeleteModal
    v-model="bShowWorkspaceDeleteModal"
    :workspace="deletingWorkspace"
    @delete="handleDeleteWorkspace"
  />

  <ContextMenu
    v-model="bCtxMenuOpen"
    :x="ctxMenuX"
    :y="ctxMenuY"
    :items="ctxMenuItems"
    @pick="onWorkspaceContextPick"
  />
</template>

<style scoped>
/* ── transitions ─────────────────────────────────────────── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ── page header ─────────────────────────────────────────── */
.ws-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 32px;
}

.ws-title {
  font-size: 22px;
  font-weight: 600;
  color: var(--fg);
  margin: 4px 0 6px;
  letter-spacing: -0.3px;
}

.ws-subtitle {
  font-size: 13px;
  color: var(--fg-subtle);
  margin: 0;
  line-height: 1.5;
}

.ws-path-pill {
  display: inline;
  background: var(--bg-elev-2);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 11.5px;
  color: var(--fg-muted);
}

.ws-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: opacity 0.1s;
}
.ws-add-btn:hover {
  opacity: 0.88;
}

/* ── loading / empty states ──────────────────────────────── */
.ws-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 72px 24px;
  gap: 10px;
  text-align: center;
}

.ws-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid var(--line-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: ws-spin 0.7s linear infinite;
}

@keyframes ws-spin {
  to { transform: rotate(360deg); }
}

.ws-empty-icon {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-muted);
  margin-bottom: 4px;
}

.ws-state-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
  margin: 0;
}

.ws-state-text {
  font-size: 13px;
  color: var(--fg-subtle);
  margin: 0;
  max-width: 340px;
  line-height: 1.5;
}

/* ── group header ────────────────────────────────────────── */
.ws-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  margin-top: 28px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--line);
}
.ws-group-header:first-child {
  margin-top: 0;
}

.ws-group-count {
  font-size: 11px;
  color: var(--fg-subtle);
}

/* ── workspace grid ──────────────────────────────────────── */
.ws-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  margin-bottom: 4px;
}

/* ── workspace card ──────────────────────────────────────── */
.ws-card {
  position: relative;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.12s, box-shadow 0.12s;
  display: flex;
  flex-direction: column;
}
.ws-card:hover {
  border-color: var(--line-strong);
  box-shadow: 0 2px 8px color-mix(in oklab, var(--fg) 6%, transparent);
}
.ws-card:hover .ws-card__actions {
  opacity: 1;
  pointer-events: auto;
}

.ws-card__bar {
  height: 3px;
  width: 100%;
  flex-shrink: 0;
}

.ws-card__top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 10px;
  flex: 1;
}

.ws-card__folder-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ws-card__info {
  flex: 1;
  min-width: 0;
}

.ws-card__name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.ws-card__path {
  font-size: 11px;
  color: var(--fg-subtle);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}

/* Action cluster — hidden until card hover */
.ws-card__actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
  flex-shrink: 0;
}

.ws-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.ws-icon-btn:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
.ws-icon-btn--warn:hover {
  background: color-mix(in oklab, var(--warn, #d97706) 14%, transparent);
  color: var(--warn, #d97706);
}
.ws-icon-btn--danger:hover {
  background: color-mix(in oklab, var(--danger) 14%, transparent);
  color: var(--danger);
}
.ws-icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ws-btn-spinner {
  width: 11px;
  height: 11px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: ws-spin 0.6s linear infinite;
  opacity: 0.6;
}

/* Bottom row */
.ws-card__bottom {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px 10px;
  min-height: 22px;
}

.ws-card__agent-label {
  font-size: 10.5px;
  color: var(--fg-subtle);
}

/* ── archived toggle ─────────────────────────────────────── */
.ws-archived-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12.5px;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.ws-archived-toggle:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.ws-archived-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--bg-elev-2);
  border: 1px solid var(--line);
  font-size: 10.5px;
  color: var(--fg-muted);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
</style>

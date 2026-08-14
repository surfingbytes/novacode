<script setup lang="ts">
import { computed } from 'vue';
import { useWorkspacesStore } from '@/stores/workspaces';
import { agentTypeShortLabel } from '@/utils/agentTypeMeta';
import { sessionStatusDotStyle, workspaceColor } from '@/utils/workspaceColor';
import { relativeTimeLong } from '@/utils/relativeTime';
import type { Session, Workspace } from '@/@types/index';

const workspacesStore = useWorkspacesStore();

const recentlyActive = computed<Session[]>(() => {
  const active = workspacesStore.allSessions.filter((session) => !session.archived);
  const busy = active.filter((session) => session.busy);
  const busyIds = new Set(busy.map((session) => session.id));
  const rest = active
    .filter((session) => !busyIds.has(session.id))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  return [
    ...[...busy].sort(
      (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    ),
    ...rest
  ].slice(0, 12);
});

function workspaceById(workspaceId: string): Workspace | undefined {
  return workspacesStore.workspaces.find((workspace) => workspace.id === workspaceId);
}

function workspaceName(workspaceId: string): string {
  return workspaceById(workspaceId)?.name ?? 'Workspace';
}
</script>

<template>
  <div v-if="recentlyActive.length > 0" class="recently-active">
    <div class="recently-active__header">
      <span class="nc-eyebrow">// recently active</span>
      <span class="recently-active__sort nc-mono">sorted: last used</span>
    </div>
    <div class="recently-active__list">
      <RouterLink
        v-for="session in recentlyActive"
        :key="session.id"
        :to="{ name: 'session', params: { id: session.workspaceId, sessionId: session.id } }"
        class="session-row nc-row-hover"
      >
        <span
          class="nc-status-dot"
          :style="sessionStatusDotStyle(workspaceById(session.workspaceId), session.busy)"
        />
        <span class="session-row__text">
          <span class="session-row__name">{{ session.name?.trim() || 'Untitled session' }}</span>
          <span class="session-row__meta nc-mono">
            <span
              class="session-row__ws-name"
              :style="{ color: workspaceColor(workspaceById(session.workspaceId)) }"
              >{{ workspaceName(session.workspaceId) }}</span
            >
            <span v-if="session.agentType"> · {{ agentTypeShortLabel(session.agentType) }}</span>
            <span> · {{ relativeTimeLong(session.updatedAt) }}</span>
          </span>
        </span>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.recently-active {
  margin: 28px 0 8px;
}

.recently-active__header {
  display: flex;
  align-items: baseline;
  margin-bottom: 8px;
}

.recently-active__sort {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--fg-subtle);
}

.recently-active__list {
  display: flex;
  flex-direction: column;
}

.session-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px 9px 4px;
  border-radius: 6px;
  text-decoration: none;
}

.session-row__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.session-row__name {
  font-size: 13.5px;
  font-weight: 450;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-row__meta {
  font-size: 12px;
  color: var(--fg-subtle);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import PageShell from '@/components/layout/PageShell.vue';
import { useWorkspacesStore } from '@/stores/workspaces';
import { useAuthStore } from '@/stores/auth';
import type { Session } from '@/@types/index';

const workspacesStore = useWorkspacesStore();
const auth = useAuthStore();

const firstName = computed(() => {
  const name = auth.username ?? '';
  return name.split(' ')[0] || name;
});

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const activeSessions = computed<Session[]>(() =>
  workspacesStore.allSessions.filter((s) => !s.archived)
);

const busyCount = computed(() => activeSessions.value.filter((s) => s.busy).length);
const idleCount = computed(() => activeSessions.value.filter((s) => !s.busy).length);

const recentlyActive = computed<Session[]>(() => {
  const busy = activeSessions.value.filter((s) => s.busy);
  const busyIds = new Set(busy.map((s) => s.id));
  const rest = activeSessions.value
    .filter((s) => !busyIds.has(s.id))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return [
    ...[...busy].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    ...rest
  ].slice(0, 20);
});

function workspaceName(workspaceId: string): string {
  return workspacesStore.workspaces.find((w) => w.id === workspaceId)?.name ?? 'Workspace';
}

function agentClass(agentType: string): string {
  if (agentType === 'claude') return 'agent-claude';
  if (agentType === 'cursor-agent') return 'agent-cursor';
  if (agentType === 'mistral-vibe') return 'agent-vibe';
  if (agentType === 'open-code') return 'agent-opencode';
  return '';
}

function agentLabel(agentType: string): string {
  if (agentType === 'cursor-agent') return 'cursor';
  if (agentType === 'mistral-vibe') return 'vibe';
  if (agentType === 'claude') return 'claude';
  return 'opencode';
}

const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.round((then - Date.now()) / 1000);
  if (Math.abs(diffSec) < 60) return relFmt.format(diffSec, 'second');
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return relFmt.format(diffMin, 'minute');
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return relFmt.format(diffHr, 'hour');
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 30) return relFmt.format(diffDay, 'day');
  return relFmt.format(Math.round(diffDay / 30), 'month');
}

onMounted(() => {
  workspacesStore.fetchAll();
  workspacesStore.ensureSessionsInitialized();
});
</script>

<template>
  <PageShell>
    <!-- Header -->
    <div class="home-eyebrow nc-eyebrow">// home</div>
    <h1 class="home-title">{{ greeting() }}, {{ firstName }}.</h1>
    <p class="home-sub">
      Session activity across workspaces. Open
      <RouterLink :to="{ name: 'workspaces' }" class="home-link">Workspaces</RouterLink>
      to add projects or manage folders.
    </p>

    <!-- Stats strip -->
    <div class="stats-strip" v-if="!workspacesStore.bSessionsLoading || activeSessions.length > 0">
      <div class="stats-strip__cell" v-for="(stat, i) in [
        { label: 'Busy',         value: busyCount,             sub: 'agents processing a prompt', accent: true },
        { label: 'Idle',         value: idleCount,             sub: 'sessions ready for input', accent: false },
        { label: 'Total active', value: activeSessions.length, sub: 'non-archived sessions', accent: false },
      ]" :key="stat.label" :style="i > 0 ? { borderLeft: '1px solid var(--line)' } : {}">
        <div class="nc-eyebrow stats-strip__label">{{ stat.label }}</div>
        <div class="stats-strip__value nc-mono" :class="{ 'stats-strip__value--accent': stat.accent }">
          {{ stat.value }}
        </div>
        <div class="stats-strip__sub">{{ stat.sub }}</div>
      </div>
    </div>

    <div v-else class="home-loading">
      <div class="home-loading__spinner" />
      Loading sessions…
    </div>

    <!-- Recently active -->
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
          <span class="nc-status-dot" :class="session.busy ? 'busy' : 'idle'" />
          <span class="session-row__name">{{ session.name || 'Untitled session' }}</span>
          <span v-if="session.agentType" class="nc-chip" :class="agentClass(session.agentType)">
            {{ agentLabel(session.agentType) }}
          </span>
          <span class="session-row__ws nc-mono">{{ workspaceName(session.workspaceId) }}</span>
          <span class="session-row__age nc-mono">{{ relativeTime(session.updatedAt) }}</span>
        </RouterLink>
      </div>
    </div>

    <p v-else-if="!workspacesStore.bSessionsLoading" class="home-empty">No active sessions yet.</p>
  </PageShell>
</template>

<style scoped>
.home-eyebrow {
  margin-bottom: 10px;
}

.home-title {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--fg);
  margin: 0;
}

.home-sub {
  font-size: 14px;
  color: var(--fg-muted);
  margin: 6px 0 0;
}

.home-link {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid var(--accent-line);
}
.home-link:hover {
  border-bottom-color: var(--accent);
}

.home-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 24px 0;
  font-size: 14px;
  color: var(--fg-muted);
  margin-top: 36px;
}

.home-loading__spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--line-strong);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Stats strip */
.stats-strip {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-top: 36px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.stats-strip__cell {
  padding: 22px 28px 22px 0;
}

.stats-strip__cell:not(:first-child) {
  padding-left: 28px;
}

.stats-strip__label {
  margin-bottom: 10px;
}

.stats-strip__value {
  font-size: 38px;
  font-weight: 500;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--fg);
}

.stats-strip__value--accent {
  color: var(--accent);
}

.stats-strip__sub {
  font-size: 12.5px;
  color: var(--fg-subtle);
  margin-top: 8px;
}

/* Recently active */
.recently-active {
  margin-top: 40px;
}

.recently-active__header {
  display: flex;
  align-items: baseline;
  margin-bottom: 12px;
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
  gap: 14px;
  padding: 11px 10px 11px 4px;
  border-radius: 6px;
  cursor: pointer;
  text-decoration: none;
  transition: background 0.1s;
}

.session-row:hover {
  background: var(--bg-hover);
}

.session-row__name {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 450;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-row__ws {
  font-size: 12px;
  color: var(--fg-subtle);
  min-width: 140px;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-row__age {
  font-size: 12px;
  color: var(--fg-subtle);
  min-width: 36px;
  text-align: right;
  white-space: nowrap;
}

.home-empty {
  margin-top: 40px;
  font-size: 14px;
  color: var(--fg-muted);
}

@media (max-width: 639px) {
  .stats-strip {
    grid-template-columns: 1fr 1fr;
  }
  .stats-strip__cell:last-child {
    border-left: none;
    border-top: 1px solid var(--line);
    padding-left: 0;
    grid-column: 1 / -1;
  }
  .session-row__ws,
  .session-row__age {
    display: none;
  }
}
</style>

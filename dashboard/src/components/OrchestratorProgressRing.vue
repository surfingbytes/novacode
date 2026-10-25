<script setup lang="ts">
// node_modules
import { computed } from 'vue';

// utils
import { idleStatusColor } from '@/utils/workspaceColor';

// types
import type { OrchestratorProgress } from '@/utils/orchestratorProgress';

/**
 * Orchestrator status in the sidebar dot slot: an arc per finished share of the
 * steps (failed in red, running ones pulsing). Lit with glow while running, dimmed when idle — same
 * lighting as the session dot/star. A step waiting for the user's answer swaps the ring for a blinking
 * amber question mark; otherwise a failed step swaps it for a red exclamation mark (blinking while the run is on).
 */
const props = withDefaults(
  defineProps<{
    progress: OrchestratorProgress;
    /** Workspace color (CSS value). */
    color: string;
    size?: number;
  }>(),
  { size: 12 }
);

interface Arc {
  key: string;
  start: number;
  length: number;
  stroke: string;
  bPulse?: boolean;
}

// -------------------------------------------------- Computed --------------------------------------------------
const bWaiting = computed(() => props.progress.waiting > 0);
const bFailed = computed(() => !bWaiting.value && props.progress.failed > 0);

const tint = computed(() => (props.progress.bRunning ? props.color : idleStatusColor(props.color)));

/** Arc lengths in percent of the circle (circle uses pathLength=100). */
const arcs = computed<Arc[]>(() => {
  const { total, done, failed, running, waiting, bRunning } = props.progress;
  // A finished, idle run rests like an inactive one; the "Done" badge marks it until read.
  if (total <= 0 || (!bRunning && done === total)) {
    return [];
  }
  const share = (count: number): number => (count / total) * 100;
  const out: Arc[] = [];
  let start = 0;
  const push = (key: string, count: number, stroke: string, bPulse = false): void => {
    if (count > 0) {
      out.push({ key, start, length: share(count), stroke, bPulse });
      start += share(count);
    }
  };
  push('done', done, tint.value);
  push('failed', failed, 'var(--danger)');
  // Waiting steps are still in progress; the question mark replaces the ring while any wait.
  push('running', running + waiting, tint.value, true);
  return out;
});

/** Bare ring (inactive or finished) matches the idle dot/star; behind arcs it stays fainter as a track. */
const trackStroke = computed(() =>
  arcs.value.length === 0 ? idleStatusColor(props.color) : `color-mix(in oklab, ${props.color} 22%, transparent)`
);

const glowStyle = computed(() =>
  bWaiting.value
    ? { filter: 'drop-shadow(0 0 3px color-mix(in oklab, var(--warn) 45%, transparent))' }
    : bFailed.value
      ? props.progress.bRunning
        ? { filter: 'drop-shadow(0 0 3px color-mix(in oklab, var(--danger) 45%, transparent))' }
        : {}
      : props.progress.bRunning
    ? { filter: `drop-shadow(0 0 3px color-mix(in oklab, ${props.color} 45%, transparent))` }
    : {}
);

const title = computed(() => {
  const { total, done, failed, running, waiting } = props.progress;
  const parts = [`${done}/${total} steps done`];
  if (running > 0) parts.push(`${running} running`);
  if (waiting > 0) parts.push(`${waiting} waiting for your answer`);
  if (failed > 0) parts.push(`${failed} failed`);
  return `Orchestrator — ${parts.join(', ')}`;
});
</script>

<template>
  <svg
    class="orchestrator-ring"
    :width="size"
    :height="size"
    viewBox="0 0 12 12"
    :style="glowStyle"
    role="img"
    :aria-label="title"
  >
    <title>{{ title }}</title>
    <g
      v-if="bWaiting"
      class="orchestrator-ring__pulse"
      fill="none"
      stroke="var(--warn)"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3.6 3.9a2.4 2.4 0 1 1 3.4 2.2c-.6.3-1 .8-1 1.5v.3" />
      <circle cx="6" cy="10.4" r="0.2" />
    </g>
    <g
      v-else-if="bFailed"
      :class="{ 'orchestrator-ring__pulse': progress.bRunning }"
      fill="none"
      stroke="var(--danger)"
      stroke-width="1.8"
      stroke-linecap="round"
    >
      <path d="M6 1.6v5.6" />
      <circle cx="6" cy="10.4" r="0.2" />
    </g>
    <template v-else>
      <circle
        cx="6"
        cy="6"
        r="4.5"
        fill="none"
        stroke-width="2"
        :stroke="trackStroke"
      />
      <circle
        v-for="arc in arcs"
        :key="arc.key"
        cx="6"
        cy="6"
        r="4.5"
        fill="none"
        stroke-width="2"
        pathLength="100"
        transform="rotate(-90 6 6)"
        :stroke="arc.stroke"
        :stroke-dasharray="`${arc.length} 100`"
        :stroke-dashoffset="-arc.start"
        :class="{ 'orchestrator-ring__pulse': arc.bPulse }"
      />
    </template>
  </svg>
</template>

<style scoped>
.orchestrator-ring {
  flex-shrink: 0;
}

.orchestrator-ring__pulse {
  animation: orchestrator-ring-pulse 1.4s ease-in-out infinite;
}

@keyframes orchestrator-ring-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.25;
  }
}

@media (prefers-reduced-motion: reduce) {
  .orchestrator-ring__pulse {
    animation: none;
  }
}
</style>

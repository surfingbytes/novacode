<script setup lang="ts">
// node_modules
import { computed } from 'vue';

// types
import type { OrchestratorProgress } from '@/utils/orchestratorProgress';

/**
 * Orchestrator status in the sidebar dot slot: an arc per finished share of the
 * steps (failed in red, running ones pulsing, ones waiting for the user in amber). Lit with glow while running,
 * dimmed when idle — same lighting as the session dot/star.
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
const tint = computed(() =>
  props.progress.bRunning ? props.color : `color-mix(in oklab, ${props.color} 45%, transparent)`
);

/** Arc lengths in percent of the circle (circle uses pathLength=100). */
const arcs = computed<Arc[]>(() => {
  const { total, done, failed, running, waiting } = props.progress;
  if (total <= 0) {
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
  push('running', running, tint.value, true);
  push('waiting', waiting, 'var(--warn)', true);
  return out;
});

const glowStyle = computed(() =>
  props.progress.bRunning
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
    <circle
      cx="6"
      cy="6"
      r="4.5"
      fill="none"
      stroke-width="2"
      :stroke="`color-mix(in oklab, ${color} 22%, transparent)`"
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

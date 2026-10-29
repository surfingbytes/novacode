<script setup lang="ts">
// node_modules
import { computed } from 'vue';

// types
import type { RunProgress, RunSummary } from '@/composables/useOrchestratorRunState';

/** Run progress ring with its short summary (from server state). Extracted from OrchestratorPanel.vue. */

const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RUN_STATUS_RING_CLASS: Record<RunProgress['status'], string> = {
  running: 'text-primary',
  completed: 'text-success',
  failed: 'text-destructive',
  stopped: 'text-warning'
};

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  progress: RunProgress;
  summary: RunSummary;
}>();

// -------------------------------------------------- Computed --------------------------------------------------

const ringDashOffset = computed(() => {
  const progress = props.progress;
  const ratio = progress.total > 0 ? progress.finished / progress.total : 0;
  return RING_CIRCUMFERENCE * (1 - ratio);
});

const finishedArcLength = computed(() => RING_CIRCUMFERENCE - ringDashOffset.value);
const runningArcLength = computed(() => {
  const progress = props.progress;
  return progress.total > 0 ? (RING_CIRCUMFERENCE * progress.running) / progress.total : 0;
});
</script>

<template>
  <button
    type="button"
    class="flex items-center gap-2 min-w-0 text-sm text-text-muted hover:text-text-primary transition-colors"
    :title="summary.full"
    :aria-label="summary.full"
  >
    <svg
      viewBox="0 0 20 20"
      width="20"
      height="20"
      class="shrink-0 -rotate-90"
      :class="RUN_STATUS_RING_CLASS[progress.status]"
      aria-hidden="true"
    >
      <circle cx="10" cy="10" :r="RING_RADIUS" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="2.5" />
      <circle
        cx="10"
        cy="10"
        :r="RING_RADIUS"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        :stroke-dasharray="RING_CIRCUMFERENCE"
        :stroke-dashoffset="ringDashOffset"
        class="transition-[stroke-dashoffset] duration-500"
      />
      <!-- Running steps' share blinks, like the sidebar ring -->
      <circle
        v-if="progress.status === 'running' && runningArcLength > 0"
        cx="10"
        cy="10"
        :r="RING_RADIUS"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        :stroke-dasharray="`${runningArcLength} ${RING_CIRCUMFERENCE}`"
        :stroke-dashoffset="-finishedArcLength"
        class="animate-pulse"
      />
    </svg>
    <span class="truncate">{{ summary.short }}</span>
  </button>
</template>

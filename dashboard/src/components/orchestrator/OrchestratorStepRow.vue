<script setup lang="ts">
// node_modules
import { computed } from 'vue';

// classes
import { normalizeDependsOn } from '@/utils/orchestratorPayload';
import { tagColorClass as categoryColorClass } from '@/utils/tagColors';

// types
import type { SubTask } from '@/@types/index';
import type { StepStatus } from '@/composables/useOrchestratorRunState';

/** One step card of the task flow. Extracted from OrchestratorPanel.vue. */

const STEP_CARD_CLASS: Record<StepStatus, string> = {
  idle: 'border border-fg/15',
  active: 'orch-active-border',
  waiting: 'border border-warning/70',
  finishing: 'border border-dashed border-primary/50',
  done: 'border border-success/60',
  failed: 'border border-destructive/60',
  skipped: 'border border-dashed border-fg/25 opacity-70'
};

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  task: SubTask;
  index: number;
  status: StepStatus;
  isRunning: boolean;
  canEdit: boolean;
  bStartingRun: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

defineEmits<{
  (e: 'open-session'): void;
  (e: 'run-only'): void;
  (e: 'run-from'): void;
  (e: 'edit'): void;
  (e: 'delete'): void;
}>();

// -------------------------------------------------- Computed --------------------------------------------------

const dependsOnLabel = computed(() => {
  const deps = normalizeDependsOn(props.task.dependsOn);
  if (!deps.length) {
    return '';
  }
  return deps.map((dep) => String(dep + 1)).join(', ');
});
</script>

<template>
  <div
    :data-step-index="index"
    :class="['rounded-xl overflow-hidden', STEP_CARD_CLASS[status]]"
  >
    <div
      class="px-3 py-2 border-b border-fg/10 flex flex-wrap items-center gap-x-2 gap-y-1 bg-fg/[0.04] orch-card-inner"
    >
      <div class="flex items-center gap-2 min-w-0 flex-1 basis-full sm:basis-auto">
        <span
          class="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-semibold shrink-0"
        >
          {{ index + 1 }}
        </span>
        <span class="font-medium text-text-primary truncate min-w-0" :title="task.name">{{
          task.name
        }}</span>
      </div>
      <span
        v-if="status === 'active'"
        class="text-xs px-2 py-0.5 rounded-full border border-primary/40 text-primary shrink-0"
      >
        Running
      </span>
      <span
        v-else-if="status === 'finishing'"
        class="text-xs px-2 py-0.5 rounded-full border border-primary/30 text-primary/80 shrink-0"
        title="The run is stopped; this step's agent finishes its current turn"
      >
        Finishing…
      </span>
      <button
        v-else-if="status === 'waiting'"
        type="button"
        class="text-xs px-2 py-0.5 rounded-full border border-warning/50 text-warning hover:bg-warning/10 shrink-0"
        title="Answer in this step's session"
        @click="$emit('open-session')"
      >
        Needs your input
      </button>
      <span
        v-else-if="task.runResult === 'skipped'"
        class="text-xs px-2 py-0.5 rounded-full border border-fg/20 text-text-muted shrink-0"
      >
        Skipped
      </span>
      <span
        v-else-if="status === 'failed'"
        class="text-xs px-2 py-0.5 rounded-full border border-destructive/40 text-destructive shrink-0"
      >
        Failed
      </span>
      <button
        v-if="task.sessionId"
        type="button"
        class="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-fg/10 transition-colors text-xs"
        title="Open this step's session"
        @click="$emit('open-session')"
      >
        Session
      </button>
      <span
        v-if="dependsOnLabel"
        class="text-xs text-text-muted shrink-0"
        :title="'Depends on steps ' + dependsOnLabel"
      >
        after {{ dependsOnLabel }}
      </span>
      <span
        v-if="task.category"
        class="text-xs px-2 py-0.5 rounded-full border shrink-0"
        :class="categoryColorClass(task.category)"
      >
        {{ task.category }}
      </span>
      <template v-if="!isRunning">
        <button
          v-if="task.kind !== 'merge' || task.mergeRef"
          type="button"
          class="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-fg/10 transition-colors text-xs"
          :title="task.kind === 'merge' ? 'Merge the last parallel run\'s result into the workspace again' : 'Run only this step (in the workspace)'"
          :disabled="bStartingRun"
          @click="$emit('run-only')"
        >
          {{ task.kind === 'merge' ? 'Merge again' : 'Run step' }}
        </button>
        <button
          v-if="index > 0"
          type="button"
          class="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-fg/10 transition-colors text-xs"
          title="Run this and the following steps one by one"
          :disabled="bStartingRun"
          @click="$emit('run-from')"
        >
          Run from here
        </button>
      </template>
      <template v-if="canEdit && !task.kind">
        <button
          type="button"
          class="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-fg/10 transition-colors"
          title="Edit step"
          aria-label="Edit step"
          @click="$emit('edit')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" class="select-none" aria-hidden="true"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
        </button>
        <button
          type="button"
          class="p-1.5 rounded text-text-muted hover:text-destructive hover:bg-fg/10 transition-colors"
          title="Delete step"
          aria-label="Delete step"
          @click="$emit('delete')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" class="select-none" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </template>
    </div>
    <div class="px-3 py-2 text-sm text-text-muted bg-black/5 orch-card-inner">
      <p class="whitespace-pre-wrap break-words">{{ task.prompt }}</p>
      <p
        v-if="task.runNote"
        class="mt-2 text-xs whitespace-pre-wrap break-words"
        :class="status === 'failed' ? 'text-destructive' : 'text-warning'"
      >
        {{ task.runNote }}
      </p>
      <p
        v-if="status === 'waiting'"
        class="mt-2 text-xs whitespace-pre-wrap break-words text-warning"
      >
        Waiting for your answer: {{ task.waitingQuestion }}
      </p>
    </div>
  </div>
</template>

<style>
.orch-active-border {
  position: relative;
  padding: 1px;
  border-radius: 0.75rem;
  background: linear-gradient(
    90deg,
    var(--accent, #8b85ff),
    var(--agent-opencode, #50c8d6),
    var(--accent, #8b85ff)
  );
  background-size: 200% 200%;
  animation: orch-border-spin 3s linear infinite;
}

.orch-card-inner {
  border-radius: 0.75rem;
}

.orch-active-border .orch-card-inner {
  background-color: var(--bg-elev, #171614);
}

@keyframes orch-border-spin {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}
</style>

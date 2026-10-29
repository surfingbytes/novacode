<script setup lang="ts">
// node_modules
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronDown, ChevronUp } from 'lucide-vue-next';

// classes
import { formatElapsed } from '@/utils/formatElapsed';
import { normalizeDependsOn } from '@/utils/orchestratorPayload';
import { tagColorClass as categoryColorClass } from '@/utils/tagColors';

// types
import type { SubTask } from '@/@types/index';
import type { StepStatus } from '@/composables/useOrchestratorRunState';

/**
 * One step card of the task flow. Extracted from OrchestratorPanel.vue.
 * The prompt is clamped to two lines (hidden entirely for automatic merge/verify
 * steps) and finished steps carry a collapsible Result section with the step's
 * handoff note and elapsed time, so a run can be reviewed without opening sessions.
 * Manual plan actions: move up/down (editable steps), apply/discard a kept branch.
 */

const STEP_CARD_CLASS: Record<StepStatus, string> = {
  idle: 'border border-fg/15',
  active: 'orch-active-border',
  waiting: 'border border-warning/70',
  finishing: 'border border-dashed border-primary/50',
  done: 'border border-success/60',
  failed: 'border border-destructive/60',
  skipped: 'border border-dashed border-fg/25 opacity-70'
};

const TEXT_BUTTON_CLASS =
  'text-xs text-text-muted hover:text-text-primary hover:underline transition-colors shrink-0';

const ACTION_BUTTON_CLASS =
  'p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-fg/10 transition-colors text-xs disabled:opacity-40 disabled:pointer-events-none';

const ICON_BUTTON_CLASS =
  'p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-fg/10 transition-colors disabled:opacity-40 disabled:pointer-events-none';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    task: SubTask;
    index: number;
    status: StepStatus;
    isRunning: boolean;
    canEdit: boolean;
    bStartingRun: boolean;
    /** This step's block of the run's handoff log (null until the step reported). */
    handoffNote: string | null;
    /** Whether the step may swap places with the step above / below (decided by the panel). */
    bCanMoveUp?: boolean;
    bCanMoveDown?: boolean;
    /** A branch apply/discard request for this step is in flight. */
    bBranchBusy?: boolean;
  }>(),
  { bCanMoveUp: false, bCanMoveDown: false, bBranchBusy: false }
);

// -------------------------------------------------- Emits --------------------------------------------------

defineEmits<{
  (e: 'open-session'): void;
  (e: 'run-only'): void;
  (e: 'run-from'): void;
  (e: 'edit'): void;
  (e: 'delete'): void;
  (e: 'move-up'): void;
  (e: 'move-down'): void;
  (e: 'apply-branch'): void;
  (e: 'discard-branch'): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const bShowFullPrompt = ref(false);
const bShowResult = ref(false);
/** Whether the clamped prompt hides text (decides if "Show more" is offered). */
const bPromptClamped = ref(false);
const promptEl = ref<HTMLElement | null>(null);
/** Clock for the live elapsed value of a running step; refreshed once per second while ticking. */
const nowMs = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;
let promptObserver: ResizeObserver | null = null;

// -------------------------------------------------- Computed --------------------------------------------------

const dependsOnLabel = computed(() => {
  const deps = normalizeDependsOn(props.task.dependsOn);
  if (!deps.length) {
    return '';
  }
  return deps.map((dep) => String(dep + 1)).join(', ');
});

/** Merge / verify steps are generated; their prompt is noise until asked for. */
const isAutomatic = computed(() => Boolean(props.task.kind));

const bShowPrompt = computed(() => !isAutomatic.value || bShowFullPrompt.value);

const bShowPromptToggle = computed(
  () => isAutomatic.value || bShowFullPrompt.value || bPromptClamped.value
);

const hasResult = computed(
  () => props.task.runResult === 'done' || props.task.runResult === 'failed'
);

/** A failed parallel step whose changes wait on a git branch (nothing to do while a run is active). */
const bShowBranchActions = computed(() => Boolean(props.task.keptBranch) && !props.isRunning);

const bShowMoveButtons = computed(() => props.canEdit && !props.task.kind);

/** Live while the step runs (or waits for input); the stored interval afterwards. */
const bTicking = computed(
  () => Boolean(props.task.startedAt) && (props.status === 'active' || props.status === 'waiting')
);

const elapsedLabel = computed(() => {
  const start = props.task.startedAt ? new Date(props.task.startedAt).getTime() : Number.NaN;
  const end = props.task.finishedAt ? new Date(props.task.finishedAt).getTime() : nowMs.value;
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return '';
  }
  return formatElapsed(end - start);
});

const elapsedTitle = computed(() =>
  props.task.finishedAt ? 'Time the step took' : 'Time since the step started'
);

/** Body is rendered only when it has something to show (keeps automatic steps to one row). */
const bShowBody = computed(
  () =>
    bShowPrompt.value ||
    Boolean(props.task.runNote) ||
    props.status === 'waiting' ||
    (hasResult.value && bShowResult.value)
);

// -------------------------------------------------- Methods --------------------------------------------------

function startTicking(): void {
  if (tickTimer !== null) {
    return;
  }
  nowMs.value = Date.now();
  tickTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
}

function stopTicking(): void {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function measurePrompt(): void {
  const el = promptEl.value;
  if (!el || bShowFullPrompt.value) {
    return;
  }
  bPromptClamped.value = el.scrollHeight > el.clientHeight + 1;
}

function observePrompt(): void {
  promptObserver?.disconnect();
  promptObserver = null;
  const el = promptEl.value;
  if (!el || typeof ResizeObserver === 'undefined') {
    return;
  }
  promptObserver = new ResizeObserver(measurePrompt);
  promptObserver.observe(el);
}

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  bTicking,
  (ticking) => {
    if (ticking) {
      startTicking();
    } else {
      stopTicking();
    }
  },
  { immediate: true }
);

watch([promptEl, () => props.task.prompt, bShowFullPrompt], async () => {
  await nextTick();
  observePrompt();
  measurePrompt();
});

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  observePrompt();
  measurePrompt();
});

onBeforeUnmount(() => {
  stopTicking();
  promptObserver?.disconnect();
  promptObserver = null;
});
</script>

<template>
  <div
    :data-step-index="index"
    :class="['rounded-xl overflow-hidden', STEP_CARD_CLASS[status]]"
  >
    <div
      class="px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1 bg-fg/[0.04] orch-card-inner"
      :class="bShowBody ? 'border-b border-fg/10' : ''"
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
      <span
        v-if="elapsedLabel"
        class="text-xs text-text-muted tabular-nums shrink-0"
        :title="elapsedTitle"
        data-testid="step-elapsed"
      >
        {{ elapsedLabel }}
      </span>
      <button
        v-if="hasResult"
        type="button"
        :class="TEXT_BUTTON_CLASS"
        :aria-expanded="bShowResult"
        :title="bShowResult ? 'Hide this step\'s report' : 'Show this step\'s report'"
        data-testid="step-result-toggle"
        @click="bShowResult = !bShowResult"
      >
        Result {{ bShowResult ? '▾' : '▸' }}
      </button>
      <button
        v-if="isAutomatic && bShowPromptToggle"
        type="button"
        :class="TEXT_BUTTON_CLASS"
        :aria-expanded="bShowFullPrompt"
        data-testid="step-prompt-toggle"
        @click="bShowFullPrompt = !bShowFullPrompt"
      >
        {{ bShowFullPrompt ? 'Show less' : 'Show more' }}
      </button>
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
      <template v-if="bShowBranchActions">
        <button
          type="button"
          :class="ACTION_BUTTON_CLASS"
          title="Apply this branch's changes to the workspace as uncommitted changes"
          :disabled="bBranchBusy"
          data-testid="step-apply-branch"
          @click="$emit('apply-branch')"
        >
          Apply branch
        </button>
        <button
          type="button"
          :class="[ACTION_BUTTON_CLASS, 'hover:text-destructive']"
          title="Delete this branch; its changes are lost"
          :disabled="bBranchBusy"
          data-testid="step-discard-branch"
          @click="$emit('discard-branch')"
        >
          Discard branch
        </button>
      </template>
      <template v-if="!isRunning">
        <button
          v-if="task.kind !== 'merge' || task.mergeRef"
          type="button"
          :class="ACTION_BUTTON_CLASS"
          :title="task.kind === 'merge' ? 'Merge the last parallel run\'s result into the workspace again' : 'Run only this step (in the workspace)'"
          :disabled="bStartingRun"
          @click="$emit('run-only')"
        >
          {{ task.kind === 'merge' ? 'Merge again' : 'Run step' }}
        </button>
        <button
          v-if="index > 0"
          type="button"
          :class="ACTION_BUTTON_CLASS"
          title="Run this and the following steps one by one"
          :disabled="bStartingRun"
          @click="$emit('run-from')"
        >
          Run from here
        </button>
      </template>
      <template v-if="bShowMoveButtons">
        <button
          type="button"
          :class="ICON_BUTTON_CLASS"
          title="Move up"
          aria-label="Move up"
          :disabled="!bCanMoveUp"
          data-testid="step-move-up"
          @click="$emit('move-up')"
        >
          <ChevronUp :size="18" aria-hidden="true" />
        </button>
        <button
          type="button"
          :class="ICON_BUTTON_CLASS"
          title="Move down"
          aria-label="Move down"
          :disabled="!bCanMoveDown"
          data-testid="step-move-down"
          @click="$emit('move-down')"
        >
          <ChevronDown :size="18" aria-hidden="true" />
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
    <div v-if="bShowBody" class="px-3 py-2 text-sm text-text-muted bg-black/5 orch-card-inner">
      <template v-if="bShowPrompt">
        <p
          ref="promptEl"
          class="whitespace-pre-wrap break-words"
          :class="bShowFullPrompt ? '' : 'line-clamp-2'"
          data-testid="step-prompt"
        >
          {{ task.prompt }}
        </p>
        <button
          v-if="!isAutomatic && bShowPromptToggle"
          type="button"
          :class="[TEXT_BUTTON_CLASS, 'mt-1']"
          :aria-expanded="bShowFullPrompt"
          data-testid="step-prompt-toggle"
          @click="bShowFullPrompt = !bShowFullPrompt"
        >
          {{ bShowFullPrompt ? 'Show less' : 'Show more' }}
        </button>
      </template>
      <p
        v-if="task.runNote"
        class="text-xs whitespace-pre-wrap break-words"
        :class="[status === 'failed' ? 'text-destructive' : 'text-warning', bShowPrompt ? 'mt-2' : '']"
      >
        {{ task.runNote }}
      </p>
      <p
        v-if="status === 'waiting'"
        class="mt-2 text-xs whitespace-pre-wrap break-words text-warning"
      >
        Waiting for your answer: {{ task.waitingQuestion }}
      </p>
      <div
        v-if="hasResult && bShowResult"
        class="mt-2 pt-2 border-t border-fg/10"
        data-testid="step-result"
      >
        <div class="flex items-center gap-2 text-xs text-text-muted mb-1">
          <span class="font-medium text-text-primary">Result</span>
          <span v-if="elapsedLabel" class="tabular-nums">· took {{ elapsedLabel }}</span>
        </div>
        <pre
          v-if="handoffNote"
          class="whitespace-pre-wrap break-words font-mono text-xs max-h-80 overflow-y-auto"
        >{{ handoffNote }}</pre>
        <p v-else class="text-xs italic">No report recorded for this step.</p>
      </div>
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

/**
 * Orchestrator run state derived from the server copy: parsed plan payload,
 * step counts, run progress and its summary, run preconditions, plus
 * starting/stopping a run. Extracted from OrchestratorPanel.vue.
 */

// node_modules
import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';

// classes
import { apiErrorMessage, orchestratorApi } from '@/classes/api';
import { safeGetItem, safeSetItem } from '@/lib/safeLocalStorage';
import { parseSubtasksPayloadString } from '@/utils/orchestratorPayload';

// types
import type { Orchestrator, OrchestratorRunMode, SubTask } from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

export type RunChoice = OrchestratorRunMode | 'sequential-fresh' | 'parallel-fresh' | 'next';

export type StepStatus = 'idle' | 'active' | 'waiting' | 'finishing' | 'done' | 'failed' | 'skipped';

export interface RunProgress {
  status: 'running' | 'completed' | 'failed' | 'stopped';
  finished: number;
  running: number;
  total: number;
}

export interface RunSummary {
  short: string;
  full: string;
}

export interface UseOrchestratorRunStateOptions {
  workspaceId: MaybeRefOrGetter<string>;
  orchestratorId: MaybeRefOrGetter<string>;
  orchestrator: MaybeRefOrGetter<Orchestrator | null>;
  /** Called with the server copy after a run was started or stopped */
  onUpdate: (orchestrator: Orchestrator) => void;
}

// -------------------------------------------------- Constants --------------------------------------------------

const RUN_MODE_STORAGE_KEY = 'nova:orchestrator:runMode';

// -------------------------------------------------- Helpers --------------------------------------------------

/** Base run mode of a choice (null for `next`), with the fresh variants folded in. */
function runModeOfChoice(choice: RunChoice): OrchestratorRunMode | null {
  switch (choice) {
    case 'sequential':
    case 'sequential-fresh':
      return 'sequential';
    case 'parallel':
    case 'parallel-fresh':
      return 'parallel';
    default:
      return null;
  }
}

function changedFilesLabel(count: number): string {
  if (count === 0) return 'no file changes';
  return count === 1 ? '1 file changed' : `${count} files changed`;
}

// -------------------------------------------------- Composable --------------------------------------------------

export function useOrchestratorRunState(options: UseOrchestratorRunStateOptions) {
  const orchestrator = computed(() => toValue(options.orchestrator));

  const bStartingRun = ref(false);
  const bStopping = ref(false);
  const runError = ref<string | null>(null);
  const preferredRunMode = ref<OrchestratorRunMode>(
    safeGetItem(RUN_MODE_STORAGE_KEY) === 'parallel' ? 'parallel' : 'sequential'
  );
  /** Why a parallel run cannot start right now (null = it can, or unknown) */
  const parallelBlockedReason = ref<string | null>(null);

  const isRunning = computed(() => orchestrator.value?.runStatus === 'running');
  const maxParallel = computed(() => orchestrator.value?.maxParallel ?? 3);

  const planPayload = computed(() => parseSubtasksPayloadString(orchestrator.value?.subtasksJson));
  const subtasks = computed<SubTask[]>(() => planPayload.value?.subtasks ?? []);
  const sharedContextDisplay = computed(() => planPayload.value?.sharedContext?.trim() ?? '');
  const handoffLogDisplay = computed(() => planPayload.value?.handoffLog?.trim() ?? '');
  const failedStepCount = computed(() => subtasks.value.filter((task) => task.runResult === 'failed').length);
  const skippedStepCount = computed(() => subtasks.value.filter((task) => task.runResult === 'skipped').length);
  const runningStepCount = computed(() => subtasks.value.filter((task) => task.runResult === 'running').length);
  const waitingStepCount = computed(() =>
    isRunning.value ? subtasks.value.filter((task) => task.runResult === 'running' && task.waitingQuestion).length : 0
  );
  const finishedStepCount = computed(
    () => subtasks.value.filter((task) => task.runResult && task.runResult !== 'running').length
  );

  const runProgress = computed<RunProgress | null>(() => {
    const status = orchestrator.value?.runStatus;
    if (status === 'running' || status === 'completed' || status === 'failed' || status === 'stopped') {
      return { status, finished: finishedStepCount.value, running: runningStepCount.value, total: subtasks.value.length };
    }
    return null;
  });

  // Short label beside the ring; the full sentence goes to the title
  const runSummary = computed<RunSummary>(() => {
    const progress = runProgress.value;
    if (!progress) {
      return { short: '', full: '' };
    }
    const parts = [`${progress.finished}/${progress.total}`];
    if (progress.status === 'running') {
      if (progress.running) parts.push(`${progress.running} running`);
      if (waitingStepCount.value) parts.push(`${waitingStepCount.value} waiting`);
    } else if (progress.status === 'failed') {
      parts.push(`${failedStepCount.value} failed`);
      if (skippedStepCount.value) parts.push(`${skippedStepCount.value} skipped`);
    } else if (progress.status === 'stopped') {
      parts.push('stopped');
    }
    const changedFiles = orchestrator.value?.runChangedFiles;
    if (progress.status !== 'running' && typeof changedFiles === 'number') {
      parts.push(changedFilesLabel(changedFiles));
    }
    const prefix =
      progress.status === 'running'
        ? orchestrator.value?.runMode === 'parallel'
          ? 'Running in parallel'
          : 'Running'
        : progress.status === 'completed'
          ? 'Completed'
          : progress.status === 'failed'
            ? 'Finished with failures'
            : 'Stopped';
    return { short: parts.join(' · '), full: `${prefix}: ${[`${parts[0]} finished`, ...parts.slice(1)].join(', ')}` };
  });

  async function startRun(choice: RunChoice, opts: { startIndex?: number; onlyIndex?: number } = {}) {
    if (subtasks.value.length === 0 || isRunning.value) {
      return;
    }
    const mode = runModeOfChoice(choice);
    const fresh = choice === 'sequential-fresh' || choice === 'parallel-fresh';
    if (mode && opts.onlyIndex === undefined && opts.startIndex === undefined) {
      preferredRunMode.value = mode;
      safeSetItem(RUN_MODE_STORAGE_KEY, mode);
    }
    runError.value = null;
    bStartingRun.value = true;
    try {
      const body = !mode
        ? { next: true }
        : {
            mode,
            ...(fresh ? { fresh: true } : {}),
            ...(opts.onlyIndex !== undefined ? { onlyIndex: opts.onlyIndex } : {}),
            ...(opts.startIndex !== undefined ? { startIndex: opts.startIndex } : {})
          };
      const { data } = await orchestratorApi.run(toValue(options.workspaceId), toValue(options.orchestratorId), body);
      if (data) {
        options.onUpdate(data);
      }
    } catch (e: unknown) {
      runError.value = apiErrorMessage(e, 'Run failed');
    } finally {
      bStartingRun.value = false;
    }
  }

  /** Ask the server whether a parallel run can start; errors count as not blocked. */
  async function refreshRunPreconditions() {
    const workspaceId = toValue(options.workspaceId);
    const orchestratorId = toValue(options.orchestratorId);
    try {
      const { data } = await orchestratorApi.runPreconditions(workspaceId, orchestratorId);
      // Ignore a late answer for a previously shown orchestrator
      if (toValue(options.orchestratorId) === orchestratorId) {
        parallelBlockedReason.value = data?.parallelBlockedReason ?? null;
      }
    } catch {
      parallelBlockedReason.value = null;
    }
  }

  // Once up front, then again when a run ends or another orchestrator is shown
  void refreshRunPreconditions();
  watch(isRunning, (running, wasRunning) => {
    if (wasRunning && !running) void refreshRunPreconditions();
  });
  watch(
    () => toValue(options.orchestratorId),
    () => {
      parallelBlockedReason.value = null;
      void refreshRunPreconditions();
    }
  );

  async function stopTasks() {
    if (!isRunning.value) {
      return;
    }
    runError.value = null;
    bStopping.value = true;
    try {
      const { data } = await orchestratorApi.stop(toValue(options.workspaceId), toValue(options.orchestratorId));
      if (data) {
        options.onUpdate(data);
      }
    } catch (e: unknown) {
      runError.value = apiErrorMessage(e, 'Failed to stop run');
    } finally {
      bStopping.value = false;
    }
  }

  return {
    bStartingRun,
    bStopping,
    runError,
    preferredRunMode,
    parallelBlockedReason,
    isRunning,
    maxParallel,
    subtasks,
    sharedContextDisplay,
    handoffLogDisplay,
    runProgress,
    runSummary,
    startRun,
    refreshRunPreconditions,
    stopTasks
  };
}

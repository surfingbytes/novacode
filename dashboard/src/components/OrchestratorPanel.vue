<script setup lang="ts">
// node_modules
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronDown, MessageSquare } from 'lucide-vue-next';

// components
import BaseModal from '@/components/BaseModal.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';
import AgentModelPicker from '@/components/AgentModelPicker.vue';
import UiToggle from '@/components/ui/UiToggle.vue';

// classes
import { apiErrorMessage, orchestratorApi, settingsApi } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';
import { safeGetItem, safeSetItem } from '@/lib/safeLocalStorage';
import {
  normalizeDependsOn,
  parseSubtasksPayloadString,
  remapDependsOnAfterDelete,
  serializeSubtasksPayload
} from '@/utils/orchestratorPayload';
import { tagColorClass as categoryColorClass } from '@/utils/tagColors';
import { agentTypeLabel } from '@/utils/agentTypeMeta';

// stores
import { useOrchestratorsStore } from '@/stores/orchestrators';
import { useWorkspacesStore } from '@/stores/workspaces';

// types
import type { AgentModelOption, AgentType, Orchestrator, OrchestratorRunMode, SubTask } from '@/@types/index';

const RUN_MODE_STORAGE_KEY = 'nova:orchestrator:runMode';
const AGENT_TYPES: AgentType[] = ['cursor-agent', 'claude', 'mistral-vibe', 'open-code', 'codex'];
const MAX_PARALLEL_CHOICES = [1, 2, 3, 4, 5, 6, 8];
const AUTO_MODEL_OPTION: AgentModelOption = { id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null };

type RunChoice = OrchestratorRunMode | 'parallel-fresh' | 'next';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  workspaceId: string;
  orchestratorId: string;
  orchestrator: Orchestrator | null;
  /** Shown as a tab inside the planning chat (no "open chat" navigation). */
  bEmbedded?: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'update:orchestrator', orchestrator: Orchestrator): void;
  /** Embedded: switch back to the planning chat tab. */
  (e: 'open-chat'): void;
}>();

// -------------------------------------------------- Store --------------------------------------------------

const router = useRouter();
const orchestratorsStore = useOrchestratorsStore();
const workspacesStore = useWorkspacesStore();

// -------------------------------------------------- Refs --------------------------------------------------

const bStartingRun = ref(false);
const bStopping = ref(false);
const bCloning = ref(false);
const bSavingSubtasks = ref(false);
const bSavingSettings = ref(false);
const bCreatingPlanner = ref(false);
const runError = ref<string | null>(null);
const editedSubtasks = ref<SubTask[]>([]);
const bShowEditModal = ref(false);
const editingTaskIndex = ref<number | null>(null);
const editDraft = ref<SubTask>({ name: '', prompt: '', category: null });
const bRunMenuOpen = ref(false);
const preferredRunMode = ref<OrchestratorRunMode>(
  safeGetItem(RUN_MODE_STORAGE_KEY) === 'parallel' ? 'parallel' : 'sequential'
);
const workerModelOptions = ref<AgentModelOption[]>([]);
const bLoadingWorkerModels = ref(false);
const verifyModelOptions = ref<AgentModelOption[]>([]);
const bLoadingVerifyModels = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);

// -------------------------------------------------- Computed --------------------------------------------------

const isRunning = computed(() => props.orchestrator?.runStatus === 'running');
const canEdit = computed(() => !isRunning.value);
const plannerSession = computed(() => {
  const id = props.orchestrator?.sourceSessionId;
  return id ? workspacesStore.allSessions.find((session) => session.id === id) ?? null : null;
});
const bHasPlanner = computed(() => !!props.orchestrator?.sourceSessionId);
const workerAgentType = computed<AgentType>(() => (props.orchestrator?.agentType ?? 'cursor-agent'));
const bWorkersUsePlannerModel = computed(() => !props.orchestrator?.workerModel);
const maxParallel = computed(() => props.orchestrator?.maxParallel ?? 3);
const bVerifyUsesPlanner = computed(() => !props.orchestrator?.verifyAgentType);
const verifyAgentType = computed<AgentType>(
  () => (props.orchestrator?.verifyAgentType ?? plannerSession.value?.agentType ?? workerAgentType.value)
);

const planPayload = computed(() => parseSubtasksPayloadString(props.orchestrator?.subtasksJson));
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

const runProgress = computed(() => {
  const status = props.orchestrator?.runStatus;
  if (status === 'running' || status === 'completed' || status === 'failed' || status === 'stopped') {
    return { status, finished: finishedStepCount.value, running: runningStepCount.value, total: subtasks.value.length };
  }
  return null;
});

const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const RUN_STATUS_RING_CLASS: Record<NonNullable<typeof runProgress.value>['status'], string> = {
  running: 'text-primary',
  completed: 'text-success',
  failed: 'text-destructive',
  stopped: 'text-warning'
};

const ringDashOffset = computed(() => {
  const progress = runProgress.value;
  const ratio = progress && progress.total > 0 ? progress.finished / progress.total : 0;
  return RING_CIRCUMFERENCE * (1 - ratio);
});

// Short label beside the ring; the full sentence goes to the title
const runSummary = computed(() => {
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
  const prefix =
    progress.status === 'running'
      ? props.orchestrator?.runMode === 'parallel'
        ? 'Running in parallel'
        : 'Running'
      : progress.status === 'completed'
        ? 'Completed'
        : progress.status === 'failed'
          ? 'Finished with failures'
          : 'Stopped';
  return { short: parts.join(' · '), full: `${prefix}: ${[`${parts[0]} finished`, ...parts.slice(1)].join(', ')}` };
});

const runChoices = computed<{ id: RunChoice; label: string; hint: string }[]>(() => [
  { id: 'sequential', label: 'Run one by one', hint: 'Every step in the workspace, in order' },
  {
    id: 'parallel',
    label: 'Run in parallel',
    hint: `Up to ${maxParallel.value} at once, each in its own git worktree; merged back automatically. Done steps are kept`
  },
  { id: 'parallel-fresh', label: 'Run all again in parallel', hint: 'Like Run in parallel, but done steps run again too' },
  { id: 'next', label: 'Run next step', hint: 'Only the first step that is ready' }
]);
const mainRunLabel = computed(() => (preferredRunMode.value === 'parallel' ? 'Run in parallel' : 'Run one by one'));

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.orchestrator?.subtasksJson,
  (json) => {
    const payload = parseSubtasksPayloadString(json);
    editedSubtasks.value = payload?.subtasks?.length ? payload.subtasks.map((t) => ({ ...t })) : [];
  },
  { immediate: true }
);

watch(
  [workerAgentType, bWorkersUsePlannerModel],
  async ([agent, bSame]) => {
    if (bSame) return;
    bLoadingWorkerModels.value = true;
    try {
      const { data } = await settingsApi.getAgentOptions(agent);
      workerModelOptions.value = data.models.length > 0 ? data.models : [AUTO_MODEL_OPTION];
    } catch {
      workerModelOptions.value = [AUTO_MODEL_OPTION];
    } finally {
      bLoadingWorkerModels.value = false;
    }
  },
  { immediate: true }
);

watch(
  [verifyAgentType, bVerifyUsesPlanner],
  async ([agent, bSame]) => {
    if (bSame) return;
    bLoadingVerifyModels.value = true;
    try {
      const { data } = await settingsApi.getAgentOptions(agent);
      verifyModelOptions.value = data.models.length > 0 ? data.models : [AUTO_MODEL_OPTION];
    } catch {
      verifyModelOptions.value = [AUTO_MODEL_OPTION];
    } finally {
      bLoadingVerifyModels.value = false;
    }
  },
  { immediate: true }
);

const hasEdits = computed(() => {
  const a = editedSubtasks.value;
  const b = subtasks.value;
  if (a.length !== b.length) {
    return true;
  }
  return a.some((task, index) => {
    const other = b[index];
    const leftDeps = normalizeDependsOn(task.dependsOn).join(',');
    const rightDeps = normalizeDependsOn(other?.dependsOn).join(',');
    return (
      task.name !== other?.name ||
      task.prompt !== other?.prompt ||
      task.category !== other?.category ||
      leftDeps !== rightDeps
    );
  });
});

// -------------------------------------------------- Methods --------------------------------------------------

function taskStatus(index: number): 'idle' | 'active' | 'waiting' | 'finishing' | 'done' | 'failed' | 'skipped' {
  const task = editedSubtasks.value[index] ?? subtasks.value[index];
  if (task?.runResult === 'running') {
    // After a stop the step's agent keeps working until its turn ends; a restart leaves "running" behind.
    if (!isRunning.value) return isStepSessionBusy(task) ? 'finishing' : 'failed';
    return task.waitingQuestion ? 'waiting' : 'active';
  }
  return task?.runResult ?? 'idle';
}

// Step that needs attention first: waiting > failed > running > not started; null when all are finished
function attentionStepIndex(): number | null {
  const statuses = editedSubtasks.value.map((_, i) => taskStatus(i));
  for (const wanted of [['waiting'], ['failed'], ['active', 'finishing'], ['idle']]) {
    const index = statuses.findIndex((status) => wanted.includes(status));
    if (index >= 0) {
      return index;
    }
  }
  return null;
}

function scrollToAttentionStep(behavior: ScrollBehavior) {
  const container = scrollContainer.value;
  if (!container) {
    return;
  }
  const index = attentionStepIndex();
  const card = index === null ? null : container.querySelector(`[data-step-index="${index}"]`);
  if (card) {
    card.scrollIntoView({ behavior, block: 'center' });
  } else {
    container.scrollTo({ top: container.scrollHeight, behavior });
  }
}

const STEP_CARD_CLASS: Record<ReturnType<typeof taskStatus>, string> = {
  idle: 'border border-fg/15',
  active: 'orch-active-border',
  waiting: 'border border-warning/70',
  finishing: 'border border-dashed border-primary/50',
  done: 'border border-success/60',
  failed: 'border border-destructive/60',
  skipped: 'border border-dashed border-fg/25 opacity-70'
};

function isStepSessionBusy(task: SubTask): boolean {
  return !!task.sessionId && !!workspacesStore.allSessions.find((session) => session.id === task.sessionId)?.busy;
}

function openEditModal(index: number) {
  const task = editedSubtasks.value[index];
  if (!task) {
    return;
  }
  editingTaskIndex.value = index;
  editDraft.value = {
    name: task.name,
    prompt: task.prompt,
    category: task.category ?? null,
    dependsOn: [...normalizeDependsOn(task.dependsOn)]
  };
  bShowEditModal.value = true;
}

function closeEditModal() {
  bShowEditModal.value = false;
  editingTaskIndex.value = null;
}

function saveEditFromModal() {
  const i = editingTaskIndex.value;
  if (i === null || i < 0 || i >= editedSubtasks.value.length) {
    closeEditModal();
    return;
  }
  const list = [...editedSubtasks.value];
  const prev = list[i];
  const category = editDraft.value.category?.trim() || null;
  const dependsOn = normalizeDependsOn(editDraft.value.dependsOn).filter((dep) => dep < i);
  const next: SubTask = {
    ...prev,
    name: editDraft.value.name.trim() || prev.name,
    prompt: editDraft.value.prompt.trim() || prev.prompt,
    category
  };
  if (dependsOn.length > 0) {
    next.dependsOn = dependsOn;
  } else {
    delete next.dependsOn;
  }
  list[i] = next;
  editedSubtasks.value = list;
  closeEditModal();
  void saveSubtasks();
}

async function saveSubtasks(): Promise<boolean> {
  if (!hasEdits.value || !props.orchestrator) {
    return true;
  }
  bSavingSubtasks.value = true;
  try {
    const prev = parseSubtasksPayloadString(props.orchestrator.subtasksJson);
    const nextPayload = {
      sharedContext: prev?.sharedContext ?? '',
      handoffLog: prev?.handoffLog ?? '',
      subtasks: editedSubtasks.value
    };
    const { data } = await orchestratorApi.update(props.workspaceId, props.orchestratorId, {
      subtasksJson: serializeSubtasksPayload(nextPayload)
    });
    if (data) {
      emit('update:orchestrator', data);
    }
    return true;
  } catch (err: unknown) {
    notifyApiError(err, 'Failed to save tasks');
    return false;
  } finally {
    bSavingSubtasks.value = false;
  }
}

async function saveRunSettings(patch: {
  agentType?: AgentType;
  workerModel?: string | null;
  maxParallel?: number;
  verifyAgentType?: AgentType | null;
  verifyModel?: string | null;
}) {
  bSavingSettings.value = true;
  try {
    const { data } = await orchestratorApi.update(props.workspaceId, props.orchestratorId, patch);
    if (data) {
      emit('update:orchestrator', data);
    }
  } catch (err: unknown) {
    notifyApiError(err, 'Failed to save run settings');
  } finally {
    bSavingSettings.value = false;
  }
}

function onWorkerAgentChange(event: Event): void {
  const agent = (event.target as HTMLSelectElement).value as AgentType;
  // The old model id belongs to the old agent.
  void saveRunSettings({ agentType: agent, workerModel: null });
}

function onSamePlannerModelToggle(bSame: boolean): void {
  void saveRunSettings({ workerModel: bSame ? null : 'auto' });
}

function onVerifyAgentChange(event: Event): void {
  const agent = (event.target as HTMLSelectElement).value as AgentType;
  void saveRunSettings({ verifyAgentType: agent, verifyModel: 'auto' });
}

function onVerifySamePlannerToggle(bSame: boolean): void {
  // Turning it off starts from the planning chat's current agent and model.
  const planner = plannerSession.value;
  void saveRunSettings(
    bSame
      ? { verifyAgentType: null, verifyModel: null }
      : { verifyAgentType: verifyAgentType.value, verifyModel: planner?.modelSelection || 'auto' }
  );
}

async function startRun(choice: RunChoice, opts: { startIndex?: number; onlyIndex?: number } = {}) {
  bRunMenuOpen.value = false;
  if (subtasks.value.length === 0 || isRunning.value) {
    return;
  }
  const mode: OrchestratorRunMode | null = choice === 'next' ? null : choice === 'parallel-fresh' ? 'parallel' : choice;
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
          ...(choice === 'parallel-fresh' ? { fresh: true } : {}),
          ...(opts.onlyIndex !== undefined ? { onlyIndex: opts.onlyIndex } : {}),
          ...(opts.startIndex !== undefined ? { startIndex: opts.startIndex } : {})
        };
    const { data } = await orchestratorApi.run(props.workspaceId, props.orchestratorId, body);
    if (data) {
      emit('update:orchestrator', data);
    }
  } catch (e: unknown) {
    runError.value = apiErrorMessage(e, 'Run failed');
  } finally {
    bStartingRun.value = false;
  }
}

async function stopTasks() {
  if (!isRunning.value) {
    return;
  }
  runError.value = null;
  bStopping.value = true;
  try {
    const { data } = await orchestratorApi.stop(props.workspaceId, props.orchestratorId);
    if (data) {
      emit('update:orchestrator', data);
    }
  } catch (e: unknown) {
    runError.value = apiErrorMessage(e, 'Failed to stop run');
  } finally {
    bStopping.value = false;
  }
}

// Index of the step awaiting delete confirmation
const pendingDelete = ref<number | null>(null);

const pendingDeleteDescription = computed(() => {
  const index = pendingDelete.value;
  if (index === null) {
    return '';
  }
  const name = editedSubtasks.value[index]?.name || `step ${index + 1}`;
  return `Delete step ${index + 1} '${name}'? Steps that depend on it lose that dependency.`;
});

async function removeTask(): Promise<void> {
  const index = pendingDelete.value;
  if (index === null) {
    return;
  }
  const without = editedSubtasks.value.filter((_, i) => i !== index);
  editedSubtasks.value = remapDependsOnAfterDelete(without, index);
  // On failure saveSubtasks toasts and the change stays unsaved behind "Save changes"
  await saveSubtasks();
  pendingDelete.value = null;
}

function toggleDependsOn(depIndex: number) {
  const current = new Set(normalizeDependsOn(editDraft.value.dependsOn));
  if (current.has(depIndex)) {
    current.delete(depIndex);
  } else {
    current.add(depIndex);
  }
  editDraft.value = {
    ...editDraft.value,
    dependsOn: [...current].sort((left, right) => left - right)
  };
}

function dependsOnLabel(task: SubTask): string {
  const deps = normalizeDependsOn(task.dependsOn);
  if (!deps.length) {
    return '';
  }
  return deps.map((dep) => String(dep + 1)).join(', ');
}

function openStepSession(task: SubTask): void {
  if (!task.sessionId) return;
  void router.push({ name: 'session', params: { id: props.workspaceId, sessionId: task.sessionId } });
}

function openPlanningChat(): void {
  if (props.bEmbedded) {
    emit('open-chat');
    return;
  }
  const sessionId = props.orchestrator?.sourceSessionId;
  if (!sessionId) return;
  void router.push({ name: 'session', params: { id: props.workspaceId, sessionId } });
}

async function startPlanningChat(): Promise<void> {
  if (bCreatingPlanner.value) return;
  bCreatingPlanner.value = true;
  try {
    const { data } = await orchestratorApi.createPlanner(props.workspaceId, props.orchestratorId);
    emit('update:orchestrator', data);
    if (data.sourceSessionId) {
      await router.push({
        name: 'session',
        params: { id: props.workspaceId, sessionId: data.sourceSessionId },
        query: { tab: 'orchestrator' }
      });
    }
  } catch (e: unknown) {
    notifyApiError(e, 'Failed to start a planning chat');
  } finally {
    bCreatingPlanner.value = false;
  }
}

function closeRunMenu(): void {
  bRunMenuOpen.value = false;
}

async function clonePlan() {
  if (bCloning.value) {
    return;
  }
  bCloning.value = true;
  try {
    const { data } = await orchestratorApi.clone(props.workspaceId, props.orchestratorId);
    if (data) {
      orchestratorsStore.upsertOrchestrator(data);
      await router.push({
        name: 'orchestrator',
        params: { id: props.workspaceId, orchestratorId: data.id }
      });
    }
  } catch (err: unknown) {
    notifyApiError(err, 'Failed to clone plan');
  } finally {
    bCloning.value = false;
  }
}

// -------------------------------------------------- Lifecycle --------------------------------------------------

// Jump to the step that needs attention once per opened plan; live updates don't move the view.
// A plan that never ran stays at the top so its settings are visible.
async function scrollOnOpen() {
  if (!runProgress.value) {
    return;
  }
  await nextTick();
  scrollToAttentionStep('auto');
}

watch(() => props.orchestratorId, scrollOnOpen);

onMounted(() => {
  document.addEventListener('click', closeRunMenu);
  void scrollOnOpen();
});

onBeforeUnmount(() => {
  document.removeEventListener('click', closeRunMenu);
});
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden min-h-0">
    <div ref="scrollContainer" class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
      <!-- Planning chat: where the plan is written and adjusted -->
      <div class="rounded-xl border border-fg/15 bg-fg/[0.04] px-3 py-2.5 flex flex-wrap items-center gap-3">
        <MessageSquare :size="16" :stroke-width="1.6" class="text-text-muted shrink-0" aria-hidden="true" />
        <p class="text-sm text-text-muted flex-1 min-w-[12rem]">
          <template v-if="bHasPlanner">
            The planning chat<span v-if="plannerSession"> <strong class="text-text-primary font-medium">{{ plannerSession.name || 'Untitled session' }}</strong></span>
            writes these steps and the spec every step reads. Ask it there to change the plan.
          </template>
          <template v-else>
            This plan has no planning chat. Start one to have an agent write and adjust the steps.
          </template>
        </p>
        <button
          v-if="bHasPlanner && !bEmbedded"
          type="button"
          class="px-3 py-1.5 text-sm font-medium border border-fg/20 text-text-primary rounded-lg hover:bg-fg/[0.06] transition-colors"
          @click="openPlanningChat"
        >
          Open planning chat
        </button>
        <button
          v-else-if="bHasPlanner"
          type="button"
          class="px-3 py-1.5 text-sm font-medium border border-fg/20 text-text-primary rounded-lg hover:bg-fg/[0.06] transition-colors"
          @click="openPlanningChat"
        >
          Back to chat
        </button>
        <button
          v-else
          type="button"
          class="px-3 py-1.5 text-sm font-medium border border-fg/20 text-text-primary rounded-lg hover:bg-fg/[0.06] transition-colors disabled:opacity-60"
          :disabled="bCreatingPlanner"
          @click="startPlanningChat"
        >
          {{ bCreatingPlanner ? 'Starting…' : 'Start planning chat' }}
        </button>
      </div>

      <!-- Workers: agent + model for the step sessions -->
      <div class="rounded-xl border border-fg/15 overflow-hidden">
        <div class="px-3 py-2 border-b border-fg/10 bg-fg/[0.04]">
          <span class="text-sm font-medium text-text-primary">Workers</span>
          <p class="text-xs text-text-muted mt-0.5">Agent and model of the step sessions.</p>
        </div>
        <div class="px-3 py-3 flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <label class="text-xs text-text-muted w-28 shrink-0" for="orch-worker-agent">Agent</label>
            <select
              id="orch-worker-agent"
              class="text-sm px-2 py-1.5 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary"
              :value="workerAgentType"
              :disabled="!canEdit || bSavingSettings"
              @change="onWorkerAgentChange"
            >
              <option v-for="agent in AGENT_TYPES" :key="agent" :value="agent">{{ agentTypeLabel(agent) }}</option>
            </select>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-xs text-text-muted w-28 shrink-0">Same model as planning chat</span>
            <UiToggle
              :model-value="bWorkersUsePlannerModel"
              :disabled="!canEdit || bSavingSettings"
              aria-label="Workers use the planning chat's model"
              @update:model-value="onSamePlannerModelToggle"
            />
          </div>
          <div v-if="!bWorkersUsePlannerModel" class="flex flex-wrap items-center gap-3">
            <span class="text-xs text-text-muted w-28 shrink-0">Model</span>
            <div class="min-w-[14rem]">
              <AgentModelPicker
                :model-value="orchestrator?.workerModel ?? 'auto'"
                :agent-type="workerAgentType"
                :model-options="workerModelOptions"
                :disabled="!canEdit || bSavingSettings || bLoadingWorkerModels"
                variant="modal"
                @update:model-value="saveRunSettings({ workerModel: $event })"
              />
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <label class="text-xs text-text-muted w-28 shrink-0" for="orch-max-parallel">Parallel at once</label>
            <select
              id="orch-max-parallel"
              class="text-sm px-2 py-1.5 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary"
              :value="maxParallel"
              :disabled="!canEdit || bSavingSettings"
              @change="saveRunSettings({ maxParallel: Number(($event.target as HTMLSelectElement).value) })"
            >
              <option v-for="count in MAX_PARALLEL_CHOICES" :key="count" :value="count">{{ count }}</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Verification: agent + model for the final "Verify against spec" step -->
      <div class="rounded-xl border border-fg/15 overflow-hidden">
        <div class="px-3 py-2 border-b border-fg/10 bg-fg/[0.04]">
          <span class="text-sm font-medium text-text-primary">Verification</span>
          <p class="text-xs text-text-muted mt-0.5">Agent and model of the final verify step.</p>
        </div>
        <div class="px-3 py-3 flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-xs text-text-muted w-28 shrink-0">Same as planning chat</span>
            <UiToggle
              :model-value="bVerifyUsesPlanner"
              :disabled="!canEdit || bSavingSettings"
              aria-label="Verification uses the planning chat's agent and model"
              @update:model-value="onVerifySamePlannerToggle"
            />
          </div>
          <template v-if="!bVerifyUsesPlanner">
            <div class="flex flex-wrap items-center gap-3">
              <label class="text-xs text-text-muted w-28 shrink-0" for="orch-verify-agent">Agent</label>
              <select
                id="orch-verify-agent"
                class="text-sm px-2 py-1.5 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary"
                :value="verifyAgentType"
                :disabled="!canEdit || bSavingSettings"
                @change="onVerifyAgentChange"
              >
                <option v-for="agent in AGENT_TYPES" :key="agent" :value="agent">{{ agentTypeLabel(agent) }}</option>
              </select>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <span class="text-xs text-text-muted w-28 shrink-0">Model</span>
              <div class="min-w-[14rem]">
                <AgentModelPicker
                  :model-value="orchestrator?.verifyModel ?? 'auto'"
                  :agent-type="verifyAgentType"
                  :model-options="verifyModelOptions"
                  :disabled="!canEdit || bSavingSettings || bLoadingVerifyModels"
                  variant="modal"
                  @update:model-value="saveRunSettings({ verifyModel: $event })"
                />
              </div>
            </div>
          </template>
        </div>
      </div>

      <p v-if="editedSubtasks.length === 0" class="text-sm text-text-muted">
        No steps yet. Describe the work in the planning chat, then ask the agent to plan it as an orchestrator
        (or use <strong>Plan as orchestrator</strong> in the chat header).
      </p>

      <div
        v-if="sharedContextDisplay"
        class="rounded-xl border border-primary/25 bg-primary/5 overflow-hidden"
      >
        <div class="px-3 py-2 border-b border-fg/10">
          <span class="text-sm font-medium text-text-primary">Plan notes</span>
          <p class="text-xs text-text-muted mt-0.5">
            Given to every step together with the planning chat's spec (read live when the step starts).
          </p>
        </div>
        <div
          class="px-3 py-2 text-sm text-text-muted max-h-40 overflow-y-auto whitespace-pre-wrap break-words"
        >
          {{ sharedContextDisplay }}
        </div>
      </div>

      <div
        v-if="handoffLogDisplay"
        class="rounded-xl border border-fg/15 bg-fg/[0.04] overflow-hidden"
      >
        <div class="px-3 py-2 border-b border-fg/10">
          <span class="text-sm font-medium text-text-primary">Completed steps — handoff</span>
          <p class="text-xs text-text-muted mt-0.5">
            Summaries from finished steps; appended to prompts for later steps in this run.
          </p>
        </div>
        <div
          class="px-3 py-2 text-sm text-text-muted max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs"
        >
          {{ handoffLogDisplay }}
        </div>
      </div>

      <!-- Task flow (read-only cards; Edit/Delete open modal or remove) -->
      <div v-if="editedSubtasks.length > 0" class="space-y-3">
        <h3 class="text-sm font-medium text-text-primary">Task flow</h3>
        <div class="flex flex-col gap-0">
          <template v-for="(task, i) in editedSubtasks" :key="'flow-' + i">
            <div
              :data-step-index="i"
              :class="['rounded-xl overflow-hidden', STEP_CARD_CLASS[taskStatus(i)]]"
            >
              <div
                class="px-3 py-2 border-b border-fg/10 flex flex-wrap items-center gap-x-2 gap-y-1 bg-fg/[0.04] orch-card-inner"
              >
                <div class="flex items-center gap-2 min-w-0 flex-1 basis-full sm:basis-auto">
                  <span
                    class="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-semibold shrink-0"
                  >
                    {{ i + 1 }}
                  </span>
                  <span class="font-medium text-text-primary truncate min-w-0" :title="task.name">{{
                    task.name
                  }}</span>
                </div>
                <span
                  v-if="taskStatus(i) === 'active'"
                  class="text-xs px-2 py-0.5 rounded-full border border-primary/40 text-primary shrink-0"
                >
                  Running
                </span>
                <span
                  v-else-if="taskStatus(i) === 'finishing'"
                  class="text-xs px-2 py-0.5 rounded-full border border-primary/30 text-primary/80 shrink-0"
                  title="The run is stopped; this step's agent finishes its current turn"
                >
                  Finishing…
                </span>
                <button
                  v-else-if="taskStatus(i) === 'waiting'"
                  type="button"
                  class="text-xs px-2 py-0.5 rounded-full border border-warning/50 text-warning hover:bg-warning/10 shrink-0"
                  title="Answer in this step's session"
                  @click="openStepSession(task)"
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
                  v-else-if="taskStatus(i) === 'failed'"
                  class="text-xs px-2 py-0.5 rounded-full border border-destructive/40 text-destructive shrink-0"
                >
                  Failed
                </span>
                <button
                  v-if="task.sessionId"
                  type="button"
                  class="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-fg/10 transition-colors text-xs"
                  title="Open this step's session"
                  @click="openStepSession(task)"
                >
                  Session
                </button>
                <span
                  v-if="dependsOnLabel(task)"
                  class="text-xs text-text-muted shrink-0"
                  :title="'Depends on steps ' + dependsOnLabel(task)"
                >
                  after {{ dependsOnLabel(task) }}
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
                    @click="startRun('sequential', { onlyIndex: i })"
                  >
                    {{ task.kind === 'merge' ? 'Merge again' : 'Run step' }}
                  </button>
                  <button
                    v-if="i > 0"
                    type="button"
                    class="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-fg/10 transition-colors text-xs"
                    title="Run this and the following steps one by one"
                    :disabled="bStartingRun"
                    @click="startRun('sequential', { startIndex: i })"
                  >
                    Run from here
                  </button>
                </template>
                <template v-if="canEdit && !task.kind">
                  <button
                    type="button"
                    class="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-fg/10 transition-colors"
                    title="Edit step"
                    @click="openEditModal(i)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" class="select-none" aria-hidden="true"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
                  </button>
                  <button
                    type="button"
                    class="p-1.5 rounded text-text-muted hover:text-destructive hover:bg-fg/10 transition-colors"
                    title="Delete step"
                    @click="pendingDelete = i"
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
                  :class="taskStatus(i) === 'failed' ? 'text-destructive' : 'text-warning'"
                >
                  {{ task.runNote }}
                </p>
                <p
                  v-if="taskStatus(i) === 'waiting'"
                  class="mt-2 text-xs whitespace-pre-wrap break-words text-warning"
                >
                  Waiting for your answer: {{ task.waitingQuestion }}
                </p>
              </div>
            </div>
            <div
              v-if="i < editedSubtasks.length - 1"
              class="flex justify-center py-1 text-text-muted"
              aria-hidden="true"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" class="select-none" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
            </div>
          </template>
        </div>
        <div v-if="canEdit && hasEdits" class="flex items-center gap-2">
          <button
            type="button"
            :disabled="bSavingSubtasks"
            class="px-3 py-1.5 text-sm font-medium border border-fg/20 text-text-primary rounded-lg hover:bg-fg/[0.06] transition-colors flex items-center gap-2 disabled:opacity-60"
            @click="saveSubtasks"
          >
            <span
              v-if="bSavingSubtasks"
              class="w-3.5 h-3.5 border-2 border-fg/30 border-t-primary rounded-full animate-spin shrink-0"
            />
            {{ bSavingSubtasks ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </div>

      <ConfirmModal
        :model-value="pendingDelete !== null"
        title="Delete step"
        :description="pendingDeleteDescription"
        confirm-label="Delete"
        variant="danger"
        :loading="bSavingSubtasks"
        @update:model-value="
          (v: boolean) => {
            if (!v) {
              pendingDelete = null;
            }
          }
        "
        @confirm="removeTask"
      />

      <!-- Edit task modal -->
      <BaseModal
        v-model="bShowEditModal"
        labelledby="edit-task-title"
        panel-class="max-w-md"
      >
        <ModalHeader
          eyebrow="// edit task"
          title="Edit task"
          title-id="edit-task-title"
          @close="closeEditModal"
        />
        <div class="p-5 pt-4">
              <div class="space-y-4">
                <div>
                  <label class="block text-xs font-medium text-text-muted mb-1">Name</label>
                  <input
                    v-model="editDraft.name"
                    type="text"
                    class="w-full text-sm px-3 py-2 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary"
                    placeholder="Task name"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-text-muted mb-1"
                    >Category (optional)</label
                  >
                  <input
                    v-model="editDraft.category"
                    type="text"
                    class="w-full text-sm px-3 py-2 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary"
                    placeholder="e.g. setup, implementation"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-text-muted mb-1">Prompt</label>
                  <textarea
                    v-model="editDraft.prompt"
                    rows="4"
                    class="w-full text-sm px-3 py-2 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary placeholder-text-muted resize-y"
                    placeholder="Instruction for this step"
                  />
                </div>
                <div v-if="editingTaskIndex !== null && editingTaskIndex > 0">
                  <p class="block text-xs font-medium text-text-muted mb-1">Depends on</p>
                  <p class="text-xs text-text-muted mb-2">
                    This step is skipped if a selected earlier step failed or was skipped.
                  </p>
                  <label
                    v-for="(prior, depIndex) in editedSubtasks.slice(0, editingTaskIndex)"
                    :key="'dep-' + depIndex"
                    class="flex items-center gap-2 text-sm text-text-primary py-0.5"
                  >
                    <input
                      type="checkbox"
                      :checked="normalizeDependsOn(editDraft.dependsOn).includes(depIndex)"
                      @change="toggleDependsOn(depIndex)"
                    />
                    <span>Step {{ depIndex + 1 }}: {{ prior.name }}</span>
                  </label>
                </div>
              </div>
              <div class="flex justify-end gap-2 mt-5">
                <button
                  type="button"
                  class="px-4 py-2 text-sm text-text-muted hover:text-text-primary border border-fg/10 rounded-lg"
                  @click="closeEditModal"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="px-4 py-2 text-sm font-medium btn-primary-solid rounded-lg"
                  @click="saveEditFromModal"
                >
                  Save
                </button>
              </div>
        </div>
      </BaseModal>

      <div v-if="runError" class="text-sm text-destructive">{{ runError }}</div>
    </div>

    <!-- Start tasks bar -->
    <div
      class="px-4 md:px-6 py-3 border-t border-fg/10 shrink-0 flex items-center justify-between gap-4"
    >
      <!-- Run progress (from server state); click jumps to the step needing attention -->
      <button
        v-if="runProgress"
        type="button"
        class="flex items-center gap-2 min-w-0 text-sm text-text-muted hover:text-text-primary transition-colors"
        :title="runSummary.full"
        :aria-label="runSummary.full"
        @click="scrollToAttentionStep('smooth')"
      >
        <svg
          viewBox="0 0 20 20"
          width="20"
          height="20"
          class="shrink-0 -rotate-90"
          :class="[RUN_STATUS_RING_CLASS[runProgress.status], runProgress.status === 'running' && 'animate-pulse']"
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
        </svg>
        <span class="truncate">{{ runSummary.short }}</span>
      </button>
      <span v-else class="text-sm text-text-muted">
        {{ subtasks.length }} task{{ subtasks.length === 1 ? '' : 's' }}
      </span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          :disabled="bCloning"
          class="px-4 py-2.5 text-sm font-medium border border-fg/20 text-text-primary rounded-lg hover:bg-fg/[0.06] transition-colors flex items-center gap-2 disabled:opacity-60"
          @click="clonePlan"
        >
          <span
            v-if="bCloning"
            class="w-4 h-4 border-2 border-fg/30 border-t-primary rounded-full animate-spin shrink-0"
          />
          {{ bCloning ? 'Cloning…' : 'Clone plan' }}
        </button>
        <button
          v-if="isRunning"
          type="button"
          :disabled="bStopping"
          class="px-4 py-2.5 text-sm font-medium bg-destructive/80 text-on-accent rounded-lg hover:bg-destructive transition-colors flex items-center gap-2 disabled:opacity-60"
          @click="stopTasks"
        >
          <span
            v-if="bStopping"
            class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0"
          />
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" class="select-none shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>
          {{ bStopping ? 'Stopping…' : 'Stop run' }}
        </button>
        <div v-else class="relative">
          <div class="inline-flex items-stretch rounded-lg overflow-hidden btn-primary-solid">
            <button
              type="button"
              class="px-4 py-2.5 text-sm font-medium disabled:opacity-40 transition-opacity flex items-center gap-2"
              :disabled="subtasks.length === 0 || bStartingRun"
              @click="startRun(preferredRunMode)"
            >
              <span
                v-if="bStartingRun"
                class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0"
              />
              {{ bStartingRun ? 'Starting…' : mainRunLabel }}
            </button>
            <button
              type="button"
              class="px-2 border-l border-white/20 disabled:opacity-40"
              aria-haspopup="true"
              :aria-expanded="bRunMenuOpen"
              aria-label="Run options"
              title="Run options"
              :disabled="subtasks.length === 0 || bStartingRun"
              @click.stop="bRunMenuOpen = !bRunMenuOpen"
            >
              <ChevronDown :size="14" :stroke-width="1.8" aria-hidden="true" />
            </button>
          </div>
          <div
            v-if="bRunMenuOpen"
            class="absolute right-0 bottom-full mb-1 z-50 w-72 rounded-lg border border-border bg-surface py-1 shadow-lg"
            role="menu"
            @click.stop
          >
            <button
              v-for="choice in runChoices"
              :key="choice.id"
              type="button"
              class="w-full px-3 py-2 text-left hover:bg-fg/[0.06] transition-colors"
              role="menuitem"
              @click="startRun(choice.id)"
            >
              <span class="block text-sm text-text-primary">{{ choice.label }}</span>
              <span class="block text-xs text-text-muted">{{ choice.hint }}</span>
            </button>
          </div>
        </div>
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

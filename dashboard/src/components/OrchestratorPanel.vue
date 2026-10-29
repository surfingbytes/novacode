<script setup lang="ts">
// node_modules
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useRouter } from 'vue-router';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import OrchestratorPlannerBanner from '@/components/orchestrator/OrchestratorPlannerBanner.vue';
import OrchestratorRunSettings from '@/components/orchestrator/OrchestratorRunSettings.vue';
import OrchestratorSpecCard from '@/components/orchestrator/OrchestratorSpecCard.vue';
import OrchestratorPlanNotes from '@/components/orchestrator/OrchestratorPlanNotes.vue';
import OrchestratorStepRow from '@/components/orchestrator/OrchestratorStepRow.vue';
import OrchestratorStepEditModal from '@/components/orchestrator/OrchestratorStepEditModal.vue';
import OrchestratorRunProgress from '@/components/orchestrator/OrchestratorRunProgress.vue';
import OrchestratorRunSplitButton from '@/components/orchestrator/OrchestratorRunSplitButton.vue';

// classes
import { orchestratorApi } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';
import {
  handoffNoteForStep,
  insertSubtask,
  moveSubtask,
  normalizeDependsOn,
  parseSubtasksPayloadString,
  remapDependsOnAfterDelete,
  serializeSubtasksPayload
} from '@/utils/orchestratorPayload';
import { motionSafeScrollBehavior } from '@/utils/reducedMotion';

// composables
import { useOrchestratorRunState, type StepStatus } from '@/composables/useOrchestratorRunState';

// stores
import { useNovaMcpStore } from '@/stores/novaMcp';
import { useWorkspacesStore } from '@/stores/workspaces';

// types
import type { Orchestrator, SubTask } from '@/@types/index';

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
const novaMcpStore = useNovaMcpStore();
const workspacesStore = useWorkspacesStore();

// -------------------------------------------------- Composables --------------------------------------------------

const {
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
  stopTasks
} = useOrchestratorRunState({
  workspaceId: () => props.workspaceId,
  orchestratorId: () => props.orchestratorId,
  orchestrator: () => props.orchestrator,
  onUpdate: (orchestrator) => emit('update:orchestrator', orchestrator)
});

// -------------------------------------------------- Refs --------------------------------------------------

const bSavingSubtasks = ref(false);
const editedSubtasks = ref<SubTask[]>([]);
const bShowEditModal = ref(false);
const editingTaskIndex = ref<number | null>(null);
/** The edit modal drafts a new step instead of editing `editingTaskIndex`. */
const bAddingStep = ref(false);
/** Index of the step whose kept branch is being applied or discarded (null when idle). */
const branchBusyIndex = ref<number | null>(null);
/** Index of the step whose kept branch awaits discard confirmation. */
const pendingDiscardBranch = ref<number | null>(null);
const scrollContainer = ref<HTMLElement | null>(null);

// -------------------------------------------------- Computed --------------------------------------------------

const canEdit = computed(() => !isRunning.value);
const plannerSession = computed(() => {
  const id = props.orchestrator?.sourceSessionId;
  return id ? workspacesStore.allSessions.find((session) => session.id === id) ?? null : null;
});
/** Per-step handoff note from the run's handoff log (null when the step has none yet). */
const stepHandoffNotes = computed(() =>
  editedSubtasks.value.map((_, index) => handoffNoteForStep(handoffLogDisplay.value, index))
);
const bBranchBusy = computed(() => branchBusyIndex.value !== null);
const pendingDiscardDescription = computed(() => {
  const index = pendingDiscardBranch.value;
  const branch = index === null ? null : editedSubtasks.value[index]?.keptBranch?.branch;
  return branch ? `Discard branch ${branch}? Its changes are lost.` : '';
});

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.orchestrator?.subtasksJson,
  (json) => {
    const payload = parseSubtasksPayloadString(json);
    editedSubtasks.value = payload?.subtasks?.length ? payload.subtasks.map((t) => ({ ...t })) : [];
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

function taskStatus(index: number): StepStatus {
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

function scrollToAttentionStep(requestedBehavior: ScrollBehavior) {
  const behavior = motionSafeScrollBehavior(requestedBehavior);
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

function isStepSessionBusy(task: SubTask): boolean {
  return !!task.sessionId && !!workspacesStore.allSessions.find((session) => session.id === task.sessionId)?.busy;
}

function openEditModal(index: number) {
  const task = editedSubtasks.value[index];
  if (!task) {
    return;
  }
  editingTaskIndex.value = index;
  bShowEditModal.value = true;
}

function openAddModal() {
  editingTaskIndex.value = null;
  bAddingStep.value = true;
  bShowEditModal.value = true;
}

function closeEditModal() {
  bShowEditModal.value = false;
  editingTaskIndex.value = null;
  bAddingStep.value = false;
}

/** New manual steps go before the automatic merge/verify steps (which are always last). */
function addStepFromModal(editDraft: SubTask) {
  const name = editDraft.name.trim();
  const prompt = editDraft.prompt.trim();
  if (!name || !prompt) {
    return;
  }
  const list = editedSubtasks.value;
  const firstAuto = list.findIndex((task) => Boolean(task.kind));
  const at = firstAuto === -1 ? list.length : firstAuto;
  const dependsOn = normalizeDependsOn(editDraft.dependsOn).filter(
    (dep) => dep < at && !list[dep]?.kind
  );
  editedSubtasks.value = insertSubtask(list, at, {
    name,
    prompt,
    category: editDraft.category?.trim() || null,
    ...(dependsOn.length > 0 ? { dependsOn } : {})
  });
  closeEditModal();
  void saveSubtasks();
}

function saveEditFromModal(editDraft: SubTask) {
  if (bAddingStep.value) {
    addStepFromModal(editDraft);
    return;
  }
  const i = editingTaskIndex.value;
  if (i === null || i < 0 || i >= editedSubtasks.value.length) {
    closeEditModal();
    return;
  }
  const list = [...editedSubtasks.value];
  const prev = list[i];
  const category = editDraft.category?.trim() || null;
  const dependsOn = normalizeDependsOn(editDraft.dependsOn).filter((dep) => dep < i);
  const next: SubTask = {
    ...prev,
    name: editDraft.name.trim() || prev.name,
    prompt: editDraft.prompt.trim() || prev.prompt,
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

/** Up is blocked at the top and when the step depends on the step directly above it. */
function canMoveUp(index: number): boolean {
  const task = editedSubtasks.value[index];
  if (!task || task.kind || index === 0) {
    return false;
  }
  return !normalizeDependsOn(task.dependsOn).includes(index - 1);
}

/** Down is blocked above an automatic step and when the step below depends on this one. */
function canMoveDown(index: number): boolean {
  const task = editedSubtasks.value[index];
  const below = editedSubtasks.value[index + 1];
  if (!task || task.kind || !below || below.kind) {
    return false;
  }
  return !normalizeDependsOn(below.dependsOn).includes(index);
}

function moveStep(index: number, direction: -1 | 1): void {
  const allowed = direction === -1 ? canMoveUp(index) : canMoveDown(index);
  if (!allowed) {
    return;
  }
  editedSubtasks.value = moveSubtask(editedSubtasks.value, index, index + direction);
  void saveSubtasks();
}

async function applyStepBranch(index: number): Promise<void> {
  if (bBranchBusy.value || !editedSubtasks.value[index]?.keptBranch) {
    return;
  }
  branchBusyIndex.value = index;
  try {
    const { data } = await orchestratorApi.applyStepBranch(props.workspaceId, props.orchestratorId, index);
    if (data) {
      emit('update:orchestrator', data);
    }
  } catch (err: unknown) {
    notifyApiError(err, 'Failed to apply the step branch');
  } finally {
    branchBusyIndex.value = null;
  }
}

async function discardStepBranch(): Promise<void> {
  const index = pendingDiscardBranch.value;
  if (index === null || bBranchBusy.value) {
    return;
  }
  branchBusyIndex.value = index;
  try {
    const { data } = await orchestratorApi.discardStepBranch(props.workspaceId, props.orchestratorId, index);
    if (data) {
      emit('update:orchestrator', data);
    }
    pendingDiscardBranch.value = null;
  } catch (err: unknown) {
    notifyApiError(err, 'Failed to discard the step branch');
  } finally {
    branchBusyIndex.value = null;
  }
}

function openStepSession(task: SubTask): void {
  if (!task.sessionId) return;
  void router.push({ name: 'session', params: { id: props.workspaceId, sessionId: task.sessionId } });
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
  void novaMcpStore.ensureFetched();
  void scrollOnOpen();
});
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden min-h-0">
    <div ref="scrollContainer" class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
      <!-- Planning chat: where the plan is written and adjusted -->
      <OrchestratorPlannerBanner
        :workspace-id="workspaceId"
        :orchestrator-id="orchestratorId"
        :orchestrator="orchestrator"
        :planner-session="plannerSession"
        :b-embedded="bEmbedded"
        @update:orchestrator="emit('update:orchestrator', $event)"
        @open-chat="emit('open-chat')"
      />

      <!-- Run settings: who runs the step sessions and the final "Verify against spec" step -->
      <OrchestratorRunSettings
        :workspace-id="workspaceId"
        :orchestrator-id="orchestratorId"
        :orchestrator="orchestrator"
        :planner-session="plannerSession"
        :can-edit="canEdit"
        @update:orchestrator="emit('update:orchestrator', $event)"
      />

      <!-- Planning chat's spec: read live by every step, editable even during a run -->
      <OrchestratorSpecCard
        v-if="orchestrator?.sourceSessionId"
        :workspace-id="workspaceId"
        :session-id="orchestrator.sourceSessionId"
      />

      <p v-if="editedSubtasks.length === 0" class="text-sm text-text-muted">
        No steps yet. Describe the work in the planning chat, then ask the agent to plan it as an orchestrator
        (or use <strong>Plan as orchestrator</strong> in the chat header).
        <template v-if="novaMcpStore.bEnabled === false">
          Nova MCP is turned off in Settings → MCP, so the agent cannot save a plan.
        </template>
      </p>

      <OrchestratorPlanNotes :shared-context="sharedContextDisplay" />

      <!-- Task flow (read-only cards; Edit/Delete open modal or remove) -->
      <div v-if="editedSubtasks.length > 0" class="space-y-3">
        <h3 class="text-sm font-medium text-text-primary">Task flow</h3>
        <div class="flex flex-col gap-0">
          <template v-for="(task, i) in editedSubtasks" :key="'flow-' + i">
            <OrchestratorStepRow
              :task="task"
              :index="i"
              :status="taskStatus(i)"
              :is-running="isRunning"
              :can-edit="canEdit"
              :b-starting-run="bStartingRun"
              :handoff-note="stepHandoffNotes[i] ?? null"
              :b-can-move-up="canMoveUp(i)"
              :b-can-move-down="canMoveDown(i)"
              :b-branch-busy="bBranchBusy"
              @open-session="openStepSession(task)"
              @run-only="startRun('sequential', { onlyIndex: i })"
              @run-from="startRun('sequential', { startIndex: i })"
              @edit="openEditModal(i)"
              @delete="pendingDelete = i"
              @move-up="moveStep(i, -1)"
              @move-down="moveStep(i, 1)"
              @apply-branch="applyStepBranch(i)"
              @discard-branch="pendingDiscardBranch = i"
            />
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

      <!-- Manual step: inserted before the automatic merge/verify steps -->
      <div v-if="canEdit && orchestrator" class="flex items-center gap-2">
        <button
          type="button"
          :disabled="bSavingSubtasks"
          class="px-3 py-1.5 text-sm font-medium border border-fg/20 text-text-primary rounded-lg hover:bg-fg/[0.06] transition-colors flex items-center gap-2 disabled:opacity-60"
          @click="openAddModal"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" class="select-none shrink-0" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add step
        </button>
      </div>

      <ConfirmModal
        :model-value="pendingDiscardBranch !== null"
        title="Discard branch"
        :description="pendingDiscardDescription"
        confirm-label="Discard"
        variant="danger"
        :loading="bBranchBusy"
        @update:model-value="
          (v: boolean) => {
            if (!v) {
              pendingDiscardBranch = null;
            }
          }
        "
        @confirm="discardStepBranch"
      />

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

      <!-- Edit / add task modal -->
      <OrchestratorStepEditModal
        v-model="bShowEditModal"
        :task-index="editingTaskIndex"
        :subtasks="editedSubtasks"
        :b-new="bAddingStep"
        @close="closeEditModal"
        @save="saveEditFromModal"
      />

      <div v-if="runError" class="text-sm text-destructive">{{ runError }}</div>
    </div>

    <!-- Start tasks bar -->
    <div
      class="px-4 md:px-6 py-3 border-t border-fg/10 shrink-0 flex items-center justify-between gap-4"
    >
      <!-- Run progress (from server state); click jumps to the step needing attention -->
      <OrchestratorRunProgress
        v-if="runProgress"
        :progress="runProgress"
        :summary="runSummary"
        @click="scrollToAttentionStep('smooth')"
      />
      <span v-else class="text-sm text-text-muted">
        {{ subtasks.length }} task{{ subtasks.length === 1 ? '' : 's' }}
      </span>
      <div class="flex items-center gap-2">
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
        <OrchestratorRunSplitButton
          v-else
          :preferred-run-mode="preferredRunMode"
          :max-parallel="maxParallel"
          :parallel-blocked-reason="parallelBlockedReason"
          :b-disabled="subtasks.length === 0"
          :b-starting-run="bStartingRun"
          @run="startRun($event)"
        />
      </div>
    </div>
  </div>
</template>

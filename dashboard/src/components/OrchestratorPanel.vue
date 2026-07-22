<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';

// classes
import { orchestratorApi } from '@/classes/api';
import {
  parseOrchestratorSubtasksJson,
  serializeOrchestratorSubtasksPayload
} from '@/utils/orchestratorPayload';
import { tagColorClass as categoryColorClass } from '@/utils/tagColors';

// types
import type { Orchestrator, SubTask } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  workspaceId: string;
  orchestratorId: string;
  orchestrator: Orchestrator | null;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  'update:orchestrator': [Orchestrator];
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const userInput = ref('');
const promptStorageKey = `orchestratorPrompt:${props.workspaceId}:${props.orchestratorId}`;
const bDecomposing = ref(false);
const bStartingRun = ref(false);
const bStopping = ref(false);
const bSavingSubtasks = ref(false);
const decomposeError = ref<string | null>(null);
const decomposeLastAssistantContent = ref<string>('');
const decomposeExpectedSchema = ref<string>('');
const decomposeThinking = ref('');
const decomposeThinkingEl = ref<HTMLElement | null>(null);
const runError = ref<string | null>(null);
const pollIntervalId = ref<ReturnType<typeof setInterval> | null>(null);
const editedSubtasks = ref<SubTask[]>([]);
const bShowEditModal = ref(false);
const editingTaskIndex = ref<number | null>(null);
const editDraft = ref<SubTask>({ name: '', prompt: '', category: null });

// -------------------------------------------------- Computed --------------------------------------------------

const isRunning = computed(() => props.orchestrator?.runStatus === 'running');
const hasRunOnce = computed(
  () => props.orchestrator?.runStatus === 'completed' || props.orchestrator?.runStatus === 'failed'
);
const canEdit = computed(() => !isRunning.value && !hasRunOnce.value);

const runProgress = computed(() => {
  const o = props.orchestrator;
  if (!o?.runStatus) {
    return null;
  }
  const total = o.runTotalSteps ?? 0;
  const current = o.runCurrentStep ?? 0;
  if (o.runStatus === 'running') {
    return { status: 'running' as const, completed: current, total };
  }
  if (o.runStatus === 'completed') {
    return { status: 'completed' as const, completed: total, total };
  }
  if (o.runStatus === 'failed') {
    return { status: 'failed' as const, completed: current, total };
  }
  if (o.runStatus === 'stopped') {
    return { status: 'stopped' as const, completed: current, total };
  }
  return null;
});

const planPayload = computed(() => parseOrchestratorSubtasksJson(props.orchestrator?.subtasksJson));

const subtasks = computed<SubTask[]>(() => planPayload.value?.subtasks ?? []);

const sharedContextDisplay = computed(() => planPayload.value?.sharedContext?.trim() ?? '');
const handoffLogDisplay = computed(() => planPayload.value?.handoffLog?.trim() ?? '');

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.orchestrator?.subtasksJson,
  (json) => {
    if (!json?.trim()) {
      editedSubtasks.value = [];
      return;
    }
    const payload = parseOrchestratorSubtasksJson(json);
    editedSubtasks.value = payload?.subtasks?.length
      ? payload.subtasks.map((t) => ({ ...t }))
      : [];
  },
  { immediate: true }
);

const hasEdits = computed(() => {
  const a = editedSubtasks.value;
  const b = subtasks.value;
  if (a.length !== b.length) {
    return true;
  }
  return a.some(
    (t, i) => t.name !== b[i]?.name || t.prompt !== b[i]?.prompt || t.category !== b[i]?.category
  );
});

// -------------------------------------------------- Methods --------------------------------------------------

function taskStatus(index: number): 'idle' | 'active' | 'done' {
  const o = props.orchestrator;
  const total = subtasks.value.length;
  if (!o || total === 0) {
    return 'idle';
  }
  const completedCount = o.runCurrentStep ?? 0;

  if (o.runStatus === 'completed') {
    return 'done';
  }

  if (o.runStatus === 'failed') {
    return index < completedCount ? 'done' : 'idle';
  }

  if (o.runStatus === 'running') {
    const clampedTotal = o.runTotalSteps ?? total;
    const clampedCompleted = Math.min(completedCount, clampedTotal);
    const activeIndex = clampedCompleted >= clampedTotal ? clampedTotal - 1 : clampedCompleted;
    if (index < clampedCompleted) {
      return 'done';
    }
    if (index === activeIndex) {
      return 'active';
    }
    return 'idle';
  }

  return 'idle';
}

function startPolling() {
  stopPolling();
  pollIntervalId.value = setInterval(async () => {
    try {
      const { data } = await orchestratorApi.get(props.workspaceId, props.orchestratorId);
      if (data) {
        emit('update:orchestrator', data);
      }
    } catch {
      // ignore
    }
  }, 2000);
}

function stopPolling() {
  if (pollIntervalId.value) {
    clearInterval(pollIntervalId.value);
    pollIntervalId.value = null;
  }
}

watch(
  () => props.orchestrator?.runStatus,
  (status) => {
    if (status === 'running') {
      startPolling();
    } else {
      stopPolling();
    }
  },
  { immediate: true }
);

watch(userInput, (val) => {
  if (!val) {
    localStorage.removeItem(promptStorageKey);
  } else {
    localStorage.setItem(promptStorageKey, val);
  }
});

function openEditModal(index: number) {
  const task = editedSubtasks.value[index];
  if (!task) {
    return;
  }
  editingTaskIndex.value = index;
  editDraft.value = { name: task.name, prompt: task.prompt, category: task.category ?? null };
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
  list[i] = {
    ...prev,
    name: editDraft.value.name.trim() || prev.name,
    prompt: editDraft.value.prompt.trim() || prev.prompt,
    category
  };
  editedSubtasks.value = list;
  closeEditModal();
  saveSubtasks();
}

async function generateTasks() {
  const msg = userInput.value.trim();
  if (!msg || bDecomposing.value) {
    return;
  }
  bDecomposing.value = true;
  decomposeError.value = null;
  decomposeLastAssistantContent.value = '';
  decomposeExpectedSchema.value = '';
  decomposeThinking.value = '';
  try {
    const data = await orchestratorApi.decomposeStream(
      props.workspaceId,
      props.orchestratorId,
      { userMessage: msg },
      {
        onThinking(text) {
          decomposeThinking.value += text;
          nextTick(() => {
            decomposeThinkingEl.value?.scrollTo({
              top: decomposeThinkingEl.value.scrollHeight,
              behavior: 'smooth'
            });
          });
        }
      }
    );
    if (data) {
      emit('update:orchestrator', data);
    }
    userInput.value = '';
  } catch (e: unknown) {
    const caughtError = e as Error & { lastAssistantContent?: string; expectedSchema?: string };
    decomposeError.value = caughtError instanceof Error ? caughtError.message : 'Failed to generate tasks';
    decomposeLastAssistantContent.value = caughtError.lastAssistantContent ?? '';
    decomposeExpectedSchema.value = caughtError.expectedSchema ?? '';
  } finally {
    bDecomposing.value = false;
  }
}

async function saveSubtasks() {
  if (!hasEdits.value || !props.orchestrator) {
    return;
  }
  bSavingSubtasks.value = true;
  try {
    const prev = parseOrchestratorSubtasksJson(props.orchestrator.subtasksJson);
    const nextPayload = {
      sharedContext: prev?.sharedContext ?? '',
      handoffLog: prev?.handoffLog ?? '',
      subtasks: editedSubtasks.value
    };
    const { data } = await orchestratorApi.update(props.workspaceId, props.orchestratorId, {
      subtasksJson: serializeOrchestratorSubtasksPayload(nextPayload)
    });
    if (data) {
      emit('update:orchestrator', data);
    }
  } catch {
    // ignore
  } finally {
    bSavingSubtasks.value = false;
  }
}

async function startTasks() {
  if (subtasks.value.length === 0 || isRunning.value) {
    return;
  }
  runError.value = null;
  bStartingRun.value = true;
  try {
    const { data } = await orchestratorApi.run(props.workspaceId, props.orchestratorId, {
      startIndex: 0
    });
    if (data) {
      emit('update:orchestrator', data);
    }
  } catch (e: unknown) {
    const caughtError = e as { response?: { data?: { error?: string }; status?: number } };
    runError.value = caughtError.response?.data?.error ?? (e instanceof Error ? e.message : 'Run failed');
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
    const caughtError = e as { response?: { data?: { error?: string }; status?: number } };
    runError.value =
      caughtError.response?.data?.error ?? (e instanceof Error ? e.message : 'Failed to stop run');
  } finally {
    bStopping.value = false;
  }
}

function removeTask(index: number) {
  const list = editedSubtasks.value.filter((_, i) => i !== index);
  editedSubtasks.value = list;
}

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  const savedPrompt = localStorage.getItem(promptStorageKey);
  if (savedPrompt != null) {
    userInput.value = savedPrompt;
  }
});

onBeforeUnmount(stopPolling);
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden min-h-0">
    <!-- Conversation summary / messages could go here -->
    <div class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
      <!-- Prompt input: hidden while run is in progress -->
      <template v-if="!isRunning">
        <p class="text-sm text-text-muted">
          Describe your goal below. The AI will break it into steps. You can edit the list and run
          the steps in order.
        </p>
        <div class="space-y-2">
          <textarea
            v-model="userInput"
            placeholder="e.g. Add a login page with email/password and run the test suite"
            rows="3"
            class="w-full text-sm px-3 py-2 rounded-xl border border-fg/10 bg-fg/[0.04] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary/50 resize-none"
            :disabled="bDecomposing"
          />
          <div class="flex items-center gap-2">
            <button
              type="button"
              @click="generateTasks"
              :disabled="!userInput.trim() || bDecomposing"
              class="px-4 py-2 text-sm font-medium bg-primary text-on-accent rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-2"
            >
              <span
                v-if="bDecomposing"
                class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
              />
              {{ subtasks.length ? 'Update tasks' : 'Generate tasks' }}
            </button>
            <span v-if="decomposeError" class="text-xs text-destructive">{{ decomposeError }}</span>
          </div>
          <!-- Decompose failure debug: last assistant result + expected schema -->
          <div
            v-if="decomposeError && (decomposeLastAssistantContent || decomposeExpectedSchema)"
            class="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden space-y-2"
          >
            <div class="px-3 py-2 border-b border-fg/10 flex items-center gap-2">
              <span class="text-sm font-medium text-amber-400">Debug: decomposition failed</span>
            </div>
            <div v-if="decomposeLastAssistantContent" class="px-3 py-2">
              <p class="text-xs font-medium text-text-muted mb-1">Last assistant response (raw):</p>
              <pre
                class="text-xs text-text-muted max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono bg-black/10 rounded p-2"
                >{{ decomposeLastAssistantContent || '(empty)' }}</pre
              >
            </div>
            <div v-if="decomposeExpectedSchema" class="px-3 py-2 border-t border-fg/10">
              <p class="text-xs font-medium text-text-muted mb-1">Expected schema:</p>
              <pre
                class="text-xs text-text-muted max-h-32 overflow-y-auto whitespace-pre-wrap font-mono bg-black/10 rounded p-2"
                >{{ decomposeExpectedSchema }}</pre
              >
            </div>
          </div>
        </div>
      </template>

      <!-- Live thinking output during decompose (thinking only, no tool calls) -->
      <div
        v-if="decomposeThinking.length > 0 || bDecomposing"
        class="rounded-xl border border-fg/15 bg-fg/[0.04] overflow-hidden"
      >
        <div class="px-3 py-2 border-b border-fg/10 flex items-center gap-2">
          <span
            v-if="bDecomposing"
            class="w-3.5 h-3.5 border-2 border-primary/40 border-t-primary rounded-full animate-spin shrink-0"
          />
          <span class="text-sm font-medium text-text-primary">Thinking</span>
        </div>
        <div
          class="px-3 py-2 text-sm text-text-muted max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono"
          ref="decomposeThinkingEl"
        >
          {{ decomposeThinking || (bDecomposing ? '…' : '') }}
        </div>
      </div>

      <div
        v-if="sharedContextDisplay"
        class="rounded-xl border border-primary/25 bg-primary/5 overflow-hidden"
      >
        <div class="px-3 py-2 border-b border-fg/10">
          <span class="text-sm font-medium text-text-primary">Shared plan context</span>
          <p class="text-xs text-text-muted mt-0.5">
            Prepended to every step so later sessions see the same decisions and constraints.
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
              :class="[
                'rounded-xl overflow-hidden',
                taskStatus(i) === 'active'
                  ? 'orch-active-border'
                  : taskStatus(i) === 'done'
                    ? 'border border-emerald-500/60'
                    : 'border border-fg/15'
              ]"
            >
              <div
                class="px-3 py-2 border-b border-fg/10 flex items-center gap-2 bg-fg/[0.04] orch-card-inner"
              >
                <span
                  class="flex items-center justify-center w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-semibold shrink-0"
                >
                  {{ i + 1 }}
                </span>
                <span class="font-medium text-text-primary truncate flex-1 min-w-0">{{
                  task.name
                }}</span>
                <span
                  v-if="task.category"
                  class="text-xs px-2 py-0.5 rounded-full border shrink-0"
                  :class="categoryColorClass(task.category)"
                >
                  {{ task.category }}
                </span>
                <template v-if="canEdit">
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
                    @click="removeTask(i)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" class="select-none" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  </button>
                </template>
              </div>
              <div class="px-3 py-2 text-sm text-text-muted bg-black/5 orch-card-inner">
                <p class="whitespace-pre-wrap break-words">{{ task.prompt }}</p>
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
            @click="saveSubtasks"
            :disabled="bSavingSubtasks"
            class="px-3 py-1.5 text-sm font-medium border border-fg/20 text-text-primary rounded-lg hover:bg-fg/[0.06] transition-colors flex items-center gap-2 disabled:opacity-60"
          >
            <span
              v-if="bSavingSubtasks"
              class="w-3.5 h-3.5 border-2 border-fg/30 border-t-primary rounded-full animate-spin shrink-0"
            />
            {{ bSavingSubtasks ? 'Saving…' : 'Save changes' }}
          </button>
        </div>
      </div>

      <!-- Edit task modal -->
      <BaseModal
        v-model="bShowEditModal"
        labelledby="edit-task-title"
        panel-class="max-w-md"
      >
        <div class="p-5">
              <h2 id="edit-task-title" class="text-lg font-semibold text-text-primary mb-4">
                Edit task
              </h2>
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
                  class="px-4 py-2 text-sm font-medium bg-primary text-on-accent rounded-lg"
                  @click="saveEditFromModal"
                >
                  Save
                </button>
              </div>
        </div>
      </BaseModal>

      <!-- Run progress (from server state) -->
      <div
        v-if="runProgress"
        class="rounded-lg border px-4 py-2 text-sm"
        :class="
          runProgress.status === 'running'
            ? 'border-primary/30 bg-primary/5 text-text-primary'
            : runProgress.status === 'completed'
              ? 'border-green-500/30 bg-green-500/5 text-text-primary'
              : runProgress.status === 'failed'
                ? 'border-destructive/30 bg-destructive/5 text-destructive'
                : 'border-amber-500/30 bg-amber-500/5 text-amber-400'
        "
      >
        <span v-if="runProgress.status === 'running'">
          <span
            class="inline-block w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin align-middle mr-1.5"
          />
          Running step {{ (runProgress.completed ?? 0) + 1 }}/{{ runProgress.total }}
        </span>
        <span v-else-if="runProgress.status === 'completed'">
          Completed {{ runProgress.total }}/{{ runProgress.total }}
        </span>
        <span v-else-if="runProgress.status === 'failed'">
          Failed at step {{ runProgress.completed + 1 }}/{{ runProgress.total }}
        </span>
        <span v-else>
          Stopped at step {{ runProgress.completed + 1 }}/{{ runProgress.total }}
        </span>
      </div>
      <div v-if="runError" class="text-sm text-destructive">{{ runError }}</div>
    </div>

    <!-- Start tasks bar -->
    <div
      class="px-4 md:px-6 py-3 border-t border-fg/10 shrink-0 flex items-center justify-between gap-4"
    >
      <span class="text-sm text-text-muted">
        {{ subtasks.length }} task{{ subtasks.length === 1 ? '' : 's' }}
      </span>
      <button
        v-if="isRunning"
        type="button"
        @click="stopTasks"
        :disabled="bStopping"
        class="px-4 py-2.5 text-sm font-medium bg-destructive/80 text-on-accent rounded-lg hover:bg-destructive transition-colors flex items-center gap-2 disabled:opacity-60"
      >
        <span
          v-if="bStopping"
          class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0"
        />
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" class="select-none shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>
        {{ bStopping ? 'Stopping…' : 'Stop run' }}
      </button>
      <button
        v-else
        type="button"
        @click="startTasks"
        :disabled="subtasks.length === 0 || bStartingRun"
        class="px-4 py-2.5 text-sm font-medium bg-primary text-on-accent rounded-lg hover:opacity-90 disabled:opacity-40 transition-opacity flex items-center gap-2"
      >
        <span
          v-if="bStartingRun"
          class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0"
        />
        {{ bStartingRun ? 'Starting…' : 'Start tasks' }}
      </button>
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

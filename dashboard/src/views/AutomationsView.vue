<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onUnmounted } from 'vue';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import PageShell from '@/components/layout/PageShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';

// api
import { automationsApi, workspaceApi } from '@/classes/api';

// types
import type { Automation, AutomationRun, Workspace, AgentType } from '@/@types/index';

// -------------------------------------------------- Constants --------------------------------------------------

const intervalPresets = [
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '6 hours', value: 360 },
  { label: '12 hours', value: 720 },
  { label: '24 hours (daily)', value: 1440 },
  { label: '7 days (weekly)', value: 10080 }
];

// -------------------------------------------------- Refs --------------------------------------------------

const workspaces = ref<Workspace[]>([]);
const automations = ref<Automation[]>([]);
const bLoading = ref(true);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const viewMode = ref<'list' | 'grid'>(
  (localStorage.getItem('automationsViewMode') as 'list' | 'grid') ?? 'list'
);

// selected automation for run report panel
const selectedAutomation = ref<Automation | null>(null);
const runs = ref<AutomationRun[]>([]);
const bRunsLoading = ref(false);
const selectedRun = ref<AutomationRun | null>(null);

// create modal
const bShowCreateForm = ref(false);
const newName = ref('');
const newWorkspaceId = ref('');
const newAgentType = ref<AgentType>('cursor-agent');
const newPrompt = ref('');
const newIntervalMinutes = ref(60);
const bNewEnabled = ref(true);
const bCreating = ref(false);
const createError = ref<string | null>(null);

// edit modal
const bShowEditModal = ref(false);
const editingId = ref<string | null>(null);
const editName = ref('');
const editAgentType = ref<AgentType>('cursor-agent');
const editPrompt = ref('');
const editIntervalMinutes = ref(60);
const bEditEnabled = ref(true);
const bSavingEdit = ref(false);
const editError = ref<string | null>(null);

// delete
const automationToDelete = ref<Automation | null>(null);
const bDeleting = ref(false);

// triggering
const triggeringId = ref<string | null>(null);

// polling handle
let pollHandle: ReturnType<typeof setInterval> | null = null;

// -------------------------------------------------- Computed --------------------------------------------------

const deleteConfirmDescription = computed(() =>
  automationToDelete.value
    ? `Delete "${automationToDelete.value.name}"? All run history will also be deleted.`
    : ''
);

// -------------------------------------------------- Methods --------------------------------------------------

function showSuccess(msg: string): void {
  successMessage.value = msg;
  setTimeout(() => {
    successMessage.value = null;
  }, 3000);
}

function setViewMode(mode: 'list' | 'grid'): void {
  viewMode.value = mode;
  localStorage.setItem('automationsViewMode', mode);
}

function formatDate(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatInterval(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  if (minutes < 1440) {
    return `${minutes / 60}h`;
  }
  if (minutes < 10080) {
    return `${minutes / 1440}d`;
  }
  return `${minutes / 10080}w`;
}

function agentTypeLabel(t: AgentType): string {
  if (t === 'claude') {
    return 'Claude';
  }
  if (t === 'mistral-vibe') {
    return 'Mistral Vibe';
  }
  if (t === 'open-code') {
    return 'OpenCode';
  }
  return 'Cursor';
}

function formatNextRun(automation: Automation): string {
  if (!automation.enabled) {
    return 'Disabled';
  }
  if (!automation.nextRunAt) {
    return '—';
  }
  const next = new Date(automation.nextRunAt);
  const now = new Date();
  const diff = next.getTime() - now.getTime();
  if (diff <= 0) {
    return 'Running soon…';
  }
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) {
    return `in ${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `in ${hrs}h ${mins % 60}m`;
  }
  return `in ${Math.floor(hrs / 24)}d`;
}

async function fetchAll(): Promise<void> {
  bLoading.value = true;
  errorMessage.value = null;
  try {
    const [automationsResponse, workspacesResponse] = await Promise.all([
      automationsApi.list(),
      workspaceApi.list()
    ]);
    automations.value = automationsResponse.data ?? [];
    workspaces.value = workspacesResponse.data ?? [];
  } catch {
    errorMessage.value = 'Failed to load automations';
  } finally {
    bLoading.value = false;
  }
}

function workspaceName(id: string): string {
  return workspaces.value.find((w) => w.id === id)?.name ?? id;
}

async function selectAutomation(a: Automation): Promise<void> {
  selectedAutomation.value = a;
  selectedRun.value = null;
  await fetchRuns(a.id);
}

async function fetchRuns(automationId: string): Promise<void> {
  bRunsLoading.value = true;
  try {
    const response = await automationsApi.listRuns(automationId, 50);
    runs.value = response.data ?? [];
  } catch {
    // ignore
  } finally {
    bRunsLoading.value = false;
  }
}

function startPoll(): void {
  pollHandle = setInterval(async () => {
    if (selectedAutomation.value) {
      // refresh automations list + runs silently
      try {
        const response = await automationsApi.list();
        automations.value = response.data ?? [];
        // update selected automation object
        const updated = automations.value.find((a) => a.id === selectedAutomation.value!.id);
        if (updated) {
          selectedAutomation.value = updated;
        }
      } catch {
        /* ignore */
      }
      try {
        const response = await automationsApi.listRuns(selectedAutomation.value.id, 50);
        runs.value = response.data ?? [];
      } catch {
        /* ignore */
      }
    }
  }, 15_000);
}

// --- create ---
function openCreateForm(): void {
  bShowCreateForm.value = true;
  newName.value = '';
  newWorkspaceId.value = workspaces.value[0]?.id ?? '';
  newAgentType.value = 'cursor-agent';
  newPrompt.value = '';
  newIntervalMinutes.value = 60;
  bNewEnabled.value = true;
  createError.value = null;
}

function cancelCreate(): void {
  if (bCreating.value) {
    return;
  }
  bShowCreateForm.value = false;
  createError.value = null;
}

async function createAutomation(): Promise<void> {
  createError.value = null;
  if (!newName.value.trim()) {
    createError.value = 'Name is required';
    return;
  }
  if (!newWorkspaceId.value) {
    createError.value = 'Workspace is required';
    return;
  }
  if (!newPrompt.value.trim()) {
    createError.value = 'Prompt is required';
    return;
  }
  if (newIntervalMinutes.value < 1) {
    createError.value = 'Interval must be at least 1 minute';
    return;
  }

  bCreating.value = true;
  try {
    await automationsApi.create({
      name: newName.value.trim(),
      workspaceId: newWorkspaceId.value,
      agentType: newAgentType.value,
      prompt: newPrompt.value.trim(),
      intervalMinutes: newIntervalMinutes.value,
      enabled: bNewEnabled.value
    });
    await fetchAll();
    cancelCreate();
    showSuccess('Automation created');
  } catch (e: unknown) {
    const caughtError = e as { response?: { data?: { error?: string } }; message?: string };
    createError.value =
      caughtError.response?.data?.error ?? caughtError.message ?? 'Failed to create';
  } finally {
    bCreating.value = false;
  }
}

// --- edit ---
function startEdit(a: Automation): void {
  bShowEditModal.value = true;
  editingId.value = a.id;
  editName.value = a.name;
  editAgentType.value = a.agentType;
  editPrompt.value = a.prompt;
  editIntervalMinutes.value = a.intervalMinutes;
  bEditEnabled.value = a.enabled;
  editError.value = null;
}

function cancelEdit(): void {
  if (bSavingEdit.value) {
    return;
  }
  bShowEditModal.value = false;
  editingId.value = null;
  editError.value = null;
}

async function saveEdit(): Promise<void> {
  if (!editingId.value) {
    return;
  }
  editError.value = null;
  if (!editName.value.trim()) {
    editError.value = 'Name is required';
    return;
  }
  if (!editPrompt.value.trim()) {
    editError.value = 'Prompt is required';
    return;
  }
  if (editIntervalMinutes.value < 1) {
    editError.value = 'Interval must be >= 1 minute';
    return;
  }

  bSavingEdit.value = true;
  try {
    await automationsApi.update(editingId.value, {
      name: editName.value.trim(),
      agentType: editAgentType.value,
      prompt: editPrompt.value.trim(),
      intervalMinutes: editIntervalMinutes.value,
      enabled: bEditEnabled.value
    });
    await fetchAll();
    // refresh selected if it's the one we edited
    if (selectedAutomation.value?.id === editingId.value) {
      const updated = automations.value.find((a) => a.id === editingId.value);
      if (updated) {
        selectedAutomation.value = updated;
      }
    }
    cancelEdit();
    showSuccess('Automation updated');
  } catch (e: unknown) {
    const caughtError = e as { response?: { data?: { error?: string } }; message?: string };
    editError.value = caughtError.response?.data?.error ?? caughtError.message ?? 'Failed to save';
  } finally {
    bSavingEdit.value = false;
  }
}

// --- toggle enabled ---
async function toggleEnabled(a: Automation): Promise<void> {
  try {
    await automationsApi.update(a.id, { enabled: !a.enabled });
    await fetchAll();
  } catch {
    errorMessage.value = 'Failed to toggle automation';
  }
}

// --- delete ---
function confirmDelete(a: Automation): void {
  automationToDelete.value = a;
}

async function doDelete(): Promise<void> {
  if (!automationToDelete.value) {
    return;
  }
  bDeleting.value = true;
  try {
    await automationsApi.remove(automationToDelete.value.id);
    if (selectedAutomation.value?.id === automationToDelete.value.id) {
      selectedAutomation.value = null;
      runs.value = [];
    }
    await fetchAll();
    automationToDelete.value = null;
    showSuccess('Automation deleted');
  } catch {
    errorMessage.value = 'Failed to delete automation';
  } finally {
    bDeleting.value = false;
  }
}

// --- trigger ---
async function triggerNow(a: Automation): Promise<void> {
  triggeringId.value = a.id;
  try {
    await automationsApi.trigger(a.id);
    showSuccess('Automation triggered — it will run in the background');
    // wait a bit then refresh runs
    setTimeout(() => {
      if (selectedAutomation.value?.id === a.id) {
        fetchRuns(a.id);
      }
    }, 2000);
  } catch {
    errorMessage.value = 'Failed to trigger automation';
  } finally {
    triggeringId.value = null;
  }
}

function changedFilesList(run: AutomationRun): Array<{ status: string; file: string }> {
  if (!run.changedFiles) {
    return [];
  }
  try {
    return JSON.parse(run.changedFiles) as Array<{ status: string; file: string }>;
  } catch {
    return [];
  }
}

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(async () => {
  await fetchAll();
  startPoll();
});

onUnmounted(() => {
  if (pollHandle) {
    clearInterval(pollHandle);
  }
});
</script>

<template>
  <PageShell>
    <!-- Header -->
    <PageHeader
      icon="schedule"
      title="Automations"
      subtitle="Schedule AI agents to run automatically at a set interval and review their reports."
    >
      <template #actions>
        <button
          type="button"
          class="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1 self-start"
          @click="openCreateForm"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          New automation
        </button>
      </template>
    </PageHeader>

    <div class="flex justify-between sm:justify-end mb-3">
      <div class="button-select-small mr-2 mt-0">
        <button
          class="button is-icon"
          :class="{ 'is-active': viewMode === 'list' }"
          @click="setViewMode('list')"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>
        <button
          class="button is-icon"
          :class="{ 'is-active': viewMode === 'grid' }"
          @click="setViewMode('grid')"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Global messages -->
    <div
      v-if="errorMessage"
      class="mb-4 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
    >
      {{ errorMessage }}
    </div>
    <div
      v-if="successMessage"
      class="mb-4 px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm"
    >
      {{ successMessage }}
    </div>

    <!-- Loading -->
    <div v-if="bLoading" class="flex items-center gap-2 py-8 text-text-muted text-sm">
      <div class="w-5 h-5 border-2 border-surface border-t-primary rounded-full animate-spin" />
      Loading automations…
    </div>

    <!-- Empty -->
    <div
      v-else-if="automations.length === 0"
      class="rounded-lg border border-fg/10 bg-fg/[0.02] py-16 px-4 text-center"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        width="40"
        height="40"
        class="text-text-muted mb-3 block mx-auto"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <p class="text-text-muted text-sm">No automations yet.</p>
      <p class="text-text-muted text-xs mt-1">
        Create one to schedule an agent to run automatically.
      </p>
    </div>

    <!-- Main layout: list + report panel -->
    <div v-else-if="!bLoading" class="flex flex-col lg:flex-row gap-6 min-h-[500px]">
      <!-- Left: automation list -->
      <div class="w-full lg:flex-1 min-w-0 space-y-4">
        <!-- Automation list -->
        <ul
          v-if="viewMode === 'list'"
          class="rounded-lg border border-fg/10 bg-fg/[0.02] divide-y divide-fg/10 overflow-hidden"
        >
          <li
            v-for="a in automations"
            :key="a.id"
            class="px-4 py-3 hover:bg-fg/[0.03] transition-colors cursor-pointer"
            :class="{
              'ring-1 ring-inset ring-primary/30 bg-primary/[0.02]': selectedAutomation?.id === a.id
            }"
            @click="selectAutomation(a)"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <p class="text-sm font-medium text-text-primary truncate">{{ a.name }}</p>
                  <!-- enabled badge -->
                  <span
                    class="text-[10px] px-1.5 py-0.5 rounded font-medium"
                    :class="
                      a.enabled ? 'bg-green-500/15 text-green-400' : 'bg-fg/10 text-text-muted'
                    "
                  >
                    {{ a.enabled ? 'active' : 'disabled' }}
                  </span>
                  <!-- agent badge -->
                  <span
                    class="text-[10px] px-1.5 py-0.5 rounded bg-fg/10 text-text-muted font-medium"
                  >
                    {{ agentTypeLabel(a.agentType) }}
                  </span>
                </div>
                <div class="flex items-center gap-3 mt-1 text-xs text-text-muted flex-wrap">
                  <span>{{ workspaceName(a.workspaceId) }}</span>
                  <span>every {{ formatInterval(a.intervalMinutes) }}</span>
                  <span>next: {{ formatNextRun(a) }}</span>
                  <span v-if="a.lastRunAt">last: {{ formatDate(a.lastRunAt) }}</span>
                </div>
                <p class="text-xs text-text-muted mt-1 truncate opacity-70">{{ a.prompt }}</p>
              </div>
              <!-- Actions -->
              <div class="flex items-center gap-1 shrink-0" @click.stop>
                <!-- toggle -->
                <button
                  type="button"
                  :title="a.enabled ? 'Disable' : 'Enable'"
                  class="p-1.5 text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
                  @click="toggleEnabled(a)"
                >
                  <svg
                    v-if="a.enabled"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    width="16"
                    height="16"
                    aria-hidden="true"
                  >
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                  <svg
                    v-else
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    width="16"
                    height="16"
                    aria-hidden="true"
                  >
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </button>
                <!-- trigger now -->
                <button
                  type="button"
                  title="Run now"
                  class="p-1.5 text-text-muted hover:text-primary hover:bg-primary/[0.06] rounded-lg transition-colors"
                  :disabled="triggeringId === a.id"
                  @click="triggerNow(a)"
                >
                  <span
                    v-if="triggeringId === a.id"
                    class="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin block"
                  />
                  <svg
                    v-else
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    width="16"
                    height="16"
                    aria-hidden="true"
                  >
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </button>
                <!-- edit -->
                <button
                  type="button"
                  title="Edit"
                  class="p-1.5 text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
                  @click="startEdit(a)"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    width="16"
                    height="16"
                    aria-hidden="true"
                  >
                    <path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6" />
                    <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
                  </svg>
                </button>
                <!-- delete -->
                <button
                  type="button"
                  title="Delete"
                  class="p-1.5 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                  @click="confirmDelete(a)"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    width="16"
                    height="16"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </li>
        </ul>

        <!-- Automation grid -->
        <div v-else class="grid-view">
          <div class="grid-view-items">
            <article
              v-for="a in automations"
              :key="a.id"
              class="group grid-item cursor-pointer"
              :class="{
                'ring-1 ring-inset ring-primary/30 bg-primary/[0.02]':
                  selectedAutomation?.id === a.id
              }"
              @click="selectAutomation(a)"
            >
              <div class="top">
                <div class="icon">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    width="16"
                    height="16"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div class="info min-w-0">
                  <p class="title truncate">{{ a.name }}</p>
                  <p class="text-xs text-text-muted mt-1">
                    {{ workspaceName(a.workspaceId) }} · every
                    {{ formatInterval(a.intervalMinutes) }}
                  </p>
                  <p class="text-xs text-text-muted mt-1">next: {{ formatNextRun(a) }}</p>
                  <p class="text-xs text-text-muted mt-1 truncate opacity-70">{{ a.prompt }}</p>
                  <div class="flex items-center gap-2 mt-2">
                    <span
                      class="text-[10px] px-1.5 py-0.5 rounded font-medium"
                      :class="
                        a.enabled ? 'bg-green-500/15 text-green-400' : 'bg-fg/10 text-text-muted'
                      "
                    >
                      {{ a.enabled ? 'active' : 'disabled' }}
                    </span>
                    <span
                      class="text-[10px] px-1.5 py-0.5 rounded bg-fg/10 text-text-muted font-medium"
                    >
                      {{ agentTypeLabel(a.agentType) }}
                    </span>
                  </div>
                </div>
                <div class="buttons" @click.stop>
                  <button
                    class="button is-icon is-transparent"
                    :title="a.enabled ? 'Disable' : 'Enable'"
                    @click="toggleEnabled(a)"
                  >
                    <svg
                      v-if="a.enabled"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <rect x="6" y="4" width="4" height="16" />
                      <rect x="14" y="4" width="4" height="16" />
                    </svg>
                    <svg
                      v-else
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </button>
                  <button
                    class="button is-icon is-transparent"
                    title="Run now"
                    :disabled="triggeringId === a.id"
                    @click="triggerNow(a)"
                  >
                    <span
                      v-if="triggeringId === a.id"
                      class="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin block"
                    />
                    <svg
                      v-else
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </button>
                  <button class="button is-icon is-transparent" title="Edit" @click="startEdit(a)">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6" />
                      <path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z" />
                    </svg>
                  </button>
                  <button
                    class="button is-icon is-transparent is-delete"
                    title="Delete"
                    @click="confirmDelete(a)"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      width="14"
                      height="14"
                      aria-hidden="true"
                    >
                      <path
                        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </div>

      <!-- Right: run report panel -->
      <div
        v-if="selectedAutomation"
        class="w-full lg:w-[420px] lg:shrink-0 flex flex-col gap-3 mt-4 lg:mt-0"
      >
        <div class="rounded-lg border border-fg/10 bg-fg/[0.02] overflow-hidden flex flex-col">
          <div class="px-4 py-3 border-b border-fg/10 flex items-center justify-between">
            <h2 class="text-sm font-medium text-text-primary truncate">
              {{ selectedAutomation.name }} — Runs
            </h2>
            <span class="text-xs text-text-muted">{{ runs.length }} runs</span>
          </div>

          <!-- runs loading -->
          <div
            v-if="bRunsLoading"
            class="flex items-center gap-2 px-4 py-6 text-text-muted text-sm"
          >
            <div
              class="w-4 h-4 border-2 border-surface border-t-primary rounded-full animate-spin"
            />
            Loading runs…
          </div>

          <!-- no runs -->
          <div v-else-if="runs.length === 0" class="px-4 py-10 text-center text-text-muted text-sm">
            No runs yet. Trigger one or wait for the schedule.
          </div>

          <!-- run list -->
          <ul v-else class="divide-y divide-fg/10 max-h-[280px] overflow-y-auto">
            <li
              v-for="run in runs"
              :key="run.id"
              class="px-4 py-2.5 hover:bg-fg/[0.04] cursor-pointer transition-colors flex items-center gap-3"
              :class="{ 'bg-fg/[0.06]': selectedRun?.id === run.id }"
              @click="selectedRun = selectedRun?.id === run.id ? null : run"
            >
              <svg
                v-if="run.status === 'completed'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                width="16"
                height="16"
                class="shrink-0 text-green-400"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <svg
                v-else-if="run.status === 'failed'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                width="16"
                height="16"
                class="shrink-0 text-destructive"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                width="16"
                height="16"
                class="shrink-0 text-yellow-400"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <div class="min-w-0 flex-1">
                <p class="text-xs text-text-primary">{{ formatDate(run.startedAt) }}</p>
                <p class="text-[11px] text-text-muted">
                  {{ run.status }}
                  <span v-if="run.finishedAt">
                    ·
                    {{
                      Math.round(
                        (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) /
                          1000
                      )
                    }}s
                  </span>
                  <span v-if="changedFilesList(run).length > 0">
                    · {{ changedFilesList(run).length }} file{{
                      changedFilesList(run).length !== 1 ? 's' : ''
                    }}
                    changed
                  </span>
                </p>
              </div>
              <svg
                v-if="selectedRun?.id === run.id"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                width="14"
                height="14"
                class="text-text-muted"
                aria-hidden="true"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                width="14"
                height="14"
                class="text-text-muted"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </li>
          </ul>
        </div>

        <!-- Run detail -->
        <div v-if="selectedRun" class="rounded-lg border border-fg/10 bg-fg/[0.02] overflow-hidden">
          <div class="px-4 py-3 border-b border-fg/10 flex items-center gap-2">
            <svg
              v-if="selectedRun.status === 'completed'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="16"
              height="16"
              class="text-green-400"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <svg
              v-else-if="selectedRun.status === 'failed'"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="16"
              height="16"
              class="text-destructive"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              width="16"
              height="16"
              class="text-yellow-400"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span class="text-sm font-medium text-text-primary capitalize">{{
              selectedRun.status
            }}</span>
            <span class="text-xs text-text-muted ml-auto">{{
              formatDate(selectedRun.startedAt)
            }}</span>
          </div>

          <div class="p-4 space-y-4 max-h-[420px] overflow-y-auto">
            <!-- Changed files -->
            <div v-if="changedFilesList(selectedRun).length > 0">
              <p class="text-xs font-medium text-text-muted mb-2 flex items-center gap-1">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  width="14"
                  height="14"
                  aria-hidden="true"
                >
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
                Changed files ({{ changedFilesList(selectedRun).length }})
              </p>
              <ul class="space-y-1">
                <li
                  v-for="f in changedFilesList(selectedRun)"
                  :key="f.file"
                  class="flex items-center gap-2 text-xs"
                >
                  <span class="font-mono text-yellow-400 w-5 shrink-0 text-center">{{
                    f.status
                  }}</span>
                  <span class="text-text-muted font-mono truncate">{{ f.file }}</span>
                </li>
              </ul>
            </div>
            <div v-else-if="selectedRun.status === 'completed'" class="text-xs text-text-muted">
              No files changed.
            </div>

            <!-- Error -->
            <div v-if="selectedRun.error">
              <p class="text-xs font-medium text-destructive mb-1 flex items-center gap-1">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  width="14"
                  height="14"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                Error
              </p>
              <pre
                class="text-xs text-destructive/80 bg-destructive/5 rounded p-2 whitespace-pre-wrap break-all font-mono"
                >{{ selectedRun.error }}</pre
              >
            </div>

            <!-- Agent response -->
            <div v-if="selectedRun.agentResponse">
              <p class="text-xs font-medium text-text-muted mb-2 flex items-center gap-1">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  width="14"
                  height="14"
                  aria-hidden="true"
                >
                  <rect x="2" y="7" width="20" height="14" rx="2" />
                  <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M8 11h.01M16 11h.01M9 16h6" />
                </svg>
                Agent response
              </p>
              <div
                class="text-xs text-text-primary bg-surface rounded p-3 whitespace-pre-wrap break-words max-h-64 overflow-y-auto"
              >
                {{ selectedRun.agentResponse }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Placeholder when nothing selected -->
      <div
        v-else-if="automations.length > 0"
        class="w-full lg:w-[420px] lg:shrink-0 rounded-lg border border-fg/10 bg-fg/[0.02] flex items-center justify-center text-text-muted text-sm py-16 text-center px-6 mt-4 lg:mt-0"
      >
        <div>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            width="32"
            height="32"
            class="mb-2 block mx-auto opacity-40"
            aria-hidden="true"
          >
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          <p>Select an automation to view run reports</p>
        </div>
      </div>
    </div>

    <!-- Create modal -->
    <div
      v-if="bShowCreateForm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="cancelCreate"
    >
      <div class="bg-bg border border-fg/20 rounded-lg shadow-xl max-w-2xl w-full p-4">
        <h2 class="text-sm font-medium text-text-primary mb-3">New automation</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Name</label>
            <input
              v-model="newName"
              type="text"
              placeholder="e.g. Daily security audit"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              :disabled="bCreating"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Workspace</label>
            <select
              v-model="newWorkspaceId"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              :disabled="bCreating"
            >
              <option v-for="w in workspaces" :key="w.id" :value="w.id">{{ w.name }}</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Agent</label>
            <select
              v-model="newAgentType"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              :disabled="bCreating"
            >
              <option value="cursor-agent">Cursor</option>
              <option value="mistral-vibe">Mistral Vibe</option>
              <option value="claude">Claude</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Interval</label>
            <select
              v-model="newIntervalMinutes"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              :disabled="bCreating"
            >
              <option v-for="p in intervalPresets" :key="p.value" :value="p.value">
                {{ p.label }}
              </option>
            </select>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-medium text-text-muted mb-1">Prompt</label>
            <textarea
              v-model="newPrompt"
              rows="4"
              placeholder="Describe what the agent should do each time it runs…"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
              :disabled="bCreating"
            />
          </div>
        </div>
        <p v-if="createError" class="text-sm text-destructive mt-2">{{ createError }}</p>
        <div class="flex items-center justify-end gap-2 mt-4">
          <label class="flex items-center gap-2 cursor-pointer mr-auto">
            <input
              v-model="bNewEnabled"
              type="checkbox"
              class="accent-primary w-4 h-4"
              :disabled="bCreating"
            />
            <span class="text-sm text-text-muted">Enabled</span>
          </label>
          <button
            type="button"
            class="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
            :disabled="bCreating"
            @click="cancelCreate"
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
            :disabled="bCreating || !newName.trim() || !newPrompt.trim() || !newWorkspaceId"
            @click="createAutomation"
          >
            <span
              v-if="bCreating"
              class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
            />
            Create
          </button>
        </div>
      </div>
    </div>

    <!-- Edit modal -->
    <div
      v-if="bShowEditModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="cancelEdit"
    >
      <div class="bg-bg border border-fg/20 rounded-lg shadow-xl max-w-2xl w-full p-4">
        <h2 class="text-sm font-medium text-text-primary mb-3">Edit automation</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Name</label>
            <input
              v-model="editName"
              type="text"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              :disabled="bSavingEdit"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Agent</label>
            <select
              v-model="editAgentType"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              :disabled="bSavingEdit"
            >
              <option value="cursor-agent">Cursor</option>
              <option value="mistral-vibe">Mistral Vibe</option>
              <option value="claude">Claude</option>
            </select>
          </div>
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Interval</label>
            <select
              v-model="editIntervalMinutes"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              :disabled="bSavingEdit"
            >
              <option v-for="p in intervalPresets" :key="p.value" :value="p.value">
                {{ p.label }}
              </option>
            </select>
          </div>
          <div class="flex items-end pb-0.5">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                v-model="bEditEnabled"
                type="checkbox"
                class="accent-primary w-4 h-4"
                :disabled="bSavingEdit"
              />
              <span class="text-sm text-text-muted">Enabled</span>
            </label>
          </div>
          <div class="md:col-span-2">
            <label class="block text-xs font-medium text-text-muted mb-1">Prompt</label>
            <textarea
              v-model="editPrompt"
              rows="4"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
              :disabled="bSavingEdit"
            />
          </div>
        </div>
        <p v-if="editError" class="text-sm text-destructive mt-2">{{ editError }}</p>
        <div class="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            class="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
            :disabled="bSavingEdit"
            @click="cancelEdit"
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
            :disabled="bSavingEdit || !editName.trim() || !editPrompt.trim()"
            @click="saveEdit"
          >
            <span
              v-if="bSavingEdit"
              class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
            />
            Save
          </button>
        </div>
      </div>
    </div>

    <!-- Delete confirm -->
    <ConfirmModal
      :model-value="automationToDelete !== null"
      title="Delete automation"
      :description="deleteConfirmDescription"
      confirm-label="Delete"
      variant="danger"
      :loading="bDeleting"
      @update:model-value="
        (v: boolean) => {
          if (!v) {
            automationToDelete = null;
          }
        }
      "
      @confirm="doDelete"
    />
  </PageShell>

  <!-- Root wrapper kept for app structure -->
  <div></div>
</template>

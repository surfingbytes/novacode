<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onUnmounted } from 'vue';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import AutomationCard from '@/components/automations/AutomationCard.vue';
import AutomationFormModal from '@/components/automations/AutomationFormModal.vue';
import PageShell from '@/components/layout/PageShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';

// api
import { automationsApi, workspaceApi } from '@/classes/api';

// stores
import { useToastStore } from '@/stores/toasts';

// types
import type { Automation, AutomationRun, Workspace, AgentType } from '@/@types/index';

// utils
import { formatDate } from '@/components/automations/automationFormat';

// -------------------------------------------------- Types --------------------------------------------------

interface AutomationFormPayload {
  name: string;
  workspaceId: string;
  agentType: AgentType;
  intervalMinutes: number;
  prompt: string;
  enabled: boolean;
}

// -------------------------------------------------- Stores --------------------------------------------------

const toastStore = useToastStore();

// -------------------------------------------------- Refs --------------------------------------------------

const workspaces = ref<Workspace[]>([]);
const automations = ref<Automation[]>([]);
const bLoading = ref(true);
const errorMessage = ref<string | null>(null);
const viewMode = ref<'list' | 'grid'>(
  (localStorage.getItem('automationsViewMode') as 'list' | 'grid') ?? 'list'
);

// selected automation for run report panel
const selectedAutomation = ref<Automation | null>(null);
const runs = ref<AutomationRun[]>([]);
const bRunsLoading = ref(false);
const selectedRun = ref<AutomationRun | null>(null);

// form modal (shared by create + edit; null = create)
const bShowFormModal = ref(false);
const editingAutomation = ref<Automation | null>(null);
const bSavingForm = ref(false);
const formError = ref<string | null>(null);

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

function setViewMode(mode: 'list' | 'grid'): void {
  viewMode.value = mode;
  localStorage.setItem('automationsViewMode', mode);
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

// --- create/edit form modal ---
function openCreateForm(): void {
  editingAutomation.value = null;
  formError.value = null;
  bShowFormModal.value = true;
}

function startEdit(a: Automation): void {
  editingAutomation.value = a;
  formError.value = null;
  bShowFormModal.value = true;
}

async function saveAutomation(payload: AutomationFormPayload): Promise<void> {
  formError.value = null;
  bSavingForm.value = true;
  const target = editingAutomation.value;
  try {
    if (target) {
      await automationsApi.update(target.id, {
        name: payload.name,
        agentType: payload.agentType,
        prompt: payload.prompt,
        intervalMinutes: payload.intervalMinutes,
        enabled: payload.enabled
      });
    } else {
      await automationsApi.create({
        name: payload.name,
        workspaceId: payload.workspaceId,
        agentType: payload.agentType,
        prompt: payload.prompt,
        intervalMinutes: payload.intervalMinutes,
        enabled: payload.enabled
      });
    }
    await fetchAll();
    // refresh selected if it's the one we edited
    if (target && selectedAutomation.value?.id === target.id) {
      const updated = automations.value.find((a) => a.id === target.id);
      if (updated) {
        selectedAutomation.value = updated;
      }
    }
    bShowFormModal.value = false;
    toastStore.success(target ? 'Automation updated' : 'Automation created');
  } catch (e: unknown) {
    const caughtError = e as { response?: { data?: { error?: string } }; message?: string };
    formError.value =
      caughtError.response?.data?.error ??
      caughtError.message ??
      (target ? 'Failed to save' : 'Failed to create');
  } finally {
    bSavingForm.value = false;
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
    toastStore.success('Automation deleted');
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
    toastStore.success('Automation triggered — it will run in the background');
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
          aria-label="List view"
          :aria-pressed="viewMode === 'list'"
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
          aria-label="Grid view"
          :aria-pressed="viewMode === 'grid'"
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
          <AutomationCard
            v-for="a in automations"
            :key="a.id"
            :automation="a"
            :workspace-name="workspaceName(a.workspaceId)"
            :b-selected="selectedAutomation?.id === a.id"
            :b-triggering="triggeringId === a.id"
            @select="selectAutomation(a)"
            @edit="startEdit(a)"
            @toggle="toggleEnabled(a)"
            @trigger="triggerNow(a)"
            @delete="confirmDelete(a)"
          />
        </ul>

        <!-- Automation grid -->
        <div v-else class="grid-view">
          <div class="grid-view-items">
            <AutomationCard
              v-for="a in automations"
              :key="a.id"
              b-grid
              :automation="a"
              :workspace-name="workspaceName(a.workspaceId)"
              :b-selected="selectedAutomation?.id === a.id"
              :b-triggering="triggeringId === a.id"
              @select="selectAutomation(a)"
              @edit="startEdit(a)"
              @toggle="toggleEnabled(a)"
              @trigger="triggerNow(a)"
              @delete="confirmDelete(a)"
            />
          </div>
        </div>
      </div>

      <!-- Right: run report panel -->
      <div
        v-if="selectedAutomation"
        class="w-full lg:w-[360px] lg:shrink-0 flex flex-col gap-3 mt-4 lg:mt-0"
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
        class="w-full lg:w-[360px] lg:shrink-0 rounded-lg border border-fg/10 bg-fg/[0.02] flex items-center justify-center text-text-muted text-sm py-16 text-center px-6 mt-4 lg:mt-0"
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

    <!-- Create/edit modal -->
    <AutomationFormModal
      v-model="bShowFormModal"
      :automation="editingAutomation"
      :workspaces="workspaces"
      :b-saving="bSavingForm"
      :server-error="formError"
      @save="saveAutomation"
    />

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

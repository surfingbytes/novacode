<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';

// components
import OrchestratorPanel from '@/components/OrchestratorPanel.vue';
import FilesView from '@/components/workspace/FilesComponent.vue';
import GitView from '@/components/workspace/GitView.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import PromptModal from '@/components/PromptModal.vue';
import EntityDetailHeader from '@/components/ui/EntityDetailHeader.vue';
import BottomTabBar from '@/components/ui/BottomTabBar.vue';

// classes
import { orchestratorApi } from '@/classes/api';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';
import { useToastStore } from '@/stores/toasts';
import { useOrchestratorsStore } from '@/stores/orchestrators';

// types
import type { Orchestrator } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  workspaceId: string;
  orchestratorId: string;
  showSidebarToggle?: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'toggle-sidebar'): void;
}>();

// -------------------------------------------------- Store --------------------------------------------------

const router = useRouter();
const workspacesStore = useWorkspacesStore();
const toastStore = useToastStore();
const orchestratorsStore = useOrchestratorsStore();

// -------------------------------------------------- Refs --------------------------------------------------

const orchestrator = computed<Orchestrator | null>(() =>
  orchestratorsStore.byId(props.orchestratorId)
);
const bLoading = ref(true);
const error = ref<string | null>(null);
const bShowDeleteModal = ref(false);
const bDeleting = ref(false);
type OrchestratorTab = 'orchestrator' | 'files' | 'git';
const activeTab = ref<OrchestratorTab>('orchestrator');

// -------------------------------------------------- Computed --------------------------------------------------

const workspaceName = computed(
  () => workspacesStore.workspaces.find((w) => w.id === props.workspaceId)?.name ?? 'Workspace',
);

const orchestratorTabs = computed(() => [
  { id: 'orchestrator', label: 'Orchestrator' },
  { id: 'files', label: 'Files' },
  { id: 'git', label: 'Git' },
]);

// -------------------------------------------------- Methods --------------------------------------------------

async function fetchOrchestrator(): Promise<void> {
  bLoading.value = true;
  error.value = null;
  try {
    const data = await orchestratorsStore.fetchOne(props.workspaceId, props.orchestratorId);
    if (!data) {
      error.value = 'Failed to load orchestrator';
    }
  } finally {
    bLoading.value = false;
  }
}

async function deleteOrchestrator(): Promise<void> {
  bDeleting.value = true;
  try {
    await orchestratorApi.remove(props.workspaceId, props.orchestratorId);
    router.push({ name: 'workspace-sessions', params: { id: props.workspaceId } });
  } catch {
    toastStore.error('Failed to delete orchestrator');
    bDeleting.value = false;
    bShowDeleteModal.value = false;
  }
}

async function toggleArchive(): Promise<void> {
  if (!orchestrator.value) {
    return;
  }
  try {
    const { data: updated } = await orchestratorApi.update(props.workspaceId, props.orchestratorId, {
      archived: !orchestrator.value.archived,
    });
    orchestratorsStore.upsertOrchestrator(updated);
  } catch {
    toastStore.error('Failed to toggle orchestrator archive');
  }
}

const bShowRenameModal = ref<boolean>(false);
const bRenaming = ref<boolean>(false);

function openEditOrchestratorName(): void {
  if (!orchestrator.value) {
    return;
  }
  bShowRenameModal.value = true;
}

async function confirmRename(nextName: string): Promise<void> {
  if (!orchestrator.value) {
    return;
  }
  const currentName = orchestrator.value.name ?? 'Orchestrator';
  if (!nextName || nextName === currentName) {
    bShowRenameModal.value = false;
    return;
  }
  bRenaming.value = true;
  try {
    const { data: updated } = await orchestratorApi.update(props.workspaceId, props.orchestratorId, {
      name: nextName,
    });
    orchestratorsStore.upsertOrchestrator(updated);
    bShowRenameModal.value = false;
  } catch {
    toastStore.error('Failed to rename orchestrator');
  } finally {
    bRenaming.value = false;
  }
}

function updateOrchestratorFromPanel(o: Orchestrator): void {
  orchestratorsStore.upsertOrchestrator(o);
}

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  fetchOrchestrator();
});

watch(
  () => props.orchestratorId,
  (newId, oldId) => {
    if (!newId || newId === oldId) {
      return;
    }
    // The orchestrator itself comes from the store (reactive on id change).
    activeTab.value = 'orchestrator';
    fetchOrchestrator();
  },
);
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Header -->
    <EntityDetailHeader
      :title="orchestrator?.name ?? 'Orchestrator'"
      :subtitle="workspaceName"
      :b-loading="bLoading"
      :archived="orchestrator?.archived ?? false"
      :b-show-sidebar-toggle="props.showSidebarToggle"
      entity-label="orchestrator"
      @toggle-sidebar="emit('toggle-sidebar')"
      @edit="openEditOrchestratorName"
      @archive="toggleArchive"
      @delete="bShowDeleteModal = true"
    />

    <div
      v-if="error"
      class="mx-4 md:mx-6 mt-4 border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3 shrink-0 rounded-lg"
    >
      {{ error }}
    </div>

    <!-- Tab content -->
    <div class="flex-1 overflow-hidden flex flex-col min-h-0">
      <!-- Orchestrator tab -->
      <template v-if="activeTab === 'orchestrator'">
        <!-- Loading skeleton -->
        <div v-if="bLoading" class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-4">
          <div class="h-4 w-3/4 max-w-md rounded bg-fg/10 animate-pulse" />
          <div class="space-y-2">
            <div class="h-20 rounded-xl bg-fg/10 animate-pulse" />
            <div class="h-10 w-32 rounded-lg bg-fg/10 animate-pulse" />
          </div>
          <div class="h-4 w-1/2 rounded bg-fg/10 animate-pulse mt-6" />
          <div class="space-y-3 mt-2">
            <div v-for="i in 3" :key="i" class="rounded-xl border border-fg/10 overflow-hidden">
              <div class="h-12 bg-fg/[0.06] animate-pulse" />
              <div class="h-16 bg-fg/5 animate-pulse" />
            </div>
          </div>
        </div>
        <OrchestratorPanel
          v-else-if="orchestrator"
          :workspace-id="workspaceId"
          :orchestrator-id="orchestratorId"
          :orchestrator="orchestrator"
          @update:orchestrator="updateOrchestratorFromPanel"
        />
      </template>

      <!-- Files -->
      <FilesView
        v-else-if="activeTab === 'files'"
        :workspace-id="workspaceId"
        :active="activeTab === 'files'"
      />

      <!-- Git -->
      <GitView
        v-else-if="activeTab === 'git'"
        :workspace-id="workspaceId"
        :active="activeTab === 'git'"
      />
    </div>

    <!-- Bottom tabs -->
    <BottomTabBar
      :tabs="orchestratorTabs"
      :model-value="activeTab"
      @update:model-value="activeTab = $event as OrchestratorTab"
    />

    <ConfirmModal
      v-model="bShowDeleteModal"
      title="Delete orchestrator"
      :description="`Delete '${orchestrator?.name}'? The task list and any step sessions from this plan will be permanently removed.`"
      confirm-label="Delete"
      :loading="bDeleting"
      @confirm="deleteOrchestrator"
    />

    <PromptModal
      v-model="bShowRenameModal"
      title="Edit orchestrator name"
      label="Name"
      :initial-value="orchestrator?.name ?? ''"
      confirm-label="Save"
      :loading="bRenaming"
      @confirm="confirmRename"
    />
  </div>
</template>

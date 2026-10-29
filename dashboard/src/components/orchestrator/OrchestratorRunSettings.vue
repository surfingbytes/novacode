<script setup lang="ts">
// node_modules
import { ref, computed, watch } from 'vue';

// components
import AgentModelPicker from '@/components/AgentModelPicker.vue';
import UiToggle from '@/components/ui/UiToggle.vue';

// classes
import { orchestratorApi, settingsApi } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';
import { agentTypeLabel } from '@/utils/agentTypeMeta';

// types
import type { AgentModelOption, AgentType, Orchestrator, Session } from '@/@types/index';

/**
 * Run settings: who runs the step sessions and the final "Verify against spec" step.
 * Extracted from OrchestratorPanel.vue.
 */

const AGENT_TYPES: AgentType[] = ['cursor-agent', 'claude', 'mistral-vibe', 'open-code', 'codex'];
const MAX_PARALLEL_CHOICES = [1, 2, 3, 4, 5, 6, 8];
const AUTO_MODEL_OPTION: AgentModelOption = { id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null };

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  workspaceId: string;
  orchestratorId: string;
  orchestrator: Orchestrator | null;
  plannerSession: Session | null;
  canEdit: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'update:orchestrator', orchestrator: Orchestrator): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const bSavingSettings = ref(false);
const workerModelOptions = ref<AgentModelOption[]>([]);
const bLoadingWorkerModels = ref(false);
const verifyModelOptions = ref<AgentModelOption[]>([]);
const bLoadingVerifyModels = ref(false);

// -------------------------------------------------- Computed --------------------------------------------------

const workerAgentType = computed<AgentType>(() => (props.orchestrator?.agentType ?? 'cursor-agent'));
// Workers always store an agent, so "same as planning chat" means: no model override and the planner's agent.
const bWorkersUsePlanner = computed(
  () => !props.orchestrator?.workerModel && (!props.plannerSession || props.plannerSession.agentType === workerAgentType.value)
);
const maxParallel = computed(() => props.orchestrator?.maxParallel ?? 3);
const bVerifyUsesPlanner = computed(() => !props.orchestrator?.verifyAgentType);
const verifyAgentType = computed<AgentType>(
  () => (props.orchestrator?.verifyAgentType ?? props.plannerSession?.agentType ?? workerAgentType.value)
);

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  [workerAgentType, bWorkersUsePlanner],
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

// -------------------------------------------------- Methods --------------------------------------------------

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

function onWorkersSamePlannerToggle(bSame: boolean): void {
  const plannerAgent = props.plannerSession?.agentType;
  void saveRunSettings(
    bSame ? { ...(plannerAgent ? { agentType: plannerAgent } : {}), workerModel: null } : { workerModel: 'auto' }
  );
}

function onVerifyAgentChange(event: Event): void {
  const agent = (event.target as HTMLSelectElement).value as AgentType;
  void saveRunSettings({ verifyAgentType: agent, verifyModel: 'auto' });
}

function onVerifySamePlannerToggle(bSame: boolean): void {
  // Turning it off starts from the planning chat's current agent and model.
  const planner = props.plannerSession;
  void saveRunSettings(
    bSame
      ? { verifyAgentType: null, verifyModel: null }
      : { verifyAgentType: verifyAgentType.value, verifyModel: planner?.modelSelection || 'auto' }
  );
}
</script>

<template>
  <div class="rounded-xl border border-fg/15 overflow-hidden">
    <div class="px-3 py-2 border-b border-fg/10 bg-fg/[0.04]">
      <span class="text-sm font-medium text-text-primary">Run settings</span>
      <p class="text-xs text-text-muted mt-0.5">Agent and model of the step sessions and of the final verify step.</p>
    </div>
    <div class="divide-y divide-fg/10">
      <div class="px-3 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span class="text-xs font-medium text-text-primary w-20 shrink-0">Workers</span>
        <div class="flex items-center gap-2">
          <span class="text-xs text-text-muted shrink-0">Same as planning chat</span>
          <UiToggle
            :model-value="bWorkersUsePlanner"
            :disabled="!canEdit || bSavingSettings"
            aria-label="Workers use the planning chat's agent and model"
            @update:model-value="onWorkersSamePlannerToggle"
          />
        </div>
        <template v-if="!bWorkersUsePlanner">
          <div class="flex items-center gap-2">
            <label class="text-xs text-text-muted shrink-0" for="orch-worker-agent">Agent</label>
            <select
              id="orch-worker-agent"
              class="w-auto h-auto text-sm px-2 py-1.5 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary"
              :value="workerAgentType"
              :disabled="!canEdit || bSavingSettings"
              @change="onWorkerAgentChange"
            >
              <option v-for="agent in AGENT_TYPES" :key="agent" :value="agent">{{ agentTypeLabel(agent) }}</option>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-text-muted shrink-0">Model</span>
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
        </template>
        <div class="flex items-center gap-2">
          <label class="text-xs text-text-muted shrink-0" for="orch-max-parallel">Parallel at once</label>
          <select
            id="orch-max-parallel"
            class="w-auto h-auto text-sm px-2 py-1.5 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary"
            :value="maxParallel"
            :disabled="!canEdit || bSavingSettings"
            @change="saveRunSettings({ maxParallel: Number(($event.target as HTMLSelectElement).value) })"
          >
            <option v-for="count in MAX_PARALLEL_CHOICES" :key="count" :value="count">{{ count }}</option>
          </select>
        </div>
      </div>
      <div class="px-3 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span class="text-xs font-medium text-text-primary w-20 shrink-0">Verification</span>
        <div class="flex items-center gap-2">
          <span class="text-xs text-text-muted shrink-0">Same as planning chat</span>
          <UiToggle
            :model-value="bVerifyUsesPlanner"
            :disabled="!canEdit || bSavingSettings"
            aria-label="Verification uses the planning chat's agent and model"
            @update:model-value="onVerifySamePlannerToggle"
          />
        </div>
        <template v-if="!bVerifyUsesPlanner">
          <div class="flex items-center gap-2">
            <label class="text-xs text-text-muted shrink-0" for="orch-verify-agent">Agent</label>
            <select
              id="orch-verify-agent"
              class="w-auto h-auto text-sm px-2 py-1.5 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary"
              :value="verifyAgentType"
              :disabled="!canEdit || bSavingSettings"
              @change="onVerifyAgentChange"
            >
              <option v-for="agent in AGENT_TYPES" :key="agent" :value="agent">{{ agentTypeLabel(agent) }}</option>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-text-muted shrink-0">Model</span>
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
  </div>
</template>

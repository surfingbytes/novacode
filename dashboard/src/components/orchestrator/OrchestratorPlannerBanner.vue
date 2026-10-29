<script setup lang="ts">
// node_modules
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { MessageSquare } from 'lucide-vue-next';

// classes
import { orchestratorApi } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';

// types
import type { Orchestrator, Session } from '@/@types/index';

/** Planning chat: where the plan is written and adjusted. Extracted from OrchestratorPanel.vue. */

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  workspaceId: string;
  orchestratorId: string;
  orchestrator: Orchestrator | null;
  plannerSession: Session | null;
  bEmbedded?: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'update:orchestrator', orchestrator: Orchestrator): void;
  (e: 'open-chat'): void;
}>();

// -------------------------------------------------- Store --------------------------------------------------

const router = useRouter();

// -------------------------------------------------- Refs --------------------------------------------------

const bCreatingPlanner = ref(false);

// -------------------------------------------------- Computed --------------------------------------------------

const bHasPlanner = computed(() => !!props.orchestrator?.sourceSessionId);

// -------------------------------------------------- Methods --------------------------------------------------

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
</script>

<template>
  <div class="rounded-xl border border-fg/15 bg-fg/[0.04] px-3 py-2.5 flex flex-wrap items-center gap-3">
    <MessageSquare :size="16" :stroke-width="1.6" class="text-text-muted shrink-0" aria-hidden="true" />
    <p class="text-sm text-text-muted flex-1 min-w-[12rem]">
      <template v-if="bHasPlanner">
        The planning chat<span v-if="plannerSession">{{ ' ' }}<strong class="text-text-primary font-medium">{{ plannerSession.name || 'Untitled session' }}</strong></span>
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
</template>

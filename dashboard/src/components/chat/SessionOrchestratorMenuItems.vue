<script setup lang="ts">
/**
 * Orchestrator actions as items of the header's mobile overflow menu — the
 * phone counterpart of SessionOrchestratorButton (which hides below lg).
 */
// node_modules
import { computed } from 'vue';
import { ExternalLink, FileText, ListOrdered, RefreshCw } from 'lucide-vue-next';

// stores
import { useSessionSpecsStore } from '@/stores/sessionSpecs';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  sessionId: string;
  /** Id of the plan this chat owns, if any (may still be empty). */
  orchestratorId: string | null;
  /** The plan has steps — the main item opens it instead of asking for one. */
  bHasSteps: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  /** Send the "plan as orchestrator" prompt into the chat. */
  (e: 'plan'): void;
  /** Show the Orchestrator tab. */
  (e: 'open-plan'): void;
  /** Open the orchestrator's full page. */
  (e: 'open-page'): void;
  /** Show the spec modal. */
  (e: 'open-spec'): void;
}>();

// -------------------------------------------------- Stores --------------------------------------------------

const specsStore = useSessionSpecsStore();

// -------------------------------------------------- Computed --------------------------------------------------

const status = computed(() => specsStore.forSession(props.sessionId));
const bHasPlan = computed(() => !!props.orchestratorId);
const bStale = computed(() => props.bHasSteps && !!status.value?.bChatNewerThanSpec);
const bHasSpec = computed(() => !!status.value?.hasContent);

// -------------------------------------------------- Methods --------------------------------------------------

function onMainClick(): void {
  if (props.bHasSteps) emit('open-plan');
  else emit('plan');
}
</script>

<template>
  <button
    type="button"
    class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
    role="menuitem"
    @click="onMainClick"
  >
    <ListOrdered :size="14" :stroke-width="1.6" class="shrink-0" aria-hidden="true" />
    {{ bHasSteps ? 'Orchestrator' : 'Plan as orchestrator' }}
  </button>
  <button
    v-if="bHasSteps"
    type="button"
    class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
    role="menuitem"
    @click="emit('plan')"
  >
    <RefreshCw :size="14" :stroke-width="1.6" class="shrink-0" aria-hidden="true" />
    <span class="flex-1">Update plan</span>
    <span v-if="bStale" class="text-[11px] text-warning">chat changed</span>
  </button>
  <button
    v-if="bHasPlan"
    type="button"
    class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
    role="menuitem"
    @click="emit('open-page')"
  >
    <ExternalLink :size="14" :stroke-width="1.6" class="shrink-0" aria-hidden="true" />
    Orchestrator page
  </button>
  <button
    v-if="bHasSpec"
    type="button"
    class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
    role="menuitem"
    @click="emit('open-spec')"
  >
    <FileText :size="14" :stroke-width="1.6" class="shrink-0" aria-hidden="true" />
    Open spec
  </button>
</template>

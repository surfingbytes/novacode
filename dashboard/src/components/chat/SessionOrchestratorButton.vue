<script setup lang="ts">
/**
 * Split button in the session header: turns the chat into orchestrator mode.
 * The main action asks the chat's own agent to write the spec and split the
 * work into steps through the nova MCP (or opens the Orchestrator tab once a
 * plan exists); the chevron menu updates the plan and opens/creates the spec.
 */
// node_modules
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronDown, Copy, ExternalLink, FileText, ListOrdered, RefreshCw } from 'lucide-vue-next';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// stores
import { useSessionSpecsStore } from '@/stores/sessionSpecs';
import { useToastStore } from '@/stores/toasts';

// utils
import { renderMd } from '@/utils/chatDisplayItems';

// lib
import { notifyApiError } from '@/lib/notifyApiError';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  workspaceId: string;
  sessionId: string;
  /** Id of the plan this chat owns, if any (may still be empty). */
  orchestratorId: string | null;
  /** The plan has steps — the main action opens it instead of asking for one. */
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
}>();

// -------------------------------------------------- Stores --------------------------------------------------

const specsStore = useSessionSpecsStore();
const toastStore = useToastStore();

// -------------------------------------------------- Refs --------------------------------------------------

const menuRef = ref<HTMLElement | null>(null);
const bMenuOpen = ref(false);
const bSpecModalOpen = ref(false);
const specContent = ref<string | null>(null);
const bSpecLoading = ref(false);

// -------------------------------------------------- Computed --------------------------------------------------

const status = computed(() => specsStore.forSession(props.sessionId));
const bHasPlan = computed(() => !!props.orchestratorId);
const bStale = computed(() => props.bHasSteps && !!status.value?.bChatNewerThanSpec);
const mainLabel = computed(() => (props.bHasSteps ? 'Orchestrator' : 'Plan as orchestrator'));
const mainTitle = computed(() =>
  props.bHasSteps
    ? 'Show the plan of this chat'
    : 'The agent writes the spec and splits the agreed work into steps (Nova MCP)'
);
/** The agent writes the spec through the nova MCP; until then there is nothing to open. */
const bHasSpec = computed(() => !!status.value?.hasContent);
const bHasMenu = computed(() => bHasPlan.value || bHasSpec.value);
const renderedSpec = computed(() => renderMd(specContent.value ?? ''));

// -------------------------------------------------- Methods --------------------------------------------------

async function loadStatus(): Promise<void> {
  try {
    await specsStore.fetchSpec(props.workspaceId, props.sessionId);
  } catch {
    // header control only — works without the spec status
  }
}

function onMainClick(): void {
  if (props.bHasSteps) emit('open-plan');
  else emit('plan');
}

function runMenuAction(action: 'plan' | 'open-page'): void {
  bMenuOpen.value = false;
  if (action === 'plan') emit('plan');
  else emit('open-page');
}

async function openSpec(): Promise<void> {
  bMenuOpen.value = false;
  bSpecModalOpen.value = true;
  bSpecLoading.value = true;
  try {
    specContent.value = await specsStore.fetchSpec(props.workspaceId, props.sessionId);
  } catch (err) {
    specContent.value = null;
    notifyApiError(err, 'Failed to load the spec');
  } finally {
    bSpecLoading.value = false;
  }
}

async function copySpecPath(): Promise<void> {
  const path = status.value?.path;
  if (!path) return;
  try {
    await navigator.clipboard.writeText(path);
    toastStore.success('Spec path copied');
  } catch {
    toastStore.error('Copy failed');
  }
}

function handleDocumentClick(e: MouseEvent): void {
  const el = menuRef.value;
  if (bMenuOpen.value && el && !el.contains(e.target as Node)) {
    bMenuOpen.value = false;
  }
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && bMenuOpen.value) {
    bMenuOpen.value = false;
  }
}

defineExpose({ openSpec });

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.sessionId,
  () => {
    bMenuOpen.value = false;
    void loadStatus();
  }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  void loadStatus();
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <!-- Below lg the actions live in the header's overflow menu; the spec modal stays reachable via openSpec() -->
  <div ref="menuRef" class="relative shrink-0 hidden lg:block">
    <div class="inline-flex items-stretch h-9 rounded-lg border border-fg/10 overflow-hidden">
      <button
        type="button"
        class="relative inline-flex items-center gap-1.5 px-2.5 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] transition-colors"
        :title="mainTitle"
        :aria-label="mainLabel"
        @click="onMainClick"
      >
        <ListOrdered :size="16" :stroke-width="1.6" aria-hidden="true" />
        <span class="hidden xl:inline whitespace-nowrap">{{ mainLabel }}</span>
        <span
          v-if="bStale"
          class="absolute top-1.5 right-1 w-1.5 h-1.5 rounded-full bg-warning"
          aria-hidden="true"
        />
      </button>
      <button
        v-if="bHasMenu"
        type="button"
        class="inline-flex items-center justify-center w-7 border-l border-fg/10 text-text-muted hover:text-text-primary hover:bg-fg/[0.06] transition-colors"
        aria-haspopup="true"
        :aria-expanded="bMenuOpen"
        title="Orchestrator and spec options"
        aria-label="Orchestrator and spec options"
        @click.stop="bMenuOpen = !bMenuOpen"
      >
        <ChevronDown :size="14" :stroke-width="1.8" aria-hidden="true" />
      </button>
    </div>

    <div
      v-if="bMenuOpen"
      class="absolute right-0 top-full mt-1 z-50 min-w-[15rem] rounded-lg border border-border bg-surface py-1 shadow-lg"
      role="menu"
      @click.stop
    >
      <template v-if="bHasPlan">
        <button
          v-if="bHasSteps"
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
          role="menuitem"
          title="Ask the agent to update the spec and the steps from this chat"
          @click="runMenuAction('plan')"
        >
          <RefreshCw :size="14" :stroke-width="1.6" class="shrink-0" aria-hidden="true" />
          <span class="flex-1">Update plan from chat</span>
          <span v-if="bStale" class="text-[11px] text-warning">chat changed</span>
        </button>
        <button
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
          role="menuitem"
          @click="runMenuAction('open-page')"
        >
          <ExternalLink :size="14" :stroke-width="1.6" class="shrink-0" aria-hidden="true" />
          Open orchestrator page
        </button>
      </template>
      <button
        v-if="bHasSpec"
        type="button"
        class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
        role="menuitem"
        @click="openSpec"
      >
        <FileText :size="14" :stroke-width="1.6" class="shrink-0" aria-hidden="true" />
        Open spec
      </button>
    </div>

    <BaseModal v-model="bSpecModalOpen" labelledby="session-spec-title" panel-class="max-w-3xl">
      <ModalHeader eyebrow="// session spec" title="Spec" title-id="session-spec-title" />
      <div class="px-6 pb-2 flex items-center gap-2 text-xs text-text-muted min-w-0">
        <span class="truncate font-mono" :title="status?.path">{{ status?.path }}</span>
        <button
          type="button"
          class="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md hover:text-text-primary hover:bg-fg/[0.06]"
          title="Copy path"
          aria-label="Copy spec path"
          @click="copySpecPath"
        >
          <Copy :size="13" :stroke-width="1.6" aria-hidden="true" />
        </button>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
        <div v-if="bSpecLoading" class="py-6 text-sm text-text-muted">Loading…</div>
        <template v-else>
          <p v-if="!status?.hasContent" class="mb-3 text-sm text-text-muted">
            The spec is empty. Ask the agent in this chat to write the spec, or use
            <strong>Plan as orchestrator</strong> to have it write the spec and the steps.
          </p>
          <div class="chat-markdown text-sm text-text-primary" v-html="renderedSpec" />
        </template>
      </div>
    </BaseModal>
  </div>
</template>

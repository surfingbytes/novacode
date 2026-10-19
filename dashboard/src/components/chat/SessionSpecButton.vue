<script setup lang="ts">
/**
 * Split button in the session header: chat → spec → ready-to-run orchestrator.
 * Main action creates (or opens) the orchestrator; the chevron menu creates the
 * spec file only, opens the spec, or regenerates the plan from the chat.
 */
// node_modules
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ChevronDown, Copy, FilePlus, FileText, LoaderCircle, RefreshCw, Workflow } from 'lucide-vue-next';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// stores
import { useSessionSpecsStore } from '@/stores/sessionSpecs';
import { useToastStore } from '@/stores/toasts';

// utils
import { renderMd } from '@/utils/chatDisplayItems';
import { isAxiosError } from 'axios';

// types
import type { SessionSpecJobState } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  workspaceId: string;
  sessionId: string;
  /** Agent is replying right now — the spec turn cannot start. */
  bBusy: boolean;
  /** Chat has at least one finished turn with the agent. */
  bHasConversation: boolean;
}>();

// -------------------------------------------------- Stores --------------------------------------------------

const specsStore = useSessionSpecsStore();
const toastStore = useToastStore();
const router = useRouter();

// -------------------------------------------------- Refs --------------------------------------------------

const menuRef = ref<HTMLElement | null>(null);
const bMenuOpen = ref(false);
const bRequesting = ref(false);
const bSpecModalOpen = ref(false);
const specContent = ref<string | null>(null);
const bSpecLoading = ref(false);

// -------------------------------------------------- Computed --------------------------------------------------

const status = computed(() => specsStore.forSession(props.sessionId));
const jobState = computed<SessionSpecJobState>(() => status.value?.job.state ?? 'idle');
const bJobRunning = computed(() => jobState.value === 'writing-spec' || jobState.value === 'planning');
const orchestratorId = computed(() => status.value?.orchestratorId ?? null);
const bStale = computed(() => !!orchestratorId.value && !!status.value?.bChatNewerThanSpec);

const generateBlockedReason = computed<string | null>(() => {
  if (!props.bHasConversation) return 'Chat with the agent first';
  if (props.bBusy) return 'Wait for the agent to finish replying';
  return null;
});

const mainLabel = computed(() => {
  if (jobState.value === 'writing-spec') return 'Writing spec…';
  if (jobState.value === 'planning') return 'Planning…';
  return orchestratorId.value ? 'Open orchestrator' : 'Create orchestrator';
});

const mainTitle = computed(() => {
  if (jobState.value === 'writing-spec') return 'The agent is writing the spec from this chat';
  if (jobState.value === 'planning') return 'Splitting the spec into orchestrator steps';
  if (orchestratorId.value) {
    return bStale.value
      ? 'Open orchestrator — the chat changed since its spec was written (regenerate from the menu)'
      : 'Open the orchestrator generated from this chat';
  }
  return generateBlockedReason.value ?? 'Agent writes the spec from this chat, then a ready-to-run orchestrator is created';
});

const bMainDisabled = computed(
  () => bJobRunning.value || bRequesting.value || (!orchestratorId.value && !!generateBlockedReason.value)
);

const renderedSpec = computed(() => renderMd(specContent.value ?? ''));

// -------------------------------------------------- Methods --------------------------------------------------

function errorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) {
    const message = (err.response?.data as { error?: string } | undefined)?.error;
    if (message) return message;
  }
  return fallback;
}

async function loadStatus(): Promise<void> {
  try {
    await specsStore.fetchSpec(props.workspaceId, props.sessionId);
  } catch {
    // header control only — stay hidden-ish (default label) on failure
  }
}

async function startGenerate(): Promise<void> {
  bMenuOpen.value = false;
  if (generateBlockedReason.value) {
    toastStore.info(generateBlockedReason.value);
    return;
  }
  bRequesting.value = true;
  try {
    await specsStore.generateOrchestrator(props.workspaceId, props.sessionId);
  } catch (err) {
    toastStore.error(errorMessage(err, 'Failed to start generating the orchestrator'));
  } finally {
    bRequesting.value = false;
  }
}

function openOrchestrator(): void {
  if (!orchestratorId.value) return;
  void router.push(`/workspace/${props.workspaceId}/orchestrator/${orchestratorId.value}`);
}

function onMainClick(): void {
  if (orchestratorId.value) {
    openOrchestrator();
    return;
  }
  void startGenerate();
}

async function createSpecOnly(): Promise<void> {
  bMenuOpen.value = false;
  try {
    await specsStore.createSpec(props.workspaceId, props.sessionId);
    toastStore.success('Spec file created — ask the agent to write to the spec');
  } catch (err) {
    toastStore.error(errorMessage(err, 'Failed to create the spec file'));
  }
}

async function openSpec(): Promise<void> {
  bMenuOpen.value = false;
  bSpecModalOpen.value = true;
  bSpecLoading.value = true;
  try {
    specContent.value = await specsStore.fetchSpec(props.workspaceId, props.sessionId);
  } catch (err) {
    specContent.value = null;
    toastStore.error(errorMessage(err, 'Failed to load the spec'));
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

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.sessionId,
  () => {
    bMenuOpen.value = false;
    void loadStatus();
  }
);

// Job finished while this chat is open: go straight to the new plan, or surface the failure.
watch(jobState, (next, previous) => {
  if (previous !== 'writing-spec' && previous !== 'planning') return;
  if (next === 'idle' && orchestratorId.value) {
    toastStore.success('Orchestrator ready');
    openOrchestrator();
  } else if (next === 'failed') {
    toastStore.error(status.value?.job.error ?? 'Generating the orchestrator failed');
  }
});

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
  <div ref="menuRef" class="relative shrink-0">
    <div class="inline-flex items-stretch h-9 rounded-lg border border-fg/10 overflow-hidden">
      <button
        type="button"
        class="relative inline-flex items-center gap-1.5 px-2.5 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] transition-colors disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-muted"
        :title="mainTitle"
        :aria-label="mainLabel"
        :disabled="bMainDisabled"
        @click="onMainClick"
      >
        <LoaderCircle v-if="bJobRunning || bRequesting" :size="16" :stroke-width="1.8" class="animate-spin text-primary" aria-hidden="true" />
        <Workflow v-else :size="16" :stroke-width="1.6" aria-hidden="true" />
        <span class="hidden xl:inline whitespace-nowrap">{{ mainLabel }}</span>
        <span
          v-if="bStale && !bJobRunning"
          class="absolute top-1.5 right-1 w-1.5 h-1.5 rounded-full bg-warning"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        class="inline-flex items-center justify-center w-7 border-l border-fg/10 text-text-muted hover:text-text-primary hover:bg-fg/[0.06] transition-colors"
        aria-haspopup="true"
        :aria-expanded="bMenuOpen"
        title="Spec options"
        aria-label="Spec options"
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
      <p
        v-if="jobState === 'failed' && status?.job.error"
        class="px-3 py-2 text-xs text-destructive border-b border-border mb-1"
      >
        Last attempt failed: {{ status.job.error }}
      </p>
      <button
        v-if="!status?.exists"
        type="button"
        class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
        role="menuitem"
        @click="createSpecOnly"
      >
        <FilePlus :size="14" :stroke-width="1.6" class="shrink-0" aria-hidden="true" />
        Create spec file only
      </button>
      <button
        v-else
        type="button"
        class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
        role="menuitem"
        @click="openSpec"
      >
        <FileText :size="14" :stroke-width="1.6" class="shrink-0" aria-hidden="true" />
        Open spec
      </button>
      <button
        v-if="orchestratorId"
        type="button"
        class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors disabled:opacity-50"
        role="menuitem"
        :disabled="bJobRunning || bRequesting"
        :title="generateBlockedReason ?? 'Agent updates the spec from this chat, then a new orchestrator is created'"
        @click="startGenerate"
      >
        <RefreshCw :size="14" :stroke-width="1.6" class="shrink-0" aria-hidden="true" />
        <span class="flex-1">Regenerate from chat</span>
        <span v-if="bStale" class="text-[11px] text-warning">chat changed</span>
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
            The spec is empty. Ask the agent in this chat to write something to the spec, or use
            <strong>Create orchestrator</strong> to have it write the full spec.
          </p>
          <div class="chat-markdown text-sm text-text-primary" v-html="renderedSpec" />
        </template>
      </div>
    </BaseModal>
  </div>
</template>

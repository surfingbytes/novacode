<script setup lang="ts">
/**
 * Collapsible card showing the planning chat's spec with inline editing.
 * The spec is read live by every step (and by the final verify step), so
 * editing stays allowed while a run is in progress.
 */
// node_modules
import { computed, onMounted, ref, watch } from 'vue';
import { ChevronRight } from 'lucide-vue-next';

// stores
import { useSessionSpecsStore } from '@/stores/sessionSpecs';

// utils
import { renderMd } from '@/utils/chatDisplayItems';
import { relativeTimeShort } from '@/utils/relativeTime';

// lib
import { notifyApiError } from '@/lib/notifyApiError';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  workspaceId: string;
  /** Planning chat that owns the spec. */
  sessionId: string;
}>();

// -------------------------------------------------- Store --------------------------------------------------

const specsStore = useSessionSpecsStore();

// -------------------------------------------------- Refs --------------------------------------------------

const bExpanded = ref(false);
const bLoading = ref(false);
const bEditing = ref(false);
const bSaving = ref(false);
/** File content as last fetched or saved (null until loaded). */
const content = ref<string | null>(null);
/** `status.updatedAt` the current `content` belongs to; a newer status triggers a refetch. */
const loadedUpdatedAt = ref<string | null | undefined>(undefined);
const draft = ref('');

// -------------------------------------------------- Computed --------------------------------------------------

const status = computed(() => specsStore.forSession(props.sessionId));
const bHasContent = computed(() => !!status.value?.hasContent);
const updatedLabel = computed(() => {
  const updatedAt = status.value?.updatedAt;
  return bHasContent.value && updatedAt ? `updated ${relativeTimeShort(updatedAt)}` : 'empty';
});
const renderedSpec = computed(() => renderMd(content.value ?? ''));

// -------------------------------------------------- Methods --------------------------------------------------

async function loadContent(): Promise<void> {
  if (bLoading.value) return;
  bLoading.value = true;
  try {
    content.value = await specsStore.fetchSpec(props.workspaceId, props.sessionId);
    loadedUpdatedAt.value = status.value?.updatedAt ?? null;
  } catch (err: unknown) {
    notifyApiError(err, 'Failed to load the spec');
  } finally {
    bLoading.value = false;
  }
}

function toggle(): void {
  bExpanded.value = !bExpanded.value;
  if (bExpanded.value && loadedUpdatedAt.value === undefined) {
    void loadContent();
  }
}

/** A spec without content (missing file or only the template header) is edited from scratch. */
function startEdit(): void {
  draft.value = bHasContent.value ? (content.value ?? '') : '';
  bEditing.value = true;
}

function cancelEdit(): void {
  bEditing.value = false;
}

async function save(): Promise<void> {
  if (bSaving.value) return;
  bSaving.value = true;
  try {
    content.value = await specsStore.saveSpec(props.workspaceId, props.sessionId, draft.value);
    // The status applied by saveSpec carries the new mtime; the watcher below must not refetch it.
    loadedUpdatedAt.value = status.value?.updatedAt ?? null;
    bEditing.value = false;
  } catch (err: unknown) {
    notifyApiError(err, 'Failed to save the spec');
  } finally {
    bSaving.value = false;
  }
}

// -------------------------------------------------- Watchers --------------------------------------------------

// The agent may rewrite the spec through the nova MCP while the card is open; the status arrives live.
// Our own save also applies a new status before its content is in hand, so it must not refetch.
watch(
  () => status.value?.updatedAt,
  (updatedAt) => {
    if (
      bExpanded.value &&
      !bSaving.value &&
      loadedUpdatedAt.value !== undefined &&
      updatedAt !== loadedUpdatedAt.value
    ) {
      void loadContent();
    }
  }
);

watch(
  () => props.sessionId,
  () => {
    content.value = null;
    loadedUpdatedAt.value = undefined;
    bEditing.value = false;
    if (bExpanded.value) {
      void loadContent();
    }
  }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  // On the standalone orchestrator page nobody has fetched the status yet; the header needs it.
  if (!status.value) {
    void loadContent();
  }
});
</script>

<template>
  <div class="rounded-xl border border-fg/15 overflow-hidden">
    <button
      type="button"
      class="w-full px-3 py-2 bg-fg/[0.04] flex items-center gap-2 text-left hover:bg-fg/[0.06] transition-colors"
      :class="{ 'border-b border-fg/10': bExpanded }"
      :aria-expanded="bExpanded"
      data-testid="spec-toggle"
      @click="toggle"
    >
      <ChevronRight
        :size="16"
        :stroke-width="1.8"
        class="shrink-0 text-text-muted transition-transform"
        :class="{ 'rotate-90': bExpanded }"
        aria-hidden="true"
      />
      <span class="text-sm font-medium text-text-primary flex-1">Spec</span>
      <span class="text-xs text-text-muted" data-testid="spec-updated">{{ updatedLabel }}</span>
    </button>

    <div v-if="bExpanded" class="px-3 py-2.5 space-y-2" data-testid="spec-body">
      <template v-if="bEditing">
        <textarea
          v-model="draft"
          rows="12"
          class="w-full min-h-[18rem] text-sm font-mono px-3 py-2 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary placeholder-text-muted resize-y"
          placeholder="Spec in markdown"
          aria-label="Spec content"
          data-testid="spec-textarea"
          :disabled="bSaving"
        />
        <div class="flex items-center gap-2">
          <button
            type="button"
            :disabled="bSaving"
            class="px-3 py-1.5 text-sm font-medium bg-primary text-on-accent rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2 disabled:opacity-60"
            data-testid="spec-save"
            @click="save"
          >
            <span
              v-if="bSaving"
              class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0"
            />
            {{ bSaving ? 'Saving…' : 'Save' }}
          </button>
          <button
            type="button"
            :disabled="bSaving"
            class="px-3 py-1.5 text-sm font-medium border border-fg/20 text-text-primary rounded-lg hover:bg-fg/[0.06] transition-colors disabled:opacity-60"
            data-testid="spec-cancel"
            @click="cancelEdit"
          >
            Cancel
          </button>
        </div>
      </template>

      <template v-else>
        <div v-if="bLoading && content === null" class="text-sm text-text-muted">Loading…</div>
        <template v-else>
          <p v-if="!bHasContent" class="text-sm text-text-muted" data-testid="spec-empty">
            The planning chat has not written a spec yet.
          </p>
          <div
            v-else
            class="chat-markdown text-sm text-text-primary max-h-[32rem] overflow-y-auto"
            data-testid="spec-rendered"
            v-html="renderedSpec"
          />
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-sm font-medium border border-fg/20 text-text-primary rounded-lg hover:bg-fg/[0.06] transition-colors"
              data-testid="spec-edit"
              @click="startEdit"
            >
              Edit
            </button>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>

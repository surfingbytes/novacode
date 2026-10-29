<script setup lang="ts">
/**
 * Unified diff of the file edits an Edit/Write tool call reported (ACP `diff`
 * content). Small diffs are always shown; larger ones sit behind a toggle the
 * parent owns (`bExpanded` / `toggle`).
 */

// node_modules
import { computed } from 'vue';

// types
import type { ToolDiff } from '@/utils/chatDisplayTypes';

// utils
import { TOOL_DIFF_COLLAPSE_LINE_LIMIT, buildToolDiffView } from '@/utils/chatToolDiff';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    diffs: ToolDiff[];
    bExpanded?: boolean;
  }>(),
  { bExpanded: false }
);

const diffViews = computed(() => props.diffs.map((diff) => buildToolDiffView(diff)));

const totalLineCount = computed(() => diffViews.value.reduce((total, view) => total + view.lineCount, 0));
const totalAdded = computed(() => diffViews.value.reduce((total, view) => total + view.added, 0));
const totalRemoved = computed(() => diffViews.value.reduce((total, view) => total + view.removed, 0));

const bCollapsible = computed(() => totalLineCount.value > TOOL_DIFF_COLLAPSE_LINE_LIMIT);
const bBodyShown = computed(() => !bCollapsible.value || props.bExpanded);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'toggle'): void;
}>();
</script>

<template>
  <div v-if="diffViews.length" class="px-1">
    <!-- Diff toggle (large diffs only) -->
    <button
      v-if="bCollapsible"
      type="button"
      class="flex items-center gap-0.5 text-[11px] text-text-muted/50 hover:text-text-muted transition-colors"
      data-testid="tool-diff-toggle"
      @click="emit('toggle')"
    >
      <svg
        v-if="bExpanded"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <polyline points="18 15 12 9 6 15" />
      </svg>
      <svg
        v-else
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
      diff
      <span class="ml-1 font-mono text-success/70">+{{ totalAdded }}</span>
      <span class="font-mono text-destructive/70">−{{ totalRemoved }}</span>
    </button>
    <!-- Diff body -->
    <div
      v-if="bBodyShown"
      class="mt-1 max-h-[320px] overflow-auto rounded border border-fg/10 bg-fg/[0.02]"
      data-testid="tool-diff-body"
    >
      <div class="min-w-full w-max">
        <template v-for="(view, viewIndex) in diffViews" :key="`${view.path}:${viewIndex}`">
          <!-- File header -->
          <div
            class="flex items-center gap-2 px-2 py-0.5 text-[11px] font-mono border-b border-fg/[0.08]"
            :class="{ 'border-t': viewIndex > 0 }"
            :title="view.path"
          >
            <span class="whitespace-pre">
              <span class="text-text-muted/60">{{ view.directory }}</span><span class="font-bold text-text-primary">{{ view.fileName }}</span>
            </span>
            <span class="shrink-0 text-success" data-testid="tool-diff-added">+{{ view.added }}</span>
            <span class="shrink-0 text-destructive" data-testid="tool-diff-removed">−{{ view.removed }}</span>
          </div>
          <!-- Hunk rows -->
          <div
            v-for="(row, rowIndex) in view.rows"
            :key="rowIndex"
            class="px-2 leading-5 whitespace-pre text-[11px] font-mono"
            :class="row.className"
          >
            {{ row.text || ' ' }}
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// node_modules
import type { ComponentPublicInstance } from 'vue';
import { MdEditor, MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';

// -------------------------------------------------- Props --------------------------------------------------
defineProps<{
  selectedPath: string | null;
  selectedPathFileName: string;
  readError: string | null;
  bReadLoading: boolean;
  bIsMarkdownFile: boolean;
  bMarkdownPreview: boolean;
  bHtmlPreview: boolean;
  htmlPreviewObjectUrl: string | null;
  bIsImageFile: boolean;
  imageObjectUrl: string | null;
  bIsBinaryFile: boolean;
  bIsDarkTheme: boolean;
  /** Function ref for the Monaco host element (owned by the parent's editor composable). */
  setEditorContainer: (el: Element | ComponentPublicInstance | null) => void;
}>();

const fileContent = defineModel<string>('fileContent', { required: true });

const emit = defineEmits<{
  'download': [];
}>();

/** md-editor-v3 pulls these extensions from unpkg, which the CSP blocks; keep them off. */
const mdEditorNoCdnProps = { noMermaid: true, noKatex: true, noHighlight: true, noEcharts: true } as const;
</script>

<template>
  <div
    v-if="!selectedPath"
    class="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-text-muted"
  >
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="opacity-50"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    <p>Select a file to view or edit</p>
  </div>
  <div v-else-if="readError" class="message is-error" role="alert">
    {{ readError }}
  </div>
  <div v-else class="flex-1 flex flex-col min-h-0 relative">
    <!-- Loading overlay: keep editor container mounted so Monaco stays attached -->
    <div
      v-if="bReadLoading && !fileContent"
      class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-text-muted text-sm"
    >
      <span
        class="w-5 h-5 border-2 border-fg/30 border-t-primary rounded-full animate-spin block"
      />
      Loading file…
    </div>
    <div
      v-if="bIsMarkdownFile && bMarkdownPreview"
      class="flex-1 min-h-0 overflow-auto"
    >
      <MdPreview
        :model-value="fileContent"
        class="border-0!"
        language="en-US"
        :theme="bIsDarkTheme ? 'dark' : 'light'"
        v-bind="mdEditorNoCdnProps"
      />
    </div>
    <MdEditor
      v-else-if="bIsMarkdownFile"
      v-model="fileContent"
      class="flex-1 min-h-[200px]"
      language="en-US"
      :theme="bIsDarkTheme ? 'dark' : 'light'"
      :preview="false"
      :toolbars-exclude="[
        'github',
        'save',
        'preview',
        'previewOnly',
        'htmlPreview',
        // these load scripts from unpkg, which the CSP blocks
        'fullscreen',
        'prettier',
        'mermaid',
        'katex'
      ]"
      v-bind="mdEditorNoCdnProps"
      no-prettier
      no-upload-img
    />
    <iframe
      v-else-if="bHtmlPreview"
      :src="htmlPreviewObjectUrl ?? undefined"
      class="flex-1 min-h-[200px] w-full border-0 bg-white"
      title="HTML preview"
      sandbox="allow-scripts"
      referrerpolicy="no-referrer"
    />
    <div
      v-else-if="bIsImageFile"
      class="flex-1 min-h-[200px] w-full overflow-auto flex items-center justify-center p-4"
    >
      <img
        v-if="imageObjectUrl"
        :src="imageObjectUrl"
        :alt="selectedPathFileName"
        class="max-w-full max-h-full object-contain"
      />
    </div>
    <div
      v-else-if="bIsBinaryFile"
      class="flex-1 min-h-[200px] w-full flex flex-col items-center justify-center gap-3 p-4 text-sm text-text-muted"
    >
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <p>Binary file — preview not available.</p>
      <button type="button" class="button is-primary h-8!" @click="emit('download')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span> Download </span>
      </button>
    </div>
    <div v-else :ref="setEditorContainer" class="flex-1 min-h-[200px] w-full" />
  </div>
</template>

<style scoped>
/* md-editor-v3 defaults to word-break: break-all, which splits mid-word on narrow screens. */
:deep(.md-editor-preview) {
  word-break: normal;
  overflow-wrap: break-word;
}

/*
 * Tailwind preflight sets list-style: none on ul/ol. md-editor-v3 only adds padding
 * and relies on browser markers, so preview lists look indented with no bullets/numbers.
 */
:deep(.md-editor-preview ul) {
  list-style: disc;
}

:deep(.md-editor-preview ol) {
  list-style: decimal;
}

:deep(.md-editor-preview ul ul) {
  list-style: circle;
}

:deep(.md-editor-preview ul ul ul) {
  list-style: square;
}

:deep(.md-editor-preview .task-list-item) {
  list-style: none;
}

/*
 * MdPreview sets height:auto + overflow:visible, which grows past the pane and gets
 * clipped by the parent overflow:hidden. Keep content natural height so the wrapper scrolls.
 */
:deep(.md-editor-previewOnly) {
  height: auto;
  max-height: none;
  overflow: visible;
}
</style>

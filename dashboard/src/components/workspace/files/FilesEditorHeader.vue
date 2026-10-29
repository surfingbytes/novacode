<script setup lang="ts">
// -------------------------------------------------- Props --------------------------------------------------
defineProps<{
  bSidePanelToggleVisible: boolean;
  bSidePanelOpen: boolean;
  bWidePane: boolean;
  selectedPath: string | null;
  selectedPathFileName: string;
  bDirty: boolean;
  saveResult: 'success' | 'error' | null;
  saveErrorMessage: string;
  bIsPreviewableMarkup: boolean;
  bReadLoading: boolean;
  bIsEditorFile: boolean;
  bSaving: boolean;
}>();

const contentViewMode = defineModel<'edit' | 'preview'>('contentViewMode', { required: true });

const emit = defineEmits<{
  'show-panel': [];
  'close': [];
  'download': [];
  'save': [];
}>();
</script>

<template>
  <div
    class="shrink-0 px-3 py-1.5 bg-surface flex items-center justify-between gap-2 h-11.5! border-b border-border"
  >
    <div class="flex items-center gap-2 min-w-0 flex-1 h-8">
      <button
        v-if="bSidePanelToggleVisible && !bSidePanelOpen"
        type="button"
        class="button is-icon is-transparent h-9! w-9!"
        aria-label="Show file list"
        title="Show file list"
        @click="emit('show-panel')"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M11 9l3 3-3 3"/></svg>
      </button>
      <!-- Back to file list on narrow viewports -->
      <button
        v-if="!bWidePane"
        type="button"
        class="button is-icon is-transparent h-8! w-8!"
        aria-label="Back to file list"
        @click="emit('close')"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <span
        class="text-xs text-text-text-primary font-mono mt-1 truncate min-w-0"
      >
        {{ bWidePane ? (selectedPath ?? 'Select a file') : selectedPathFileName }}
      </span>
      <span
        v-if="bDirty"
        class="shrink-0 mt-1 flex items-center gap-1 text-xs text-warning"
        title="Unsaved changes"
      >
        <span class="w-1.5 h-1.5 rounded-full bg-warning" aria-hidden="true" />
        Unsaved
      </span>
    </div>
    <div class="flex items-center gap-1">
      <span
        v-if="saveResult === 'success'"
        class="text-xs text-success mr-1"
        role="status"
      >
        Saved
      </span>
      <span
        v-else-if="saveResult === 'error'"
        class="text-xs text-destructive mr-1 truncate max-w-60"
        role="alert"
        :title="saveErrorMessage"
      >
        {{ saveErrorMessage }}
      </span>
      <div
        v-if="bIsPreviewableMarkup"
        class="button-select-small h-8! p-0.5! mr-1"
        role="group"
        aria-label="View mode"
      >
        <button
          type="button"
          class="button is-icon"
          :class="{ 'is-active': contentViewMode === 'edit' }"
          aria-label="Edit"
          :aria-pressed="contentViewMode === 'edit'"
          title="Edit"
          @click="contentViewMode = 'edit'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        </button>
        <button
          type="button"
          class="button is-icon"
          :class="{ 'is-active': contentViewMode === 'preview' }"
          aria-label="Preview"
          :aria-pressed="contentViewMode === 'preview'"
          title="Preview"
          @click="contentViewMode = 'preview'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>
      <button
        v-if="selectedPath"
        type="button"
        class="button is-primary is-transparent h-8!"
        :disabled="bReadLoading"
        title="Download file"
        aria-label="Download file"
        @click="emit('download')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span> Download </span>
      </button>
      <button
        v-if="selectedPath && bIsEditorFile"
        type="button"
        class="button is-primary is-transparent h-8!"
        :disabled="bSaving"
        title="Save (Ctrl+S)"
        aria-label="Save (Ctrl+S)"
        @click="emit('save')"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        <span> Save </span>
      </button>
    </div>
  </div>
</template>

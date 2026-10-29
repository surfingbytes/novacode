<script setup lang="ts">
// composables
import { useLongPress } from '@/composables/useLongPress';

// types
import type { FileEntry } from '@/@types/index';
import type { VisibleFileEntry } from './useFileTree';

// -------------------------------------------------- Props --------------------------------------------------
defineProps<{
  bShowFileTree: boolean;
  bWidePane: boolean;
  bFullscreen: boolean;
  bShowHidden: boolean;
  bSidePanelToggleVisible: boolean;
  selectedPath: string | null;
  visibleEntries: VisibleFileEntry[];
  bListLoading: boolean;
  bRootEmpty: boolean;
  listError: string | null;
  isExpanded: (path: string) => boolean;
  bCreatingFile: boolean;
  bCreatingFileLoading: boolean;
  createKind: 'file' | 'folder';
  createFileError: string | null;
}>();

const newFilePath = defineModel<string>('newFilePath', { required: true });

const emit = defineEmits<{
  'toggle-hidden': [];
  'open-create': [kind: 'file' | 'folder'];
  'toggle-fullscreen': [];
  'hide-panel': [];
  'create': [];
  'cancel-create': [];
  'entry-click': [entry: FileEntry];
  /** Context menu requested at viewport coordinates (right-click or long-press). */
  'entry-menu': [entry: FileEntry, x: number, y: number];
}>();

// -------------------------------------------------- Methods --------------------------------------------------
const longPress = useLongPress<FileEntry>((entry) => {
  emit('entry-menu', entry, 16, 80);
});

function onEntryClick(entry: FileEntry): void {
  if (longPress.bTriggered.value) {
    longPress.bTriggered.value = false;
    return;
  }
  emit('entry-click', entry);
}
</script>

<template>
  <div
    v-show="bShowFileTree"
    class="shrink-0 border-border flex flex-col overflow-hidden bg-surface"
    :class="[
      bWidePane ? 'w-64' : 'w-full',
      !bFullscreen ? 'mr-2 rounded-md border' : ''
    ]"
  >
    <div
      class="text-sm py-2 px-2 font-semibold text-text-primary flex justify-between items-center h-11.5! border-b border-border"
    >
      Files

      <div class="flex items-center gap-1">
        <button
          type="button"
          class="button is-icon is-transparent h-8!"
          :aria-pressed="bShowHidden"
          :aria-label="bShowHidden ? 'Hide dotfiles' : 'Show hidden files'"
          :title="bShowHidden ? 'Hide dotfiles' : 'Show hidden files'"
          @click="emit('toggle-hidden')"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path v-if="bShowHidden" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle v-if="bShowHidden" cx="12" cy="12" r="3" />
            <path v-else d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" />
          </svg>
        </button>
        <button type="button" class="button is-icon is-transparent h-8!" aria-label="New folder" title="New folder" @click="emit('open-create', 'folder')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><path d="M12 11v6M9 14h6"/></svg>
        </button>
        <button type="button" class="button is-icon is-transparent h-8!" aria-label="New file" title="New file" @click="emit('open-create', 'file')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </button>

        <!-- fullscreen button -->
        <button
          type="button"
          class="button is-icon is-transparent h-8!"
          :aria-label="bFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          :title="bFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
          @click="emit('toggle-fullscreen')"
        >
          <svg v-if="bFullscreen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
        </button>

        <button
          v-if="bSidePanelToggleVisible && selectedPath"
          type="button"
          class="button is-icon is-transparent h-9! w-9!"
          aria-label="Hide file list"
          title="Hide file list"
          @click="emit('hide-panel')"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M14 9l-3 3 3 3"/></svg>
        </button>
      </div>
    </div>
    <div v-if="bCreatingFile" class="border-b border-border px-2 py-2 flex flex-col gap-2">
      <input
        v-model="newFilePath"
        type="text"
        class="input w-full"
        :placeholder="createKind === 'folder' ? 'src/lib' : 'src/new-file.ts'"
        :disabled="bCreatingFileLoading"
        @keydown.enter.prevent="emit('create')"
        @keydown.esc.prevent="emit('cancel-create')"
      />
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="button is-primary h-8!"
          :disabled="bCreatingFileLoading"
          @click="emit('create')"
        >
          <span>{{ createKind === 'folder' ? 'Create folder' : 'Create' }}</span>
        </button>
        <button
          type="button"
          class="button is-transparent h-8!"
          :disabled="bCreatingFileLoading"
          @click="emit('cancel-create')"
        >
          Cancel
        </button>
      </div>
      <p v-if="createFileError" class="text-xs text-destructive">
        {{ createFileError }}
      </p>
    </div>
    <div class="flex-1 overflow-auto py-1">
      <div v-if="listError" class="px-3 py-2 text-xs text-destructive">
        {{ listError }}
      </div>
      <!-- w-max/min-w-full: rows size to the widest entry so long names scroll horizontally -->
      <div class="w-max min-w-full">
        <button
          v-for="{ entry, depth } in visibleEntries"
          :key="entry.path"
          type="button"
          class="group w-full flex items-center gap-1.5 py-1 pr-2 text-left text-sm whitespace-nowrap transition-colors hover:bg-primary/10 cursor-pointer"
          :class="
            !entry.isDirectory && selectedPath === entry.path
              ? 'bg-primary/15 text-primary hover:bg-primary/10'
              : 'text-text-primary hover:bg-primary/10!'
          "
          :style="{ paddingLeft: 8 + depth * 12 + 'px' }"
          @click="onEntryClick(entry)"
          @contextmenu.prevent.stop="emit('entry-menu', entry, $event.clientX, $event.clientY)"
          @pointerdown="longPress.onPointerDown($event, entry)"
          @pointerup="longPress.onPointerUp"
          @pointercancel="longPress.onPointerUp"
          @pointermove="longPress.onPointerMove"
        >
          <span class="select-none shrink-0 w-4 h-4 flex items-center justify-center">
            <template v-if="entry.isDirectory">
              <!-- keyboard_arrow_down when expanded, chevron_right when collapsed -->
              <svg v-if="isExpanded(entry.path)" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>
            </template>
            <template v-else>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            </template>
          </span>

          <span>{{ entry.name }}</span>
        </button>
      </div>
      <div
        v-if="bListLoading && bRootEmpty"
        class="px-3 py-2 text-xs text-text-muted"
      >
        Loading…
      </div>
    </div>
  </div>
</template>

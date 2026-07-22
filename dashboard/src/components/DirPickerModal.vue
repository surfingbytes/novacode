<script setup lang="ts">
// node_modules
import { computed, ref, watch } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';

// classes
import { workspaceApi } from '@/classes/api';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  modelValue: boolean;
  initialPath?: string;
}>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'select', path: string): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------
const currentPath = ref<string>('/');
const entries = ref<{ name: string; path: string; isDirectory: boolean }[]>([]);
const bIsLoading = ref<boolean>(false);
const error = ref<string>('');
const bShowNewFolder = ref<boolean>(false);
const newFolderName = ref<string>('');
const newFolderError = ref<string>('');
const bIsCreatingFolder = ref<boolean>(false);
const newFolderInputRef = ref<HTMLInputElement | null>(null);

// -------------------------------------------------- Computed --------------------------------------------------
// potential computed properties here
const entriesWithParent = computed(() => {
  if (!currentPath.value || currentPath.value === '/') {
    return entries.value;
  }
  return [{ name: 'Parent folder', path: null }, ...entries.value];
});

// -------------------------------------------------- Methods --------------------------------------------------
const load = async (path: string): Promise<void> => {
  bIsLoading.value = true;
  error.value = '';
  try {
    const fullPath = path.startsWith('/data-root') ? path : '/data-root' + path;
    const response = await workspaceApi.browse(fullPath);
    currentPath.value = response.data.path.replace('/data-root', '');
    entries.value = response.data.entries;
  } catch (err: unknown) {
    const msg =
      (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
      'Failed to load directory';
    error.value = msg;
    entries.value = [];
  } finally {
    bIsLoading.value = false;
  }
};

const enterDir = (entry: { path: string | null }): void => {
  if (entry.path === null) {
    goUp();
    return;
  }

  load(entry.path);
};

const goUp = (): void => {
  const p = currentPath.value.replace(/\/?[^/]+\/?$/, '') || '/';
  load(p);
};

const selectCurrent = (): void => {
  emit('select', currentPath.value);
  emit('update:modelValue', false);
};

const close = (): void => {
  emit('update:modelValue', false);
};

const startNewFolder = (): void => {
  bShowNewFolder.value = true;
  newFolderName.value = '';
  newFolderError.value = '';
  setTimeout(() => {
    newFolderInputRef.value?.focus();
  }, 1);
};

const cancelNewFolder = (): void => {
  bShowNewFolder.value = false;
  newFolderName.value = '';
  newFolderError.value = '';
};

const createFolder = async (): Promise<void> => {
  const name = newFolderName.value.trim();
  if (!name) {
    newFolderError.value = 'Enter a folder name';
    return;
  }
  if (/[\\/]/.test(name)) {
    newFolderError.value = 'Folder name cannot contain / or \\';
    return;
  }
  bIsCreatingFolder.value = true;
  newFolderError.value = '';
  try {
    const fullPath = currentPath.value.startsWith('/data-root')
      ? currentPath.value
      : '/data-root' + currentPath.value;
    await workspaceApi.createFolder(fullPath, name);
    cancelNewFolder();
    await load(currentPath.value);
  } catch (err: unknown) {
    const msg =
      (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
      'Failed to create folder';
    newFolderError.value = msg;
  } finally {
    bIsCreatingFolder.value = false;
  }
};

// -------------------------------------------------- Lifecycle --------------------------------------------------
watch(
  () => [props.modelValue, props.initialPath] as const,
  ([open, initial]) => {
    if (open) {
      bShowNewFolder.value = false;
      newFolderName.value = '';
      newFolderError.value = '';
      const start = typeof initial === 'string' && initial.trim() ? initial.trim() : '';
      load(start);
    }
  }
);
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    labelledby="dir-picker-modal-title"
    panel-class="max-w-xl"
    @update:model-value="close"
  >
    <!-- Header -->
    <div class="modal-header">
      <div id="dir-picker-modal-title">Choose workspace folder</div>
      <button class="close-button" aria-label="Close dialog" @click="close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>

          <!-- Body -->
          <div class="modal-body">
            <!-- Current path display -->
            <div class="field">
              <div class="label">Current path</div>
              <div class="input-wrap">
                <input
                  v-model="currentPath"
                  type="text"
                  class="text-xs! font-mono truncate"
                  disabled
                />
                <button class="button hidden! lg:flex!" @click="startNewFolder">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                  New folder
                </button>
                <button class="button is-icon lg:hidden!" @click="startNewFolder">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                </button>
              </div>
            </div>
            <hr />

            <!-- Loading -->
            <div v-if="bIsLoading" class="flex items-center justify-center py-12">
              <div
                class="w-6 h-6 border-2 border-surface border-t-primary rounded-full animate-spin"
              ></div>
            </div>

            <!-- Error -->
            <div v-else-if="error" class="message is-error">
              {{ error }}
            </div>

            <template v-else>
              <div v-if="bShowNewFolder" class="box">
                <div class="field">
                  <div class="label">New folder</div>
                  <div class="input-wrap flex-wrap lg:flex-nowrap">
                    <input
                      type="text"
                      v-model="newFolderName"
                      placeholder="Folder name"
                      @keydown.enter="createFolder"
                      @keydown.escape="cancelNewFolder"
                      ref="newFolderInputRef"
                    />
                    <button class="button is-primary flex-1 lg:flex-none" @click="createFolder">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
                      Create
                    </button>
                    <button class="button is-icon" @click="cancelNewFolder">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                  <p v-if="newFolderError" class="hint is-error">
                    {{ newFolderError }}
                  </p>
                </div>
              </div>

              <hr v-if="bShowNewFolder" />

              <!-- Directory listing -->
              <div class="box h-[50vh] overflow-y-auto">
                <!-- New folder inline form -->

                <div class="space-y-0.5">
                  <template v-for="entry in entriesWithParent" :key="entry.path ?? 'parent'">
                    <button
                      type="button"
                      class="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-text-primary hover:text-text-primary hover:bg-fg/[0.05] rounded-lg transition-colors"
                      @click="enterDir(entry)"
                    >
                      <svg v-if="entry.path" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none shrink-0"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                      <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none shrink-0"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                      <span class="truncate font-mono text-xs">{{ entry.name }}/</span>
                    </button>
                    <hr v-if="entry.path == null" />
                  </template>
                </div>

                <p
                  v-if="entries.length === 0 && !bIsLoading"
                  class="text-sm text-text-muted text-center py-8"
                >
                  No subdirectories here.
                </p>
              </div>
            </template>
          </div>

          <!-- Footer -->
          <div class="modal-footer">
            <button class="button is-transparent" @click="close">Cancel</button>
            <button class="button is-primary" :disabled="bIsLoading" @click="selectCurrent">
              Select this folder
            </button>
          </div>
  </BaseModal>
</template>

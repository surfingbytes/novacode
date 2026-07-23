<script setup lang="ts">
// node_modules
import { ref, computed, onMounted } from 'vue';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';

// classes
import { workspaceRulesApi, roleTemplatesApi } from '@/classes/api';

// types
import type { WorkspaceRuleFileSummary, RoleTemplate, Workspace } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  workspace: Workspace;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const files = ref<WorkspaceRuleFileSummary[]>([]);
const bListLoading = ref(true);
const listError = ref<string | null>(null);
const bRulesDirMissing = ref(false);
const selectedFilename = ref<string | null>(null);
const bContentLoading = ref(false);
const content = ref('');
const originalContent = ref('');
const bSaving = ref(false);
const saveError = ref<string | null>(null);
const successMessage = ref<string | null>(null);
const ruleTemplates = ref<RoleTemplate[]>([]);
const bRuleTemplatesLoading = ref(false);
const ruleTemplatesError = ref<string | null>(null);
const bShowTemplateModal = ref(false);
const newTemplateName = ref('');
const newTemplateDescription = ref('');
const newTemplateContent = ref('');
const bCreatingTemplate = ref(false);
const createTemplateError = ref<string | null>(null);
const fileToDelete = ref<string | null>(null);
const bDeleting = ref(false);
const deleteError = ref<string | null>(null);
const fileToRename = ref<string | null>(null);
const renameNewFilename = ref('');
const bRenaming = ref(false);
const renameError = ref<string | null>(null);
const bShowNewRuleModal = ref(false);
const newRuleMode = ref<'blank' | 'template'>('blank');
const newRuleFilename = ref('');
const selectedTemplateId = ref<string | null>(null);
const bCreatingRule = ref(false);
const createRuleError = ref<string | null>(null);

// -------------------------------------------------- Computed --------------------------------------------------

const workspaceId = computed(() => props.workspace.id);
const fileLabel = computed(() => {
  const file = files.value.find((f) => f.filename === selectedFilename.value);
  return file?.label ?? selectedFilename.value ?? '';
});
const hasUnsavedChanges = computed(
  () => selectedFilename.value !== null && content.value !== originalContent.value
);
const deleteDescription = computed(() =>
  fileToDelete.value ? `Delete "${fileToDelete.value}"? This cannot be undone.` : ''
);

// -------------------------------------------------- Methods --------------------------------------------------

function showSuccess(msg: string): void {
  successMessage.value = msg;
  setTimeout(() => {
    if (successMessage.value === msg) {
      successMessage.value = null;
    }
  }, 3000);
}

async function fetchFiles(): Promise<void> {
  if (!workspaceId.value) {
    return;
  }
  bListLoading.value = true;
  listError.value = null;
  bRulesDirMissing.value = false;
  try {
    const { data } = await workspaceRulesApi.list(workspaceId.value);
    files.value = data ?? [];
    if (files.value.length > 0) {
      // Initial selection without unsaved-change prompt.
      selectedFilename.value = files.value[0].filename;
      await loadFile(files.value[0].filename);
    } else {
      selectedFilename.value = null;
      content.value = '';
      originalContent.value = '';
    }
  } catch (e: unknown) {
    const caughtError = e as {
      response?: { status?: number; data?: { error?: string; code?: string } };
      message?: string;
    };
    const code = caughtError.response?.data?.code;
    if (code === 'RULES_DIR_NOT_FOUND') {
      bRulesDirMissing.value = true;
      files.value = [];
      selectedFilename.value = null;
      content.value = '';
      originalContent.value = '';
      listError.value = null;
    } else if (code === 'WORKSPACE_NOT_FOUND' || caughtError.response?.status === 404) {
      listError.value = 'Workspace not found.';
    } else {
      listError.value = caughtError.response?.data?.error ?? 'Failed to load rules';
    }
  } finally {
    bListLoading.value = false;
  }
}

async function loadFile(filename: string): Promise<void> {
  if (!workspaceId.value) {
    return;
  }
  bContentLoading.value = true;
  saveError.value = null;
  try {
    const { data } = await workspaceRulesApi.read(workspaceId.value, filename);
    content.value = data.content ?? '';
    originalContent.value = content.value;
  } catch (e: unknown) {
    const caughtError = e as {
      response?: { status?: number; data?: { error?: string; code?: string } };
      message?: string;
    };
    const code = caughtError.response?.data?.code;
    if (code === 'FILE_NOT_FOUND') {
      saveError.value = 'Rule file not found. It may have been deleted.';
    } else if (code === 'RULES_DIR_NOT_FOUND') {
      bRulesDirMissing.value = true;
      saveError.value = 'Rules directory not found for this workspace.';
    } else {
      saveError.value = caughtError.response?.data?.error ?? 'Failed to load rule file';
    }
    content.value = '';
    originalContent.value = '';
  } finally {
    bContentLoading.value = false;
  }
}

const bShowDiscardConfirm = ref<boolean>(false);
const pendingSelectFilename = ref<string | null>(null);

async function selectFile(filename: string): Promise<void> {
  if (filename === selectedFilename.value) {
    return;
  }
  if (hasUnsavedChanges.value) {
    pendingSelectFilename.value = filename;
    bShowDiscardConfirm.value = true;
    return;
  }
  selectedFilename.value = filename;
  await loadFile(filename);
}

async function confirmDiscardAndSelect(): Promise<void> {
  const filename = pendingSelectFilename.value;
  bShowDiscardConfirm.value = false;
  pendingSelectFilename.value = null;
  if (!filename) {
    return;
  }
  selectedFilename.value = filename;
  await loadFile(filename);
}

async function saveCurrent(): Promise<void> {
  if (!workspaceId.value || !selectedFilename.value || !hasUnsavedChanges.value) {
    return;
  }
  bSaving.value = true;
  saveError.value = null;
  try {
    await workspaceRulesApi.update(workspaceId.value, selectedFilename.value, content.value);
    originalContent.value = content.value;
    showSuccess('Rule saved');
  } catch (e: unknown) {
    const caughtError = e as {
      response?: { status?: number; data?: { error?: string; code?: string } };
      message?: string;
    };
    saveError.value = caughtError.response?.data?.error ?? caughtError.message ?? 'Failed to save rule file';
  } finally {
    bSaving.value = false;
  }
}

async function fetchRuleTemplates(): Promise<void> {
  if (!workspaceId.value) {
    return;
  }
  bRuleTemplatesLoading.value = true;
  ruleTemplatesError.value = null;
  try {
    const { data } = await roleTemplatesApi.list();
    ruleTemplates.value = data ?? [];
  } catch (e) {
    console.error('Failed to fetch templates for rules:', e);
    ruleTemplates.value = [];
    ruleTemplatesError.value = 'Failed to load templates from settings';
  } finally {
    bRuleTemplatesLoading.value = false;
  }
}

function openTemplateModal(): void {
  bShowTemplateModal.value = true;
  createTemplateError.value = null;
  newTemplateName.value = '';
  newTemplateDescription.value = '';
  newTemplateContent.value = '';
}

function closeTemplateModal(): void {
  if (bCreatingTemplate.value) {
    return;
  }
  bShowTemplateModal.value = false;
  createTemplateError.value = null;
}

async function createTemplate(): Promise<void> {
  const name = newTemplateName.value.trim();
  createTemplateError.value = null;

  if (!name) {
    createTemplateError.value = 'Template name is required';
    return;
  }
  if (!newTemplateContent.value.trim()) {
    createTemplateError.value = 'Template content is required';
    return;
  }
  if (ruleTemplates.value.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    createTemplateError.value = 'A template with this name already exists';
    return;
  }

  bCreatingTemplate.value = true;
  try {
    const { data } = await roleTemplatesApi.create({
      name,
      description: newTemplateDescription.value.trim() || null,
      content: newTemplateContent.value
    });
    await fetchRuleTemplates();
    selectedTemplateId.value = data?.id ?? selectedTemplateId.value;
    newRuleMode.value = 'template';
    closeTemplateModal();
    showSuccess('Template created');
  } catch (e: unknown) {
    const caughtError = e as { response?: { data?: { error?: string } }; message?: string };
    createTemplateError.value =
      caughtError.response?.data?.error ?? caughtError.message ?? 'Failed to create template';
  } finally {
    bCreatingTemplate.value = false;
  }
}

async function deleteFile(): Promise<void> {
  if (!workspaceId.value || !fileToDelete.value) {
    return;
  }
  bDeleting.value = true;
  deleteError.value = null;
  try {
    await workspaceRulesApi.remove(workspaceId.value, fileToDelete.value);
    const wasSelected = selectedFilename.value === fileToDelete.value;
    fileToDelete.value = null;
    await fetchFiles();
    if (wasSelected && files.value.length > 0) {
      selectedFilename.value = files.value[0].filename;
      await loadFile(files.value[0].filename);
    }
    showSuccess('Rule file deleted');
  } catch (e: unknown) {
    const caughtError = e as {
      response?: { data?: { error?: string } };
      message?: string;
    };
    deleteError.value = caughtError.response?.data?.error ?? caughtError.message ?? 'Failed to delete rule file';
  } finally {
    bDeleting.value = false;
  }
}

function openNewRuleModal(): void {
  bShowNewRuleModal.value = true;
  newRuleMode.value = 'blank';
  newRuleFilename.value = '';
  selectedTemplateId.value = null;
  createRuleError.value = null;
}

function closeNewRuleModal(): void {
  bShowNewRuleModal.value = false;
  createRuleError.value = null;
}

async function createRule(): Promise<void> {
  if (!workspaceId.value) {
    return;
  }
  const filename = newRuleFilename.value.trim();
  createRuleError.value = null;

  if (!filename) {
    createRuleError.value = 'Filename is required';
    return;
  }
  if (filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\')) {
    createRuleError.value = 'Filename must not contain path separators';
    return;
  }
  if (files.value.some((f) => f.filename === filename)) {
    createRuleError.value = 'A file with that name already exists';
    return;
  }

  let initialContent = '';
  if (newRuleMode.value === 'template') {
    const tpl = ruleTemplates.value.find((t) => t.id === selectedTemplateId.value);
    if (!tpl) {
      createRuleError.value = 'Select a template';
      return;
    }
    initialContent = tpl.content;
  } else {
    initialContent = '# Workspace rules\n\nDescribe your workspace rules here.';
  }

  bCreatingRule.value = true;
  try {
    await workspaceRulesApi.update(workspaceId.value, filename, initialContent);
    closeNewRuleModal();
    await fetchFiles();
    selectedFilename.value = filename;
    await loadFile(filename);
    showSuccess('Rule file created');
  } catch (e: unknown) {
    const caughtError = e as {
      response?: { data?: { error?: string } };
      message?: string;
    };
    createRuleError.value =
      caughtError.response?.data?.error ?? caughtError.message ?? 'Failed to create rule file';
  } finally {
    bCreatingRule.value = false;
  }
}

function startRename(filename: string): void {
  fileToRename.value = filename;
  renameNewFilename.value = filename;
  renameError.value = null;
}

function cancelRename(): void {
  fileToRename.value = null;
  renameNewFilename.value = '';
  renameError.value = null;
}

async function submitRename(): Promise<void> {
  if (!workspaceId.value || !fileToRename.value) {
    return;
  }
  const newName = renameNewFilename.value.trim();
  if (!newName || newName === fileToRename.value) {
    cancelRename();
    return;
  }
  if (files.value.some((f) => f.filename !== fileToRename.value && f.filename === newName)) {
    renameError.value = 'A file with that name already exists';
    return;
  }
  bRenaming.value = true;
  renameError.value = null;
  try {
    await workspaceRulesApi.rename(workspaceId.value, fileToRename.value, newName);
    const wasSelected = selectedFilename.value === fileToRename.value;
    cancelRename();
    await fetchFiles();
    if (wasSelected) {
      selectedFilename.value = newName;
      await loadFile(newName);
    }
    showSuccess('Rule file renamed');
  } catch (e: unknown) {
    const caughtError = e as {
      response?: { data?: { error?: string } };
      message?: string;
    };
    renameError.value = caughtError.response?.data?.error ?? caughtError.message ?? 'Failed to rename rule file';
  } finally {
    bRenaming.value = false;
  }
}

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(async () => {
  await Promise.all([fetchFiles(), fetchRuleTemplates()]);
});
</script>

<template>
  <!-- Header -->
  <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
    <div>
      <h1 class="text-xl font-semibold text-text-primary flex items-center gap-2">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="12" y2="16"/></svg>
        Cursor rules
      </h1>
      <p class="text-sm text-text-muted mt-1">
        View and edit workspace rules stored in
        <span class="font-mono text-xs">.cursor/rules</span>
        for this workspace.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
        @click="openNewRuleModal"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M12 5v14M5 12h14"/></svg>
        New rule
      </button>
    </div>
  </div>

  <!-- Global messages -->
  <div
    v-if="listError"
    class="mb-4 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
  >
    {{ listError }}
  </div>
  <div
    v-if="successMessage"
    class="mb-4 px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm"
  >
    {{ successMessage }}
  </div>

  <!-- Loading -->
  <div v-if="bListLoading" class="flex items-center gap-2 py-8 text-text-muted text-sm">
    <div class="w-5 h-5 border-2 border-surface border-t-primary rounded-full animate-spin" />
    Loading workspace rules…
  </div>

  <!-- Empty / missing rules dir -->
  <div
    v-else-if="files.length === 0"
    class="rounded-lg border border-fg/10 bg-fg/[0.02] py-10 px-4 text-center text-text-muted text-sm"
  >
    <p v-if="bRulesDirMissing">
      No <span class="font-mono text-xs">.cursor/rules</span> directory was found for this
      workspace.
    </p>
    <p v-else>
      No rule files were found in
      <span class="font-mono text-xs">.cursor/rules</span>.
    </p>
    <p class="mt-2 text-xs text-text-muted">
      Use the <span class="font-semibold">New rule</span> button above to create one, or add
      Markdown files (for example <span class="font-mono">project-guidelines.mdc</span>) in that
      folder.
    </p>
  </div>

  <!-- Rules list + editor -->
  <div v-else class="grid grid-cols-1 md:grid-cols-[240px,minmax(0,1fr)] gap-4">
        <!-- Sidebar: file list -->
        <aside class="rounded-lg border border-fg/10 bg-fg/[0.02] overflow-hidden">
          <div
            class="px-3 py-2 border-b border-fg/10 text-xs font-medium text-text-muted uppercase tracking-wide"
          >
            Rule files
          </div>
          <ul class="divide-y divide-fg/10">
            <li v-for="file in files" :key="file.filename" class="flex items-center gap-1 group">
              <button
                type="button"
                class="flex-1 min-w-0 flex items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors"
                :class="
                  file.filename === selectedFilename
                    ? 'bg-primary/10 text-text-primary'
                    : 'text-text-muted hover:text-text-primary hover:bg-fg/[0.04]'
                "
                @click="selectFile(file.filename)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none shrink-0"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                <span class="flex-1 min-w-0 truncate">
                  {{ file.label || file.filename }}
                </span>
              </button>
              <div class="flex items-center shrink-0">
                <button
                  type="button"
                  class="p-1.5 text-text-muted hover:text-text-primary rounded transition-colors"
                  title="Rename file"
                  @click.stop="startRename(file.filename)"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
                </button>
                <button
                  type="button"
                  class="p-1.5 text-text-muted hover:text-destructive rounded transition-colors"
                  title="Delete file"
                  @click.stop="fileToDelete = file.filename"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                </button>
              </div>
            </li>
          </ul>
        </aside>

        <!-- Editor -->
        <section
          class="relative rounded-lg border border-fg/10 bg-fg/[0.02] p-4 flex flex-col min-h-[260px]"
        >
          <header class="flex items-center justify-between gap-2 mb-3">
            <div class="min-w-0">
              <p class="text-sm font-medium text-text-primary truncate">
                {{ fileLabel || 'Select a rule file' }}
              </p>
              <p class="text-xs text-text-muted truncate">
                {{ selectedFilename }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <p v-if="hasUnsavedChanges" class="hidden sm:block text-xs text-amber-400">
                Unsaved changes
              </p>
              <button
                type="button"
                class="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
                :disabled="!hasUnsavedChanges || bSaving || !selectedFilename"
                @click="saveCurrent"
              >
                <span
                  v-if="bSaving"
                  class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
                />
                <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                Save
              </button>
            </div>
          </header>

          <div class="relative flex-1 min-h-[180px]">
            <textarea
              v-model="content"
              :disabled="bContentLoading || !selectedFilename"
              rows="12"
              class="w-full h-full min-h-[180px] font-mono text-xs md:text-sm bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
              placeholder="Select a rule file from the list to view and edit its contents."
            />

            <div
              v-if="bContentLoading"
              class="absolute inset-0 bg-bg/40 flex items-center justify-center rounded-lg"
            >
              <div
                class="w-5 h-5 border-2 border-surface border-t-primary rounded-full animate-spin"
              />
            </div>
          </div>

          <p v-if="saveError" class="mt-2 text-xs text-destructive">
            {{ saveError }}
          </p>
        </section>
  </div>

    <!-- Delete rule file confirmation -->
    <ConfirmModal
      :model-value="fileToDelete !== null"
      title="Delete rule file"
      :description="deleteDescription"
      confirm-label="Delete"
      variant="danger"
      :loading="bDeleting"
      @update:model-value="
        (v: boolean) => {
          if (!v) {
            fileToDelete = null;
            deleteError = null;
          }
        }
      "
      @confirm="deleteFile"
    />

    <!-- Discard unsaved changes confirmation -->
    <ConfirmModal
      v-model="bShowDiscardConfirm"
      title="Discard changes"
      description="Discard unsaved changes to the current rule file?"
      confirm-label="Discard"
      variant="danger"
      @confirm="confirmDiscardAndSelect"
    />

    <!-- Rename rule file -->
    <div
      v-if="fileToRename"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="cancelRename"
    >
      <div
        class="bg-bg border border-fg/20 rounded-lg shadow-xl max-w-md w-full p-4"
        role="dialog"
        aria-labelledby="rename-title"
      >
        <h2 id="rename-title" class="text-sm font-medium text-text-primary mb-3">
          Rename rule file
        </h2>
        <p class="text-xs text-text-muted mb-2">
          Current: <span class="font-mono">{{ fileToRename }}</span>
        </p>
        <input
          v-model="renameNewFilename"
          type="text"
          class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 mb-3"
          placeholder="New filename"
          @keydown.enter.prevent="submitRename"
        />
        <p v-if="renameError" class="text-xs text-destructive mb-2">
          {{ renameError }}
        </p>
        <div class="flex items-center gap-2 justify-end">
          <button
            type="button"
            class="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
            :disabled="bRenaming"
            @click="cancelRename"
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
            :disabled="
              bRenaming || !renameNewFilename.trim() || renameNewFilename.trim() === fileToRename
            "
            @click="submitRename"
          >
            <span
              v-if="bRenaming"
              class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
            />
            Rename
          </button>
        </div>
      </div>
    </div>

    <!-- New rule file modal -->
    <div
      v-if="bShowNewRuleModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="closeNewRuleModal"
    >
      <div
        class="bg-bg border border-fg/20 rounded-lg shadow-xl max-w-lg w-full p-4"
        role="dialog"
        aria-labelledby="new-rule-title"
      >
        <h2 id="new-rule-title" class="text-sm font-medium text-text-primary mb-3">
          New rule file
        </h2>
        <p class="text-xs text-text-muted mb-3">
          Create a basic rule file or start from a template you configured under
          <RouterLink
            :to="{ name: 'settings', query: { tab: 'templates' } }"
            class="font-semibold text-primary hover:underline"
            >Settings → Templates</RouterLink
          >.
        </p>

        <!-- Mode toggle -->
        <div class="flex items-center gap-2 mb-4">
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-full border transition-colors"
            :class="
              newRuleMode === 'blank'
                ? 'bg-primary/10 text-primary border-primary/40'
                : 'text-text-muted border-fg/20 hover:text-text-primary hover:border-fg/40'
            "
            @click="newRuleMode = 'blank'"
          >
            Basic rule
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-xs rounded-full border transition-colors"
            :class="
              newRuleMode === 'template'
                ? 'bg-primary/10 text-primary border-primary/40'
                : 'text-text-muted border-fg/20 hover:text-text-primary hover:border-fg/40'
            "
            @click="newRuleMode = 'template'"
          >
            From template
          </button>
        </div>

        <!-- Filename -->
        <div class="mb-3">
          <label class="block text-xs font-medium text-text-muted mb-1"> Filename </label>
          <input
            v-model="newRuleFilename"
            type="text"
            class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
            placeholder="e.g. project-guidelines.mdc"
          />
        </div>

        <!-- Template selection -->
        <div v-if="newRuleMode === 'template'" class="mb-3 space-y-2">
          <label class="block text-xs font-medium text-text-muted"> Template </label>
          <div v-if="bRuleTemplatesLoading" class="text-xs text-text-muted">Loading templates…</div>
          <div v-else-if="ruleTemplatesError" class="text-xs text-destructive">
            {{ ruleTemplatesError }}
          </div>
          <div v-else-if="ruleTemplates.length === 0" class="text-xs text-text-muted">
            No templates yet. Create one with the button below.
          </div>
          <div class="flex items-center justify-end gap-3">
            <RouterLink
              :to="{ name: 'settings', query: { tab: 'templates' } }"
              class="text-xs text-primary hover:underline"
              >Manage templates →</RouterLink
            >
            <button
              type="button"
              class="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-text-muted border border-fg/20 rounded-lg hover:text-text-primary hover:border-fg/35 hover:bg-fg/[0.04] transition-colors"
              @click="openTemplateModal"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M12 5v14M5 12h14"/></svg>
              New template
            </button>
          </div>
          <select
            v-if="!bRuleTemplatesLoading && !ruleTemplatesError && ruleTemplates.length > 0"
            v-model="selectedTemplateId"
            class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          >
            <option disabled value="">Select a template…</option>
            <option v-for="tpl in ruleTemplates" :key="tpl.id" :value="tpl.id">
              {{ tpl.name }}
            </option>
          </select>
        </div>

        <p v-if="createRuleError" class="text-xs text-destructive mb-2">
          {{ createRuleError }}
        </p>

        <div class="flex items-center justify-end gap-2 mt-2">
          <button
            type="button"
            class="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
            :disabled="bCreatingRule"
            @click="closeNewRuleModal"
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
            :disabled="
              bCreatingRule ||
              !newRuleFilename.trim() ||
              (newRuleMode === 'template' && !selectedTemplateId)
            "
            @click="createRule"
          >
            <span
              v-if="bCreatingRule"
              class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
            />
            Create
          </button>
        </div>
      </div>
    </div>

    <!-- New template modal -->
    <div
      v-if="bShowTemplateModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="closeTemplateModal"
    >
      <div
        class="bg-bg border border-fg/20 rounded-lg shadow-xl max-w-lg w-full p-4"
        role="dialog"
        aria-labelledby="new-template-title"
      >
        <h2 id="new-template-title" class="text-sm font-medium text-text-primary mb-2">
          New rule template
        </h2>
        <p class="text-xs text-text-muted mb-3">
          Create a reusable template you can apply when creating rule files.
        </p>

        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Name</label>
            <input
              v-model="newTemplateName"
              type="text"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              placeholder="e.g. TypeScript guardrails"
              :disabled="bCreatingTemplate"
              @keydown.enter.prevent="createTemplate"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">
              Description (optional)
            </label>
            <input
              v-model="newTemplateDescription"
              type="text"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              placeholder="Short summary"
              :disabled="bCreatingTemplate"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Content</label>
            <textarea
              v-model="newTemplateContent"
              rows="7"
              class="w-full font-mono bg-surface border border-fg/15 rounded-lg px-3 py-2 text-xs md:text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 resize-y"
              placeholder="Template content to prefill the new rule file."
              :disabled="bCreatingTemplate"
            />
          </div>
        </div>

        <p v-if="createTemplateError" class="text-xs text-destructive mt-3">
          {{ createTemplateError }}
        </p>

        <div class="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            class="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
            :disabled="bCreatingTemplate"
            @click="closeTemplateModal"
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
            :disabled="bCreatingTemplate || !newTemplateName.trim() || !newTemplateContent.trim()"
            @click="createTemplate"
          >
            <span
              v-if="bCreatingTemplate"
              class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
            />
            Create template
          </button>
        </div>
      </div>
    </div>
</template>

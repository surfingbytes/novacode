<script setup lang="ts">
// node_modules
import { ref, computed, onMounted } from 'vue';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import PageShell from '@/components/layout/PageShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';

// classes
import { roleTemplatesApi } from '@/classes/api';

// types
import type { RoleTemplate } from '@/@types/index';

// -------------------------------------------------- Refs --------------------------------------------------

const templates = ref<RoleTemplate[]>([]);
const bLoading = ref(true);
const errorMessage = ref<string | null>(null);
const successMessage = ref<string | null>(null);

const viewMode = ref<'list' | 'grid'>(
  (localStorage.getItem('ruleTemplatesViewMode') as 'list' | 'grid') ?? 'list',
);

// Create modal
const bShowCreateModal = ref(false);
const newName = ref('');
const newDescription = ref('');
const newContent = ref('');
const bCreating = ref(false);
const createError = ref<string | null>(null);

// Edit modal
const bShowEditModal = ref(false);
const editingId = ref<string | null>(null);
const editName = ref('');
const editDescription = ref('');
const editContent = ref('');
const bSavingEdit = ref(false);
const editError = ref<string | null>(null);

// Delete
const templateToDelete = ref<RoleTemplate | null>(null);
const bDeleting = ref(false);
const deleteError = ref<string | null>(null);

// -------------------------------------------------- Computed --------------------------------------------------

const deleteConfirmDescription = computed(() =>
  templateToDelete.value ? `Delete "${templateToDelete.value.name}"? This cannot be undone.` : '',
);

// -------------------------------------------------- Methods --------------------------------------------------

async function fetchTemplates(): Promise<void> {
  bLoading.value = true;
  errorMessage.value = null;
  try {
    const { data } = await roleTemplatesApi.list();
    templates.value = data ?? [];
  } catch (e) {
    console.error('Failed to fetch rule templates:', e);
    errorMessage.value = 'Failed to load rule templates';
    templates.value = [];
  } finally {
    bLoading.value = false;
  }
}

function showSuccess(msg: string): void {
  successMessage.value = msg;
  setTimeout(() => {
    successMessage.value = null;
  }, 3000);
}

function setViewMode(mode: 'list' | 'grid'): void {
  viewMode.value = mode;
  localStorage.setItem('ruleTemplatesViewMode', mode);
}

// --- Create ---
function openCreateModal(): void {
  bShowCreateModal.value = true;
  createError.value = null;
  newName.value = '';
  newDescription.value = '';
  newContent.value = '';
}

function closeCreateModal(): void {
  if (bCreating.value) {
    return;
  }
  bShowCreateModal.value = false;
  createError.value = null;
}

function validateNewTemplate(): boolean {
  createError.value = null;
  const name = newName.value.trim();
  const content = newContent.value;
  if (!name) {
    createError.value = 'Name is required';
    return false;
  }
  if (templates.value.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    createError.value = 'A template with this name already exists';
    return false;
  }
  if (!content || !content.trim()) {
    createError.value = 'Content is required';
    return false;
  }
  return true;
}

async function createTemplate(): Promise<void> {
  if (!validateNewTemplate()) {
    return;
  }
  bCreating.value = true;
  createError.value = null;
  try {
    await roleTemplatesApi.create({
      name: newName.value.trim(),
      description: newDescription.value.trim() || null,
      content: newContent.value,
    });
    await fetchTemplates();
    closeCreateModal();
    showSuccess('Template created');
  } catch (e: unknown) {
    const caughtError = e as { response?: { data?: { error?: string } }; message?: string };
    createError.value =
      caughtError.response?.data?.error ?? caughtError.message ?? 'Failed to create template';
  } finally {
    bCreating.value = false;
  }
}

// --- Edit ---
function startEdit(t: RoleTemplate): void {
  bShowEditModal.value = true;
  editingId.value = t.id;
  editName.value = t.name;
  editDescription.value = t.description ?? '';
  editContent.value = t.content;
  editError.value = null;
}

function cancelEdit(): void {
  if (bSavingEdit.value) {
    return;
  }
  bShowEditModal.value = false;
  editingId.value = null;
  editName.value = '';
  editDescription.value = '';
  editContent.value = '';
  editError.value = null;
}

function validateEdit(): boolean {
  editError.value = null;
  const name = editName.value.trim();
  const content = editContent.value;
  if (!name) {
    editError.value = 'Name cannot be empty';
    return false;
  }
  const other = templates.value.find(
    (t) => t.id !== editingId.value && t.name.toLowerCase() === name.toLowerCase()
  );
  if (other) {
    editError.value = 'A template with this name already exists';
    return false;
  }
  if (!content || !content.trim()) {
    editError.value = 'Content cannot be empty';
    return false;
  }
  return true;
}

async function saveEdit(): Promise<void> {
  if (!editingId.value || !validateEdit()) {
    return;
  }
  bSavingEdit.value = true;
  editError.value = null;
  try {
    await roleTemplatesApi.update(editingId.value, {
      name: editName.value.trim(),
      description: editDescription.value.trim() || null,
      content: editContent.value,
    });
    await fetchTemplates();
    cancelEdit();
    showSuccess('Template updated');
  } catch (e: unknown) {
    const caughtError = e as { response?: { data?: { error?: string } }; message?: string };
    editError.value =
      caughtError.response?.data?.error ?? caughtError.message ?? 'Failed to update template';
  } finally {
    bSavingEdit.value = false;
  }
}

// --- Delete ---
function confirmDelete(t: RoleTemplate): void {
  templateToDelete.value = t;
  deleteError.value = null;
}

function cancelDelete(): void {
  templateToDelete.value = null;
  deleteError.value = null;
}

async function doDelete(): Promise<void> {
  if (!templateToDelete.value) {
    return;
  }
  bDeleting.value = true;
  deleteError.value = null;
  try {
    await roleTemplatesApi.remove(templateToDelete.value.id);
    await fetchTemplates();
    cancelDelete();
    showSuccess('Template deleted');
  } catch (e: unknown) {
    const caughtError = e as { response?: { data?: { error?: string } }; message?: string };
    deleteError.value =
      caughtError.response?.data?.error ?? caughtError.message ?? 'Failed to delete template';
  } finally {
    bDeleting.value = false;
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  fetchTemplates();
});
</script>

<template>
  <PageShell>
    <!-- Header -->
    <PageHeader
      icon="manage_accounts"
      title="Rule templates"
      subtitle="Define reusable system prompts for Cursor agents. Available to all workspaces."
    />

    <div class="flex justify-between sm:justify-end mb-3">
      <div class="button-select-small mr-2 mt-0">
        <button
          class="button is-icon"
          :class="{ 'is-active': viewMode === 'list' }"
          @click="setViewMode('list')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        </button>
        <button
          class="button is-icon"
          :class="{ 'is-active': viewMode === 'grid' }"
          @click="setViewMode('grid')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </button>
      </div>
      <button type="button" class="button is-primary" @click="openCreateModal">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M12 5v14M5 12h14"/></svg>
        New template
      </button>
    </div>

    <!-- Global messages -->
    <div
      v-if="errorMessage"
      class="mb-4 px-4 py-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
    >
      {{ errorMessage }}
    </div>
    <div
      v-if="successMessage"
      class="mb-4 px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm"
    >
      {{ successMessage }}
    </div>

    <!-- Loading -->
    <div v-if="bLoading" class="flex items-center gap-2 py-8 text-text-muted text-sm">
      <div class="w-5 h-5 border-2 border-surface border-t-primary rounded-full animate-spin" />
      Loading rule templates…
    </div>

    <!-- Empty -->
    <div
      v-else-if="templates.length === 0"
      class="rounded-lg border border-fg/10 bg-fg/[0.02] py-12 px-4 text-center text-text-muted text-sm"
    >
      No rule templates yet. Create one above to get started.
    </div>

    <!-- Templates -->
    <div v-else-if="viewMode === 'grid'" class="grid-view">
      <div class="grid-view-items">
        <article v-for="template in templates" :key="template.id" class="group grid-item">
          <div class="top">
            <div class="icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V4h16v3M9 20h6M12 4v16"/></svg>
            </div>
            <div class="info min-w-0">
              <p class="title truncate">{{ template.name }}</p>
              <p class="text-xs text-text-muted line-clamp-2 min-h-[2.5rem]">
                {{ template.description || 'No description' }}
              </p>
              <p class="text-[11px] text-text-muted mt-1">
                Updated {{ formatDate(template.updatedAt) }}
              </p>
            </div>
            <div class="buttons">
              <button
                class="button is-icon is-transparent"
                @click.prevent.stop="startEdit(template)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
              </button>
              <button
                class="button is-icon is-transparent is-delete"
                @click.prevent.stop="confirmDelete(template)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
    <div v-else class="list-view">
      <div class="list-view-items">
        <article v-for="template in templates" :key="template.id" class="group list-item">
          <div class="cell flex-1 min-w-0">
            <p class="title truncate">{{ template.name }}</p>
            <p class="text-xs text-text-muted line-clamp-1 mt-1">
              {{ template.description || 'No description' }}
            </p>
          </div>
          <div class="cell">
            <p class="text-xs text-text-muted">Updated {{ formatDate(template.updatedAt) }}</p>
          </div>
          <div class="cell buttons">
            <button class="button is-icon" @click.prevent.stop="startEdit(template)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
            </button>
            <button
              class="button is-icon hover:bg-destructive/10! hover:border-destructive!"
              @click.prevent.stop="confirmDelete(template)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="text-destructive"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
          </div>
        </article>
      </div>
    </div>

    <!-- Create modal -->
    <div
      v-if="bShowCreateModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="closeCreateModal"
    >
      <div
        class="bg-bg border border-fg/20 rounded-lg shadow-xl max-w-lg w-full p-4"
        role="dialog"
        aria-labelledby="new-template-title"
      >
        <h2 id="new-template-title" class="text-sm font-medium text-text-primary mb-2">
          New rule template
        </h2>
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Name</label>
            <input
              v-model="newName"
              type="text"
              placeholder="e.g. Senior TypeScript engineer"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              :disabled="bCreating"
              @keydown.enter.prevent="createTemplate"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1"
              >Description (optional)</label
            >
            <textarea
              v-model="newDescription"
              rows="2"
              placeholder="Short summary of this rule template"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
              :disabled="bCreating"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Content</label>
            <textarea
              v-model="newContent"
              rows="6"
              placeholder="System prompt text to apply when this rule template is used."
              class="w-full font-mono bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-xs md:text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
              :disabled="bCreating"
            />
          </div>
        </div>
        <p v-if="createError" class="text-xs text-destructive mt-3">{{ createError }}</p>
        <div class="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            class="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
            :disabled="bCreating"
            @click="closeCreateModal"
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
            :disabled="bCreating || !newName.trim() || !newContent.trim()"
            @click="createTemplate"
          >
            <span
              v-if="bCreating"
              class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
            />
            Create
          </button>
        </div>
      </div>
    </div>

    <!-- Edit modal -->
    <div
      v-if="bShowEditModal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      @click.self="cancelEdit"
    >
      <div
        class="bg-bg border border-fg/20 rounded-lg shadow-xl max-w-lg w-full p-4"
        role="dialog"
        aria-labelledby="edit-template-title"
      >
        <h2 id="edit-template-title" class="text-sm font-medium text-text-primary mb-2">
          Edit rule template
        </h2>
        <div class="space-y-3">
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Name</label>
            <input
              v-model="editName"
              type="text"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
              :disabled="bSavingEdit"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1"
              >Description (optional)</label
            >
            <textarea
              v-model="editDescription"
              rows="2"
              class="w-full bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
              :disabled="bSavingEdit"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-text-muted mb-1">Content</label>
            <textarea
              v-model="editContent"
              rows="6"
              class="w-full font-mono bg-surface border border-fg/15 rounded-lg px-3 py-2.5 text-xs md:text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-y"
              :disabled="bSavingEdit"
            />
          </div>
        </div>
        <p v-if="editError" class="text-xs text-destructive mt-3">{{ editError }}</p>
        <div class="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            class="px-3 py-1.5 text-sm text-text-muted hover:text-text-primary hover:bg-fg/[0.06] rounded-lg transition-colors"
            :disabled="bSavingEdit"
            @click="cancelEdit"
          >
            Cancel
          </button>
          <button
            type="button"
            class="px-3 py-1.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1"
            :disabled="bSavingEdit || !editName.trim() || !editContent.trim()"
            @click="saveEdit"
          >
            <span
              v-if="bSavingEdit"
              class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
            />
            Save
          </button>
        </div>
      </div>
    </div>

    <!-- Delete confirmation modal -->
    <ConfirmModal
      :model-value="templateToDelete !== null"
      title="Delete rule template"
      :description="deleteConfirmDescription"
      confirm-label="Delete"
      variant="danger"
      :loading="bDeleting"
      @update:model-value="
        (v: boolean) => {
          if (!v) {
            cancelDelete();
          }
        }
      "
      @confirm="doDelete"
    />

    <!-- Delete error toast -->
    <div
      v-if="templateToDelete && deleteError"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 max-w-md px-4 py-3 rounded-lg bg-destructive/90 text-white text-sm shadow-lg z-[100]"
    >
      {{ deleteError }}
    </div>
  </PageShell>
</template>

<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import type { ComponentPublicInstance } from 'vue';

// classes
import { filesApi } from '@/classes/api';
import { notifyApiError } from '@/lib/notifyApiError';
import { readFilesOpenPath, writeFilesOpenPath } from '@/lib/filesOpenPath';
import { safeGetItem } from '@/lib/safeLocalStorage';
import { DEFAULT_THEME_ID, resolveStoredThemeId, themes } from '@/lib/themes';
import { extensionForPath, fileContentBytes, isImagePath, mimeForPath } from './files/filePaths';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import PromptModal from '@/components/PromptModal.vue';
import FilesTree from './files/FilesTree.vue';
import FilesEditorHeader from './files/FilesEditorHeader.vue';
import FilesEditorContent from './files/FilesEditorContent.vue';

// composables
import { usePaneLayout } from '@/composables/usePaneLayout';
import { useFileTree } from './files/useFileTree';
import { useMonacoEditor } from './files/useMonacoEditor';
import { useFilePreviews } from './files/useFilePreviews';
import { useFileEntryActions } from './files/useFileEntryActions';

// stores

// types
import type { FileEntry } from '@/@types/index';
import { ancestorDirectoryPaths } from '@/utils/workspaceFilePath';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  workspaceId: string;
  active: boolean;
  openPath?: string | null;
  /** When this changes (e.g. session id), re-read the open file from disk. */
  reloadToken?: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:openPath', path: string | null): void;
}>();

const {
  bWidePane,
  bSidePanelOpen,
  bSidePanelToggleVisible,
  setSidePanelOpen,
  listVisible,
  detailVisible
} = usePaneLayout('novacode:filesSidePanel');

const {
  entriesByPath,
  expandedPaths,
  bListLoading,
  listError,
  bShowHidden,
  rootEntries,
  visibleEntries,
  loadList,
  reloadVisibleLists,
  toggleExpand,
  isExpanded,
  toggleShowHidden
} = useFileTree(() => props.workspaceId);

// -------------------------------------------------- Refs --------------------------------------------------
const selectedPath = ref<string | null>(null);
const fileContent = ref<string>('');
const fileEncoding = ref<'utf8' | 'base64'>('utf8');
const bReadLoading = ref<boolean>(false);
const readError = ref<string | null>(null);
const editorContainerRef = ref<HTMLDivElement | null>(null);
const bSaving = ref<boolean>(false);
const saveResult = ref<'success' | 'error' | null>(null);
const saveErrorMessage = ref<string>('');
let saveResultTimer: ReturnType<typeof setTimeout> | null = null;
/** Content as last read from / written to disk; compared against the editor to detect unsaved edits. */
const loadedContent = ref<string>('');
/** Live Monaco content (markdown edits live in fileContent via MdEditor v-model). */
const editorContent = ref<string>('');
const bShowDiscardModal = ref<boolean>(false);
/** Action blocked by unsaved changes; runs once the user confirms discarding them. */
const pendingDiscardAction = ref<(() => void | Promise<void>) | null>(null);
const bFullscreen = ref<boolean>(false);
/** Edit vs rendered preview for markdown / HTML files in the files pane. */
const contentViewMode = ref<'edit' | 'preview'>('edit');

/** Raw bytes of the currently selected file, decoded according to its encoding. */
function currentFileBytes(): Uint8Array<ArrayBuffer> {
  return fileContentBytes(fileContent.value, fileEncoding.value);
}

function setEditorContainer(el: Element | ComponentPublicInstance | null): void {
  editorContainerRef.value = el as HTMLDivElement | null;
}

// -------------------------------------------------- Computed --------------------------------------------------
const selectedPathFileName = computed((): string => {
  return selectedPath.value ? (selectedPath.value.split('/').pop() ?? '') : '';
});
const bIsMarkdownFile = computed((): boolean => {
  return selectedPath.value?.toLowerCase().endsWith('.md') ?? false;
});
const bIsHtmlFile = computed((): boolean => {
  if (!selectedPath.value) {
    return false;
  }
  const extension = extensionForPath(selectedPath.value);
  return extension === 'html' || extension === 'htm';
});
/** Markdown or HTML: header gets an edit/preview toggle. */
const bIsPreviewableMarkup = computed((): boolean => {
  return bIsMarkdownFile.value || bIsHtmlFile.value;
});
const bIsImageFile = computed((): boolean => {
  return selectedPath.value !== null && isImagePath(selectedPath.value);
});
/** Non-image binary file (detected after read): cannot be previewed or edited. */
const bIsBinaryFile = computed((): boolean => {
  return !bIsImageFile.value && fileEncoding.value === 'base64';
});
/** Files shown in a text editor (Monaco or the markdown editor). */
const bIsEditorFile = computed((): boolean => {
  return !bIsImageFile.value && !bIsBinaryFile.value;
});
const bMarkdownPreview = computed((): boolean => {
  return bIsMarkdownFile.value && contentViewMode.value === 'preview';
});
const bHtmlPreview = computed((): boolean => {
  return bIsHtmlFile.value && contentViewMode.value === 'preview';
});
/** Text files that use Monaco (markdown uses MdEditor; HTML preview uses a sandboxed iframe). */
const bIsMonacoFile = computed((): boolean => {
  // Require a selection — the Monaco host is only mounted when a file is open.
  // Without this, bIsMonacoFile stays true for the empty state and selecting a
  // file never re-triggers the init watch.
  return (
    selectedPath.value !== null &&
    bIsEditorFile.value &&
    !bIsMarkdownFile.value &&
    !bHtmlPreview.value
  );
});
const bIsDarkTheme = computed((): boolean => {
  const themeId = resolveStoredThemeId(safeGetItem('theme') ?? DEFAULT_THEME_ID);
  const theme = themes.find((themeOption) => themeOption.id === themeId);
  return theme?.dark ?? false;
});

const bDirty = computed((): boolean => {
  if (!selectedPath.value || !bIsEditorFile.value || bReadLoading.value || readError.value) {
    return false;
  }
  const currentContent = bIsMarkdownFile.value ? fileContent.value : editorContent.value;
  return currentContent !== loadedContent.value;
});

const bShowFileTree = computed((): boolean => listVisible(selectedPath.value !== null));
const bShowEditor = computed((): boolean => detailVisible(selectedPath.value !== null));

const { initEditor, disposeEditor, updateEditorContent, getEditor } = useMonacoEditor({
  containerRef: editorContainerRef,
  active: () => props.active,
  bIsMonacoFile,
  bIsDarkTheme,
  selectedPath,
  fileContent,
  editorContent,
  onSave: () => void saveFile()
});

// -------------------------------------------------- Methods --------------------------------------------------
function commitOpenPath(path: string | null, bEmit = true): void {
  writeFilesOpenPath(props.workspaceId, path);
  if (bEmit) {
    emit('update:openPath', path);
  }
}

function pathToRestore(): string | null {
  if (props.openPath && props.openPath.trim()) {
    return props.openPath;
  }
  return readFilesOpenPath(props.workspaceId);
}

const readFilePath = async (path: string, bEmit = true): Promise<void> => {
  selectedPath.value = path;
  commitOpenPath(path, bEmit);
  readError.value = null;
  bReadLoading.value = true;
  fileContent.value = '';
  fileEncoding.value = 'utf8';
  loadedContent.value = '';
  editorContent.value = '';
  try {
    const response = await filesApi.read(props.workspaceId, path);
    fileContent.value = response.data.content;
    fileEncoding.value = response.data.encoding;
    loadedContent.value = response.data.content;
    editorContent.value = response.data.content;
  } catch (error: unknown) {
    const errorWithMessage = error as { response?: { data?: { error?: string } }; message?: string };
    readError.value = errorWithMessage?.response?.data?.error ?? errorWithMessage?.message ?? 'Failed to read file';
  } finally {
    bReadLoading.value = false;
  }
};

const {
  bCreatingFile,
  bCreatingFileLoading,
  newFilePath,
  createFileError,
  createKind,
  openCreateFile,
  closeCreateFile,
  createFile,
  bCtxMenuOpen,
  ctxMenuX,
  ctxMenuY,
  ctxMenuItems,
  openEntryContextMenu,
  onCtxPick,
  bShowDeleteModal,
  bDeleting,
  deleteTarget,
  confirmDelete,
  bShowRenameModal,
  bRenaming,
  renameTarget,
  confirmRename
} = useFileEntryActions({
  getWorkspaceId: () => props.workspaceId,
  selectedPath,
  expandedPaths,
  listError,
  loadList,
  reloadVisibleLists,
  readFilePath,
  commitOpenPath
});

const downloadFile = (): void => {
  if (!selectedPath.value) {
    return;
  }
  const blob = new Blob([currentFileBytes()], { type: mimeForPath(selectedPath.value) });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = selectedPathFileName.value || 'download';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const selectFile = (entry: FileEntry): void => {
  if (entry.isDirectory) {
    return;
  }
  runOrConfirmDiscard(() => readFilePath(entry.path));
};

/** Runs the action now, or asks to discard unsaved edits first and runs it on confirm. */
function runOrConfirmDiscard(action: () => void | Promise<void>): void {
  if (!bDirty.value) {
    void action();
    return;
  }
  pendingDiscardAction.value = action;
  bShowDiscardModal.value = true;
}

function confirmDiscard(): void {
  const action = pendingDiscardAction.value;
  pendingDiscardAction.value = null;
  bShowDiscardModal.value = false;
  if (action) {
    void action();
  }
}

// Cancelled: drop the pending action and keep the URL pointing at the file still open.
watch(bShowDiscardModal, (bOpen) => {
  if (bOpen || !pendingDiscardAction.value) {
    return;
  }
  pendingDiscardAction.value = null;
  if (selectedPath.value && props.openPath !== selectedPath.value) {
    commitOpenPath(selectedPath.value);
  }
});

function closeEditor(): void {
  runOrConfirmDiscard(() => {
    selectedPath.value = null;
  });
}

async function revealAndOpen(path: string): Promise<void> {
  const normalized = path.replace(/^\/+/, '').replace(/\/+/g, '/');
  if (!normalized) {
    return;
  }
  const ancestors = ancestorDirectoryPaths(normalized);
  expandedPaths.value = new Set([...expandedPaths.value, ...ancestors]);
  for (const directoryPath of ancestors) {
    await loadList(directoryPath);
  }
  await readFilePath(normalized);
}

const saveFile = async (): Promise<void> => {
  if (!selectedPath.value) {
    return;
  }
  const content = bIsMarkdownFile.value
    ? fileContent.value
    : (getEditor()?.getModel()?.getValue() ?? editorContent.value);
  bSaving.value = true;
  saveResult.value = null;
  if (saveResultTimer) {
    clearTimeout(saveResultTimer);
  }
  try {
    await filesApi.write(props.workspaceId, selectedPath.value, content);
    loadedContent.value = content;
    editorContent.value = content;
    fileContent.value = content;
    saveResult.value = 'success';
    saveResultTimer = setTimeout(() => (saveResult.value = null), 2000);
  } catch (error: unknown) {
    const errorWithMessage = error as { response?: { data?: { error?: string } }; message?: string };
    saveErrorMessage.value =
      errorWithMessage?.response?.data?.error ?? errorWithMessage?.message ?? 'Failed to save file';
    saveResult.value = 'error';
    notifyApiError(error, 'Failed to save file');
    saveResultTimer = setTimeout(() => (saveResult.value = null), 3000);
  } finally {
    bSaving.value = false;
  }
};

function onWindowKeydown(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') {
    return;
  }
  if (!props.active || !selectedPath.value || !bIsEditorFile.value || bSaving.value) {
    return;
  }
  event.preventDefault();
  void saveFile();
}

function onEntryClick(entry: FileEntry): void {
  if (entry.isDirectory) {
    toggleExpand(entry);
    return;
  }
  selectFile(entry);
}

// -------------------------------------------------- Watchers --------------------------------------------------
async function reloadOpenFileFromDisk(): Promise<void> {
  // Background reloads (tab activation, session change) must not silently drop unsaved edits.
  if (!selectedPath.value || bDirty.value) {
    return;
  }
  await readFilePath(selectedPath.value, false);
}

watch(
  () => props.active,
  (active: boolean) => {
    if (active) {
      void reloadOpenFileFromDisk();
      if (editorContainerRef.value && !getEditor()) {
        initEditor().catch((err: unknown) => notifyApiError(err, 'Failed to load the editor'));
      }
    }
    if (!active) {
      disposeEditor();
    }
  }
);

watch(
  () => props.reloadToken,
  (token, previous) => {
    if (previous === undefined || token === previous || !props.active) {
      return;
    }
    void reloadOpenFileFromDisk();
  }
);

watch([fileContent, selectedPath], () => {
  if (getEditor()) {
    updateEditorContent().catch((err: unknown) => notifyApiError(err, 'Failed to load the editor'));
  }
});

watch(
  bIsMonacoFile,
  async (isMonaco: boolean) => {
    if (!isMonaco) {
      disposeEditor();
      return;
    }
    await nextTick();
    if (props.active && editorContainerRef.value && !getEditor()) {
      await initEditor();
    }
    getEditor()?.layout();
  },
  { immediate: true }
);

// Selecting a file mounts the Monaco host; ensure layout after the pane sizes.
watch(selectedPath, async (path) => {
  if (!path || !bIsMonacoFile.value) return;
  await nextTick();
  if (props.active && editorContainerRef.value && !getEditor()) {
    await initEditor();
  }
  getEditor()?.layout();
});

const { imageObjectUrl, htmlPreviewObjectUrl, disposePreviews } = useFilePreviews({
  getWorkspaceId: () => props.workspaceId,
  selectedPath,
  fileContent,
  fileEncoding,
  bIsImageFile,
  bHtmlPreview
});

watch(
  () => props.openPath,
  (path) => {
    if (!path || path === selectedPath.value) {
      return;
    }
    runOrConfirmDiscard(() => revealAndOpen(path));
  }
);

watch(
  () => props.workspaceId,
  async () => {
    entriesByPath.value = {};
    expandedPaths.value = new Set();
    selectedPath.value = null;
    fileContent.value = '';
    await loadList('');
    // Parent openPath can still be the previous workspace's file for a tick.
    const restorePath = readFilesOpenPath(props.workspaceId);
    if (restorePath) {
      await revealAndOpen(restorePath);
    }
  }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(async (): Promise<void> => {
  window.addEventListener('keydown', onWindowKeydown);
  await loadList('');
  const restorePath = pathToRestore();
  if (restorePath) {
    await revealAndOpen(restorePath);
  }
});

onUnmounted((): void => {
  window.removeEventListener('keydown', onWindowKeydown);
  if (saveResultTimer) {
    clearTimeout(saveResultTimer);
  }
  disposeEditor();
  disposePreviews();
});
</script>

<template>
  <div class="flex h-full min-h-0" :class="bFullscreen ? 'fixed inset-0 z-50 top-0 left-0 ' : ''">
    <!-- File tree: full width on narrow; fixed sidebar on wide (foldable / tablet+) -->
    <FilesTree
      v-model:new-file-path="newFilePath"
      :b-show-file-tree="bShowFileTree"
      :b-wide-pane="bWidePane"
      :b-fullscreen="bFullscreen"
      :b-show-hidden="bShowHidden"
      :b-side-panel-toggle-visible="bSidePanelToggleVisible"
      :selected-path="selectedPath"
      :visible-entries="visibleEntries"
      :b-list-loading="bListLoading"
      :b-root-empty="rootEntries.length === 0"
      :list-error="listError"
      :is-expanded="isExpanded"
      :b-creating-file="bCreatingFile"
      :b-creating-file-loading="bCreatingFileLoading"
      :create-kind="createKind"
      :create-file-error="createFileError"
      @toggle-hidden="toggleShowHidden"
      @open-create="openCreateFile"
      @toggle-fullscreen="bFullscreen = !bFullscreen"
      @hide-panel="setSidePanelOpen(false)"
      @create="createFile"
      @cancel-create="closeCreateFile"
      @entry-click="onEntryClick"
      @entry-menu="openEntryContextMenu"
    />

    <!-- Editor area: full width on narrow when a file is open; always present on wide -->
    <div
      v-show="bShowEditor"
      class="flex-1 flex flex-col min-w-0 border border-border rounded-md bg-surface overflow-hidden"
    >
      <FilesEditorHeader
        v-model:content-view-mode="contentViewMode"
        :b-side-panel-toggle-visible="bSidePanelToggleVisible"
        :b-side-panel-open="bSidePanelOpen"
        :b-wide-pane="bWidePane"
        :selected-path="selectedPath"
        :selected-path-file-name="selectedPathFileName"
        :b-dirty="bDirty"
        :save-result="saveResult"
        :save-error-message="saveErrorMessage"
        :b-is-previewable-markup="bIsPreviewableMarkup"
        :b-read-loading="bReadLoading"
        :b-is-editor-file="bIsEditorFile"
        :b-saving="bSaving"
        @show-panel="setSidePanelOpen(true)"
        @close="closeEditor"
        @download="downloadFile"
        @save="saveFile"
      />
      <FilesEditorContent
        v-model:file-content="fileContent"
        :selected-path="selectedPath"
        :selected-path-file-name="selectedPathFileName"
        :read-error="readError"
        :b-read-loading="bReadLoading"
        :b-is-markdown-file="bIsMarkdownFile"
        :b-markdown-preview="bMarkdownPreview"
        :b-html-preview="bHtmlPreview"
        :html-preview-object-url="htmlPreviewObjectUrl"
        :b-is-image-file="bIsImageFile"
        :image-object-url="imageObjectUrl"
        :b-is-binary-file="bIsBinaryFile"
        :b-is-dark-theme="bIsDarkTheme"
        :set-editor-container="setEditorContainer"
        @download="downloadFile"
      />
    </div>
  </div>

  <ContextMenu
    v-model="bCtxMenuOpen"
    :x="ctxMenuX"
    :y="ctxMenuY"
    :items="ctxMenuItems"
    @pick="onCtxPick"
  />
  <ConfirmModal
    v-model="bShowDeleteModal"
    :title="deleteTarget?.isDirectory ? 'Delete folder' : 'Delete file'"
    :description="`Delete '${deleteTarget?.name ?? ''}'? This cannot be undone.`"
    confirm-label="Delete"
    :loading="bDeleting"
    @confirm="confirmDelete"
  />
  <ConfirmModal
    v-model="bShowDiscardModal"
    title="Discard unsaved changes?"
    :description="`Your edits to '${selectedPathFileName}' have not been saved and will be lost.`"
    confirm-label="Discard"
    variant="danger"
    @confirm="confirmDiscard"
  />
  <PromptModal
    v-model="bShowRenameModal"
    title="Rename"
    label="Name"
    :initial-value="renameTarget?.name ?? ''"
    confirm-label="Rename"
    :loading="bRenaming"
    @confirm="confirmRename"
  />
</template>

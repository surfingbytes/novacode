<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onUnmounted, shallowRef, nextTick } from 'vue';
import type * as Monaco from 'monaco-editor';
import { MdEditor, MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';

// classes
import { filesApi } from '@/classes/api';
import { DEFAULT_THEME_ID, resolveStoredThemeId, themes } from '@/lib/themes';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import PromptModal from '@/components/PromptModal.vue';
import type { ContextMenuItem } from '@/components/ContextMenu.vue';

// composables
import { useLongPress } from '@/composables/useLongPress';
import { usePaneLayout } from '@/composables/usePaneLayout';

// types
import type { FileEntry } from '@/classes/api';
import { ancestorDirectoryPaths } from '@/utils/workspaceFilePath';

const monacoModule = shallowRef<typeof Monaco | null>(null);
async function getMonaco(): Promise<typeof Monaco> {
  if (!monacoModule.value) {
    monacoModule.value = await import('monaco-editor');
  }
  return monacoModule.value;
}

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  workspaceId: string;
  active: boolean;
  openPath?: string | null;
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

// -------------------------------------------------- Refs --------------------------------------------------
const entriesByPath = ref<Record<string, FileEntry[]>>({});
const expandedPaths = ref<Set<string>>(new Set());
const selectedPath = ref<string | null>(null);
const fileContent = ref<string>('');
const fileEncoding = ref<'utf8' | 'base64'>('utf8');
const imageObjectUrl = ref<string | null>(null);
const htmlPreviewObjectUrl = ref<string | null>(null);
const bListLoading = ref<boolean>(false);
const loadingPath = ref<string | null>(null);
const bReadLoading = ref<boolean>(false);
const listError = ref<string | null>(null);
const readError = ref<string | null>(null);
const editorContainerRef = ref<HTMLDivElement | null>(null);
const bSaving = ref<boolean>(false);
const saveResult = ref<'success' | 'error' | null>(null);
const bFullscreen = ref<boolean>(false);
/** Edit vs rendered preview for markdown / HTML files in the files pane. */
const contentViewMode = ref<'edit' | 'preview'>('edit');
const bCreatingFile = ref<boolean>(false);
const bCreatingFileLoading = ref<boolean>(false);
const newFilePath = ref<string>('');
const createFileError = ref<string | null>(null);
const createKind = ref<'file' | 'folder'>('file');
const bShowHidden = ref<boolean>(localStorage.getItem('novacode:filesShowHidden') === '1');
const bCtxMenuOpen = ref<boolean>(false);
const ctxMenuX = ref<number>(0);
const ctxMenuY = ref<number>(0);
const ctxMenuItems = ref<ContextMenuItem[]>([]);
const ctxTarget = ref<FileEntry | null>(null);
const bShowDeleteModal = ref<boolean>(false);
const bDeleting = ref<boolean>(false);
const deleteTarget = ref<FileEntry | null>(null);
const bShowRenameModal = ref<boolean>(false);
const bRenaming = ref<boolean>(false);
const renameTarget = ref<FileEntry | null>(null);
let editor: Monaco.editor.IStandaloneCodeEditor | null = null;

// Extension to Monaco language id
const EXT_LANG: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  jsx: 'javascript',
  tsx: 'typescript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  py: 'python',
  vue: 'html',
  sql: 'sql',
  xml: 'xml'
};

function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[extension] ?? 'plaintext';
}

// Extension to image MIME type (files rendered as pictures instead of text)
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif'
};

function extensionForPath(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index++) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
}

/** Raw bytes of the currently selected file, decoded according to its encoding. */
function currentFileBytes(): Uint8Array<ArrayBuffer> {
  if (fileEncoding.value === 'base64') {
    return base64ToBytes(fileContent.value);
  }
  // Copy into a fresh ArrayBuffer-backed array so the result is a valid BlobPart.
  return new Uint8Array(new TextEncoder().encode(fileContent.value));
}

function mimeForPath(path: string): string {
  return IMAGE_MIME[extensionForPath(path)] ?? 'application/octet-stream';
}

// -------------------------------------------------- Computed --------------------------------------------------
const rootEntries = computed((): FileEntry[] => entriesByPath.value[''] ?? []);

/** Flat list of visible entries with depth for recursive tree rendering */
const visibleEntries = computed((): { entry: FileEntry; depth: number }[] => {
  const result: { entry: FileEntry; depth: number }[] = [];
  function add(entries: FileEntry[], depth: number): void {
    for (const entry of entries) {
      result.push({ entry, depth });
      if (entry.isDirectory && expandedPaths.value.has(entry.path)) {
        const childList = entriesByPath.value[entry.path];
        if (childList) {
          add(childList, depth + 1);
        }
      }
    }
  }
  add(rootEntries.value, 0);
  return result;
});

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
  return selectedPath.value !== null && extensionForPath(selectedPath.value) in IMAGE_MIME;
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
  const themeId = resolveStoredThemeId(localStorage.getItem('theme') ?? DEFAULT_THEME_ID);
  const theme = themes.find((themeOption) => themeOption.id === themeId);
  return theme?.dark ?? false;
});

const bShowFileTree = computed((): boolean => listVisible(selectedPath.value !== null));
const bShowEditor = computed((): boolean => detailVisible(selectedPath.value !== null));

// -------------------------------------------------- Methods --------------------------------------------------
const loadList = async (path: string, bForce = false): Promise<void> => {
  const key = path || '';
  if (!bForce && entriesByPath.value[key]) {
    return;
  }
  bListLoading.value = true;
  loadingPath.value = path || '';
  listError.value = null;
  try {
    const response = await filesApi.list(props.workspaceId, path || undefined, {
      hidden: bShowHidden.value
    });
    const nextEntriesByPath = { ...entriesByPath.value };
    nextEntriesByPath[key] = response.data.entries;
    entriesByPath.value = nextEntriesByPath;
  } catch (error: unknown) {
    const errorWithMessage = error as { response?: { data?: { error?: string } }; message?: string };
    listError.value = errorWithMessage?.response?.data?.error ?? errorWithMessage?.message ?? 'Failed to list';
  } finally {
    bListLoading.value = false;
    loadingPath.value = null;
  }
};

async function reloadVisibleLists(): Promise<void> {
  const paths = ['', ...expandedPaths.value];
  entriesByPath.value = {};
  for (const directoryPath of paths) {
    await loadList(directoryPath, true);
  }
}

const toggleExpand = (entry: FileEntry): void => {
  if (!entry.isDirectory) {
    return;
  }
  const nextExpandedPaths = new Set(expandedPaths.value);
  if (nextExpandedPaths.has(entry.path)) {
    nextExpandedPaths.delete(entry.path);
  } else {
    nextExpandedPaths.add(entry.path);
  }
  expandedPaths.value = nextExpandedPaths;
  loadList(entry.path);
};

const readFilePath = async (path: string, bEmit = true): Promise<void> => {
  selectedPath.value = path;
  if (bEmit) {
    emit('update:openPath', path);
  }
  readError.value = null;
  bReadLoading.value = true;
  fileContent.value = '';
  fileEncoding.value = 'utf8';
  try {
    const response = await filesApi.read(props.workspaceId, path);
    fileContent.value = response.data.content;
    fileEncoding.value = response.data.encoding;
  } catch (error: unknown) {
    const errorWithMessage = error as { response?: { data?: { error?: string } }; message?: string };
    readError.value = errorWithMessage?.response?.data?.error ?? errorWithMessage?.message ?? 'Failed to read file';
  } finally {
    bReadLoading.value = false;
  }
};

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

const selectFile = async (entry: FileEntry): Promise<void> => {
  if (entry.isDirectory) {
    return;
  }
  await readFilePath(entry.path);
};

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
  await readFilePath(normalized, false);
}

const isExpanded = (path: string): boolean => expandedPaths.value.has(path);

async function initEditor(): Promise<void> {
  if (!editorContainerRef.value || !props.active || !bIsMonacoFile.value) {
    return;
  }
  const monaco = await getMonaco();
  // Another initEditor() call may have finished while we awaited getMonaco(); only one instance per container.
  if (editor || !bIsMonacoFile.value || !editorContainerRef.value) {
    return;
  }
  editor = monaco.editor.create(editorContainerRef.value, {
    value: fileContent.value,
    language: selectedPath.value ? languageForPath(selectedPath.value) : 'plaintext',
    readOnly: false,
    automaticLayout: true,
    minimap: { enabled: true },
    fontSize: 13,
    scrollBeyondLastLine: false,
    theme: bIsDarkTheme.value ? 'vs-dark' : 'vs-light'
  });
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    void saveFile();
  });
}

function disposeEditor(): void {
  if (editor) {
    editor.dispose();
    editor = null;
  }
}

async function updateEditorContent(): Promise<void> {
  if (!editor || !bIsMonacoFile.value) {
    return;
  }
  const monaco = await getMonaco();
  const model = editor.getModel();
  if (model) {
    model.setValue(fileContent.value);
    monaco.editor.setModelLanguage(model, languageForPath(selectedPath.value ?? ''));
  } else {
    const lang = selectedPath.value ? languageForPath(selectedPath.value) : 'plaintext';
    editor.setModel(monaco.editor.createModel(fileContent.value, lang));
  }
  await nextTick();
  editor.layout();
}

const saveFile = async (): Promise<void> => {
  if (!selectedPath.value) {
    return;
  }
  const content = bIsMarkdownFile.value ? fileContent.value : (editor?.getModel()?.getValue() ?? '');
  bSaving.value = true;
  saveResult.value = null;
  try {
    await filesApi.write(props.workspaceId, selectedPath.value, content);
    fileContent.value = content;
    saveResult.value = 'success';
    setTimeout(() => (saveResult.value = null), 2000);
  } catch {
    saveResult.value = 'error';
    setTimeout(() => (saveResult.value = null), 3000);
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

function parentPath(path: string): string {
  const slashIndex = path.lastIndexOf('/');
  return slashIndex >= 0 ? path.slice(0, slashIndex) : '';
}

function normalizeNewFilePath(path: string): string {
  return path.trim().replace(/^\/+/, '').replace(/\/+/g, '/');
}

const openCreateFile = (kind: 'file' | 'folder' = 'file'): void => {
  const selectedParent = selectedPath.value
    ? parentPath(selectedPath.value)
    : (ctxTarget.value?.isDirectory ? ctxTarget.value.path : parentPath(ctxTarget.value?.path ?? ''));
  createKind.value = kind;
  newFilePath.value =
    kind === 'folder'
      ? selectedParent
        ? `${selectedParent}/new-folder`
        : 'new-folder'
      : selectedParent
        ? `${selectedParent}/new-file.txt`
        : 'new-file.txt';
  createFileError.value = null;
  bCreatingFile.value = true;
};

const closeCreateFile = (): void => {
  bCreatingFile.value = false;
  bCreatingFileLoading.value = false;
  createFileError.value = null;
  newFilePath.value = '';
};

const createFile = async (): Promise<void> => {
  const normalizedPath = normalizeNewFilePath(newFilePath.value);
  if (!normalizedPath || normalizedPath.endsWith('/')) {
    createFileError.value =
      createKind.value === 'folder'
        ? 'Enter a valid folder path, for example src/lib.'
        : 'Enter a valid file path, for example src/new-file.ts.';
    return;
  }
  const pathSegments = normalizedPath.split('/');
  if (pathSegments.some((segment) => segment === '..' || segment === '.')) {
    createFileError.value = 'Path cannot include . or .. segments.';
    return;
  }

  bCreatingFileLoading.value = true;
  createFileError.value = null;
  try {
    if (createKind.value === 'folder') {
      await filesApi.mkdir(props.workspaceId, normalizedPath);
    } else {
      await filesApi.write(props.workspaceId, normalizedPath, '');
    }

    const ancestors = normalizedPath.includes('/')
      ? normalizedPath
          .split('/')
          .slice(0, -1)
          .reduce<string[]>((result, _, index, all) => {
            result.push(all.slice(0, index + 1).join('/'));
            return result;
          }, [])
      : [];
    expandedPaths.value = new Set([...expandedPaths.value, ...ancestors]);
    if (createKind.value === 'folder') {
      expandedPaths.value = new Set([...expandedPaths.value, normalizedPath]);
    }
    await reloadVisibleLists();
    if (createKind.value === 'folder') {
      await loadList(normalizedPath, true);
    } else {
      await readFilePath(normalizedPath);
    }
    closeCreateFile();
  } catch (error: unknown) {
    const errorWithMessage = error as { response?: { data?: { error?: string } }; message?: string };
    createFileError.value =
      errorWithMessage?.response?.data?.error ??
      errorWithMessage?.message ??
      (createKind.value === 'folder' ? 'Failed to create folder' : 'Failed to create file');
  } finally {
    bCreatingFileLoading.value = false;
  }
};

function toggleShowHidden(): void {
  bShowHidden.value = !bShowHidden.value;
  localStorage.setItem('novacode:filesShowHidden', bShowHidden.value ? '1' : '0');
  void reloadVisibleLists();
}

function entryContextItems(entry: FileEntry): ContextMenuItem[] {
  return [
    { key: 'rename', label: 'Rename…' },
    { key: 'delete', label: 'Delete…', danger: true }
  ];
}

function openEntryContextMenu(event: MouseEvent, entry: FileEntry): void {
  ctxTarget.value = entry;
  ctxMenuItems.value = entryContextItems(entry);
  ctxMenuX.value = event.clientX;
  ctxMenuY.value = event.clientY;
  bCtxMenuOpen.value = true;
}

const longPress = useLongPress<FileEntry>((entry) => {
  ctxTarget.value = entry;
  ctxMenuItems.value = entryContextItems(entry);
  ctxMenuX.value = 16;
  ctxMenuY.value = 80;
  bCtxMenuOpen.value = true;
});

function onCtxPick(key: string): void {
  const entry = ctxTarget.value;
  if (!entry) {
    return;
  }
  if (key === 'rename') {
    renameTarget.value = entry;
    bShowRenameModal.value = true;
    return;
  }
  if (key === 'delete') {
    deleteTarget.value = entry;
    bShowDeleteModal.value = true;
  }
}

async function confirmDelete(): Promise<void> {
  const entry = deleteTarget.value;
  if (!entry) {
    return;
  }
  bDeleting.value = true;
  try {
    await filesApi.remove(props.workspaceId, entry.path);
    if (selectedPath.value === entry.path || selectedPath.value?.startsWith(`${entry.path}/`)) {
      selectedPath.value = null;
      emit('update:openPath', null);
    }
    deleteTarget.value = null;
    bShowDeleteModal.value = false;
    await reloadVisibleLists();
  } catch (error: unknown) {
    const errorWithMessage = error as { response?: { data?: { error?: string } }; message?: string };
    listError.value =
      errorWithMessage?.response?.data?.error ?? errorWithMessage?.message ?? 'Failed to delete';
  } finally {
    bDeleting.value = false;
  }
}

async function confirmRename(nextName: string): Promise<void> {
  const entry = renameTarget.value;
  if (!entry) {
    return;
  }
  const trimmed = nextName.trim();
  if (!trimmed || trimmed.includes('/') || trimmed === '.' || trimmed === '..') {
    listError.value = 'Enter a file or folder name without slashes.';
    return;
  }
  const destination = parentPath(entry.path) ? `${parentPath(entry.path)}/${trimmed}` : trimmed;
  if (destination === entry.path) {
    bShowRenameModal.value = false;
    renameTarget.value = null;
    return;
  }
  bRenaming.value = true;
  try {
    const { data } = await filesApi.rename(props.workspaceId, entry.path, destination);
    if (selectedPath.value === entry.path) {
      await readFilePath(data.path);
    } else if (selectedPath.value?.startsWith(`${entry.path}/`)) {
      selectedPath.value = null;
      emit('update:openPath', null);
    }
    bShowRenameModal.value = false;
    renameTarget.value = null;
    await reloadVisibleLists();
  } catch (error: unknown) {
    const errorWithMessage = error as { response?: { data?: { error?: string } }; message?: string };
    listError.value =
      errorWithMessage?.response?.data?.error ?? errorWithMessage?.message ?? 'Failed to rename';
  } finally {
    bRenaming.value = false;
  }
}

function onEntryClick(entry: FileEntry): void {
  if (longPress.bTriggered.value) {
    longPress.bTriggered.value = false;
    return;
  }
  if (entry.isDirectory) {
    toggleExpand(entry);
    return;
  }
  void selectFile(entry);
}

// -------------------------------------------------- Watchers --------------------------------------------------
watch(
  () => props.active,
  (active: boolean) => {
    if (active && editorContainerRef.value && !editor) {
      initEditor();
    }
    if (!active) {
      disposeEditor();
    }
  }
);

watch([fileContent, selectedPath], () => {
  if (editor) {
    updateEditorContent();
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
    if (props.active && editorContainerRef.value && !editor) {
      await initEditor();
    }
    editor?.layout();
  },
  { immediate: true }
);

// Selecting a file mounts the Monaco host; ensure layout after the pane sizes.
watch(selectedPath, async (path) => {
  if (!path || !bIsMonacoFile.value) return;
  await nextTick();
  if (props.active && editorContainerRef.value && !editor) {
    await initEditor();
  }
  editor?.layout();
});

// Build/revoke the blob URL backing the image preview.
watch([fileContent, fileEncoding, selectedPath], () => {
  if (imageObjectUrl.value) {
    URL.revokeObjectURL(imageObjectUrl.value);
    imageObjectUrl.value = null;
  }
  if (bIsImageFile.value && fileContent.value) {
    const blob = new Blob([currentFileBytes()], { type: mimeForPath(selectedPath.value ?? '') });
    imageObjectUrl.value = URL.createObjectURL(blob);
  }
});

// Sandboxed HTML preview: blob URL + allow-scripts without allow-same-origin
// so mockup JS can run but cannot touch the app origin / token storage.
watch([fileContent, fileEncoding, selectedPath, bHtmlPreview], () => {
  if (htmlPreviewObjectUrl.value) {
    URL.revokeObjectURL(htmlPreviewObjectUrl.value);
    htmlPreviewObjectUrl.value = null;
  }
  if (bHtmlPreview.value && fileEncoding.value === 'utf8' && fileContent.value !== '') {
    const blob = new Blob([fileContent.value], { type: 'text/html;charset=utf-8' });
    htmlPreviewObjectUrl.value = URL.createObjectURL(blob);
  }
});

watch(
  () => props.openPath,
  (path) => {
    if (!path || path === selectedPath.value) {
      return;
    }
    void revealAndOpen(path);
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
    if (props.openPath) {
      await revealAndOpen(props.openPath);
    }
  }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(async (): Promise<void> => {
  window.addEventListener('keydown', onWindowKeydown);
  await loadList('');
  if (props.openPath) {
    await revealAndOpen(props.openPath);
  }
});

onUnmounted((): void => {
  window.removeEventListener('keydown', onWindowKeydown);
  disposeEditor();
  if (imageObjectUrl.value) {
    URL.revokeObjectURL(imageObjectUrl.value);
    imageObjectUrl.value = null;
  }
  if (htmlPreviewObjectUrl.value) {
    URL.revokeObjectURL(htmlPreviewObjectUrl.value);
    htmlPreviewObjectUrl.value = null;
  }
});
</script>

<template>
  <div class="flex h-full min-h-0" :class="bFullscreen ? 'fixed inset-0 z-50 top-0 left-0 ' : ''">
    <!-- File tree: full width on narrow; fixed sidebar on wide (foldable / tablet+) -->
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
            @click="toggleShowHidden"
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
          <button type="button" class="button is-icon is-transparent h-8!" aria-label="New folder" title="New folder" @click="openCreateFile('folder')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><path d="M12 11v6M9 14h6"/></svg>
          </button>
          <button type="button" class="button is-icon is-transparent h-8!" aria-label="New file" title="New file" @click="openCreateFile('file')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>

          <!-- fullscreen button -->
          <button
            type="button"
            class="button is-icon is-transparent h-8!"
            :aria-label="bFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
            :title="bFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
            @click="bFullscreen = !bFullscreen"
          >
            <svg v-if="bFullscreen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
          </button>

          <button
            v-if="bSidePanelToggleVisible"
            type="button"
            class="button is-icon is-transparent h-8!"
            aria-label="Hide file list"
            title="Hide file list"
            @click="setSidePanelOpen(false)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M14 9l-3 3 3 3"/></svg>
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
          @keydown.enter.prevent="createFile"
          @keydown.esc.prevent="closeCreateFile"
        />
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="button is-primary h-8!"
            :disabled="bCreatingFileLoading"
            @click="createFile"
          >
            <span>{{ createKind === 'folder' ? 'Create folder' : 'Create' }}</span>
          </button>
          <button
            type="button"
            class="button is-transparent h-8!"
            :disabled="bCreatingFileLoading"
            @click="closeCreateFile"
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
        <div v-else class="w-max min-w-full">
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
            @contextmenu.prevent.stop="openEntryContextMenu($event, entry)"
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
          v-if="bListLoading && rootEntries.length === 0"
          class="px-3 py-2 text-xs text-text-muted"
        >
          Loading…
        </div>
      </div>
    </div>

    <!-- Editor area: full width on narrow when a file is open; always present on wide -->
    <div
      v-show="bShowEditor"
      class="flex-1 flex flex-col min-w-0 border border-border rounded-md bg-surface overflow-hidden"
    >
      <div
        class="shrink-0 px-3 py-1.5 bg-surface flex items-center justify-between gap-2 h-11.5! border-b border-border"
      >
        <div class="flex items-center gap-2 min-w-0 flex-1 h-8">
          <button
            v-if="bSidePanelToggleVisible && !bSidePanelOpen"
            type="button"
            class="button is-icon is-transparent h-8! w-8!"
            aria-label="Show file list"
            title="Show file list"
            @click="setSidePanelOpen(true)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M11 9l3 3-3 3"/></svg>
          </button>
          <!-- Back to file list on narrow viewports -->
          <button
            v-if="!bWidePane"
            type="button"
            class="button is-icon is-transparent h-8! w-8!"
            aria-label="Back to file list"
            @click="selectedPath = null"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <span
            class="text-xs text-text-text-primary font-mono mt-1 truncate min-w-0"
          >
            {{ bWidePane ? (selectedPath ?? 'Select a file') : selectedPathFileName }}
          </span>
        </div>
        <div class="flex items-center gap-1">
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
            @click="downloadFile"
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
            @click="saveFile"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            <span> Save </span>
          </button>
        </div>
      </div>
      <div
        v-if="!selectedPath"
        class="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-text-muted"
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="opacity-50"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p>Select a file to view or edit</p>
      </div>
      <div v-else-if="readError" class="message is-error">
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
          />
        </div>
        <MdEditor
          v-else-if="bIsMarkdownFile"
          v-model="fileContent"
          class="flex-1 min-h-[200px]"
          language="en-US"
          :theme="bIsDarkTheme ? 'dark' : 'light'"
          :preview="false"
          :toolbars-exclude="['github', 'save', 'preview', 'previewOnly', 'htmlPreview']"
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
          <button type="button" class="button is-primary h-8!" @click="downloadFile">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span> Download </span>
          </button>
        </div>
        <div v-else ref="editorContainerRef" class="flex-1 min-h-[200px] w-full" />
      </div>
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

<style scoped>
/* md-editor-v3 defaults to word-break: break-all, which splits mid-word on narrow screens. */
:deep(.md-editor-preview) {
  word-break: normal;
  overflow-wrap: break-word;
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

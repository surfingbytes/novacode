<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onUnmounted, shallowRef, nextTick } from 'vue';
import type * as Monaco from 'monaco-editor';
import { MdEditor, MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/style.css';

// classes
import { filesApi } from '@/classes/api';
import { DEFAULT_THEME_ID, resolveStoredThemeId, themes } from '@/lib/themes';

// composables
import { usePaneLayout } from '@/composables/usePaneLayout';

// types
import type { FileEntry } from '@/classes/api';

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
const loadList = async (path: string): Promise<void> => {
  const key = path || '';
  if (entriesByPath.value[key]) {
    return;
  }
  bListLoading.value = true;
  loadingPath.value = path || '';
  listError.value = null;
  try {
    const response = await filesApi.list(props.workspaceId, path || undefined);
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

const readFilePath = async (path: string): Promise<void> => {
  selectedPath.value = path;
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

function parentPath(path: string): string {
  const slashIndex = path.lastIndexOf('/');
  return slashIndex >= 0 ? path.slice(0, slashIndex) : '';
}

function normalizeNewFilePath(path: string): string {
  return path.trim().replace(/^\/+/, '').replace(/\/+/g, '/');
}

const openCreateFile = (): void => {
  const selectedParent = selectedPath.value ? parentPath(selectedPath.value) : '';
  newFilePath.value = selectedParent ? `${selectedParent}/new-file.txt` : 'new-file.txt';
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
    createFileError.value = 'Enter a valid file path, for example src/new-file.ts.';
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
    await filesApi.write(props.workspaceId, normalizedPath, '');

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
    entriesByPath.value = {};
    await loadList('');
    for (const directoryPath of ancestors) {
      await loadList(directoryPath);
    }

    await readFilePath(normalizedPath);
    closeCreateFile();
  } catch (error: unknown) {
    const errorWithMessage = error as { response?: { data?: { error?: string } }; message?: string };
    createFileError.value =
      errorWithMessage?.response?.data?.error ?? errorWithMessage?.message ?? 'Failed to create file';
  } finally {
    bCreatingFileLoading.value = false;
  }
};

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
  () => props.workspaceId,
  () => {
    entriesByPath.value = {};
    expandedPaths.value = new Set();
    selectedPath.value = null;
    fileContent.value = '';
    loadList('');
  }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(async (): Promise<void> => {
  await loadList('');
});

onUnmounted((): void => {
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
          <button type="button" class="button is-icon is-transparent h-8!" aria-label="New file" title="New file" @click="openCreateFile">
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
          placeholder="src/new-file.ts"
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
            <span> Create </span>
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
      <div class="flex-1 overflow-y-auto py-1">
        <div v-if="listError" class="px-3 py-2 text-xs text-destructive">
          {{ listError }}
        </div>
        <template v-else>
          <button
            v-for="{ entry, depth } in visibleEntries"
            :key="entry.path"
            type="button"
            class="group w-full flex items-center gap-1.5 py-1 text-left text-sm truncate transition-colors hover:bg-primary/10 cursor-pointer"
            :class="
              !entry.isDirectory && selectedPath === entry.path
                ? 'bg-primary/15 text-primary hover:bg-primary/10'
                : 'text-text-primary hover:bg-primary/10!'
            "
            :style="{ paddingLeft: 8 + depth * 12 + 'px' }"
            @click="entry.isDirectory ? toggleExpand(entry) : selectFile(entry)"
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

            <span class="truncate">{{ entry.name }}</span>
          </button>
        </template>
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
        <MdPreview
          v-if="bIsMarkdownFile && bMarkdownPreview"
          :model-value="fileContent"
          class="flex-1 min-h-[200px] overflow-auto"
          language="en-US"
          :theme="bIsDarkTheme ? 'dark' : 'light'"
        />
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
</template>

<style scoped></style>

// node_modules
import { ref } from 'vue';
import type { Ref } from 'vue';

// classes
import { filesApi } from '@/classes/api';
import { normalizeNewFilePath, parentPath } from './filePaths';

// types
import type { ContextMenuItem } from '@/components/ContextMenu.vue';
import type { FileEntry } from '@/@types/index';

type UseFileEntryActionsOptions = {
  getWorkspaceId: () => string;
  selectedPath: Ref<string | null>;
  expandedPaths: Ref<Set<string>>;
  listError: Ref<string | null>;
  loadList: (path: string, bForce?: boolean) => Promise<void>;
  reloadVisibleLists: () => Promise<void>;
  readFilePath: (path: string) => Promise<void>;
  commitOpenPath: (path: string | null) => void;
};

/** Create / rename / delete of tree entries, plus the entry context menu that triggers them. */
export function useFileEntryActions(options: UseFileEntryActionsOptions) {
  const { selectedPath, expandedPaths, listError, loadList, reloadVisibleLists, readFilePath, commitOpenPath } =
    options;

  const bCreatingFile = ref<boolean>(false);
  const bCreatingFileLoading = ref<boolean>(false);
  const newFilePath = ref<string>('');
  const createFileError = ref<string | null>(null);
  const createKind = ref<'file' | 'folder'>('file');
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
        await filesApi.mkdir(options.getWorkspaceId(), normalizedPath);
      } else {
        await filesApi.write(options.getWorkspaceId(), normalizedPath, '');
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

  function entryContextItems(): ContextMenuItem[] {
    return [
      { key: 'rename', label: 'Rename…' },
      { key: 'delete', label: 'Delete…', danger: true }
    ];
  }

  function openEntryContextMenu(entry: FileEntry, x: number, y: number): void {
    ctxTarget.value = entry;
    ctxMenuItems.value = entryContextItems();
    ctxMenuX.value = x;
    ctxMenuY.value = y;
    bCtxMenuOpen.value = true;
  }

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
      await filesApi.remove(options.getWorkspaceId(), entry.path);
      if (selectedPath.value === entry.path || selectedPath.value?.startsWith(`${entry.path}/`)) {
        selectedPath.value = null;
        commitOpenPath(null);
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
      const { data } = await filesApi.rename(options.getWorkspaceId(), entry.path, destination);
      if (selectedPath.value === entry.path) {
        await readFilePath(data.path);
      } else if (selectedPath.value?.startsWith(`${entry.path}/`)) {
        selectedPath.value = null;
        commitOpenPath(null);
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

  return {
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
  };
}

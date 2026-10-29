// node_modules
import { ref, computed } from 'vue';

// classes
import { filesApi } from '@/classes/api';
import { safeGetItem, safeSetItem } from '@/lib/safeLocalStorage';

// types
import type { FileEntry } from '@/@types/index';

export type VisibleFileEntry = { entry: FileEntry; depth: number };

/** Lazily loaded directory tree of a workspace (listings, expansion, hidden-file toggle). */
export function useFileTree(getWorkspaceId: () => string) {
  const entriesByPath = ref<Record<string, FileEntry[]>>({});
  const expandedPaths = ref<Set<string>>(new Set());
  const bListLoading = ref<boolean>(false);
  const loadingPath = ref<string | null>(null);
  const listError = ref<string | null>(null);
  const bShowHidden = ref<boolean>(safeGetItem('novacode:filesShowHidden') === '1');

  const rootEntries = computed((): FileEntry[] => entriesByPath.value[''] ?? []);

  /** Flat list of visible entries with depth for recursive tree rendering */
  const visibleEntries = computed((): VisibleFileEntry[] => {
    const result: VisibleFileEntry[] = [];
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

  const loadList = async (path: string, bForce = false): Promise<void> => {
    const key = path || '';
    if (!bForce && entriesByPath.value[key]) {
      return;
    }
    bListLoading.value = true;
    loadingPath.value = path || '';
    listError.value = null;
    try {
      const response = await filesApi.list(getWorkspaceId(), path || undefined, {
        hidden: bShowHidden.value
      });
      const nextEntriesByPath = { ...entriesByPath.value };
      nextEntriesByPath[key] = response.data.entries;
      entriesByPath.value = nextEntriesByPath;
    } catch (error: unknown) {
      // A missing subfolder (e.g. ancestor of a stale open path) just collapses; only root failures are errors.
      if (key) {
        const nextExpandedPaths = new Set(expandedPaths.value);
        nextExpandedPaths.delete(key);
        expandedPaths.value = nextExpandedPaths;
        return;
      }
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
    void loadList(entry.path);
  };

  const isExpanded = (path: string): boolean => expandedPaths.value.has(path);

  function toggleShowHidden(): void {
    bShowHidden.value = !bShowHidden.value;
    safeSetItem('novacode:filesShowHidden', bShowHidden.value ? '1' : '0');
    void reloadVisibleLists();
  }

  return {
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
  };
}

/**
 * Session tabs — active tab and Files open path, kept in sync with the route query.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { ref, watch } from 'vue';
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router';

// classes
import { readFilesOpenPath, writeFilesOpenPath } from '@/lib/filesOpenPath';
import { toWorkspaceRelativePath } from '@/utils/workspaceFilePath';

// -------------------------------------------------- Types --------------------------------------------------

export type SessionTab = 'chat' | 'terminal' | 'files' | 'git' | 'plan' | 'orchestrator';

export interface UseSessionTabsOptions {
  workspaceId: () => string;
  workspacePath: () => string;
  route: RouteLocationNormalizedLoaded;
  router: Router;
}

// -------------------------------------------------- Helpers --------------------------------------------------

export function tabFromQuery(raw: unknown): SessionTab | null {
  if (
    raw === 'chat' ||
    raw === 'terminal' ||
    raw === 'files' ||
    raw === 'git' ||
    raw === 'plan' ||
    raw === 'orchestrator'
  ) {
    return raw;
  }
  return null;
}

export function useSessionTabs(options: UseSessionTabsOptions) {
  const { route, router } = options;

  // -------------------------------------------------- Refs --------------------------------------------------
  const activeTab = ref<SessionTab>('chat');
  const filesOpenPath = ref<string | null>(null);

  // -------------------------------------------------- Methods --------------------------------------------------
  function applySessionQueryFromRoute(): void {
    const tab = tabFromQuery(route.query.tab);
    if (tab && tab !== activeTab.value) {
      activeTab.value = tab;
    }
    const file = route.query.file;
    if (typeof file === 'string' && file.trim()) {
      filesOpenPath.value = file;
      writeFilesOpenPath(options.workspaceId(), file);
      if (!tab) {
        activeTab.value = 'files';
      }
    } else if (!filesOpenPath.value) {
      filesOpenPath.value = readFilesOpenPath(options.workspaceId());
    }
  }

  function syncSessionQuery(): void {
    const nextQuery: Record<string, string> = {};
    if (activeTab.value !== 'chat') {
      nextQuery.tab = activeTab.value;
    }
    if (activeTab.value === 'files' && filesOpenPath.value) {
      nextQuery.file = filesOpenPath.value;
    }
    const currentTab = typeof route.query.tab === 'string' ? route.query.tab : '';
    const currentFile = typeof route.query.file === 'string' ? route.query.file : '';
    if ((nextQuery.tab ?? '') === currentTab && (nextQuery.file ?? '') === currentFile) {
      return;
    }
    void router.replace({ query: nextQuery });
  }

  function openWorkspaceFile(rawPath: string): void {
    const relative =
      toWorkspaceRelativePath(rawPath, options.workspacePath()) ??
      rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!relative || relative.includes('*')) {
      return;
    }
    filesOpenPath.value = relative;
    writeFilesOpenPath(options.workspaceId(), relative);
    activeTab.value = 'files';
    syncSessionQuery();
  }

  function onFilesOpenPath(path: string | null): void {
    filesOpenPath.value = path;
    writeFilesOpenPath(options.workspaceId(), path);
    syncSessionQuery();
  }

  // -------------------------------------------------- Watchers --------------------------------------------------
  // Files open path follows the workspace: the route's ?file wins, else the stored one.
  watch(
    () => options.workspaceId(),
    (workspaceId) => {
      const file = route.query.file;
      filesOpenPath.value =
        typeof file === 'string' && file.trim() ? file : readFilesOpenPath(workspaceId);
    },
    { immediate: true }
  );

  watch(
    () => [route.query.tab, route.query.file],
    () => {
      applySessionQueryFromRoute();
    }
  );

  return {
    // data
    activeTab,
    filesOpenPath,
    // methods
    applySessionQueryFromRoute,
    syncSessionQuery,
    openWorkspaceFile,
    onFilesOpenPath
  };
}

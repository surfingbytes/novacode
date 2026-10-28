/**
 * Session header info — workspace names, rules subtitle, CI badge and tag suggestions.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { computed, ref } from 'vue';
import type { Router } from 'vue-router';

// classes
import { globalRulesApi, workspaceRulesApi } from '@/classes/api';
import { formatRulesSubtitleLabel, formatRulesSubtitleTitle } from '@/utils/cursorUsageDisplay';
import { ciBadgeState, ciBadgeTitle } from '@/utils/ciStatusDisplay';

// composables
import { useCiStatus } from '@/composables/useCiStatus';

// types
import type { Session, Workspace } from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseSessionHeaderInfoOptions {
  workspaceId: () => string;
  sessionId: () => string;
  router: Router;
  workspacesStore: { workspaces: Workspace[]; allSessions: Session[] };
  /** Header CI badge polls only while the Git tab (which has its own) is hidden. */
  bCiActive: () => boolean;
}

export function useSessionHeaderInfo(options: UseSessionHeaderInfoOptions) {
  const { workspacesStore } = options;

  // -------------------------------------------------- Refs --------------------------------------------------
  const rulesCount = ref(0);
  const globalRulesCount = ref(0);

  // -------------------------------------------------- Computed --------------------------------------------------
  const workspaceName = computed(
    () =>
      workspacesStore.workspaces.find((w) => w.id === options.workspaceId())?.name ?? 'Workspace'
  );
  const workspacePath = computed(
    () => workspacesStore.workspaces.find((w) => w.id === options.workspaceId())?.path ?? ''
  );
  const subtitleWorkspaces = computed(() =>
    workspacesStore.workspaces
      .filter((workspace) => !workspace.archived)
      .map((workspace) => ({ id: workspace.id, name: workspace.name }))
      .sort((left, right) => left.name.localeCompare(right.name))
  );
  const rulesSubtitleLabel = computed(() =>
    formatRulesSubtitleLabel(rulesCount.value, globalRulesCount.value)
  );
  const rulesSubtitleTitle = computed(() =>
    formatRulesSubtitleTitle(rulesCount.value, globalRulesCount.value)
  );
  const rulesSubtitleTo = computed(() => {
    if (rulesCount.value > 0) {
      return { name: 'workspace-rules' as const, params: { id: options.workspaceId() } };
    }
    return { name: 'settings' as const, query: { tab: 'rules' } };
  });

  // Header CI badge for the workspace root repo; the Git tab shows the full breakdown.
  const { status: headerCiStatus } = useCiStatus({
    workspaceId: computed(() => options.workspaceId()),
    repo: computed(() => ''),
    sessionId: computed(() => options.sessionId()),
    active: computed(() => options.bCiActive())
  });
  const headerCiState = computed(() => ciBadgeState(headerCiStatus.value));
  const headerCiTitle = computed(() => ciBadgeTitle(headerCiStatus.value));

  /** Tags used in this workspace (for edit session autocomplete). */
  const sessionTagSuggestions = computed(() => {
    const wid = options.workspaceId();
    const all = workspacesStore.allSessions.filter((s) => s.workspaceId === wid);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of all) {
      const tags = s.tags;
      if (!tags?.length) continue;
      for (const t of tags) {
        if (typeof t !== 'string' || !t.trim()) continue;
        const k = t.trim().toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t.trim());
      }
    }
    return out.sort((a, b) => a.localeCompare(b));
  });

  // -------------------------------------------------- Methods --------------------------------------------------
  function onSelectWorkspace(workspaceId: string): void {
    if (workspaceId === options.workspaceId()) {
      return;
    }
    void options.router.push({ name: 'workspace-sessions', params: { id: workspaceId } });
  }

  async function loadRulesCount(): Promise<void> {
    try {
      const { data } = await workspaceRulesApi.list(options.workspaceId());
      rulesCount.value = Array.isArray(data) ? data.length : 0;
    } catch {
      rulesCount.value = 0;
    }
    try {
      const { data } = await globalRulesApi.list();
      globalRulesCount.value = Array.isArray(data) ? data.length : 0;
    } catch {
      globalRulesCount.value = 0;
    }
  }

  return {
    // data
    workspaceName,
    workspacePath,
    subtitleWorkspaces,
    rulesSubtitleLabel,
    rulesSubtitleTitle,
    rulesSubtitleTo,
    headerCiState,
    headerCiTitle,
    sessionTagSuggestions,
    // methods
    onSelectWorkspace,
    loadRulesCount
  };
}

export type UseSessionHeaderInfo = ReturnType<typeof useSessionHeaderInfo>;

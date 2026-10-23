// node_modules
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

// classes
import { orchestratorApi } from '@/classes/api';
import { forgetLocalStateForId } from '@/lib/sessionLocalState';
import { subtasksFromStoredJson } from '@/utils/orchestratorPayload';

// types
import type { Orchestrator, OrchestratorSummary } from '@/@types/index';

/**
 * Single source of truth for orchestrators.
 * Previously five components each held their own copy and polled for run
 * state at 2s/3s/3s concurrently. Run-state changes now arrive over the
 * sessions WebSocket as `orchestrator-upsert` frames (see workspaces store),
 * so this store only fetches on demand and applies pushes.
 */
export const useOrchestratorsStore = defineStore('orchestrators', () => {
  // -------------------------------------------------- Refs --------------------------------------------------
  const orchestratorsByWorkspace = ref<Record<string, Orchestrator[]>>({});
  const fetchedWorkspaces = new Set<string>();

  // -------------------------------------------------- Computed --------------------------------------------------
  const anyRunning = computed<boolean>(() =>
    Object.values(orchestratorsByWorkspace.value).some((list) =>
      list.some((orchestrator) => orchestrator.runStatus === 'running')
    )
  );

  /** Planning chat id → its newest non-archived orchestrator, across all workspaces. */
  const byPlannerSessionId = computed<Map<string, Orchestrator>>(() => {
    const map = new Map<string, Orchestrator>();
    for (const list of Object.values(orchestratorsByWorkspace.value)) {
      for (const orchestrator of list) {
        const plannerId = orchestrator.sourceSessionId;
        if (!plannerId || orchestrator.archived) {
          continue;
        }
        const existing = map.get(plannerId);
        if (!existing || orchestrator.createdAt > existing.createdAt) {
          map.set(plannerId, orchestrator);
        }
      }
    }
    return map;
  });

  /** Sessions that ran a step of any orchestrator (the plan stands for them in the nav). */
  const stepSessionIds = computed<Set<string>>(() => {
    const ids = new Set<string>();
    for (const list of Object.values(orchestratorsByWorkspace.value)) {
      for (const orchestrator of list) {
        for (const task of subtasksFromStoredJson(orchestrator.subtasksJson)) {
          if (task.sessionId) {
            ids.add(task.sessionId);
          }
        }
      }
    }
    return ids;
  });

  // -------------------------------------------------- Methods --------------------------------------------------
  function forWorkspace(workspaceId: string): Orchestrator[] {
    return orchestratorsByWorkspace.value[workspaceId] ?? [];
  }

  function byId(orchestratorId: string): Orchestrator | null {
    for (const list of Object.values(orchestratorsByWorkspace.value)) {
      const found = list.find((orchestrator) => orchestrator.id === orchestratorId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /** Newest non-archived plan whose planning chat is `sessionId`. */
  function forPlannerSession(workspaceId: string, sessionId: string): Orchestrator | null {
    const matches = forWorkspace(workspaceId).filter(
      (orchestrator) => orchestrator.sourceSessionId === sessionId && !orchestrator.archived
    );
    if (matches.length === 0) {
      return null;
    }
    return matches.reduce((newest, candidate) => (candidate.createdAt > newest.createdAt ? candidate : newest));
  }

  function upsertOrchestrator(orchestrator: Orchestrator): void {
    const workspaceId = orchestrator.workspaceId;
    const list = [...(orchestratorsByWorkspace.value[workspaceId] ?? [])];
    const index = list.findIndex((existing) => existing.id === orchestrator.id);
    if (index === -1) {
      list.unshift(orchestrator);
    } else {
      // Preserve richer fields the push may omit (same merge rule as sessions).
      list[index] = { ...list[index], ...orchestrator };
    }
    orchestratorsByWorkspace.value = {
      ...orchestratorsByWorkspace.value,
      [workspaceId]: list
    };
  }

  /**
   * Merge the all-workspace list (no `messageJson`) from `GET /orchestrators` or the
   * sessions WS snapshot. Keeps richer fields already loaded; doesn't mark workspaces
   * fetched, so workspace views still load the full rows.
   */
  function applySummaries(summaries: OrchestratorSummary[]): void {
    const next = { ...orchestratorsByWorkspace.value };
    for (const summary of summaries) {
      const list = [...(next[summary.workspaceId] ?? [])];
      const index = list.findIndex((existing) => existing.id === summary.id);
      if (index === -1) {
        list.push({ messageJson: '', ...summary });
      } else {
        list[index] = { ...list[index], ...summary };
      }
      next[summary.workspaceId] = list;
    }
    orchestratorsByWorkspace.value = next;
  }

  function removeOrchestrator(orchestratorId: string, workspaceId?: string): void {
    const next = { ...orchestratorsByWorkspace.value };
    const workspaceIds = workspaceId ? [workspaceId] : Object.keys(next);
    for (const id of workspaceIds) {
      if (next[id]) {
        next[id] = next[id].filter((orchestrator) => orchestrator.id !== orchestratorId);
      }
    }
    orchestratorsByWorkspace.value = next;
    forgetLocalStateForId(orchestratorId);
  }

  /** Fetch once per workspace unless forced; safe to call repeatedly. */
  async function ensureFetched(workspaceId: string, bForce = false): Promise<void> {
    if (!workspaceId || (fetchedWorkspaces.has(workspaceId) && !bForce)) {
      return;
    }
    try {
      const { data } = await orchestratorApi.list(workspaceId);
      orchestratorsByWorkspace.value = {
        ...orchestratorsByWorkspace.value,
        [workspaceId]: data ?? []
      };
      fetchedWorkspaces.add(workspaceId);
    } catch {
      // leave previous data in place; the list view shows its own error state
    }
  }

  async function fetchOne(workspaceId: string, orchestratorId: string): Promise<Orchestrator | null> {
    try {
      const { data } = await orchestratorApi.get(workspaceId, orchestratorId);
      if (data) {
        upsertOrchestrator(data);
      }
      return data ?? null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------- Export --------------------------------------------------
  return {
    // data
    orchestratorsByWorkspace,
    anyRunning,
    byPlannerSessionId,
    stepSessionIds,
    // methods
    forWorkspace,
    byId,
    forPlannerSession,
    upsertOrchestrator,
    applySummaries,
    removeOrchestrator,
    ensureFetched,
    fetchOne
  };
});

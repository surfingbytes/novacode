// node_modules
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

// classes
import { orchestratorApi } from '@/classes/api';

// types
import type { Orchestrator } from '@/@types/index';

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

  function removeOrchestrator(orchestratorId: string, workspaceId?: string): void {
    const next = { ...orchestratorsByWorkspace.value };
    const workspaceIds = workspaceId ? [workspaceId] : Object.keys(next);
    for (const id of workspaceIds) {
      if (next[id]) {
        next[id] = next[id].filter((orchestrator) => orchestrator.id !== orchestratorId);
      }
    }
    orchestratorsByWorkspace.value = next;
  }

  /** Fetch once per workspace unless forced; safe to call repeatedly. */
  async function ensureFetched(workspaceId: string, bForce = false): Promise<void> {
    if (!workspaceId || (fetchedWorkspaces.has(workspaceId) && !bForce)) {
      return;
    }
    fetchedWorkspaces.add(workspaceId);
    try {
      const { data } = await orchestratorApi.list(workspaceId);
      orchestratorsByWorkspace.value = {
        ...orchestratorsByWorkspace.value,
        [workspaceId]: data ?? []
      };
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
    // methods
    forWorkspace,
    byId,
    upsertOrchestrator,
    removeOrchestrator,
    ensureFetched,
    fetchOne
  };
});

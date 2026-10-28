/**
 * Orchestrator mode for a chat — the plan this chat owns and the actions that write or open it.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { computed, ref, watch, type Ref } from 'vue';
import type { Router } from 'vue-router';

// stores
import type { useOrchestratorsStore } from '@/stores/orchestrators';

// types
import { buildPlanAsOrchestratorPrompt, subtasksFromStoredJson } from '@novacode/shared';
import type { Orchestrator } from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

export interface UseSessionOrchestratorOptions {
  workspaceId: () => string;
  sessionId: () => string;
  router: Router;
  orchestratorsStore: Pick<
    ReturnType<typeof useOrchestratorsStore>,
    'forPlannerSession' | 'ensureFetched'
  >;
  activeTab: Ref<string>;
  /** Sends a prompt to this chat's agent with the current model and mode. */
  sendPrompt: (text: string) => void;
}

export function useSessionOrchestrator(options: UseSessionOrchestratorOptions) {
  // -------------------------------------------------- Refs --------------------------------------------------
  /** Plan this chat owns (its agent writes it through the nova MCP). */
  const plannedOrchestrator = computed<Orchestrator | null>(() =>
    options.orchestratorsStore.forPlannerSession(options.workspaceId(), options.sessionId())
  );
  const bPlanHasSteps = computed(
    () => subtasksFromStoredJson(plannedOrchestrator.value?.subtasksJson).length > 0
  );
  /** Set once the workspace's plans are loaded, so only plans created afterwards switch tabs. */
  const bOrchestratorsLoaded = ref(false);

  // -------------------------------------------------- Methods --------------------------------------------------
  function loadPlannedOrchestrator(): void {
    bOrchestratorsLoaded.value = false;
    void options.orchestratorsStore.ensureFetched(options.workspaceId()).finally(() => {
      bOrchestratorsLoaded.value = true;
    });
  }

  /** Ask the chat's agent to write the spec and the steps (nova MCP tools). */
  function planAsOrchestrator(): void {
    options.activeTab.value = 'chat';
    options.sendPrompt(buildPlanAsOrchestratorPrompt(bPlanHasSteps.value));
  }

  function openOrchestratorPage(): void {
    if (!plannedOrchestrator.value) return;
    void options.router.push({
      name: 'orchestrator',
      params: { id: options.workspaceId(), orchestratorId: plannedOrchestrator.value.id }
    });
  }

  // -------------------------------------------------- Watchers --------------------------------------------------
  // The agent just saved the first steps of this chat's plan: show it.
  watch(
    () => [options.sessionId(), bPlanHasSteps.value] as const,
    ([sessionId, bHasSteps], [previousSessionId, bHadSteps]) => {
      if (
        sessionId === previousSessionId &&
        bHasSteps &&
        !bHadSteps &&
        bOrchestratorsLoaded.value
      ) {
        options.activeTab.value = 'orchestrator';
      }
    }
  );

  return {
    // data
    plannedOrchestrator,
    bPlanHasSteps,
    bOrchestratorsLoaded,
    // methods
    loadPlannedOrchestrator,
    planAsOrchestrator,
    openOrchestratorPage
  };
}

export type UseSessionOrchestrator = ReturnType<typeof useSessionOrchestrator>;

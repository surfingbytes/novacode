/**
 * Canonical implementation lives in @novacode/shared
 * (shared/src/orchestratorPayload.ts). This shim keeps existing imports working.
 */
export {
  appendHandoff,
  buildStepPrompt,
  cloneSubtasksForNewPlan,
  collectStepSessionIdsFromSubtasksJson,
  mergeSubtasksJsonPatch,
  normalizeDependsOn,
  normalizeSubtasksPayload,
  parseSubtasksPayloadString,
  remapDependsOnAfterDelete,
  serializeSubtasksPayload,
  shouldSkipOrchestratorStep,
  subtasksFromStoredJson,
  summarizeStepHandoff
} from '@novacode/shared';
export type { OrchestratorSubtasksPayload } from '@novacode/shared';

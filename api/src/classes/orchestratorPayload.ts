/**
 * Canonical implementation lives in @novacode/shared
 * (shared/src/orchestratorPayload.ts). This shim keeps existing imports working.
 */
export {
  appendHandoff,
  buildStepPrompt,
  cloneSubtasksForNewPlan,
  collectStepSessionIdsFromSubtasksJson,
  filterHandoffLog,
  findRunnableSteps,
  mergeSubtasksJsonPatch,
  normalizeDependsOn,
  parseSubtasksPayloadString,
  serializeSubtasksPayload,
  shouldSkipOrchestratorStep,
  summarizeStepHandoff
} from '@novacode/shared';

/**
 * Canonical implementation lives in @novacode/shared
 * (shared/src/orchestratorPayload.ts). This shim keeps existing imports working.
 */
export {
  appendHandoff,
  buildStepPrompt,
  collectStepSessionIdsFromSubtasksJson,
  mergeSubtasksJsonPatch,
  normalizeSubtasksPayload,
  parseSubtasksPayloadString,
  serializeSubtasksPayload,
  subtasksFromStoredJson,
  summarizeStepHandoff
} from '@novacode/shared';
export type { OrchestratorSubtasksPayload } from '@novacode/shared';

/**
 * Canonical implementation lives in @novacode/shared
 * (shared/src/orchestratorPayload.ts). This shim keeps existing imports working.
 */
export {
  normalizeDependsOn,
  parseOrchestratorSubtasksJson,
  remapDependsOnAfterDelete,
  serializeOrchestratorSubtasksPayload,
  subtasksFromStoredJson
} from '@novacode/shared';
export type { OrchestratorSubtasksPayload } from '@novacode/shared';

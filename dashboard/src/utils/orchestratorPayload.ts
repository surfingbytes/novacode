/**
 * Canonical implementation lives in @novacode/shared
 * (shared/src/orchestratorPayload.ts). This shim keeps existing imports working.
 */
export {
  handoffNoteForStep,
  insertSubtask,
  moveSubtask,
  normalizeDependsOn,
  parseSubtasksPayloadString,
  remapDependsOnAfterDelete,
  serializeSubtasksPayload,
  subtasksFromStoredJson
} from '@novacode/shared';

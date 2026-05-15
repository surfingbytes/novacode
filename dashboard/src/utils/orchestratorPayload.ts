// types
import type { OrchestratorSubtasksPayload, SubTask } from '@/@types/index';

export type { OrchestratorSubtasksPayload };

export function parseOrchestratorSubtasksJson(
  json: string | null | undefined
): OrchestratorSubtasksPayload | null {
  if (!json?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      return { sharedContext: '', handoffLog: '', subtasks: parsed as SubTask[] };
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { subtasks?: unknown }).subtasks)
    ) {
      const parsedPayload = parsed as {
        sharedContext?: unknown;
        handoffLog?: unknown;
        subtasks: SubTask[];
      };
      return {
        sharedContext: typeof parsedPayload.sharedContext === 'string' ? parsedPayload.sharedContext : '',
        handoffLog: typeof parsedPayload.handoffLog === 'string' ? parsedPayload.handoffLog : '',
        subtasks: parsedPayload.subtasks
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export function serializeOrchestratorSubtasksPayload(
  payload: OrchestratorSubtasksPayload
): string {
  return JSON.stringify({
    sharedContext: payload.sharedContext,
    handoffLog: payload.handoffLog,
    subtasks: payload.subtasks
  });
}

export function subtasksFromStoredJson(json: string | null | undefined): SubTask[] {
  return parseOrchestratorSubtasksJson(json)?.subtasks ?? [];
}

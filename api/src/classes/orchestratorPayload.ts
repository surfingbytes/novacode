// types
import type { ChatMessage, OrchestratorSubtasksPayload, SubTask } from '../@types/index';

export type { OrchestratorSubtasksPayload };

const MAX_HANDOFF_STEP_CHARS = 6000;
const MAX_TOTAL_HANDOFF_CHARS = 16000;

export function normalizeSubtasksPayload(raw: unknown): OrchestratorSubtasksPayload | null {
  if (Array.isArray(raw)) {
    return { sharedContext: '', handoffLog: '', subtasks: raw as SubTask[] };
  }
  if (raw && typeof raw === 'object' && Array.isArray((raw as { subtasks?: unknown }).subtasks)) {
    const o = raw as { sharedContext?: unknown; handoffLog?: unknown; subtasks: SubTask[] };
    return {
      sharedContext: typeof o.sharedContext === 'string' ? o.sharedContext : '',
      handoffLog: typeof o.handoffLog === 'string' ? o.handoffLog : '',
      subtasks: o.subtasks
    };
  }
  return null;
}

export function parseSubtasksPayloadString(json: string | null | undefined): OrchestratorSubtasksPayload | null {
  if (!json?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    return normalizeSubtasksPayload(parsed);
  } catch {
    return null;
  }
}

export function serializeSubtasksPayload(p: OrchestratorSubtasksPayload): string {
  return JSON.stringify({
    sharedContext: p.sharedContext,
    handoffLog: p.handoffLog,
    subtasks: p.subtasks
  });
}

/** Unique session ids assigned to orchestrator steps (from stored subtasksJson). */
export function collectStepSessionIdsFromSubtasksJson(
  subtasksJson: string | null | undefined
): string[] {
  const payload = parseSubtasksPayloadString(subtasksJson);
  if (!payload?.subtasks.length) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of payload.subtasks) {
    const sid = t.sessionId;
    if (typeof sid !== 'string' || !sid.trim()) {
      continue;
    }
    if (seen.has(sid)) {
      continue;
    }
    seen.add(sid);
    out.push(sid);
  }
  return out;
}

/** Merge PATCH body: legacy array of subtasks keeps existing sharedContext + handoffLog. */
export function mergeSubtasksJsonPatch(
  incomingJson: string | null | undefined,
  existingJson: string | null | undefined
): string | null | undefined {
  if (incomingJson === undefined) {
    return undefined;
  }
  if (incomingJson === null) {
    return null;
  }
  try {
    const incoming = JSON.parse(incomingJson) as unknown;
    if (Array.isArray(incoming)) {
      const prev = parseSubtasksPayloadString(existingJson ?? '');
      return serializeSubtasksPayload({
        sharedContext: prev?.sharedContext ?? '',
        handoffLog: prev?.handoffLog ?? '',
        subtasks: incoming as SubTask[]
      });
    }
    const norm = normalizeSubtasksPayload(incoming);
    if (norm) {
      return serializeSubtasksPayload(norm);
    }
  } catch {
    // fall through
  }
  return incomingJson;
}

function extractAssistantTextFromEvents(events: string[] | undefined): string {
  if (!events?.length) {
    return '';
  }
  let text = '';
  for (const line of events) {
    try {
      const event = JSON.parse(line) as {
        type?: string;
        message?: { content?: Array<{ type?: string; text?: string }> };
      };
      if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
        for (const block of event.message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            text += block.text;
          }
        }
      }
    } catch {
      // skip
    }
  }
  return text.trim();
}

export function buildStepPrompt(task: SubTask, payload: OrchestratorSubtasksPayload): string {
  const parts: string[] = [];
  const sc = payload.sharedContext?.trim();
  if (sc) {
    parts.push(`## Shared plan context (from orchestrator decomposition)\n\n${sc}`);
  }
  const hl = payload.handoffLog?.trim();
  if (hl) {
    parts.push(`## Completed steps — handoff notes\n\n${hl}`);
  }
  const body = task.prompt.trim();
  if (parts.length === 0) {
    return body;
  }
  return `${parts.join('\n\n---\n\n')}\n\n---\n\n## This step\n\n${body}`;
}

export function summarizeStepHandoff(messages: ChatMessage[] | undefined): string {
  if (!messages?.length) {
    return '(no assistant output)';
  }
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  if (!last) {
    return '(no assistant output)';
  }
  let text = last.events?.length ? extractAssistantTextFromEvents(last.events) : '';
  if (!text && typeof last.content === 'string') {
    text = last.content.trim();
  }
  text = text.trim();
  if (!text) {
    return '(no text output)';
  }
  if (text.length > MAX_HANDOFF_STEP_CHARS) {
    return `${text.slice(0, MAX_HANDOFF_STEP_CHARS)}\n…(truncated)`;
  }
  return text;
}

export function appendHandoff(
  existing: string,
  stepNumber: number,
  stepName: string,
  snippet: string
): string {
  const block = `### Step ${stepNumber}: ${stepName}\n\n${snippet}`;
  const next = existing.trim() ? `${existing.trim()}\n\n${block}` : block;
  if (next.length <= MAX_TOTAL_HANDOFF_CHARS) {
    return next;
  }
  return `…(earlier handoff truncated)\n\n${next.slice(-MAX_TOTAL_HANDOFF_CHARS)}`;
}

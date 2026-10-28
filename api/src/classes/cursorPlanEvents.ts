/**
 * Cursor ACP cursor/create_plan and cursor/task extension events.
 */

// classes
import { asRecord, recordHasTrue } from './acpSessionHelpers';
import type { AcpEventHandler } from './acpSessionHelpers';

/** Resolves the event handler for an ACP session id (falls back to the in-flight prompt handler). */
export type CursorEventHandlerResolver = (sessionId: string | null) => AcpEventHandler | undefined;

export interface CursorPlanEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface CursorPlanPayload {
  title?: string;
  markdown?: string;
  entries: CursorPlanEntry[];
}

export function normalizeCursorPlanStatus(status: unknown): CursorPlanEntry['status'] {
  if (typeof status !== 'string') {
    return 'pending';
  }
  const normalized = status.toLowerCase().replace(/^todo_status_/, '');
  if (normalized === 'completed' || normalized === 'done') {
    return 'completed';
  }
  if (normalized === 'in_progress' || normalized === 'in-progress' || normalized === 'running') {
    return 'in_progress';
  }
  return 'pending';
}

export function cursorPlanEntryFromUnknown(value: unknown): CursorPlanEntry | null {
  if (typeof value === 'string') {
    const content = value.trim();
    return content ? { content, status: 'pending' } : null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const obj = value as Record<string, unknown>;
  const rawContent = obj.content ?? obj.text ?? obj.title ?? obj.description ?? obj.name;
  if (typeof rawContent !== 'string') {
    return null;
  }

  const content = rawContent.trim();
  if (!content) {
    return null;
  }

  return {
    content,
    status: normalizeCursorPlanStatus(obj.status),
  };
}

export function stringProp(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function looksLikeRichPlanMarkdown(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  const headingCount = (text.match(/^#{1,3}\s+/gm) ?? []).length;
  const hasPlanSections =
    /^#{1,3}\s+(goal|required order|step\s+\d+|implementation|validation|test plan)\b/im.test(text);
  return headingCount >= 2 || (headingCount >= 1 && hasPlanSections);
}

export function findRichPlanMarkdown(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || value == null) return undefined;
  if (typeof value === 'string') {
    return looksLikeRichPlanMarkdown(value) ? value.trim() : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRichPlanMarkdown(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== 'object') return undefined;

  const obj = value as Record<string, unknown>;
  for (const key of ['markdown', 'content', 'text', 'description', 'body', 'planText', 'planMarkdown']) {
    const found = findRichPlanMarkdown(obj[key], depth + 1);
    if (found) return found;
  }
  for (const nested of Object.values(obj)) {
    const found = findRichPlanMarkdown(nested, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export function extractCursorPlanEntries(params: unknown): CursorPlanEntry[] {
  if (typeof params === 'string' || Array.isArray(params)) {
    const values = Array.isArray(params) ? params : [params];
    return values
      .map(cursorPlanEntryFromUnknown)
      .filter((entry): entry is CursorPlanEntry => entry !== null);
  }

  if (!params || typeof params !== 'object') {
    return [];
  }

  const obj = params as Record<string, unknown>;
  for (const key of ['entries', 'steps', 'todos', 'items', 'plan']) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value
        .map(cursorPlanEntryFromUnknown)
        .filter((entry): entry is CursorPlanEntry => entry !== null);
    }
  }

  if (obj.plan && typeof obj.plan === 'object') {
    const nestedEntries = extractCursorPlanEntries(obj.plan);
    if (nestedEntries.length > 0) {
      return nestedEntries;
    }
  }

  const singleEntry = cursorPlanEntryFromUnknown(obj.plan ?? obj.content ?? obj.text ?? obj.title);
  return singleEntry ? [singleEntry] : [];
}

export function extractCursorPlanPayload(params: unknown): CursorPlanPayload {
  let entries = extractCursorPlanEntries(params);
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return {
      markdown: typeof params === 'string' ? params.trim() : undefined,
      entries,
    };
  }

  const obj = params as Record<string, unknown>;
  const nestedPlan = obj.plan && typeof obj.plan === 'object' && !Array.isArray(obj.plan)
    ? (obj.plan as Record<string, unknown>)
    : null;

  const markdown =
    stringProp(obj, ['markdown', 'content', 'text', 'description', 'body', 'planText', 'planMarkdown']) ??
    (nestedPlan ? stringProp(nestedPlan, ['markdown', 'content', 'text', 'description', 'body', 'planText', 'planMarkdown']) : undefined) ??
    findRichPlanMarkdown(params);
  if (markdown && entries.length === 1 && entries[0]?.content === markdown) {
    entries = [];
  }

  return {
    title: stringProp(obj, ['title', 'name']) ?? (nestedPlan ? stringProp(nestedPlan, ['title', 'name']) : undefined),
    markdown,
    entries,
  };
}

export function emitCursorTaskActivity(
  params: unknown,
  getSessionId: () => string | null,
  resolveHandler: CursorEventHandlerResolver
): void {
  const sessionId = getSessionId();
  const handler = resolveHandler(sessionId);
  if (!handler) return;

  const payload =
    params && typeof params === 'object' && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  handler(
    JSON.stringify({
      type: 'cursor_task',
      sessionId,
      ...payload,
    })
  );
}

export function emitCursorPlanRequest(
  params: unknown,
  getSessionId: () => string | null,
  resolveHandler: CursorEventHandlerResolver
): void {
  const plan = extractCursorPlanPayload(params);
  if (plan.entries.length === 0 && !plan.markdown) {
    return;
  }

  const sessionId = getSessionId();
  const handler = resolveHandler(sessionId);
  if (!handler) {
    return;
  }

  handler(
    JSON.stringify({
      sessionId,
      update: {
        sessionUpdate: 'plan',
        entries: plan.entries,
        title: plan.title,
        markdown: plan.markdown,
      },
    })
  );
}

/**
 * Cursor ACP often emits Task tool_calls with empty `rawInput: {}`. Prefer title
 * (`Task: …`) and background flags over rawInput field names.
 */
export function isAcpTaskToolCall(update: Record<string, unknown>): boolean {
  const rawInput = asRecord(update.rawInput);
  if (
    rawInput?._toolName === 'task' ||
    rawInput?.toolName === 'task' ||
    rawInput?.name === 'task' ||
    typeof rawInput?.agent_type === 'string' ||
    typeof rawInput?.agentType === 'string' ||
    typeof rawInput?.subagent_type === 'string' ||
    typeof rawInput?.subagentType === 'string' ||
    recordHasTrue(rawInput, ['run_in_background', 'runInBackground', 'is_background', 'isBackground'])
  ) {
    return true;
  }
  const title = typeof update.title === 'string' ? update.title.trim() : '';
  return /^task\b/i.test(title);
}

export function isAcpTaskBackgroundLaunch(update: Record<string, unknown>): boolean {
  return (
    recordHasTrue(asRecord(update.rawOutput), ['isBackground', 'is_background']) ||
    recordHasTrue(asRecord(update.rawInput), [
      'run_in_background',
      'runInBackground',
      'is_background',
      'isBackground',
    ])
  );
}

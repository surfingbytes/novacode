/**
 * Cursor ACP cursor/update_todos extension: parsing, merge semantics and synthetic tool_call events.
 */

// classes
import type { CursorEventHandlerResolver } from './cursorPlanEvents';

/** Cursor ACP cursor/update_todos item. */
export interface CursorTodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface CursorUpdateTodosParams {
  toolCallId: string;
  todos: CursorTodoItem[];
  merge: boolean;
}

/** Last accepted todos from cursor/update_todos, keyed by ACP session id (survives per-turn subprocess restarts). */
const cursorTodoStateBySession = new Map<string, CursorTodoItem[]>();

export function normalizeCursorTodoStatus(status: unknown): CursorTodoItem['status'] {
  if (typeof status !== 'string') return 'pending';
  const normalized = status.toLowerCase().replace(/^todo_status_/, '').replace(/[\s-]+/g, '_');
  if (normalized === 'completed' || normalized === 'done') return 'completed';
  if (normalized === 'in_progress' || normalized === 'active' || normalized === 'running') {
    return 'in_progress';
  }
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  return 'pending';
}

export function parseCursorTodoItem(value: unknown): CursorTodoItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id.trim()) return null;
  const content =
    typeof obj.content === 'string'
      ? obj.content.trim()
      : typeof obj.title === 'string'
        ? obj.title.trim()
        : typeof obj.text === 'string'
          ? obj.text.trim()
          : '';
  if (!content) return null;
  return {
    id: obj.id,
    content,
    status: normalizeCursorTodoStatus(obj.status),
  };
}

export function parseCursorUpdateTodosParams(params: unknown): CursorUpdateTodosParams | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const obj = params as Record<string, unknown>;
  if (typeof obj.toolCallId !== 'string' || !obj.toolCallId.trim()) return null;
  if (!Array.isArray(obj.todos)) return null;

  const todos: CursorTodoItem[] = [];
  for (const raw of obj.todos) {
    const item = parseCursorTodoItem(raw);
    if (!item) return null;
    todos.push(item);
  }

  return {
    toolCallId: obj.toolCallId,
    todos,
    merge: obj.merge === true,
  };
}

/** Apply Cursor merge semantics: replace when merge=false; upsert by id when merge=true. */
export function mergeCursorTodos(
  existing: CursorTodoItem[],
  incoming: CursorTodoItem[],
  merge: boolean
): CursorTodoItem[] {
  if (!merge) return incoming.map((todo) => ({ ...todo }));

  const byId = new Map<string, CursorTodoItem>();
  for (const todo of existing) {
    byId.set(todo.id, { ...todo });
  }
  for (const todo of incoming) {
    byId.set(todo.id, { ...todo });
  }

  const ordered: CursorTodoItem[] = [];
  const seen = new Set<string>();
  for (const todo of existing) {
    const next = byId.get(todo.id);
    if (!next || seen.has(todo.id)) continue;
    ordered.push(next);
    seen.add(todo.id);
  }
  for (const todo of incoming) {
    if (seen.has(todo.id)) continue;
    ordered.push({ ...todo });
    seen.add(todo.id);
  }
  return ordered;
}

/**
 * Emit synthetic ACP tool_call(+update) events so dashboard/shared parsers surface
 * todos in the existing Tasks panel (latest todos display item wins).
 */
export function emitCursorTodosUpdate(
  params: CursorUpdateTodosParams,
  acceptedTodos: CursorTodoItem[],
  getSessionId: () => string | null,
  resolveHandler: CursorEventHandlerResolver
): void {
  const sessionId = getSessionId();
  const handler = resolveHandler(sessionId);
  if (!handler) return;

  const rawInput = { todos: acceptedTodos };
  handler(
    JSON.stringify({
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: params.toolCallId,
        title: 'Update Todos',
        kind: 'other',
        status: 'pending',
        rawInput,
      },
    })
  );
  handler(
    JSON.stringify({
      sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: params.toolCallId,
        status: 'completed',
        rawInput,
      },
    })
  );
}

export function handleCursorUpdateTodos(
  params: unknown,
  getSessionId: () => string | null,
  resolveHandler: CursorEventHandlerResolver
): {
  outcome:
    | { outcome: 'accepted'; todos: CursorTodoItem[] }
    | { outcome: 'rejected'; reason: string }
    | { outcome: 'cancelled' };
} {
  const parsed = parseCursorUpdateTodosParams(params);
  if (!parsed) {
    return {
      outcome: { outcome: 'rejected', reason: 'Invalid update_todos request.' },
    };
  }

  const sessionId = getSessionId();
  const existing = sessionId ? (cursorTodoStateBySession.get(sessionId) ?? []) : [];
  const acceptedTodos = mergeCursorTodos(existing, parsed.todos, parsed.merge);

  if (sessionId) {
    cursorTodoStateBySession.set(sessionId, acceptedTodos);
  }

  emitCursorTodosUpdate(parsed, acceptedTodos, getSessionId, resolveHandler);

  return {
    outcome: {
      outcome: 'accepted',
      todos: acceptedTodos,
    },
  };
}

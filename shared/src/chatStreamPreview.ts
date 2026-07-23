/**
 * Derives a short plain-text preview from agent stream event lines.
 * Used for push notification bodies and session list previews when the
 * assistant ends on a tool call.
 *
 * Handles two event shapes:
 *  1. ACP native — { sessionId, update: { sessionUpdate, … } }  (Claude, Mistral, any ACP agent)
 *  2. Cursor-style legacy — { type: "assistant"|"tool_call", … }
 *
 * Canonical home: @novacode/shared. This module previously existed as two
 * hand-synced copies (api + dashboard) that had drifted — this version is the
 * superset of both (adds Vibe `role: "tool"` results and richer glob summaries,
 * which the API copy lacked, so notification previews missed those).
 */

// ---------------------------------- Types ----------------------------------

export interface TodoDisplayItem {
  id: string;
  content: string;
  status: string;
}

export interface StreamDisplayItem {
  kind: 'text' | 'tool' | 'todos' | 'plan';
  text?: string;
  callId?: string;
  toolName?: string;
  toolSummary?: string;
  status?: 'running' | 'success' | 'rejected';
  todoItems?: TodoDisplayItem[];
  planEntries?: Array<{ content: string; status: string }>;
}

// ---------------------------------- ACP helpers ----------------------------------

/** Mirrors the dashboard parser: normalizes agent todo statuses to TODO_STATUS_*. */
function normalizeTodoStatus(status: unknown): string {
  if (typeof status !== 'string' || !status.trim()) {
    return 'TODO_STATUS_PENDING';
  }
  const trimmed = status.trim();
  if (trimmed.startsWith('TODO_STATUS_')) {
    return trimmed;
  }
  const normalized = trimmed.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'completed' || normalized === 'done') {
    return 'TODO_STATUS_COMPLETED';
  }
  if (normalized === 'in_progress' || normalized === 'active') {
    return 'TODO_STATUS_IN_PROGRESS';
  }
  if (normalized === 'cancelled' || normalized === 'canceled') {
    return 'TODO_STATUS_CANCELLED';
  }
  return 'TODO_STATUS_PENDING';
}

/**
 * Unwraps an ACP rawInput/rawOutput carrier into an object that may hold a
 * `todos` array. Most adapters send structured objects; vibe-acp serializes
 * tool args/results with pydantic's model_dump_json(), i.e. a JSON *string*.
 */
function todosCarrierFromRaw(raw: unknown): { todos?: unknown } | null {
  if (!raw || typeof raw !== 'object') {
    if (typeof raw !== 'string' || !raw.includes('todos')) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as { todos?: unknown })
        : null;
    } catch {
      return null;
    }
  }
  return raw as { todos?: unknown };
}

/**
 * Extracts a todo list from an ACP tool_call / tool_call_update payload when the
 * tool carries one (rawInput.todos / rawOutput.todos) — e.g. Claude's TodoWrite.
 * Returns null for non-todo tools.
 */
function todosFromAcpUpdate(update: Record<string, unknown>): TodoDisplayItem[] | null {
  const rawInput = todosCarrierFromRaw(update.rawInput);
  const rawOutput = todosCarrierFromRaw(update.rawOutput);
  const rawTodos = Array.isArray(rawInput?.todos)
    ? rawInput.todos
    : Array.isArray(rawOutput?.todos)
      ? rawOutput.todos
      : null;
  if (!rawTodos) {
    return null;
  }
  const items: TodoDisplayItem[] = [];
  for (let index = 0; index < rawTodos.length; index++) {
    const raw = rawTodos[index];
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const candidate = raw as {
      id?: unknown;
      content?: unknown;
      status?: unknown;
    };
    if (typeof candidate.content !== 'string' || !candidate.content.trim()) {
      continue;
    }
    items.push({
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `todo-${index}`,
      content: candidate.content,
      status: normalizeTodoStatus(candidate.status)
    });
  }
  return items;
}

function acpKindToToolName(kind: string | undefined): string {
  const names: Record<string, string> = {
    read: 'Read',
    edit: 'Edit',
    delete: 'Delete',
    move: 'Move',
    search: 'Search',
    execute: 'Shell',
    think: 'Think',
    fetch: 'Fetch',
    switch_mode: 'Mode',
    other: 'Tool'
  };
  return names[kind ?? ''] ?? 'Tool';
}

function processAcpUpdate(update: Record<string, unknown>, items: StreamDisplayItem[]): void {
  const sessionUpdate = update.sessionUpdate as string | undefined;

  if (sessionUpdate === 'agent_message_chunk') {
    const content = update.content as { type?: string; text?: string } | undefined;
    // Keep whitespace-only chunks mid-message (table padding, code indentation);
    // skip them only when they would start a new text item.
    if (
      content?.type === 'text' &&
      typeof content.text === 'string' &&
      (content.text.trim() || items[items.length - 1]?.kind === 'text')
    ) {
      appendAssistantTextChunk(content.text, items);
    }
    return;
  }

  if (sessionUpdate === 'tool_call') {
    const toolCallId = update.toolCallId as string | undefined;
    if (!toolCallId) {
      return;
    }
    const todoItems = todosFromAcpUpdate(update);
    if (todoItems?.length) {
      items.push({
        kind: 'todos',
        callId: toolCallId,
        status: 'running',
        todoItems
      });
      return;
    }
    items.push({
      kind: 'tool',
      callId: toolCallId,
      toolName: acpKindToToolName(update.kind as string | undefined),
      toolSummary: String(update.title ?? ''),
      status: 'running'
    });
    return;
  }

  if (sessionUpdate === 'tool_call_update') {
    const toolCallId = update.toolCallId as string | undefined;
    if (!toolCallId) {
      return;
    }
    const item = items.find(
      (i) => (i.kind === 'tool' || i.kind === 'todos') && i.callId === toolCallId
    );
    if (!item) {
      return;
    }
    const status = update.status as string | undefined;
    if (status === 'completed') {
      item.status = 'success';
    } else if (status === 'failed') {
      item.status = 'rejected';
    }
    if (item.kind === 'todos') {
      const updatedTodos = todosFromAcpUpdate(update);
      if (updatedTodos?.length) {
        item.todoItems = updatedTodos;
      }
    }
    if (item.kind === 'tool') {
      // Late todos (e.g. vibe's todo 'read' action): adopt the todos row.
      const lateTodos = todosFromAcpUpdate(update);
      if (lateTodos?.length) {
        item.kind = 'todos';
        item.todoItems = lateTodos;
        item.toolName = undefined;
        item.toolSummary = undefined;
        return;
      }
    }
    if (item.kind === 'tool' && typeof update.title === 'string') {
      item.toolSummary = update.title;
    }
    return;
  }

  if (sessionUpdate === 'plan') {
    const entries = update.entries as Array<{ content: string; status: string }> | undefined;
    if (!entries?.length) {
      return;
    }
    const existing = items.find((i) => i.kind === 'plan');
    if (existing) {
      existing.planEntries = entries;
    } else {
      items.push({ kind: 'plan', planEntries: entries });
    }
    return;
  }

  // usage_update is UI-only; no action needed for previews.
}

// ---------------------------------- Legacy cursor-style helpers ----------------------------------
// Kept for historical sessions that stored cursor-style event lines.

const TOOL_META: Record<string, { name: string }> = {
  readToolCall: { name: 'Read' },
  globToolCall: { name: 'Glob' },
  grepToolCall: { name: 'Grep' },
  editToolCall: { name: 'Edit' },
  shellToolCall: { name: 'Shell' },
  deleteToolCall: { name: 'Delete' },
  updateTodosToolCall: { name: 'Todos' }
};

const VIBE_TOOL_META: Record<string, { name: string }> = {
  write_file: { name: 'Write' },
  edit_file: { name: 'Edit' },
  read_file: { name: 'Read' },
  list_directory: { name: 'Glob' },
  search_files: { name: 'Grep' },
  run_command: { name: 'Shell' },
  delete_file: { name: 'Delete' }
};

function getToolSummary(toolCallName: string, toolCallObj: Record<string, unknown>): string {
  const call = (toolCallObj[toolCallName] ?? {}) as Record<string, unknown>;
  const args = (call.args ?? {}) as Record<string, unknown>;
  switch (toolCallName) {
    case 'readToolCall':
      return String(args.path ?? '');
    case 'globToolCall': {
      const pattern = String(args.globPattern ?? '');
      const targetDirectory = String(args.targetDirectory ?? '');
      const base = [pattern, targetDirectory].filter(Boolean).join(' in ') || '—';
      const result = (call.result ?? {}) as Record<string, unknown>;
      const success = result.success as Record<string, unknown> | undefined;
      const files = Array.isArray(success?.files) ? (success.files as string[]) : [];
      if (files.length === 0 && !('success' in result)) {
        return base;
      }
      if (files.length > 10) {
        return `${base} → ${files.length} files`;
      }
      if (files.length > 0) {
        return `${base} → ${files.length} file${files.length === 1 ? '' : 's'}: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '…' : ''}`;
      }
      return `${base} → 0 files`;
    }
    case 'grepToolCall':
      return `"${args.pattern}"  ${args.path ?? ''}`;
    case 'editToolCall':
      return String(args.path ?? '');
    case 'shellToolCall':
      return String(call.description ?? args.command ?? '');
    case 'deleteToolCall':
      return String(args.path ?? '');
    case 'updateTodosToolCall': {
      const todos = args.todos as Array<{ status?: string }> | undefined;
      if (!todos?.length) {
        return '';
      }
      const completedCount = todos.filter((todo) => todo.status === 'TODO_STATUS_COMPLETED').length;
      return `${completedCount}/${todos.length} completed`;
    }
    default:
      return '';
  }
}

function isToolResultSuccess(toolCallObj: Record<string, unknown>): boolean {
  const toolCallName = Object.keys(toolCallObj)[0];
  if (!toolCallName) {
    return false;
  }
  const call = (toolCallObj[toolCallName] ?? {}) as Record<string, unknown>;
  const result = (call.result ?? {}) as Record<string, unknown>;
  return 'success' in result;
}

// ---------------------------------- Shared merge helper ----------------------------------

/**
 * ACP `agent_message_chunk` content is a sequential increment — the reference
 * SDK's readText() plain-appends it. Boundary dedup corrupts content that
 * legitimately repeats (table separator rows, code indentation), so ACP chunks
 * are appended verbatim. The defensive merge below stays for legacy
 * cursor-style/Vibe events, whose payloads are cumulative snapshots.
 */
function appendAssistantTextChunk(assistantText: string, items: StreamDisplayItem[]): void {
  const lastItem = items[items.length - 1];
  if (lastItem?.kind === 'text') {
    lastItem.text = (lastItem.text ?? '') + assistantText;
    return;
  }
  items.push({ kind: 'text', text: assistantText });
}

export function mergeAssistantTextIntoDisplayItems(
  assistantText: string,
  items: StreamDisplayItem[]
): void {
  const lastItem = items[items.length - 1];
  if (lastItem?.kind === 'text') {
    const previousText = lastItem.text ?? '';
    if (!assistantText || assistantText === previousText) {
      return;
    }
    if (previousText.startsWith(assistantText)) {
      return;
    }
    if (assistantText.startsWith(previousText)) {
      lastItem.text = assistantText;
      return;
    }
    if (previousText.endsWith(assistantText)) {
      return;
    }
    let overlap = 0;
    const maxOverlap = Math.min(previousText.length, assistantText.length);
    for (let len = maxOverlap; len > 0; len -= 1) {
      if (previousText.endsWith(assistantText.slice(0, len))) {
        overlap = len;
        break;
      }
    }
    lastItem.text = previousText + assistantText.slice(overlap);
    return;
  }
  items.push({ kind: 'text', text: assistantText });
}

// ---------------------------------- Event line processor ----------------------------------

function processEventLine(line: string, items: StreamDisplayItem[]): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  // ── ACP native format (any ACP agent: Claude, Mistral, …) ──────────────────
  if (typeof event.sessionId === 'string' && event.update && typeof event.update === 'object') {
    processAcpUpdate(event.update as Record<string, unknown>, items);
    return;
  }

  // ── Legacy cursor-style format (kept for historical session data) ───────────

  for (let i = 0; i < 3; i += 1) {
    if (event.type !== 'stream' || typeof event.data !== 'string') {
      break;
    }
    const nested = event.data.trim();
    if (!nested) {
      return;
    }
    try {
      event = JSON.parse(nested) as Record<string, unknown>;
    } catch {
      break;
    }
  }

  if (event.type === 'thinking') {
    return;
  }

  let assistantText = '';
  if (
    event.type === 'assistant' &&
    Array.isArray((event.message as Record<string, unknown>)?.content)
  ) {
    const content = (event.message as Record<string, unknown>).content as Array<{
      type: string;
      text?: string;
    }>;
    assistantText = content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
  } else if (
    (event.role === 'assistant' || event.type === 'assistant') &&
    typeof event.content === 'string'
  ) {
    assistantText = event.content;
  }

  if (assistantText) {
    if (!assistantText.trim()) {
      return;
    }
    mergeAssistantTextIntoDisplayItems(assistantText, items);
    return;
  }

  if (event.role === 'tool' && typeof event.content === 'string') {
    const toolNameRaw = typeof event.name === 'string' ? event.name : 'tool';
    const meta = VIBE_TOOL_META[toolNameRaw] ?? { name: toolNameRaw };
    const summary = event.content.replace(/\s+/g, ' ').trim();
    const toolSummary = summary.length > 220 ? `${summary.slice(0, 220)}...` : summary;
    const callId =
      typeof event.tool_call_id === 'string' && event.tool_call_id
        ? event.tool_call_id
        : `vibe-${toolNameRaw}-${items.length}`;
    const existing = items.find((i) => i.kind === 'tool' && i.callId === callId);
    if (existing && existing.kind === 'tool') {
      existing.toolSummary = toolSummary || existing.toolSummary;
      existing.status = 'success';
      existing.toolName = meta.name;
    } else {
      items.push({
        kind: 'tool',
        callId,
        toolName: meta.name,
        toolSummary,
        status: 'success'
      });
    }
    return;
  }

  if (event.type === 'tool_call') {
    const toolCallObj = (event.tool_call ?? {}) as Record<string, unknown>;
    const toolCallName = Object.keys(toolCallObj)[0] ?? '';
    const meta = TOOL_META[toolCallName] ?? { name: toolCallName };

    if (event.subtype === 'started') {
      if (toolCallName === 'updateTodosToolCall') {
        const call = (toolCallObj[toolCallName] ?? {}) as Record<string, unknown>;
        const args = (call.args ?? {}) as Record<string, unknown>;
        const rawTodos = (args.todos ?? []) as Array<{
          id: string;
          content: string;
          status: string;
        }>;
        items.push({
          kind: 'todos',
          callId: event.call_id as string,
          status: 'running',
          todoItems: rawTodos.map((t) => ({
            id: t.id,
            content: t.content,
            status: t.status
          }))
        });
      } else {
        items.push({
          kind: 'tool',
          callId: event.call_id as string,
          toolName: meta.name,
          toolSummary: getToolSummary(toolCallName, toolCallObj),
          status: 'running'
        });
      }
    } else if (event.subtype === 'completed') {
      const item = items.find(
        (i) => (i.kind === 'tool' || i.kind === 'todos') && i.callId === event.call_id
      );
      if (item) {
        item.status = isToolResultSuccess(toolCallObj) ? 'success' : 'rejected';
        if (item.kind === 'tool') {
          item.toolSummary = getToolSummary(toolCallName, toolCallObj);
        }
        if (toolCallName === 'updateTodosToolCall' && item.kind === 'todos') {
          const call = (toolCallObj[toolCallName] ?? {}) as Record<string, unknown>;
          const result = (call.result ?? {}) as Record<string, unknown>;
          const success = (result.success ?? {}) as Record<string, unknown>;
          const finalTodos = (success.todos ?? []) as Array<{
            id: string;
            content: string;
            status: string;
          }>;
          if (finalTodos.length) {
            item.todoItems = finalTodos.map((todo) => ({
              id: todo.id,
              content: todo.content,
              status: todo.status
            }));
          }
        }
      }
    }
  }
}

export function parseStreamEventsToDisplayItems(events: string[]): StreamDisplayItem[] {
  const items: StreamDisplayItem[] = [];
  for (const line of events) {
    processEventLine(line, items);
  }
  return items;
}

/** Last user-visible chunk: final assistant text, or last tool/todos row if the model stopped after tools. */
function tailPreviewFromDisplayItems(items: StreamDisplayItem[]): string {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.kind === 'text' && item.text?.trim()) {
      return item.text.trim();
    }
    if (item.kind === 'tool' && item.toolSummary?.trim()) {
      const name = item.toolName?.trim();
      const sum = item.toolSummary.trim();
      return name ? `${name}: ${sum}` : sum;
    }
    if (item.kind === 'todos' && item.todoItems?.length) {
      const done = item.todoItems.filter((todo) => todo.status === 'TODO_STATUS_COMPLETED').length;
      const total = item.todoItems.length;
      return `Todos: ${done}/${total} completed`;
    }
    if (item.kind === 'plan' && item.planEntries?.length) {
      const done = item.planEntries.filter((e) => e.status === 'completed').length;
      const total = item.planEntries.length;
      return `Plan: ${done}/${total} completed`;
    }
  }
  return '';
}

export function extractStreamNotificationPreview(events: string[]): string {
  return tailPreviewFromDisplayItems(parseStreamEventsToDisplayItems(events));
}

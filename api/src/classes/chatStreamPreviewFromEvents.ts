/**
 * Derives a short plain-text preview from agent stream event lines.
 * Used for push notification bodies and session list previews when the
 * assistant ends on a tool call.
 *
 * Handles two event shapes:
 *  1. ACP native — { sessionId, update: { sessionUpdate, … } }  (Claude, Mistral, any ACP agent)
 *  2. Cursor-style legacy — { type: "assistant"|"tool_call", … }
 *
 * Dashboard copy: app/dashboard/src/utils/chatStreamPreviewFromEvents.ts (keep in sync).
 */

// ---------------------------------- Types ----------------------------------

interface TodoDisplayItem {
  id: string;
  content: string;
  status: string;
}

interface DisplayItem {
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
    other: 'Tool',
  };
  return names[kind ?? ''] ?? 'Tool';
}

function processAcpUpdate(update: Record<string, unknown>, items: DisplayItem[]): void {
  const sessionUpdate = update.sessionUpdate as string | undefined;

  if (sessionUpdate === 'agent_message_chunk') {
    const content = update.content as { type?: string; text?: string } | undefined;
    if (content?.type === 'text' && content.text?.trim()) {
      mergeAssistantTextIntoDisplayItems(content.text, items);
    }
    return;
  }

  if (sessionUpdate === 'tool_call') {
    const toolCallId = update.toolCallId as string | undefined;
    if (!toolCallId) {
      return;
    }
    items.push({
      kind: 'tool',
      callId: toolCallId,
      toolName: acpKindToToolName(update.kind as string | undefined),
      toolSummary: String(update.title ?? ''),
      status: 'running',
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
    if (item.kind === 'tool' && typeof update.title === 'string') {
      item.toolSummary = update.title;
    }
    return;
  }

  if (sessionUpdate === 'plan') {
    const entries = update.entries as Array<{ content: string; status: string }> | undefined;
    if (!entries?.length) return;
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
  updateTodosToolCall: { name: 'Todos' },
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
      return [pattern, targetDirectory].filter(Boolean).join(' in ') || '—';
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
      const completed = todos.filter((t) => t.status === 'TODO_STATUS_COMPLETED').length;
      return `${completed}/${todos.length} completed`;
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

function mergeAssistantTextIntoDisplayItems(assistantText: string, items: DisplayItem[]): void {
  const lastItem = items[items.length - 1];
  if (lastItem?.kind === 'text') {
    const previousText = lastItem.text ?? '';
    if (assistantText === previousText) {
      return;
    }
    if (assistantText.startsWith(previousText)) {
      lastItem.text = assistantText;
      return;
    }
    lastItem.text = previousText + assistantText;
    return;
  }
  items.push({ kind: 'text', text: assistantText });
}

// ---------------------------------- Event line processor ----------------------------------

function processEventLine(line: string, items: DisplayItem[]): void {
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

  // Unwrap nested `{ type: "stream", data: "<json>" }` envelopes
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

  if (event.type === 'tool_call') {
    const toolCallObj = (event.tool_call ?? {}) as Record<string, unknown>;
    const toolCallName = Object.keys(toolCallObj)[0] ?? '';
    const meta = TOOL_META[toolCallName] ?? { name: toolCallName };

    if (event.subtype === 'started') {
      items.push({
        kind: 'tool',
        callId: event.call_id as string,
        toolName: meta.name,
        toolSummary: getToolSummary(toolCallName, toolCallObj),
        status: 'running',
      });
    } else if (event.subtype === 'completed') {
      const item = items.find(
        (i) => (i.kind === 'tool' || i.kind === 'todos') && i.callId === event.call_id
      );
      if (item) {
        item.status = isToolResultSuccess(toolCallObj) ? 'success' : 'rejected';
        if (item.kind === 'tool') {
          item.toolSummary = getToolSummary(toolCallName, toolCallObj);
        }
      }
    }
  }
}

function parseEventsToItems(events: string[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const line of events) {
    processEventLine(line, items);
  }
  return items;
}

function tailPreviewFromDisplayItems(items: DisplayItem[]): string {
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
      const done = item.todoItems.filter((t) => t.status === 'TODO_STATUS_COMPLETED').length;
      return `Todos: ${done}/${item.todoItems.length} completed`;
    }
    if (item.kind === 'plan' && item.planEntries?.length) {
      const done = item.planEntries.filter((e) => e.status === 'completed').length;
      return `Plan: ${done}/${item.planEntries.length} completed`;
    }
  }
  return '';
}

export function extractStreamNotificationPreview(events: string[]): string {
  return tailPreviewFromDisplayItems(parseEventsToItems(events));
}

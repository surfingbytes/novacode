/**
 * Chat display-item pipeline — converts agent stream event lines (ACP native,
 * legacy cursor-style, Vibe) into render-ready DisplayItems.
 *
 * Extracted from SessionChat.vue (previously ~900 lines inline). Pure logic:
 * all side effects (live thinking text, token usage, agent config sync) go
 * through the ChatStreamParserHooks passed to createChatStreamParser().
 */

// types
import type { ClaudePlanUsageWindow, TodoDisplayItem } from '@novacode/shared';
import type { DisplayItem, PlanEntry, ToolDiff } from './chatDisplayTypes';

// utils
import { renderMd, renderMdCached } from './chatMarkdown';
import { parseClaudeRateLimitMeta } from './claudePlanUsageDisplay';
import { isPlanEntryCompleted, markdownFromPlanEntries } from './planDocuments';
import {
  appendAssistantTextChunk,
  getToolSummary,
  isToolResultSuccess,
  mergeAssistantTextIntoDisplayItems,
  mergeStreamingTextChunks,
  resolvePlanDisplayTitle,
  todosFromAcpUpdate
} from '@novacode/shared';

// Parser helpers live in @novacode/shared; re-exported for existing importers.
export type { TodoDisplayItem };
export { mergeStreamingTextChunks };

// ---------------------------------- Types ----------------------------------

/** Tool-call traces in the transcript (generic tools + compact todos). */
export function isToolCallDisplayItem(item: DisplayItem): boolean {
  return item.kind === 'tool' || item.kind === 'todos';
}

/** Raw path from a tool card (locations first, then a summary that looks like a path). */
export function filePathFromToolItem(item: DisplayItem): string | null {
  if (item.kind !== 'tool') {
    return null;
  }
  const fromLocation = item.locations?.find((location) => location.path?.trim())?.path?.trim();
  if (fromLocation) {
    return fromLocation;
  }
  const summary = item.toolSummary?.trim() ?? '';
  if (!summary || summary.startsWith('"') || summary.includes(' → ') || summary.includes('*')) {
    return null;
  }
  const firstToken = summary.split(/\s+/)[0] ?? '';
  if (!firstToken.includes('/') && !/\.\w+$/.test(firstToken)) {
    return null;
  }
  return firstToken;
}

export interface StreamUsage {
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
  /** Claude subscription windows from `_meta["_claude/rateLimit"]`, when reported. */
  planWindows?: Record<string, ClaudePlanUsageWindow>;
}

function textFromAcpToolContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (obj.type === 'text' && typeof obj.text === 'string') {
      parts.push(obj.text);
      continue;
    }
    if (obj.type === 'content' && obj.content && typeof obj.content === 'object') {
      const inner = obj.content as Record<string, unknown>;
      if (inner.type === 'text' && typeof inner.text === 'string') {
        parts.push(inner.text);
      }
    }
  }
  return parts.join('');
}

/** Appends ACP `diff` content entries to the tool item, skipping malformed and identical ones. */
function mergeToolDiffs(item: DisplayItem, content: unknown): void {
  if (!Array.isArray(content)) {
    return;
  }
  for (const entry of content) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const obj = entry as Record<string, unknown>;
    if (obj.type !== 'diff' || typeof obj.path !== 'string' || typeof obj.newText !== 'string') {
      continue;
    }
    const diff: ToolDiff = {
      path: obj.path,
      oldText: typeof obj.oldText === 'string' ? obj.oldText : null,
      newText: obj.newText
    };
    const bDuplicate = item.toolDiffs?.some(
      (existing) =>
        existing.path === diff.path && existing.oldText === diff.oldText && existing.newText === diff.newText
    );
    if (!bDuplicate) {
      item.toolDiffs = [...(item.toolDiffs ?? []), diff];
    }
  }
}

/** Full plan body from ExitPlanMode / Approve Plan tool calls (not task-list plan updates). */
function planMarkdownFromToolUpdate(update: Record<string, unknown>): string | undefined {
  const name = typeof update.name === 'string' ? update.name : '';
  const title = typeof update.title === 'string' ? update.title.trim() : '';
  const rawInput =
    update.rawInput && typeof update.rawInput === 'object' && !Array.isArray(update.rawInput)
      ? (update.rawInput as Record<string, unknown>)
      : null;
  const fromInput = typeof rawInput?.plan === 'string' ? rawInput.plan.trim() : '';
  const fromContent = textFromAcpToolContent(update.content).trim();
  const isPlanTool =
    name === 'ExitPlanMode' ||
    title === 'Approve Plan' ||
    title === 'Exited Plan Mode' ||
    !!fromInput;
  if (!isPlanTool) return undefined;
  return fromInput || fromContent || undefined;
}

function upsertPlanMarkdown(
  items: DisplayItem[],
  markdown: string,
  title: string | undefined,
  sourceSessionId: string | undefined
): void {
  const planTitle = resolvePlanDisplayTitle(title, markdown);
  const existing = items.find((item) => item.kind === 'plan');
  if (existing) {
    existing.planMarkdown = markdown;
    existing.planTitle = planTitle ?? existing.planTitle;
    existing.planSourceSessionId = sourceSessionId ?? existing.planSourceSessionId;
    return;
  }
  items.push({
    kind: 'plan',
    planSourceSessionId: sourceSessionId,
    planEntries: [],
    planTitle,
    planMarkdown: markdown
  });
}

// ---------------------------------- Tool metadata ----------------------------------

const TOOL_META: Record<string, { name: string; icon: string }> = {
  readToolCall: { name: 'Read', icon: 'description' },
  globToolCall: { name: 'Glob', icon: 'travel_explore' },
  grepToolCall: { name: 'Grep', icon: 'manage_search' },
  editToolCall: { name: 'Edit', icon: 'edit' },
  shellToolCall: { name: 'Shell', icon: 'terminal' },
  deleteToolCall: { name: 'Delete', icon: 'delete' },
  updateTodosToolCall: { name: 'Todos', icon: 'checklist' }
};

const VIBE_TOOL_META: Record<string, { name: string; icon: string }> = {
  write_file: { name: 'Write', icon: 'edit' },
  edit_file: { name: 'Edit', icon: 'edit' },
  read_file: { name: 'Read', icon: 'description' },
  list_directory: { name: 'Glob', icon: 'travel_explore' },
  search_files: { name: 'Grep', icon: 'manage_search' },
  run_command: { name: 'Shell', icon: 'terminal' },
  delete_file: { name: 'Delete', icon: 'delete' }
};

const ACP_KIND_TO_NAME: Record<string, string> = {
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

const ACP_KIND_TO_ICON: Record<string, string> = {
  read: 'description',
  edit: 'edit',
  delete: 'delete',
  move: 'drive_file_move',
  search: 'manage_search',
  execute: 'terminal',
  think: 'psychology',
  fetch: 'cloud_download',
  switch_mode: 'tune',
  other: 'build'
};

export function getToolIconSvg(icon: string): string {
  const paths: Record<string, string> = {
    description:
      '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    edit: '<path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/>',
    delete:
      '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
    drive_file_move:
      '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M9 15l3-3 3 3"/><line x1="12" y1="12" x2="12" y2="18"/>',
    manage_search:
      '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/><path d="M9 11h4M11 9v4"/>',
    travel_explore: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    psychology:
      '<path d="M9 12a3 3 0 006 0 3 3 0 00-6 0"/><path d="M12 2a7 7 0 00-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 002 2h4a2 2 0 002-2v-2.26A7 7 0 0012 2z"/>',
    cloud_download:
      '<polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29"/>',
    tune: '<path d="M4 21V14M4 10V3M12 21V12M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    checklist:
      '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12l2 2 4-4"/>',
    build:
      '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>'
  };
  const d = paths[icon] ?? paths.build;
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

// ---------------------------------- Text merge helpers ----------------------------------

function shouldKeepAssistantTextChunk(assistantText: string, items: DisplayItem[]): boolean {
  return Boolean(assistantText.trim() || items[items.length - 1]?.kind === 'text');
}

// ---------------------------------- Parser hooks ----------------------------------

export type AgentThoughtChunkContent = {
  type?: string;
  text?: string;
  annotations?: {
    _meta?: {
      heartbeat?: boolean;
      elapsedSeconds?: number;
    };
  };
};

/** Side effects the parser needs, injected by the caller (useChatSocket). */
export interface ChatStreamParserHooks {
  /** Live thinking stream text (read + written) */
  thinkingText?: { value: string };
  /** Live token-usage meter (written) */
  usage?: { value: StreamUsage | null };
  isThinkingHidden?: () => boolean;
  onModeUpdate?: (modeId: string) => void;
  onModelUpdate?: (modelId: string) => void;
  onConfigUpdate?: (config: Record<string, string>) => void;
}

export interface ProcessEventLineOptions {
  liveThinking?: boolean;
  applyConfigSync?: boolean;
}

// ---------------------------------- Parser ----------------------------------

export function createChatStreamParser(hooks: ChatStreamParserHooks = {}) {
  /** First file path of each ACP tool call — Claude sends it only on the initial tool_call. */
  const toolCallFilePaths = new Map<string, string>();

  /** Strip cursor-agent-acp elapsed suffix, e.g. "Doing the thing... (12s)" → "Doing the thing..." */
  function agentThoughtStatusBase(text: string): string {
    return text.replace(/\s\(\d+s\)\s*$/, '');
  }

  /**
   * cursor-agent-acp sends funny progress lines as agent_thought_chunk (see getRandomProcessingText).
   * Heartbeats replace the previous line; only genuine incremental thought text is appended.
   */
  function mergeAgentThoughtChunk(text: string, content?: AgentThoughtChunkContent): void {
    if (!hooks.thinkingText) return;
    const isHeartbeat = content?.annotations?._meta?.heartbeat === true;
    const prev = hooks.thinkingText.value;

    if (isHeartbeat || !prev) {
      hooks.thinkingText.value = text;
      return;
    }

    const textBase = agentThoughtStatusBase(text);
    const prevBase = agentThoughtStatusBase(prev);
    if (textBase === prevBase || text.startsWith(prevBase) || prev.startsWith(textBase)) {
      hooks.thinkingText.value = text;
      return;
    }

    hooks.thinkingText.value = mergeStreamingTextChunks(prev, text);
  }

  function processAcpUpdate(
    update: Record<string, unknown>,
    items: DisplayItem[],
    opts?: ProcessEventLineOptions & { sourceSessionId?: string }
  ): void {
    const sessionUpdate = update.sessionUpdate as string | undefined;

    if (sessionUpdate === 'agent_message_chunk') {
      const content = update.content as { type?: string; text?: string } | undefined;
      if (
        content?.type === 'text' &&
        typeof content.text === 'string' &&
        shouldKeepAssistantTextChunk(content.text, items)
      ) {
        appendAssistantTextChunk(content.text, items);
      }
      return;
    }

    if (sessionUpdate === 'agent_thought_chunk') {
      const content = update.content as AgentThoughtChunkContent | undefined;
      if (opts?.liveThinking && !hooks.isThinkingHidden?.() && content?.text) {
        mergeAgentThoughtChunk(content.text, content);
      }
      return;
    }

    if (sessionUpdate === 'tool_call') {
      const toolCallId = update.toolCallId as string | undefined;
      if (!toolCallId) {
        return;
      }
      const todoItems = todosFromAcpUpdate(update);
      if (todoItems) {
        items.push({ kind: 'todos', callId: toolCallId, status: 'running', todoItems });
        return;
      }
      const planMarkdown = planMarkdownFromToolUpdate(update);
      if (planMarkdown) {
        upsertPlanMarkdown(items, planMarkdown, typeof update.title === 'string' ? update.title : undefined, opts?.sourceSessionId);
        return;
      }
      const callLocations = update.locations as Array<{ path?: string }> | undefined;
      const callPath = callLocations?.find((location) => location.path?.trim())?.path;
      if (callPath) toolCallFilePaths.set(toolCallId, callPath);
      const kind = update.kind as string | undefined;
      const toolItem: DisplayItem = {
        kind: 'tool',
        callId: toolCallId,
        toolName: ACP_KIND_TO_NAME[kind ?? ''] ?? 'Tool',
        toolIcon: ACP_KIND_TO_ICON[kind ?? ''] ?? 'build',
        toolSummary: typeof update.title === 'string' ? update.title : '',
        status: 'running'
      };
      mergeToolDiffs(toolItem, update.content);
      items.push(toolItem);
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
        if (updatedTodos) {
          item.todoItems = updatedTodos;
        }
      }
      if (item.kind === 'tool') {
        // Late todos (e.g. vibe's todo 'read' action carries no todos at call
        // time; the result's rawOutput has the list) — adopt the todos row.
        const lateTodos = todosFromAcpUpdate(update);
        if (lateTodos?.length) {
          item.kind = 'todos';
          item.todoItems = lateTodos;
          item.toolName = undefined;
          item.toolIcon = undefined;
          item.toolSummary = undefined;
          item.toolOutput = undefined;
          item.toolDiffs = undefined;
          return;
        }
      }
      if (item.kind === 'tool') {
        if (typeof update.title === 'string') item.toolSummary = update.title;
        const rawLocs = update.locations as Array<{ path: string; line?: number }> | undefined;
        if (rawLocs?.length) item.locations = rawLocs;
        mergeToolDiffs(item, update.content);
        if (status === 'completed') {
          const rawContent = update.content as
            Array<{ type?: string; content?: { type?: string; text?: string } }> | undefined;
          const text =
            rawContent
              ?.filter((c) => c.type === 'content' && c.content?.type === 'text')
              .map((c) => c.content?.text ?? '')
              .join('') ?? '';
          if (text.trim()) item.toolOutput = text.trim();
          const imagePath =
            item.locations?.find((location) => location.path?.trim())?.path ?? toolCallFilePaths.get(toolCallId);
          if (imagePath && rawContent?.some((c) => c.type === 'content' && c.content?.type === 'image')) {
            item.toolImagePath = imagePath;
          }
        }
      }
      return;
    }

    if (sessionUpdate === 'plan') {
      const entries = update.entries as PlanEntry[] | undefined;
      const title = typeof update.title === 'string' ? update.title : undefined;
      const markdown = typeof update.markdown === 'string' ? update.markdown : undefined;
      if (!entries?.length && !markdown?.trim()) return;
      const planTitle = resolvePlanDisplayTitle(title, markdown);
      const existing = items.find((i) => i.kind === 'plan');
      if (existing) {
        existing.planEntries = entries ?? existing.planEntries;
        existing.planSourceSessionId = opts?.sourceSessionId ?? existing.planSourceSessionId;
        existing.planTitle = planTitle ?? existing.planTitle;
        existing.planMarkdown = markdown ?? existing.planMarkdown;
      } else {
        items.push({
          kind: 'plan',
          planSourceSessionId: opts?.sourceSessionId,
          planEntries: entries ?? [],
          planTitle,
          planMarkdown: markdown
        });
      }
      return;
    }

    if (sessionUpdate === 'usage_update') {
      const used = update.used as number | undefined;
      const size = update.size as number | undefined;
      if (
        opts?.liveThinking &&
        hooks.usage &&
        typeof used === 'number' &&
        typeof size === 'number'
      ) {
        const meta = update._meta as Record<string, unknown> | undefined;
        const planWindows = parseClaudeRateLimitMeta(meta?.['_claude/rateLimit']);
        hooks.usage.value = {
          used,
          size,
          cost: update.cost as { amount: number; currency: string } | undefined,
          ...(planWindows ? { planWindows } : {})
        };
      }
      return;
    }

    if (sessionUpdate === 'current_mode_update') {
      const modeId = update.currentModeId as string | undefined;
      if (modeId && opts?.applyConfigSync !== false) hooks.onModeUpdate?.(modeId);
      return;
    }

    if (sessionUpdate === 'config_option_update') {
      if (opts?.applyConfigSync === false) return;
      const rawOpts = update.configOptions as
        Array<{ id: string; category?: string; type: string; currentValue?: string }> | undefined;
      if (!rawOpts?.length) return;
      const modelOpt = rawOpts.find((o) => o.category === 'model' || o.id === 'model');
      if (modelOpt?.type === 'select' && typeof modelOpt.currentValue === 'string') {
        hooks.onModelUpdate?.(modelOpt.currentValue);
      }
      const config: Record<string, string> = {};
      for (const opt of rawOpts) {
        if (opt.type !== 'select') continue;
        const cat = opt.category ?? opt.id;
        if (cat === 'mode' || cat === 'model' || opt.id === 'mode' || opt.id === 'model') continue;
        if (typeof opt.currentValue === 'string') config[opt.id] = opt.currentValue;
      }
      if (Object.keys(config).length > 0) hooks.onConfigUpdate?.(config);
      return;
    }
  }

  function processEventLine(
    line: string,
    items: DisplayItem[],
    opts?: ProcessEventLineOptions
  ): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    if (event.type === 'session_config_sync') {
      if (opts?.applyConfigSync === false) return;
      const modeId = typeof event.modeId === 'string' ? event.modeId : undefined;
      const modelId = typeof event.modelId === 'string' ? event.modelId : undefined;
      const config =
        event.config && typeof event.config === 'object' && !Array.isArray(event.config)
          ? (event.config as Record<string, string>)
          : undefined;
      if (modeId) hooks.onModeUpdate?.(modeId);
      if (modelId) hooks.onModelUpdate?.(modelId);
      if (config) hooks.onConfigUpdate?.(config);
      return;
    }

    // Server-side notices (context reset, skipped MCP, …).
    if (event.type === 'session_reset_notice' || event.type === 'mcp_unavailable_notice') {
      const text = typeof event.text === 'string' ? event.text.trim() : '';
      if (text) items.push({ kind: 'notice', text });
      return;
    }

    // ── ACP native format (any ACP agent: Claude, Mistral, …) ──────────────────
    if (typeof event.sessionId === 'string' && event.update && typeof event.update === 'object') {
      processAcpUpdate(event.update as Record<string, unknown>, items, {
        ...opts,
        sourceSessionId: event.sessionId
      });
      return;
    }

    // ── Legacy cursor-style format (kept for historical session data) ───────────
    // Some providers (e.g. Vibe) can nest real events inside `{ type: "stream", data: "<json>" }`.
    // Unwrap those envelopes so the display parser can handle a consistent event shape.
    for (let i = 0; i < 3; i += 1) {
      if (event.type !== 'stream' || typeof event.data !== 'string') break;
      const nested = event.data.trim();
      if (!nested) return;
      try {
        event = JSON.parse(nested) as Record<string, unknown>;
      } catch {
        break;
      }
    }

    // Ephemeral thinking stream (Cursor stream-json) — never persisted as display items.
    if (event.type === 'thinking') {
      if (
        opts?.liveThinking &&
        !hooks.isThinkingHidden?.() &&
        event.subtype === 'delta' &&
        typeof event.text === 'string' &&
        hooks.thinkingText
      ) {
        hooks.thinkingText.value = mergeStreamingTextChunks(hooks.thinkingText.value, event.text);
      }
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
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
    } else if (
      (event.role === 'assistant' || event.type === 'assistant') &&
      typeof event.content === 'string'
    ) {
      assistantText = event.content;
    }

    if (assistantText) {
      // Skip standalone whitespace, but preserve spaces that arrive between streamed text chunks.
      if (!shouldKeepAssistantTextChunk(assistantText, items)) return;
      mergeAssistantTextIntoDisplayItems(assistantText, items);
    } else if (event.role === 'tool' && typeof event.content === 'string') {
      const toolNameRaw = typeof event.name === 'string' ? event.name : 'tool';
      const meta = VIBE_TOOL_META[toolNameRaw] ?? { name: toolNameRaw, icon: 'build' };
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
        existing.toolIcon = meta.icon;
      } else {
        items.push({
          kind: 'tool',
          callId,
          toolName: meta.name,
          toolIcon: meta.icon,
          toolSummary,
          status: 'success'
        });
      }
    } else if (event.type === 'tool_call') {
      const toolCallObj = (event.tool_call ?? {}) as Record<string, unknown>;
      const toolCallName = Object.keys(toolCallObj)[0] ?? '';
      const meta = TOOL_META[toolCallName] ?? { name: toolCallName, icon: 'build' };

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
            todoItems: rawTodos.map((t) => ({ id: t.id, content: t.content, status: t.status }))
          });
        } else {
          items.push({
            kind: 'tool',
            callId: event.call_id as string,
            toolName: meta.name,
            toolIcon: meta.icon,
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
          if (item.kind === 'tool') item.toolSummary = getToolSummary(toolCallName, toolCallObj);
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

  function parseEventsToItems(events: string[], opts?: ProcessEventLineOptions): DisplayItem[] {
    const items: DisplayItem[] = [];
    for (const line of events) {
      processEventLine(line, items, opts);
    }
    return items;
  }

  return { processEventLine, parseEventsToItems };
}

// ---------------------------------- Cached history parsing (perf) ----------------------------------

/**
 * History messages are immutable once received, but displayMessages previously
 * re-parsed every message's events on EVERY reactive tick (O(history) per
 * stream chunk). Cache parsed items per events-array reference; re-parse only
 * when the array identity or length changes (events are append-only).
 */
const parseCache = new WeakMap<string[], { length: number; items: DisplayItem[] }>();
const fallbackParser = createChatStreamParser();

export function parseHistoryEventsCached(events: string[]): DisplayItem[] {
  const cached = parseCache.get(events);
  if (cached && cached.length === events.length) {
    return cached.items;
  }
  const items = fallbackParser.parseEventsToItems(events, { applyConfigSync: false });
  parseCache.set(events, { length: events.length, items });
  return items;
}

// ---------------------------------- prepareDisplayItem ----------------------------------

export function prepareDisplayItem(item: DisplayItem): DisplayItem {
  return prepareDisplayItemWith(item, renderMdCached);
}

/**
 * Live variant: streamed text grows with every chunk, so caching each partial
 * render would flood the markdown cache and evict the whole history's HTML.
 */
export function prepareLiveDisplayItem(item: DisplayItem): DisplayItem {
  return prepareDisplayItemWith(item, renderMd);
}

function prepareDisplayItemWith(
  item: DisplayItem,
  render: (src: string | undefined) => string
): DisplayItem {
  if (item.kind === 'text') {
    return { ...item, renderedHtml: render(item.text) };
  }
  if (item.kind === 'todos') {
    return {
      ...item,
      todoDoneCount:
        item.todoItems?.filter((todo) => todo.status === 'TODO_STATUS_COMPLETED').length ?? 0
    };
  }
  if (item.kind === 'plan') {
    const entries = item.planEntries ?? [];
    return {
      ...item,
      planCompletedCount: entries.filter((entry) => isPlanEntryCompleted(entry.status)).length,
      planRenderedHtml: render(item.planMarkdown ?? markdownFromPlanEntries(entries))
    };
  }
  return item;
}

// ---------------------------------- Vibe dedup ----------------------------------

function parseNestedEvent(line: string): Record<string, unknown> | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  for (let i = 0; i < 3; i += 1) {
    if (event.type !== 'stream' || typeof event.data !== 'string') break;
    const nested = event.data.trim();
    if (!nested) return null;
    try {
      event = JSON.parse(nested) as Record<string, unknown>;
    } catch {
      break;
    }
  }
  return event;
}

export function indexSeenVibeIdsFromEvents(
  events: string[] | undefined,
  seenMessageIds: Set<string>,
  seenToolCallIds: Set<string>
): void {
  if (!events?.length) return;
  for (const line of events) {
    const event = parseNestedEvent(line);
    if (!event) continue;
    if (typeof event.message_id === 'string' && event.message_id) {
      seenMessageIds.add(event.message_id);
    }
    if (
      (event.role === 'tool' || event.role === 'assistant') &&
      typeof event.tool_call_id === 'string' &&
      event.tool_call_id
    ) {
      seenToolCallIds.add(event.tool_call_id);
    }
  }
}

export function shouldSkipDuplicateVibeEventLine(
  line: string,
  seenMessageIds: Set<string>,
  seenToolCallIds: Set<string>
): boolean {
  const event = parseNestedEvent(line);
  if (!event) return false;
  if (typeof event.message_id === 'string' && event.message_id) {
    if (seenMessageIds.has(event.message_id)) return true;
    seenMessageIds.add(event.message_id);
  }
  if (
    (event.role === 'tool' || event.role === 'assistant') &&
    typeof event.tool_call_id === 'string' &&
    event.tool_call_id
  ) {
    if (seenToolCallIds.has(event.tool_call_id)) return true;
    seenToolCallIds.add(event.tool_call_id);
  }
  return false;
}

// ---------------------------------- Notification preview ----------------------------------

/** Prefer the last assistant text bubble; if the run ended on a tool, use that tool row (or todos). */
export function notificationPreviewFromStreamingItems(items: DisplayItem[]): string {
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
      const total = item.todoItems.length;
      return `Todos: ${done}/${total} completed`;
    }
    if (item.kind === 'plan') {
      const total = item.planEntries?.length ?? 0;
      if (total > 0) {
        return `Plan: ${item.planCompletedCount ?? 0}/${total} completed`;
      }
      return 'Plan ready';
    }
  }
  return '';
}

// ---------------------------------- Re-exports ----------------------------------

// Types, markdown and plan helpers moved to sibling modules; re-exported for existing importers.
export * from './chatDisplayTypes';
export * from './chatMarkdown';
export * from './planDocuments';

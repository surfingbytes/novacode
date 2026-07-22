/**
 * Chat display-item pipeline — converts agent stream event lines (ACP native,
 * legacy cursor-style, Vibe) into render-ready DisplayItems.
 *
 * Extracted from SessionChat.vue (previously ~900 lines inline). Pure logic:
 * all side effects (live thinking text, token usage, agent config sync) go
 * through the ChatStreamParserHooks passed to createChatStreamParser().
 */

// node_modules
import { marked } from 'marked';

// types
import type { PlanDocumentSummary } from '@/@types/index';

// ---------------------------------- Types ----------------------------------

export interface TodoDisplayItem {
  id: string;
  content: string;
  status: string;
}

export interface PlanEntry {
  content: string;
  status: string;
}

export interface DisplayItem {
  kind: 'text' | 'tool' | 'todos' | 'plan';
  // text
  text?: string;
  renderedHtml?: string;
  // tool
  callId?: string;
  toolName?: string;
  toolIcon?: string;
  toolSummary?: string;
  status?: 'running' | 'success' | 'rejected';
  locations?: Array<{ path: string; line?: number }>;
  toolOutput?: string;
  // todos
  todoItems?: TodoDisplayItem[];
  todoDoneCount?: number;
  // plan (ACP native)
  planId?: string;
  planSourceSessionId?: string;
  planTitle?: string;
  planMarkdown?: string;
  planEntries?: PlanEntry[];
  planCompletedCount?: number;
  planRenderedHtml?: string;
}

export interface PlanDocument {
  id: string;
  backendPlanId?: string;
  planSourceSessionId?: string;
  title: string;
  markdown: string;
  entries: PlanEntry[];
  startableEntries: PlanEntry[];
  completedCount: number;
  renderedHtml: string;
  createdAt: string;
  live: boolean;
}

export interface StreamUsage {
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
}

// ---------------------------------- Markdown ----------------------------------

marked.setOptions({ breaks: true, gfm: true });

function escapeHtmlForMd(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const langAttr = lang ? ` class="language-${escapeHtmlForMd(lang)}"` : '';
      const langLabel = lang
        ? `<span class="code-block-lang mr-auto text-[10px] font-mono uppercase tracking-wide text-text-muted/70">${escapeHtmlForMd(lang)}</span>`
        : '';
      return (
        `<div class="code-block-card my-2.5 rounded-xl border border-fg/10 bg-fg/[0.03] overflow-hidden">` +
        `<div class="code-block-header flex items-center gap-2 px-2 py-1 border-b border-fg/10 bg-fg/[0.02]">` +
        langLabel +
        `<button type="button" class="code-copy-btn ml-auto shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded text-text-muted/70 hover:text-text-primary transition-colors" aria-label="Copy code" title="Copy">Copy</button>` +
        `</div>` +
        `<pre><code${langAttr}>${escapeHtmlForMd(text)}</code></pre>` +
        `</div>`
      );
    }
  }
});

export function normalizeMarkdownForRendering(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let openFence: { marker: '`' | '~'; length: number } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const marker = fence[0] as '`' | '~';
      if (!openFence) {
        openFence = { marker, length: fence.length };
      } else if (marker === openFence.marker && fence.length >= openFence.length) {
        openFence = null;
      }
      continue;
    }

    if (!openFence) continue;

    const partialClose = line.match(/^ {0,3}(`{1,2}|~{1,2})\s*$/);
    if (partialClose?.[1]?.[0] === openFence.marker) {
      lines[i] = openFence.marker.repeat(Math.max(3, openFence.length));
      openFence = null;
    }
  }

  if (openFence) {
    lines.push(openFence.marker.repeat(Math.max(3, openFence.length)));
  }

  return lines.join('\n');
}

export function renderMd(src: string | undefined): string {
  if (!src) {
    return '';
  }
  return marked.parse(normalizeMarkdownForRendering(src), { async: false }) as string;
}

const markdownRenderCache = new Map<string, string>();

export function renderMdCached(src: string | undefined): string {
  if (!src) return '';
  const cached = markdownRenderCache.get(src);
  if (cached !== undefined) return cached;
  const rendered = renderMd(src);
  if (markdownRenderCache.size > 500) markdownRenderCache.clear();
  markdownRenderCache.set(src, rendered);
  return rendered;
}

// ---------------------------------- Tool metadata ----------------------------------

const MAX_GLOB_FILES_TO_SHOW = 10;

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
    description: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    edit: '<path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/>',
    delete: '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>',
    drive_file_move: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M9 15l3-3 3 3"/><line x1="12" y1="12" x2="12" y2="18"/>',
    manage_search: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/><path d="M9 11h4M11 9v4"/>',
    travel_explore: '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    psychology: '<path d="M9 12a3 3 0 006 0 3 3 0 00-6 0"/><path d="M12 2a7 7 0 00-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 002 2h4a2 2 0 002-2v-2.26A7 7 0 0012 2z"/>',
    cloud_download: '<polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29"/>',
    tune: '<path d="M4 21V14M4 10V3M12 21V12M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    checklist: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12l2 2 4-4"/>',
    build: '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>'
  };
  const d = paths[icon] ?? paths.build;
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

function getToolSummary(toolCallName: string, toolCallObj: Record<string, unknown>): string {
  const call = (toolCallObj[toolCallName] ?? {}) as Record<string, unknown>;
  const args = (call.args ?? {}) as Record<string, unknown>;
  switch (toolCallName) {
    case 'readToolCall':
      return String(args.path ?? '');
    case 'globToolCall': {
      const pattern = String(args.globPattern ?? '');
      const dir = String(args.targetDirectory ?? '');
      const base = [pattern, dir].filter(Boolean).join(' in ') || '—';
      const result = (call.result ?? {}) as Record<string, unknown>;
      const success = result.success as Record<string, unknown> | undefined;
      const files = Array.isArray(success?.files) ? (success.files as string[]) : [];
      if (files.length === 0 && !('success' in result)) return base;
      if (files.length > MAX_GLOB_FILES_TO_SHOW) return `${base} → ${files.length} files`;
      if (files.length > 0)
        return `${base} → ${files.length} file${files.length === 1 ? '' : 's'}: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '…' : ''}`;
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
      if (!todos?.length) return '';
      const done = todos.filter((t) => t.status === 'TODO_STATUS_COMPLETED').length;
      return `${done}/${todos.length} completed`;
    }
    default:
      return '';
  }
}

function isToolResultSuccess(toolCallObj: Record<string, unknown>): boolean {
  const toolCallName = Object.keys(toolCallObj)[0];
  if (!toolCallName) return false;
  const call = (toolCallObj[toolCallName] ?? {}) as Record<string, unknown>;
  const result = (call.result ?? {}) as Record<string, unknown>;
  return 'success' in result;
}

// ---------------------------------- Text merge helpers ----------------------------------

/**
 * Stream providers mix cumulative snapshots with incremental deltas and may repeat boundary tokens
 * (e.g. send "The shared" then " shared"). Merge without doubling identical or overlapping text.
 */
export function mergeStreamingTextChunks(previousText: string, incomingText: string): string {
  if (!incomingText || incomingText === previousText) return previousText;
  if (previousText.startsWith(incomingText)) return previousText;
  if (incomingText.startsWith(previousText)) return incomingText;
  if (previousText.endsWith(incomingText)) return previousText;
  let overlap = 0;
  const maxOverlap = Math.min(previousText.length, incomingText.length);
  for (let len = maxOverlap; len > 0; len -= 1) {
    if (previousText.endsWith(incomingText.slice(0, len))) {
      overlap = len;
      break;
    }
  }
  return previousText + incomingText.slice(overlap);
}

export function mergeAssistantTextIntoDisplayItems(
  assistantText: string,
  items: DisplayItem[]
): void {
  const last = items[items.length - 1];
  if (last?.kind === 'text') {
    const prev = last.text ?? '';
    last.text = mergeStreamingTextChunks(prev, assistantText);
    return;
  }
  items.push({ kind: 'text', text: assistantText });
}

/**
 * ACP `agent_message_chunk` content is a sequential increment — the reference
 * SDK's readText() plain-appends it. Boundary dedup corrupts content that
 * legitimately repeats (table separator rows, code indentation), so ACP chunks
 * are appended verbatim. The defensive merge above stays for legacy
 * cursor-style/Vibe events, whose payloads are cumulative snapshots.
 */
function appendAssistantTextChunk(assistantText: string, items: DisplayItem[]): void {
  const last = items[items.length - 1];
  if (last?.kind === 'text') {
    last.text = (last.text ?? '') + assistantText;
    return;
  }
  items.push({ kind: 'text', text: assistantText });
}

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
      const kind = update.kind as string | undefined;
      items.push({
        kind: 'tool',
        callId: toolCallId,
        toolName: ACP_KIND_TO_NAME[kind ?? ''] ?? 'Tool',
        toolIcon: ACP_KIND_TO_ICON[kind ?? ''] ?? 'build',
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
      if (item.kind === 'tool') {
        if (typeof update.title === 'string') item.toolSummary = update.title;
        const rawLocs = update.locations as Array<{ path: string; line?: number }> | undefined;
        if (rawLocs?.length) item.locations = rawLocs;
        if (status === 'completed') {
          const rawContent = update.content as
            | Array<{ type?: string; content?: { type?: string; text?: string } }>
            | undefined;
          const text =
            rawContent
              ?.filter((c) => c.type === 'content' && c.content?.type === 'text')
              .map((c) => c.content?.text ?? '')
              .join('') ?? '';
          if (text.trim()) item.toolOutput = text.trim();
        }
      }
      return;
    }

    if (sessionUpdate === 'plan') {
      const entries = update.entries as PlanEntry[] | undefined;
      const title = typeof update.title === 'string' ? update.title : undefined;
      const markdown = typeof update.markdown === 'string' ? update.markdown : undefined;
      if (!entries?.length && !markdown?.trim()) return;
      const existing = items.find((i) => i.kind === 'plan');
      if (existing) {
        existing.planEntries = entries ?? existing.planEntries;
        existing.planSourceSessionId = opts?.sourceSessionId ?? existing.planSourceSessionId;
        existing.planTitle = title ?? existing.planTitle;
        existing.planMarkdown = markdown ?? existing.planMarkdown;
      } else {
        items.push({
          kind: 'plan',
          planSourceSessionId: opts?.sourceSessionId,
          planEntries: entries ?? [],
          planTitle: title,
          planMarkdown: markdown
        });
      }
      return;
    }

    if (sessionUpdate === 'usage_update') {
      const used = update.used as number | undefined;
      const size = update.size as number | undefined;
      if (opts?.liveThinking && hooks.usage && typeof used === 'number' && typeof size === 'number') {
        hooks.usage.value = {
          used,
          size,
          cost: update.cost as { amount: number; currency: string } | undefined
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
        | Array<{ id: string; category?: string; type: string; currentValue?: string }>
        | undefined;
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

export function isPlanEntryCompleted(status: string | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return (
    normalized === 'completed' || normalized === 'done' || normalized === 'todo_status_completed'
  );
}

export function isPlanEntryInProgress(status: string | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return (
    normalized === 'in_progress' ||
    normalized === 'in-progress' ||
    normalized === 'running' ||
    normalized === 'todo_status_in_progress'
  );
}

export function planStatusIcon(status: string | undefined): 'completed' | 'in_progress' | 'pending' {
  if (isPlanEntryCompleted(status)) return 'completed';
  if (isPlanEntryInProgress(status)) return 'in_progress';
  return 'pending';
}

function escapePlanEntryContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

export function markdownFromPlanEntries(entries: PlanEntry[]): string {
  if (entries.length === 0) return '';
  return entries
    .map((entry) => {
      const box = isPlanEntryCompleted(entry.status) ? 'x' : ' ';
      const content = escapePlanEntryContent(entry.content).replace(/\n/g, '\n  ');
      return `- [${box}] ${content}`;
    })
    .join('\n');
}

export function prepareDisplayItem(item: DisplayItem): DisplayItem {
  if (item.kind === 'text') {
    return { ...item, renderedHtml: renderMdCached(item.text) };
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
      planRenderedHtml: renderMdCached(item.planMarkdown ?? markdownFromPlanEntries(entries))
    };
  }
  return item;
}

// ---------------------------------- Plan documents ----------------------------------

function stripMarkdownSyntax(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function unwrapMarkdownFence(markdown: string): string {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^```(?:md|markdown)?\s*\n([\s\S]*?)\n```$/i);
  return (match?.[1] ?? trimmed).trim();
}

export function entriesFromPlanMarkdown(markdown: string): PlanEntry[] {
  const lines = unwrapMarkdownFence(markdown).replace(/\r\n/g, '\n').split('\n');
  const headingEntries: PlanEntry[] = [];
  const actionEntries: PlanEntry[] = [];
  const numberedEntries: PlanEntry[] = [];
  let inFence = false;
  let fenceMarker: '`' | '~' | null = null;

  const addEntry = (target: PlanEntry[], content: string): PlanEntry => {
    const existing = [...headingEntries, ...actionEntries].find((entry) => entry.content === content);
    if (existing) return existing;
    const entry = { content, status: 'pending' };
    target.push(entry);
    return entry;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~';
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;

    const headingMatch = line.match(/^#{1,4}\s+(?:\d+[\.)]\s*)?(.+)$/);
    const orderedMatch = line.match(/^\s{0,3}\d+[\.)]\s+(.+)$/);
    const taskMatch = line.match(/^\s{0,3}[-*]\s+\[[ xX]\]\s+(.+)$/);
    const bNumberedEntry = Boolean(orderedMatch || /^#{1,4}\s+\d+[\.)]\s+/.test(line));
    const rawContent = headingMatch?.[1] ?? orderedMatch?.[1] ?? taskMatch?.[1];
    const content = rawContent ? stripMarkdownSyntax(rawContent) : '';
    if (!content) continue;

    const entry = addEntry(orderedMatch || taskMatch ? actionEntries : headingEntries, content);
    if (bNumberedEntry) numberedEntries.push(entry);
  }

  return numberedEntries.length
    ? numberedEntries
    : actionEntries.length
      ? actionEntries
      : headingEntries;
}

function planActionRows(entries: PlanEntry[]): string {
  if (!entries.length) return '';
  const rows = entries
    .map((entry, index) => {
      const label = escapeHtml(entry.content.trim());
      return `<li class="plan-start-action-row"><span>${label}</span><button type="button" class="plan-start-session-btn" data-plan-entry-index="${index}">Start session</button></li>`;
    })
    .join('');
  return `<div class="plan-start-actions-card"><div class="plan-start-actions-title">Start from plan point</div><ol>${rows}</ol></div>`;
}

export function renderPlanMarkdownWithActions(markdown: string, entries: PlanEntry[]): string {
  if (!entries.length) return renderMdCached(markdown);

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceMarker: '`' | '~' | null = null;
  let entryIndex = 0;
  const hasNumberedEntries = lines.some(
    (line) => /^#{1,4}\s+\d+[\.)]\s+/.test(line) || /^\s{0,3}\d+[\.)]\s+/.test(line)
  );

  for (const rawLine of lines) {
    out.push(rawLine);
    const line = rawLine.trimEnd();
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as '`' | '~';
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence || entryIndex >= entries.length) continue;

    const bNumberedLine = /^#{1,4}\s+\d+[\.)]\s+/.test(line) || /^\s{0,3}\d+[\.)]\s+/.test(line);
    const bTaskLine = /^\s{0,3}[-*]\s+\[[ xX]\]\s+/.test(line);
    const bHeadingLine = /^#{1,4}\s+/.test(line);
    const bActionTarget = hasNumberedEntries
      ? bNumberedLine
      : bNumberedLine || bTaskLine || bHeadingLine;
    if (!bActionTarget) continue;

    const fullPlanAttribute =
      bHeadingLine && !bNumberedLine && !bTaskLine ? ' data-plan-full-plan="true"' : '';
    out.push(
      '',
      `<div class="plan-start-action-inline"><button type="button" class="plan-start-session-btn" data-plan-entry-index="${entryIndex}"${fullPlanAttribute}>Start session</button></div>`,
      ''
    );
    if (!fullPlanAttribute) {
      entryIndex += 1;
    }
  }

  const fallbackEntries = entryIndex < entries.length ? entries.slice(entryIndex) : [];
  return `${renderMdCached(out.join('\n'))}${planActionRows(fallbackEntries)}`;
}

function planTitle(item: DisplayItem, fallbackIndex: number): string {
  const title = item.planTitle?.trim();
  if (title) return title;
  return fallbackIndex === 0 ? 'Plan' : `Plan ${fallbackIndex + 1}`;
}

export interface PlanMarkdownCandidate {
  markdown: string;
  normalized: string;
  index: number;
  planId?: string;
  sourceSessionId?: string;
}

export function normalizePlanSearchText(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function firstMarkdownHeading(markdown: string): string {
  const heading = unwrapMarkdownFence(markdown).match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  return heading ?? '';
}

function looksLikeFullPlanMarkdown(markdown: string | undefined): markdown is string {
  if (!markdown?.trim()) return false;
  const text = unwrapMarkdownFence(markdown);
  const headingCount = (text.match(/^#{1,3}\s+/gm) ?? []).length;
  const hasPlanSections =
    /^#{1,3}\s+(goal|required order|step\s+\d+|implementation|validation|test plan)\b/im.test(text);
  return headingCount >= 2 || (headingCount >= 1 && hasPlanSections);
}

export function planMarkdownCandidatesFromDocuments(
  documents: PlanDocumentSummary[] | undefined,
  sourceSessionId: string | undefined
): PlanMarkdownCandidate[] {
  if (!sourceSessionId || !documents?.length) return [];
  return documents
    .filter((doc) => doc.sessionId === sourceSessionId && looksLikeFullPlanMarkdown(doc.markdown))
    .map((doc, index) => {
      const markdown = unwrapMarkdownFence(doc.markdown);
      return {
        markdown,
        normalized: normalizePlanSearchText(`${doc.title} ${firstMarkdownHeading(markdown)} ${markdown}`),
        index,
        planId: doc.id,
        sourceSessionId: doc.sessionId
      };
    });
}

function scorePlanMarkdownCandidate(item: DisplayItem, candidate: PlanMarkdownCandidate): number {
  const titleTokens = normalizePlanSearchText(item.planTitle)
    .split(' ')
    .filter((token) => token.length >= 3);
  const entryTokens = (item.planEntries ?? [])
    .slice(0, 3)
    .flatMap((entry) =>
      normalizePlanSearchText(entry.content)
        .split(' ')
        .filter((token) => token.length >= 4)
        .slice(0, 4)
    );
  const tokens = [...titleTokens, ...entryTokens];
  if (tokens.length === 0) return candidate.index;
  const matches = tokens.filter((token) => candidate.normalized.includes(token)).length;
  return matches * 1000 + candidate.index;
}

export function bestPlanMarkdownFallback(
  item: DisplayItem,
  candidates: PlanMarkdownCandidate[]
): PlanMarkdownCandidate | undefined {
  if (candidates.length === 0) return undefined;
  let best: PlanMarkdownCandidate | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = scorePlanMarkdownCandidate(item, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (!best) return undefined;
  if (bestScore > 0 || candidates.length === 1) return best;
  return undefined;
}

export function planDocumentFromItem(
  item: DisplayItem,
  id: string,
  fallbackIndex: number,
  createdAt: string,
  live: boolean,
  fallback?: PlanMarkdownCandidate
): PlanDocument | null {
  if (item.kind !== 'plan') return null;
  const entries = item.planEntries ?? [];
  const markdown = item.planMarkdown?.trim() || fallback?.markdown.trim() || markdownFromPlanEntries(entries);
  if (!markdown && entries.length === 0) return null;
  const startableEntries = entries.length ? entries : entriesFromPlanMarkdown(markdown);
  const completedCount = startableEntries.filter((entry) => isPlanEntryCompleted(entry.status)).length;
  return {
    id,
    backendPlanId: fallback?.planId,
    planSourceSessionId: item.planSourceSessionId ?? fallback?.sourceSessionId,
    title: planTitle(item, fallbackIndex),
    markdown,
    entries,
    startableEntries,
    completedCount,
    renderedHtml: renderPlanMarkdownWithActions(markdown, startableEntries),
    createdAt,
    live
  };
}

export function planDocumentFromFileSummary(
  doc: PlanDocumentSummary,
  index: number
): PlanDocument | null {
  const markdown = doc.markdown.trim();
  if (!markdown) return null;
  const startableEntries = entriesFromPlanMarkdown(markdown);
  return {
    id: `file-plan-${doc.id}`,
    backendPlanId: doc.id,
    planSourceSessionId: doc.sessionId,
    title: doc.title || firstMarkdownHeading(markdown) || (index === 0 ? 'Plan' : `Plan ${index + 1}`),
    markdown,
    entries: [],
    startableEntries,
    completedCount: 0,
    renderedHtml: renderPlanMarkdownWithActions(markdown, startableEntries),
    createdAt: '',
    live: false
  };
}

// ---------------------------------- Vibe dedup ----------------------------------

export function parseNestedEvent(line: string): Record<string, unknown> | null {
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

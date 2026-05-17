<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import { marked } from 'marked';

// components
import FilesView from '@/components/workspace/FilesComponent.vue';
import GitView from '@/components/workspace/GitView.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import SessionEditModal from '@/components/SessionEditModal.vue';
import ClaudeLimitPopup from '@/components/ClaudeLimitPopup.vue';

// classes
import { sessionsApi, settingsApi, buildChatWsUrl, type CursorModelOption } from '@/classes/api';
import { notifyTaskDone, notifyTodoCompleted } from '@/lib/notifications';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';

// types
import type { ChatMessage, ChatQueueItem, ChatWsServerMessage, Session } from '@/@types/index';

marked.setOptions({ breaks: true, gfm: true });

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  workspaceId: string;
  sessionId: string;
  viewportHeight: number | null;
  showSidebarToggle?: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  (e: 'toggle-sidebar'): void;
}>();

// -------------------------------------------------- Store --------------------------------------------------
const router = useRouter();
const workspacesStore = useWorkspacesStore();

// -------------------------------------------------- Refs --------------------------------------------------
const session = ref<Session | null>(null);
const bLoading = ref(true);
const error = ref<string | null>(null);
const bShowEditModal = ref(false);
const bSavingEdit = ref(false);
const bShowDeleteModal = ref(false);
const bDeletingSession = ref(false);

/** Mobile overflow menu (Edit / Archive / Delete) */
const bMobileSessionMenuOpen = ref(false);
const mobileSessionMenuRef = ref<HTMLElement | null>(null);

// Claude limit popup state
const bShowClaudeLimitPopup = ref(false);
const claudeLimitResetTime = ref('');
const claudeLimitResetTimeReadable = ref('');
const bClaudeAutoContinueEnabled = ref(false);

// -------------------------------------------------- Computed --------------------------------------------------
/** Tags used in this workspace (for edit session autocomplete). */
const sessionTagSuggestions = computed(() => {
  const wid = props.workspaceId;
  const all = workspacesStore.allSessions.filter((s) => s.workspaceId === wid);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of all) {
    const tags = s.tags;
    if (!tags?.length) continue;
    for (const t of tags) {
      if (typeof t !== 'string' || !t.trim()) continue;
      const k = t.trim().toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t.trim());
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
});

// -------------------------------------------------- Methods --------------------------------------------------
function renderMd(src: string | undefined): string {
  if (!src) {
    return '';
  }
  return marked.parse(src, { async: false }) as string;
}

function closeMobileSessionMenu(): void {
  bMobileSessionMenuOpen.value = false;
}

function handleDocumentClickMobileMenu(e: MouseEvent): void {
  if (!bMobileSessionMenuOpen.value) return;
  const el = mobileSessionMenuRef.value;
  if (el && !el.contains(e.target as Node)) {
    closeMobileSessionMenu();
  }
}

function handleKeydownMobileMenu(e: KeyboardEvent): void {
  if (e.key === 'Escape' && bMobileSessionMenuOpen.value) closeMobileSessionMenu();
}

const CATEGORY_COLORS = [
  'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'bg-purple-500/15 text-purple-400 border-purple-500/20',
  'bg-green-500/15 text-green-400 border-green-500/20',
  'bg-orange-500/15 text-orange-400 border-orange-500/20',
  'bg-pink-500/15 text-pink-400 border-pink-500/20',
  'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  'bg-yellow-500/15 text-yellow-500/20',
  'bg-red-500/15 text-red-400 border-red-500/20'
];

function categoryColorClass(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CATEGORY_COLORS[h % CATEGORY_COLORS.length];
}

const activeTab = ref<'chat' | 'files' | 'git'>('chat');

// ── Chat state ───────────────────────────────────────────────────────────────
const messages = ref<ChatMessage[]>([]);
const bIsStreaming = ref(false);
const chatError = ref<string | null>(null);
const promptText = ref<string>('');
const messagesEl = ref<HTMLElement | null>(null);
/** Bottom sentinel inside the scroll area so follow-bottom includes streaming + thinking. */
const messagesScrollAnchor = ref<HTMLElement | null>(null);
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);
const lightboxSrc = ref<string | null>(null);
const bShowScrollToBottom = ref(false);
const modelSelection = ref<string>('auto');
const bShowModelSelector = ref(false);

const HIDE_THINKING_LS_KEY = 'nova:chat:hideThinkingOutput';

function readHideThinkingFromLs(): boolean {
  try {
    return localStorage.getItem(HIDE_THINKING_LS_KEY) === '1';
  } catch {
    return false;
  }
}

const hideThinkingOutput = ref(readHideThinkingFromLs());
const availableModels = ref<CursorModelOption[]>([]);
const openCodeModels = ref<CursorModelOption[]>([]);
const bModelsLoading = ref(false);
const queuedPrompts = ref<ChatQueueItem[]>([]);
const promptStorageKey = computed(() => `sessionPrompt:${props.workspaceId}:${props.sessionId}`);
const workspaceName = computed(
  () => workspacesStore.workspaces.find((w) => w.id === props.workspaceId)?.name ?? 'Workspace'
);

/** Tailwind `md` — desktop shows full placeholder with keyboard hints */
const bChatInputMdUp = ref(false);
let chatInputMql: MediaQueryList | null = null;

function syncChatInputBreakpoint(): void {
  bChatInputMdUp.value = chatInputMql?.matches ?? window.matchMedia('(min-width: 768px)').matches;
}

const promptPlaceholder = computed(() => {
  if (bIsStreaming.value) return 'Type your next message…';
  if (bChatInputMdUp.value) {
    return 'Type a message… (Ctrl+Enter to send, Enter for newline)';
  }
  return 'Type a message…';
});

// ── Image attachments ─────────────────────────────────────────────────────────
interface PendingImage {
  filename: string;
  dataUrl: string;
  serverPath: string;
}

const pendingImages = ref<PendingImage[]>([]);
const bUploadingImage = ref(false);

function imageApiUrl(serverPath: string): string {
  // serverPath is <configDir>/prompt-images/<sessionId>/<filename>
  const parts = serverPath.split('/');
  const fname = parts[parts.length - 1];
  const sid = parts[parts.length - 2];
  return sessionsApi.imageUrl(sid, fname);
}

/** Markdown-rendered assistant bubbles: open embedded images in the same lightbox as user attachments */
function onChatMarkdownImageClick(e: MouseEvent): void {
  const t = e.target as EventTarget | null;
  if (!t || !(t instanceof HTMLImageElement)) return;
  e.preventDefault();
  e.stopPropagation();
  const src = t.currentSrc || t.src;
  if (src) lightboxSrc.value = src;
}

function uploadImageFile(file: File): void {
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const dataUrl = ev.target?.result as string;
    const base64 = dataUrl.split(',')[1];
    bUploadingImage.value = true;
    try {
      const { data } = await sessionsApi.uploadImage(props.sessionId, base64, file.type);
      pendingImages.value.push({ filename: data.filename, dataUrl, serverPath: data.path });
    } catch {
      chatError.value = 'Failed to upload image';
    } finally {
      bUploadingImage.value = false;
    }
  };
  reader.readAsDataURL(file);
}

async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;

  let hasImage = false;
  for (const item of Array.from(items)) {
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file) continue;
    hasImage = true;
    if (file) uploadImageFile(file);
  }

  if (hasImage) e.preventDefault();
}

function onAttachClick() {
  fileInputEl.value?.click();
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (!files || files.length === 0) return;
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue;
    uploadImageFile(file);
  }
  // allow selecting the same file again
  input.value = '';
}

async function loadAvailableModels() {
  if (session.value?.agentType === 'open-code') {
    if (openCodeModels.value.length > 0) return;
    bModelsLoading.value = true;
    try {
      const { data } = await settingsApi.getOpenCodeModels();
      openCodeModels.value = data.models;
      if (data.models.length > 0 && !data.models.some((m) => m.id === modelSelection.value)) {
        modelSelection.value = data.models[0].id;
      }
    } catch {
      openCodeModels.value = [{ id: 'opencode/big-pickle', label: 'opencode/big-pickle' }];
    } finally {
      bModelsLoading.value = false;
    }
    return;
  }
  if (availableModels.value.length > 0) return;
  bModelsLoading.value = true;
  try {
    const { data } = await settingsApi.getCursorModels();
    availableModels.value = data.models;
    if (data.models.length > 0 && !data.models.some((m) => m.id === modelSelection.value)) {
      modelSelection.value = data.models[0].id;
    }
  } catch {
    availableModels.value = [{ id: 'auto', label: 'Auto' }];
  } finally {
    bModelsLoading.value = false;
  }
}

async function onModelChange(newModel: string) {
  const prev = modelSelection.value;
  modelSelection.value = newModel;
  try {
    await settingsApi.update({ modelSelection: newModel });
  } catch {
    modelSelection.value = prev;
  }
}

function onHideThinkingToggle(checked: boolean): void {
  hideThinkingOutput.value = checked;
  if (checked) streamingThinkingText.value = '';
  try {
    if (checked) localStorage.setItem(HIDE_THINKING_LS_KEY, '1');
    else localStorage.removeItem(HIDE_THINKING_LS_KEY);
  } catch {
    // ignore quota / private mode
  }
}

function openModelSettings(): void {
  void loadAvailableModels();
  bShowModelSelector.value = true;
}

function closeModelSettings(): void {
  bShowModelSelector.value = false;
}

const bHasMore = ref(false);
const bLoadingMore = ref(false);
let webSocket: WebSocket | null = null;
const bWsConnected = ref(false);
const bWsReconnecting = ref(false);
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let wsUnmounted = false;

// ── Display items ─────────────────────────────────────────────────────────────
interface TodoDisplayItem {
  id: string;
  content: string;
  status: string;
}

interface PlanEntry {
  content: string;
  status: string;
}

interface DisplayItem {
  kind: 'text' | 'tool' | 'todos' | 'plan';
  // text
  text?: string;
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
  // plan (ACP native)
  planEntries?: PlanEntry[];
}

// Items being built during a live stream; raw lines saved for DB persistence.
const streamingItems = ref<DisplayItem[]>([]);
const streamingRawLines: string[] = [];
/** Cursor `thinking` / `delta` chunks — shown for the whole busy stream; cleared when the run ends. Not in history. */
const streamingThinkingText = ref('');
const notifiedTodoIds = new Set<string>();
const seenVibeMessageIds = new Set<string>();
const seenVibeToolCallIds = new Set<string>();
const streamingUsage = ref<{
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
} | null>(null);
const expandedToolOutputIds = ref(new Set<string>());

function toggleToolOutput(callId: string): void {
  const next = new Set(expandedToolOutputIds.value);
  if (next.has(callId)) next.delete(callId);
  else next.add(callId);
  expandedToolOutputIds.value = next;
}

// ── Tool call helpers ─────────────────────────────────────────────────────────
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

// ── ACP native event helpers (Claude, Mistral, and any future ACP agent) ─────
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
  other: 'Tool',
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
  other: 'build',
};

function getToolIconSvg(icon: string): string {
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
    build: '<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>',
  };
  const d = paths[icon] ?? paths.build;
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

function processAcpUpdate(
  update: Record<string, unknown>,
  items: DisplayItem[],
  opts?: { liveThinking?: boolean }
): void {
  const sessionUpdate = update.sessionUpdate as string | undefined;

  if (sessionUpdate === 'agent_message_chunk') {
    const content = update.content as { type?: string; text?: string } | undefined;
    if (content?.type === 'text' && content.text?.trim()) {
      mergeAssistantTextIntoDisplayItems(content.text, items);
    }
    return;
  }

  if (sessionUpdate === 'agent_thought_chunk') {
    const content = update.content as { type?: string; text?: string } | undefined;
    if (opts?.liveThinking && !hideThinkingOutput.value && content?.text) {
      streamingThinkingText.value += content.text;
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
    if (!entries?.length) return;
    const existing = items.find((i) => i.kind === 'plan');
    if (existing) {
      existing.planEntries = entries;
    } else {
      items.push({ kind: 'plan', planEntries: entries });
    }
    return;
  }

  if (sessionUpdate === 'usage_update') {
    const used = update.used as number | undefined;
    const size = update.size as number | undefined;
    if (typeof used === 'number' && typeof size === 'number') {
      streamingUsage.value = {
        used,
        size,
        cost: update.cost as { amount: number; currency: string } | undefined,
      };
    }
    return;
  }
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

/**
 * Mistral Vibe (and some stream shapes) may re-send the full assistant line or duplicate the final
 * chunk; Cursor-style deltas are plain appends. Merge without doubling identical/cumulative text.
 */
function mergeAssistantTextIntoDisplayItems(
  assistantText: string,
  items: DisplayItem[]
): void {
  const last = items[items.length - 1];
  if (last?.kind === 'text') {
    const prev = last.text ?? '';
    if (assistantText === prev) return;
    if (assistantText.startsWith(prev)) {
      last.text = assistantText;
      return;
    }
    last.text = prev + assistantText;
    return;
  }
  items.push({ kind: 'text', text: assistantText });
}

// ── Parse events → DisplayItems ───────────────────────────────────────────────
function processEventLine(
  line: string,
  items: DisplayItem[],
  opts?: { liveThinking?: boolean }
): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  // ── ACP native format (any ACP agent: Claude, Mistral, …) ──────────────────
  if (typeof event.sessionId === 'string' && event.update && typeof event.update === 'object') {
    processAcpUpdate(event.update as Record<string, unknown>, items, opts);
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
      !hideThinkingOutput.value &&
      event.subtype === 'delta' &&
      typeof event.text === 'string'
    ) {
      streamingThinkingText.value += event.text;
    }
    return;
  }

  let assistantText = '';
  if (event.type === 'assistant' && Array.isArray((event.message as Record<string, unknown>)?.content)) {
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
    // Skip whitespace-only chunks so we do not render empty markdown bubbles between tool calls.
    if (!assistantText.trim()) return;
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
            item.todoItems = finalTodos.map((t) => ({
              id: t.id,
              content: t.content,
              status: t.status
            }));
          }
        }
      }
    }
  }
}

function parseEventsToItems(events: string[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const line of events) processEventLine(line, items);
  return items;
}

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

function indexSeenVibeIdsFromEvents(events: string[] | undefined): void {
  if (!events?.length) return;
  for (const line of events) {
    const event = parseNestedEvent(line);
    if (!event) continue;
    if (typeof event.message_id === 'string' && event.message_id) {
      seenVibeMessageIds.add(event.message_id);
    }
    if (
      (event.role === 'tool' || event.role === 'assistant') &&
      typeof event.tool_call_id === 'string' &&
      event.tool_call_id
    ) {
      seenVibeToolCallIds.add(event.tool_call_id);
    }
  }
}

function shouldSkipDuplicateVibeEventLine(line: string): boolean {
  const event = parseNestedEvent(line);
  if (!event) return false;
  if (typeof event.message_id === 'string' && event.message_id) {
    if (seenVibeMessageIds.has(event.message_id)) return true;
    seenVibeMessageIds.add(event.message_id);
  }
  if (
    (event.role === 'tool' || event.role === 'assistant') &&
    typeof event.tool_call_id === 'string' &&
    event.tool_call_id
  ) {
    if (seenVibeToolCallIds.has(event.tool_call_id)) return true;
    seenVibeToolCallIds.add(event.tool_call_id);
  }
  return false;
}

/** Prefer the last assistant text bubble; if the run ended on a tool, use that tool row (or todos). */
function notificationPreviewFromStreamingItems(items: DisplayItem[]): string {
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
  }
  return '';
}

// ── Auto-scroll ───────────────────────────────────────────────────────────────
function isScrolledToBottom(): boolean {
  const el = messagesEl.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

async function scrollToBottom(smooth = false) {
  await nextTick();
  // Wait for layout/paint so scrollHeight and the thinking block height are final.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  const el = messagesEl.value;
  if (!el) return;
  bShowScrollToBottom.value = false;
  const anchor = messagesScrollAnchor.value;
  if (anchor) {
    anchor.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
    return;
  }
  if (!smooth) {
    el.scrollTop = el.scrollHeight;
    return;
  }
  const start = el.scrollTop;
  const target = el.scrollHeight - el.clientHeight;
  const distance = target - start;
  if (distance <= 0) return;
  const duration = Math.min(150, distance * 0.15);
  const t0 = performance.now();
  function step(now: number) {
    const elapsed = now - t0;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - (1 - progress) ** 3;
    el!.scrollTop = start + distance * ease;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

async function scrollToBottomIfPinned() {
  if (isScrolledToBottom()) await scrollToBottom();
}

function onMessagesScroll() {
  bShowScrollToBottom.value = !isScrolledToBottom();
  if (!bHasMore.value || bLoadingMore.value) return;
  if (messagesEl.value && messagesEl.value.scrollTop < 100) {
    bLoadingMore.value = true;
    webSocket?.send(JSON.stringify({ type: 'load-more', offset: messages.value.length }));
  }
}

function forceInitialScrollToBottom() {
  scrollToBottom();
  // Some message content (e.g. markdown/images) can expand after first paint.
  requestAnimationFrame(() => {
    scrollToBottom();
  });
}

/**
 * Handle Claude limit detection event from backend
 */
type ClaudeLimitDetectedPayload = {
  resetTime?: string;
  resetTimeReadable?: string;
};

function parseControlStreamMessage(line: string): { type?: string; resetTime?: string; resetTimeReadable?: string } | null {
  try {
    const parsed = JSON.parse(line) as { type?: string; resetTime?: string; resetTimeReadable?: string };
    if (!parsed?.type || typeof parsed.type !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function handleClaudeLimitDetected(msg: ClaudeLimitDetectedPayload): void {
  const resetTime = msg.resetTime ?? new Date().toISOString();
  const resetTimeReadable = msg.resetTimeReadable ?? 'unknown time';

  // Show notification to user
  showClaudeLimitNotification(resetTime, resetTimeReadable);
}

/**
 * Show notification about Claude limit with option to enable auto-continue
 */
function showClaudeLimitNotification(resetTime: string, resetTimeReadable: string) {
  // Show the popup notification
  bShowClaudeLimitPopup.value = true;
  claudeLimitResetTime.value = resetTime;
  claudeLimitResetTimeReadable.value = resetTimeReadable;
}

/**
 * Handle auto-continue preference update from popup
 */
function handleAutoContinueUpdated(enabled: boolean) {
  // Update the local state to reflect the user's preference
  // This will be used when the limit actually resets
  console.log('Auto-continue preference updated:', enabled);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectChatWs() {
  if (webSocket) {
    return;
  }
  webSocket = new WebSocket(buildChatWsUrl(props.sessionId));

  webSocket.onopen = () => {
    bWsConnected.value = true;
    bWsReconnecting.value = false;
  };

  webSocket.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as ChatWsServerMessage;

      if (msg.type === 'history') {
        messages.value = msg.messages ?? [];
        seenVibeMessageIds.clear();
        seenVibeToolCallIds.clear();
        for (const m of messages.value) indexSeenVibeIdsFromEvents(m.events);
        queuedPrompts.value = msg.queue ?? [];
        bHasMore.value = msg.hasMore ?? false;
        streamingItems.value = [];
        streamingRawLines.length = 0;
        streamingThinkingText.value = '';
        notifiedTodoIds.clear();
        bIsStreaming.value = msg.streaming === true;
        forceInitialScrollToBottom();
      } else if (msg.type === 'history-page') {
        const container = messagesEl.value;
        const oldScrollHeight = container?.scrollHeight ?? 0;
        const older = msg.messages ?? [];
        for (const m of older) indexSeenVibeIdsFromEvents(m.events);
        messages.value = [...older, ...messages.value];
        bHasMore.value = msg.hasMore ?? false;
        bLoadingMore.value = false;
        nextTick(() => {
          if (container) {
            container.scrollTop += container.scrollHeight - oldScrollHeight;
          }
        });
      } else if (msg.type === 'queue-updated') {
        queuedPrompts.value = msg.queue ?? [];
      } else if (msg.type === 'prompt-started') {
        const prompt = msg.prompt;
        if (prompt) {
          messages.value.push({
            role: 'user',
            content: prompt.text,
            imagePaths: prompt.imagePaths?.length ? prompt.imagePaths : undefined,
            createdAt: prompt.createdAt
          });
          void scrollToBottomIfPinned();
        }
      } else if (msg.type === 'stream') {
        bIsStreaming.value = true;
        const line = msg.data ?? '';
        const controlMessage = parseControlStreamMessage(line);
        if (controlMessage?.type === 'claude_limit_detected') {
          handleClaudeLimitDetected(controlMessage);
        }
        if (shouldSkipDuplicateVibeEventLine(line)) return;
        streamingRawLines.push(line);
        processEventLine(line, streamingItems.value, { liveThinking: true });
        for (const item of streamingItems.value) {
          if (item.kind !== 'todos' || !item.todoItems) continue;
          for (const t of item.todoItems) {
            if (t.status === 'TODO_STATUS_COMPLETED' && !notifiedTodoIds.has(t.id)) {
              notifiedTodoIds.add(t.id);
              notifyTodoCompleted(t.content);
            }
          }
        }
        void scrollToBottomIfPinned();
      } else if (msg.type === 'done') {
        const lastAssistantMessage = notificationPreviewFromStreamingItems(streamingItems.value);
        const events = [...streamingRawLines];
        messages.value.push({
          role: 'assistant',
          events,
          content: events.length === 0 ? '(No response from agent)' : undefined,
          createdAt: new Date().toISOString()
        });
        streamingItems.value = [];
        streamingRawLines.length = 0;
        streamingThinkingText.value = '';
        streamingUsage.value = null;
        notifiedTodoIds.clear();
        bIsStreaming.value = false;
        scrollToBottomIfPinned();
        notifyTaskDone(
          session.value?.name ?? 'Session',
          workspaceName.value,
          lastAssistantMessage,
          props.workspaceId,
          props.sessionId
        );
      } else if (msg.type === 'error') {
        chatError.value = msg.message ?? 'Unknown error';
        streamingItems.value = [];
        streamingRawLines.length = 0;
        streamingThinkingText.value = '';
        streamingUsage.value = null;
        notifiedTodoIds.clear();
        bIsStreaming.value = false;
      } else if (msg.type === 'server-shutdown') {
        chatError.value = 'Server disconnected';
        streamingThinkingText.value = '';
        bIsStreaming.value = false;
      } else if (msg.type === 'claude_limit_detected') {
        // Handle Claude limit detection event
        handleClaudeLimitDetected(msg);
      }
    } catch {
      // ignore malformed frames
    }
  };

  webSocket.onclose = (event: CloseEvent) => {
    bWsConnected.value = false;
    webSocket = null;
    if (event.code === 4001 || event.code === 4004) {
      chatError.value = event.reason || 'Connection closed';
      return;
    }
    if (!wsUnmounted && activeTab.value === 'chat') {
      bWsReconnecting.value = true;
      wsReconnectTimer = setTimeout(() => {
        wsReconnectTimer = null;
        connectChatWs();
      }, 2000);
    }
  };

  webSocket.onerror = () => {
    bWsConnected.value = false;
    webSocket = null;
  };
}

function disconnectChatWs() {
  if (wsReconnectTimer !== null) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  bWsReconnecting.value = false;
  if (webSocket) {
    webSocket.close();
    webSocket = null;
  }
}

// ── Send prompt ───────────────────────────────────────────────────────────────
function sendPrompt() {
  const text = promptText.value.trim();
  const hasImages = pendingImages.value.length > 0;
  if ((!text && !hasImages) || !webSocket || webSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  chatError.value = null;
  const imagePaths = pendingImages.value.map((img) => img.serverPath);
  webSocket.send(JSON.stringify({ type: 'prompt', text, model: modelSelection.value, imagePaths }));
  promptText.value = '';
  pendingImages.value = [];

  nextTick(() => textareaEl.value?.focus());
}

function cancelPrompt() {
  if (!bIsStreaming.value || !webSocket || webSocket.readyState !== WebSocket.OPEN) {
    return;
  }
  webSocket.send(JSON.stringify({ type: 'cancel' }));
}

function deleteQueuedPrompt(queueItemId: string): void {
  if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
    return;
  }
  webSocket.send(JSON.stringify({ type: 'queue-delete', queueItemId }));
}

function pushQueuedPrompt(queueItemId: string): void {
  if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
    return;
  }
  webSocket.send(JSON.stringify({ type: 'queue-push', queueItemId }));
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    sendPrompt();
  }
}

// ── Session edit ──────────────────────────────────────────────────────────────
function openEditModal() {
  bShowEditModal.value = true;
}

async function saveSessionEdit(payload: { name: string; tags?: string[] | null }) {
  bSavingEdit.value = true;
  try {
    const { data: updated } = await sessionsApi.update(props.workspaceId, props.sessionId, payload);
    session.value = updated;
    bShowEditModal.value = false;
  } catch (e) {
    console.error('Failed to update session:', e);
  } finally {
    bSavingEdit.value = false;
  }
}

// ── Session delete ────────────────────────────────────────────────────────────
async function deleteSession() {
  bDeletingSession.value = true;
  try {
    await sessionsApi.remove(props.workspaceId, props.sessionId);
    router.push({ name: 'workspace', params: { id: props.workspaceId } });
  } catch (e) {
    console.error('Failed to delete session:', e);
    bDeletingSession.value = false;
    bShowDeleteModal.value = false;
  }
}

// ── Session archive ──────────────────────────────────────────────────────────
async function toggleArchive() {
  if (!session.value) return;
  try {
    const { data: updated } = await sessionsApi.update(props.workspaceId, props.sessionId, {
      archived: !session.value.archived
    });
    session.value = updated;
  } catch (e) {
    console.error('Failed to toggle archive:', e);
  }
}

function onMobileMenuEdit(): void {
  closeMobileSessionMenu();
  openEditModal();
}

async function onMobileMenuArchive(): Promise<void> {
  closeMobileSessionMenu();
  await toggleArchive();
}

function onMobileMenuDelete(): void {
  closeMobileSessionMenu();
  bShowDeleteModal.value = true;
}

// ── Session fetch ─────────────────────────────────────────────────────────────
async function fetchSession() {
  try {
    bLoading.value = true;
    error.value = null;
    const response = await sessionsApi.get(props.workspaceId, props.sessionId);
    session.value = response.data;
  } catch (e) {
    error.value = 'Failed to load session';
    console.error('Failed to fetch session:', e);
  } finally {
    bLoading.value = false;
  }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible' && !webSocket && activeTab.value === 'chat') {
    if (wsReconnectTimer !== null) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    chatError.value = null;
    connectChatWs();
  }
}

watch(promptText, (val) => {
  const key = promptStorageKey.value;
  if (!val) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, val);
  }
  nextTick(() => resizeTextarea());
});

function resizeTextarea() {
  const el = textareaEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

watch(activeTab, (tab) => {
  if (tab === 'chat' && !webSocket) {
    if (wsReconnectTimer !== null) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    connectChatWs();
  }
});

watch(
  () => props.sessionId,
  async (newId, oldId) => {
    if (!newId || newId === oldId) return;
    // reset chat state for new session
    messages.value = [];
    seenVibeMessageIds.clear();
    seenVibeToolCallIds.clear();
    streamingItems.value = [];
    streamingRawLines.length = 0;
    streamingThinkingText.value = '';
    streamingUsage.value = null;
    notifiedTodoIds.clear();
    chatError.value = null;
    session.value = null;
    bLoading.value = true;
    pendingImages.value = [];
    queuedPrompts.value = [];

    const savedPrompt = localStorage.getItem(promptStorageKey.value);
    promptText.value = savedPrompt ?? '';

    disconnectChatWs();
    await fetchSession();
    if (activeTab.value === 'chat') {
      connectChatWs();
    }
  }
);

watch(
  () => props.viewportHeight,
  async () => {
    await nextTick();
    scrollToBottom();
  }
);

onMounted(async () => {
  wsUnmounted = false;
  chatInputMql = window.matchMedia('(min-width: 768px)');
  syncChatInputBreakpoint();
  chatInputMql.addEventListener('change', syncChatInputBreakpoint);

  const savedPrompt = localStorage.getItem(promptStorageKey.value);
  if (savedPrompt != null) promptText.value = savedPrompt;

  fetchSession();
  connectChatWs();
  try {
    const { data } = await settingsApi.get();
    if (data.modelSelection != null) modelSelection.value = data.modelSelection;
    if (typeof data.claudeAutoContinue === 'boolean') {
      bClaudeAutoContinueEnabled.value = data.claudeAutoContinue;
    }
  } catch {
    // keep default 'auto'
  }
  loadAvailableModels();
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('click', handleDocumentClickMobileMenu);
  document.addEventListener('keydown', handleKeydownMobileMenu);
});

onUnmounted(() => {
  wsUnmounted = true;
  if (chatInputMql) {
    chatInputMql.removeEventListener('change', syncChatInputBreakpoint);
    chatInputMql = null;
  }
  disconnectChatWs();
  document.removeEventListener('visibilitychange', onVisibilityChange);
  document.removeEventListener('click', handleDocumentClickMobileMenu);
  document.removeEventListener('keydown', handleKeydownMobileMenu);
});
</script>

<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- Header -->

    <div class="h-16 px-4 md:px-6 flex items-center border-b border-fg/10 shrink-0 gap-3 min-w-0">
      <!-- Name + tags -->
      <div class="flex-1 min-w-0 flex flex-col gap-0.5">
        <div class="flex items-center">
          <button
            v-if="props.showSidebarToggle"
            @click="emit('toggle-sidebar')"
            class="button is-transparent is-icon mr-2"
            title="Toggle sessions"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/><path d="M19 6l-6 6 6 6"/></svg>
          </button>
          <div class="flex flex-col">
            <h1 class="text-base font-semibold text-text-primary truncate">
              {{ bLoading ? '…' : session?.name || 'Session' }}
            </h1>
            <!-- workspace name -->
            <p class="text-xs text-text-muted">
              {{ workspaceName }}
            </p>
            <span
              v-if="session?.tags?.length"
              class="inline-flex flex-wrap items-center gap-1 mt-0.5"
            >
              <span
                v-for="tag in session.tags"
                :key="tag"
                class="inline-flex items-center text-xs px-2 py-0.5 rounded-full border"
                :class="categoryColorClass(tag)"
              >
                {{ tag }}
              </span>
            </span>
          </div>
        </div>
      </div>

      <!-- Archive + Edit + Delete -->
      <div v-if="!bLoading" class="hidden lg:flex items-center gap-1 shrink-0">
        <button class="button is-transparent is-icon" title="Edit session" @click="openEditModal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
        </button>
        <button
          class="button is-transparent is-icon"
          :title="session?.archived ? 'Unarchive session' : 'Archive session'"
          @click="toggleArchive"
        >
          <svg v-if="session?.archived" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-primary" aria-hidden="true"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"/></svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-warning" aria-hidden="true"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"/></svg>
        </button>

        <button
          class="button is-transparent is-icon hover:!text-destructive hover:!bg-destructive/10"
          title="Delete session"
          @click="bShowDeleteModal = true"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-destructive" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>

      <!-- Mobile: overflow menu (Edit / Archive / Delete) -->
      <div v-if="!bLoading" ref="mobileSessionMenuRef" class="relative lg:hidden shrink-0">
        <button
          type="button"
          class="button is-transparent is-icon"
          aria-haspopup="true"
          :aria-expanded="bMobileSessionMenuOpen"
          title="Session actions"
          @click.stop="bMobileSessionMenuOpen = !bMobileSessionMenuOpen"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="0" aria-hidden="true"><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></svg>
        </button>
        <Transition name="mobile-session-menu-drop">
          <div
            v-if="bMobileSessionMenuOpen"
            class="absolute right-0 top-full mt-1 z-50 min-w-[11rem] rounded-lg border border-border bg-surface py-1 shadow-lg"
            role="menu"
            @click.stop
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
              role="menuitem"
              @click="onMobileMenuEdit"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0" aria-hidden="true"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
              Edit
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-text-primary hover:bg-fg/[0.06] transition-colors"
              role="menuitem"
              @click="onMobileMenuArchive"
            >
              <svg v-if="session?.archived" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-primary" aria-hidden="true"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M12 12v4M10 14l2-2 2 2"/></svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-warning" aria-hidden="true"><path d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4"/></svg>
              {{ session?.archived ? 'Unarchive' : 'Archive' }}
            </button>
            <button
              type="button"
              class="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-left text-destructive hover:bg-destructive/[0.08] transition-colors"
              role="menuitem"
              @click="onMobileMenuDelete"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              Delete
            </button>
          </div>
        </Transition>
      </div>
    </div>

    <div
      v-if="error"
      class="mx-4 md:mx-6 mt-4 border border-destructive/50 bg-destructive/10 text-destructive px-4 py-3 shrink-0"
    >
      {{ error }}
    </div>

    <!-- Tab content -->
    <div class="flex-1 overflow-hidden flex flex-col min-h-0">
      <!-- Chat -->
      <template v-if="activeTab === 'chat'">
        <!-- Messages -->
        <div
          ref="messagesEl"
          class="flex-1 overflow-y-auto px-4 md:px-6 py-4 space-y-3 min-h-0"
          @scroll="onMessagesScroll"
        >
          <!-- Chat skeleton -->
          <template v-if="bLoading">
            <div class="space-y-3">
              <div class="flex justify-end">
                <div class="h-10 w-48 rounded-2xl rounded-br-sm bg-fg/10 animate-pulse" />
              </div>
              <div class="flex justify-start">
                <div
                  class="h-16 w-[85%] max-w-md rounded-2xl rounded-bl-sm bg-fg/10 animate-pulse"
                />
              </div>
              <div class="flex justify-end">
                <div class="h-8 w-36 rounded-2xl rounded-br-sm bg-fg/10 animate-pulse" />
              </div>
              <div class="flex justify-start">
                <div class="h-12 w-3/4 max-w-sm rounded-2xl rounded-bl-sm bg-fg/10 animate-pulse" />
              </div>
            </div>
          </template>
          <template v-else>
            <!-- Load more -->
            <div v-if="bLoadingMore" class="flex justify-center py-2">
              <div
                class="w-5 h-5 border-2 border-surface border-t-primary rounded-full animate-spin"
              ></div>
            </div>
            <div v-else-if="bHasMore" class="flex justify-center py-2">
              <button
                class="text-xs text-text-muted hover:text-text-primary transition-colors"
                @click="
                  bLoadingMore = true;
                  webSocket!.send(JSON.stringify({ type: 'load-more', offset: messages.length }));
                "
              >
                Load older messages
              </button>
            </div>

            <!-- Empty state -->
            <div
              v-if="messages.length === 0 && !bIsStreaming && !bLoadingMore"
              class="h-full flex items-center justify-center"
            >
              <p class="text-sm text-text-muted">Start the conversation below.</p>
            </div>

            <!-- History messages -->
            <template v-for="(msg, i) in messages" :key="i">
              <!-- User bubble -->
              <div v-if="msg.role === 'user'" class="flex justify-end">
                <div class="max-w-[75%] flex flex-col items-end gap-2">
                  <div v-if="msg.imagePaths?.length" class="flex flex-wrap gap-2 justify-end">
                    <img
                      v-for="(imgPath, j) in msg.imagePaths"
                      :key="j"
                      :src="msg.imageDataUrls?.[j] ?? imageApiUrl(imgPath)"
                      class="max-h-48 max-w-[12rem] rounded-xl object-cover border border-fg/10 cursor-pointer"
                      title="View full size"
                      @click="lightboxSrc = msg.imageDataUrls?.[j] ?? imageApiUrl(imgPath)"
                    />
                  </div>
                  <div
                    v-if="msg.content"
                    class="bg-primary text-white px-4 py-2 rounded-2xl rounded-br-sm text-sm whitespace-pre-wrap break-all"
                  >
                    {{ msg.content }}
                  </div>
                </div>
              </div>

              <!-- Assistant turn -->
              <template v-else>
                <template v-for="(item, j) in parseEventsToItems(msg.events ?? [])" :key="j">
                  <div v-if="item.kind === 'text'" class="flex justify-start">
                    <div
                      class="chat-markdown max-w-[85%] bg-fg/[0.06] text-text-primary px-4 py-2 rounded-2xl rounded-bl-sm text-sm"
                      v-html="renderMd(item.text)"
                      @click="onChatMarkdownImageClick"
                    ></div>
                  </div>
                  <div v-else-if="item.kind === 'todos'" class="flex justify-start">
                    <div
                      class="max-w-[85%] w-80 rounded-xl border border-fg/10 bg-fg/[0.03] overflow-hidden"
                    >
                      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-fg/10">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none text-text-muted shrink-0" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12l2 2 4-4"/></svg>
                        <span class="text-xs font-medium text-text-primary">Todos</span>
                        <span class="ml-auto text-xs text-text-muted"
                          >{{
                            item.todoItems?.filter((t) => t.status === 'TODO_STATUS_COMPLETED')
                              .length
                          }}/{{ item.todoItems?.length }}</span
                        >
                      </div>
                      <ul class="px-3 py-1.5 space-y-1">
                        <li
                          v-for="todo in item.todoItems"
                          :key="todo.id"
                          class="flex items-start gap-2 text-xs"
                        >
                          <svg v-if="todo.status === 'TODO_STATUS_COMPLETED'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-green-500 select-none shrink-0 mt-px" aria-hidden="true"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                          <svg v-else-if="todo.status === 'TODO_STATUS_IN_PROGRESS'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-primary select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          <svg v-else-if="todo.status === 'TODO_STATUS_CANCELLED'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-text-muted select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
                          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-text-muted select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>
                          <span
                            class="leading-snug"
                            :class="
                              todo.status === 'TODO_STATUS_COMPLETED'
                                ? 'text-text-muted line-through'
                                : todo.status === 'TODO_STATUS_CANCELLED'
                                  ? 'text-text-muted line-through'
                                  : 'text-text-primary'
                            "
                            >{{ todo.content }}</span
                          >
                        </li>
                      </ul>
                    </div>
                  </div>
                  <!-- Plan card (ACP native) -->
                  <div v-else-if="item.kind === 'plan'" class="flex justify-start">
                    <div
                      class="max-w-[85%] w-80 rounded-xl border border-fg/10 bg-fg/[0.03] overflow-hidden"
                    >
                      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-fg/10">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none text-text-muted shrink-0" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                        <span class="text-xs font-medium text-text-primary">Plan</span>
                        <span class="ml-auto text-xs text-text-muted">
                          {{ item.planEntries?.filter((e) => e.status === 'completed').length }}/{{
                            item.planEntries?.length
                          }}
                        </span>
                      </div>
                      <ul class="px-3 py-1.5 space-y-1">
                        <li
                          v-for="(entry, ei) in item.planEntries"
                          :key="ei"
                          class="flex items-start gap-2 text-xs"
                        >
                          <svg v-if="entry.status === 'completed'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-green-500 select-none shrink-0 mt-px" aria-hidden="true"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                          <svg v-else-if="entry.status === 'in_progress'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-primary select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-text-muted select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>
                          <span
                            class="leading-snug"
                            :class="
                              entry.status === 'completed'
                                ? 'text-text-muted line-through'
                                : 'text-text-primary'
                            "
                            >{{ entry.content }}</span
                          >
                        </li>
                      </ul>
                    </div>
                  </div>
                  <!-- Tool card -->
                  <div v-else class="flex justify-start">
                    <div class="flex flex-col gap-0.5 max-w-[85%]">
                      <div
                        class="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-fg/10 bg-fg/[0.03] text-text-muted text-xs font-mono"
                      >
                        <span class="shrink-0" v-html="getToolIconSvg(item.toolIcon ?? '')" />
                        <span class="font-sans font-medium text-text-primary shrink-0">{{
                          item.toolName
                        }}</span>
                        <span class="truncate">{{ item.toolSummary }}</span>
                        <span class="shrink-0 ml-auto pl-2">
                          <svg v-if="item.status === 'success'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-green-500 select-none" aria-hidden="true"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                          <svg v-else-if="item.status === 'rejected'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-text-muted select-none" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                        </span>
                      </div>
                      <!-- Locations -->
                      <div v-if="item.locations?.length" class="flex flex-wrap gap-x-2 px-1">
                        <span
                          v-for="loc in item.locations"
                          :key="loc.path"
                          class="text-[11px] text-text-muted/60 font-mono"
                          >{{ loc.path.split('/').at(-1) }}{{ loc.line ? `:${loc.line}` : '' }}</span
                        >
                      </div>
                      <!-- Tool output toggle -->
                      <div v-if="item.toolOutput && item.callId" class="px-1">
                        <button
                          class="flex items-center gap-0.5 text-[11px] text-text-muted/50 hover:text-text-muted transition-colors"
                          @click="toggleToolOutput(item.callId!)"
                        >
                          <svg v-if="expandedToolOutputIds.has(item.callId!)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>
                          <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
                          output
                        </button>
                        <pre
                          v-if="expandedToolOutputIds.has(item.callId!)"
                          class="mt-1 text-[11px] font-mono text-text-muted/80 whitespace-pre-wrap break-words max-h-32 overflow-y-auto rounded bg-fg/[0.04] px-2 py-1"
                          >{{ item.toolOutput }}</pre
                        >
                      </div>
                    </div>
                  </div>
                </template>
                <!-- Fallback -->
                <div
                  v-if="
                    (parseEventsToItems(msg.events ?? []).length === 0 || !msg.events?.length) &&
                    msg.content
                  "
                  class="flex justify-start"
                >
                  <div
                    class="chat-markdown max-w-[85%] bg-fg/[0.06] text-text-primary px-4 py-2 rounded-2xl rounded-bl-sm text-sm"
                    v-html="renderMd(msg.content)"
                    @click="onChatMarkdownImageClick"
                  ></div>
                </div>
              </template>
            </template>

            <!-- Live streaming turn -->
            <template v-if="bIsStreaming">
              <template v-for="(item, j) in streamingItems" :key="'s' + j">
                <div v-if="item.kind === 'text'" class="flex justify-start">
                  <div
                    class="chat-markdown max-w-[85%] bg-fg/[0.06] text-text-primary px-4 py-2 rounded-2xl rounded-bl-sm text-sm"
                    v-html="renderMd(item.text)"
                    @click="onChatMarkdownImageClick"
                  ></div>
                </div>
                <div v-else-if="item.kind === 'todos'" class="flex justify-start">
                  <div
                    class="max-w-[85%] w-80 rounded-xl border border-fg/10 bg-fg/[0.03] overflow-hidden"
                  >
                    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-fg/10">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none text-text-muted shrink-0" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12l2 2 4-4"/></svg>
                      <span class="text-xs font-medium text-text-primary">Todos</span>
                      <span v-if="item.status === 'running'" class="ml-auto">
                        <svg class="animate-spin text-primary select-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                      </span>
                      <span v-else class="ml-auto text-xs text-text-muted"
                        >{{
                          item.todoItems?.filter((t) => t.status === 'TODO_STATUS_COMPLETED')
                            .length
                        }}/{{ item.todoItems?.length }}</span
                      >
                    </div>
                    <ul class="px-3 py-1.5 space-y-1">
                      <li
                        v-for="todo in item.todoItems"
                        :key="todo.id"
                        class="flex items-start gap-2 text-xs"
                      >
                        <svg v-if="todo.status === 'TODO_STATUS_COMPLETED'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-green-500 select-none shrink-0 mt-px" aria-hidden="true"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        <svg v-else-if="todo.status === 'TODO_STATUS_IN_PROGRESS'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-primary select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <svg v-else-if="todo.status === 'TODO_STATUS_CANCELLED'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-text-muted select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
                        <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-text-muted select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>
                        <span
                          class="leading-snug"
                          :class="
                            todo.status === 'TODO_STATUS_COMPLETED'
                              ? 'text-text-muted line-through'
                              : todo.status === 'TODO_STATUS_CANCELLED'
                                ? 'text-text-muted line-through'
                                : 'text-text-primary'
                          "
                          >{{ todo.content }}</span
                        >
                      </li>
                    </ul>
                  </div>
                </div>
                <!-- Plan card (ACP native) — live -->
                <div v-else-if="item.kind === 'plan'" class="flex justify-start">
                  <div
                    class="max-w-[85%] w-80 rounded-xl border border-fg/10 bg-fg/[0.03] overflow-hidden"
                  >
                    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-fg/10">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none text-text-muted shrink-0" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                      <span class="text-xs font-medium text-text-primary">Plan</span>
                      <span class="ml-auto text-xs text-text-muted">
                        {{ item.planEntries?.filter((e) => e.status === 'completed').length }}/{{
                          item.planEntries?.length
                        }}
                      </span>
                    </div>
                    <ul class="px-3 py-1.5 space-y-1">
                      <li
                        v-for="(entry, ei) in item.planEntries"
                        :key="ei"
                        class="flex items-start gap-2 text-xs"
                      >
                        <svg v-if="entry.status === 'completed'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-green-500 select-none shrink-0 mt-px" aria-hidden="true"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        <svg v-else-if="entry.status === 'in_progress'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-primary animate-pulse select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-text-muted select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>
                        <span
                          class="leading-snug"
                          :class="
                            entry.status === 'completed'
                              ? 'text-text-muted line-through'
                              : entry.status === 'in_progress'
                                ? 'text-text-primary'
                                : 'text-text-muted/70'
                          "
                          >{{ entry.content }}</span
                        >
                      </li>
                    </ul>
                  </div>
                </div>
                <!-- Tool card — live -->
                <div v-else class="flex justify-start">
                  <div class="flex flex-col gap-0.5 max-w-[85%]">
                    <div
                      class="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-fg/10 bg-fg/[0.03] text-text-muted text-xs font-mono"
                    >
                      <span class="shrink-0" v-html="getToolIconSvg(item.toolIcon ?? '')" />
                      <span class="font-sans font-medium text-text-primary shrink-0">{{
                        item.toolName
                      }}</span>
                      <span class="truncate">{{ item.toolSummary }}</span>
                      <span class="shrink-0 ml-auto pl-2">
                        <svg v-if="item.status === 'running'" class="animate-spin text-primary select-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                        <svg v-else-if="item.status === 'success'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-green-500 select-none" aria-hidden="true"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                        <svg v-else-if="item.status === 'rejected'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-text-muted select-none" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                      </span>
                    </div>
                    <!-- Locations -->
                    <div v-if="item.locations?.length" class="flex flex-wrap gap-x-2 px-1">
                      <span
                        v-for="loc in item.locations"
                        :key="loc.path"
                        class="text-[11px] text-text-muted/60 font-mono"
                        >{{ loc.path.split('/').at(-1) }}{{ loc.line ? `:${loc.line}` : '' }}</span
                      >
                    </div>
                    <!-- Tool output toggle -->
                    <div v-if="item.toolOutput && item.callId" class="px-1">
                      <button
                        class="flex items-center gap-0.5 text-[11px] text-text-muted/50 hover:text-text-muted transition-colors"
                        @click="toggleToolOutput(item.callId!)"
                      >
                        <svg v-if="expandedToolOutputIds.has(item.callId!)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>
                        <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
                        output
                      </button>
                      <pre
                        v-if="expandedToolOutputIds.has(item.callId!)"
                        class="mt-1 text-[11px] font-mono text-text-muted/80 whitespace-pre-wrap break-words max-h-32 overflow-y-auto rounded bg-fg/[0.04] px-2 py-1"
                        >{{ item.toolOutput }}</pre
                      >
                    </div>
                  </div>
                </div>
              </template>
              <!-- Token usage meter -->
              <div v-if="streamingUsage" class="flex justify-start">
                <div
                  class="flex items-center gap-1.5 px-2 py-1 text-[11px] text-text-muted/50 font-mono"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none shrink-0" aria-hidden="true"><path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M12 12l-3-3"/></svg>
                  {{ streamingUsage.used.toLocaleString() }} /
                  {{ streamingUsage.size.toLocaleString() }}
                  <template v-if="streamingUsage.cost">
                    <span class="text-text-muted/30">·</span>
                    ${{ streamingUsage.cost.amount.toFixed(4) }}
                  </template>
                </div>
              </div>
              <!-- Model thinking (Cursor stream-json): keep visible until the turn ends (not busy) -->
              <div
                v-if="streamingThinkingText.trim() && !hideThinkingOutput"
                class="flex justify-start"
              >
                <div
                  class="flex h-[240px] max-w-[85%] min-h-0 flex-col overflow-hidden rounded-xl border border-fg/10 border-dashed bg-fg/[0.03] px-3 py-2 text-xs text-text-muted"
                >
                  <div
                    class="flex shrink-0 items-center gap-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted/90"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none shrink-0" aria-hidden="true"><path d="M9 12a3 3 0 006 0 3 3 0 00-6 0"/><path d="M12 2a7 7 0 00-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 002 2h4a2 2 0 002-2v-2.26A7 7 0 0012 2z"/><path d="M9 17v1a3 3 0 006 0v-1"/></svg>
                    Thinking
                  </div>
                  <!-- Nested min-h-0 + overflow-hidden gives the inner scroller a real height cap (flex quirk). -->
                  <div class="min-h-0 flex-1 overflow-hidden">
                    <!-- column-reverse: scrollport stays anchored to the latest streamed text (CSS-only tail). -->
                    <div
                      class="flex h-full max-h-full flex-col-reverse overflow-y-auto overflow-x-hidden [overflow-anchor:none]"
                    >
                      <pre
                        class="w-full min-w-0 whitespace-pre-wrap break-words font-sans leading-snug text-text-muted"
                      >{{ streamingThinkingText }}</pre>
                    </div>
                  </div>
                </div>
              </div>
              <!-- Thinking indicator (no streamed content yet) -->
              <div
                v-if="
                  streamingItems.length === 0 &&
                  (!streamingThinkingText.trim() || hideThinkingOutput)
                "
                class="flex justify-start"
              >
                <div class="bg-fg/[0.06] px-4 py-2 rounded-2xl rounded-bl-sm">
                  <span class="inline-flex items-center gap-1 text-text-muted">
                    <span class="animate-pulse text-sm">●</span>
                    <span class="animate-pulse text-sm" style="animation-delay: 0.2s">●</span>
                    <span class="animate-pulse text-sm" style="animation-delay: 0.4s">●</span>
                  </span>
                </div>
              </div>
            </template>

            <!-- Inline chat error -->
            <div v-if="chatError" class="flex justify-center">
              <div
                class="text-xs text-destructive bg-destructive/10 border border-destructive/30 px-3 py-1.5 rounded-lg"
              >
                {{ chatError }}
              </div>
            </div>

            <!-- Pinned-to-bottom follows this (incl. live thinking), not a fixed inner scroll on the thinking pre -->
            <div ref="messagesScrollAnchor" class="h-px w-full shrink-0" aria-hidden="true" />
          </template>
        </div>

        <!-- Scroll to bottom button -->
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 translate-y-2"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 translate-y-2"
        >
          <div v-if="bShowScrollToBottom" class="flex justify-center py-2 shrink-0">
            <div class="chat-fixed-actions">
            <button
              v-if="bIsStreaming"
              @click="cancelPrompt"
              class="button is-transparent is-icon chat-fixed-action !text-destructive hover:!bg-destructive/10"
              title="Stop"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>
            </button>
            <button
              @click="scrollToBottom(true)"
              class="button is-transparent is-icon chat-fixed-action"
              title="Scroll to bottom"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
            </button>
            </div>
          </div>
        </Transition>

        <!-- Floating stop button (when already at bottom) -->
        <div v-if="bIsStreaming && !bShowScrollToBottom" class="flex justify-center py-2 shrink-0">
          <button
            @click="cancelPrompt"
            class="button is-transparent is-icon chat-fixed-action !text-destructive hover:!bg-destructive/10"
            title="Stop"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>
          </button>
        </div>

        <!-- Reconnecting indicator -->
        <div v-if="bWsReconnecting" class="flex justify-center py-1.5 shrink-0">
          <span class="text-xs text-text-muted flex items-center gap-1.5">
            <span
              class="w-3 h-3 border border-text-muted/40 border-t-text-muted rounded-full animate-spin inline-block"
            ></span>
            Reconnecting…
          </span>
        </div>

        <!-- Input bar -->
        <div class="pt-2 pb-3 border-t border-fg/10 flex flex-col gap-2 shrink-0">
          <div v-if="queuedPrompts.length > 0" class="px-2">
            <div class="rounded-md border border-fg/10 bg-fg/[0.03] p-2">
              <div class="text-[11px] font-medium text-text-muted uppercase tracking-wide">
                Queue ({{ queuedPrompts.length }})
              </div>
              <div
                v-for="item in queuedPrompts"
                :key="item.id"
                class="flex items-start gap-2 px-1 py-1.5"
              >
                <div class="flex-1 min-w-0">
                  <div class="text-xs text-text-primary break-words whitespace-pre-wrap line-clamp-2">
                    {{ item.text || '(Images only)' }}
                  </div>
                  <div v-if="item.imagePaths?.length" class="text-[11px] text-text-muted mt-0.5">
                    {{ item.imagePaths.length }} image{{ item.imagePaths.length === 1 ? '' : 's' }}
                  </div>
                </div>
                <button
                  type="button"
                  title="Send next"
                  class="button is-transparent is-icon h-7! w-7! min-w-7! px-0!"
                  @click="pushQueuedPrompt(item.id)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                </button>
                <button
                  type="button"
                  title="Remove from queue"
                  class="button is-transparent is-icon h-7! w-7! min-w-7! px-0!"
                  @click="deleteQueuedPrompt(item.id)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                </button>
              </div>
            </div>
          </div>
          <!-- Pending image previews -->
          <div
            v-if="pendingImages.length > 0 || bUploadingImage"
            class="flex flex-wrap gap-2 pb-1 px-2"
          >
            <div v-for="(img, i) in pendingImages" :key="i" class="relative shrink-0">
              <img
                :src="img.dataUrl"
                class="h-16 w-16 object-cover rounded-lg border border-fg/10 cursor-pointer"
                title="View full size"
                @click="lightboxSrc = img.dataUrl"
              />
              <button
                type="button"
                @click.stop="pendingImages.splice(i, 1)"
                class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-white rounded-full text-xs flex items-center justify-center leading-none shadow-sm"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div
              v-if="bUploadingImage"
              class="h-16 w-16 rounded-lg border border-fg/10 bg-fg/[0.06] flex items-center justify-center shrink-0"
            >
              <span
                class="w-4 h-4 border-2 border-surface border-t-primary rounded-full animate-spin inline-block"
              ></span>
            </div>
          </div>
          <div class="flex items-end gap-2 px-2">
            <div
              class="flex flex-1 min-w-0 min-h-[44px] items-end gap-0.5 rounded-md border border-fg/10 bg-fg/[0.06] pl-1 pr-1 transition-colors focus-within:border-primary/50"
            >
              <button
                type="button"
                @click="openModelSettings"
                title="Model settings"
                class="button is-transparent is-icon h-[36px]! mb-[3px]! px-0! aspect-square! shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><path d="M4 21V14M4 10V3M12 21V12M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>
              </button>
              <textarea
                ref="textareaEl"
                v-model="promptText"
                @keydown.enter="onKeydown"
                @paste="onPaste"
                :placeholder="promptPlaceholder"
                rows="1"
                class="flex-1 min-w-0 resize-none self-center bg-transparent text-text-primary placeholder-text-muted text-sm px-2 py-1.5 leading-5 rounded-none border-0 shadow-none focus:outline-none focus:ring-0 box-border"
                style="height: 32px; max-height: 160px; overflow-y: auto"
              ></textarea>
              <button
                type="button"
                @click="onAttachClick"
                :disabled="bIsStreaming"
                title="Attach image"
                class="button is-transparent is-icon h-[36px]! mb-[3px]! px-0! aspect-square! shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
              </button>
            </div>
            <input
              ref="fileInputEl"
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              @change="onFileChange"
            />
            <button
              type="button"
              @click="sendPrompt"
              :disabled="(!promptText.trim() && !pendingImages.length) || !bWsConnected"
              class="button is-primary is-icon !h-[44px] !w-[44px] !min-w-[44px] shrink-0 !rounded-md !p-0"
            >
              <svg v-if="bIsStreaming" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none send-wait-hourglass" aria-hidden="true"><path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 00-.586-1.414L12 12M7 22v-4.172a2 2 0 01.586-1.414L12 12M17 2v4.172a2 2 0 01-.586 1.414L12 12M7 2v4.172a2 2 0 00.586 1.414L12 12"/></svg>
              <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </template>

      <!-- Files -->
      <FilesView
        v-else-if="activeTab === 'files'"
        :workspace-id="workspaceId"
        :active="activeTab === 'files'"
      />

      <!-- Git -->
      <GitView
        v-else-if="activeTab === 'git'"
        :workspace-id="workspaceId"
        :active="activeTab === 'git'"
      />
    </div>

    <!-- Bottom tabs -->
    <div
      class="flex border-t border-fg/10 shrink-0 md:border-none md:justify-center md:pb-4 md:mb-4"
    >
      <div
        class="flex flex-1 max-w-md mx-auto md:flex-none md:inline-flex md:items-center md:gap-1.5 md:px-1.5 md:py-1.5 md:rounded-full md:border md:border-fg/15 md:bg-fg/[0.02] md:shadow-sm"
      >
        <button
          class="flex-1 md:flex-none px-4 py-3 text-sm md:px-4 md:py-2 md:text-sm font-medium transition-colors border-t-2 md:border-t-0 md:rounded-full"
          :class="
            activeTab === 'chat'
              ? 'border-primary text-text-primary bg-fg/[0.03]'
              : 'border-transparent text-text-muted hover:text-text-primary hover:bg-fg/[0.04]'
          "
          @click="activeTab = 'chat'"
        >
          Chat
        </button>
        <button
          class="flex-1 md:flex-none px-4 py-3 text-sm md:px-4 md:py-2 md:text-sm font-medium transition-colors border-t-2 md:border-t-0 md:rounded-full"
          :class="
            activeTab === 'files'
              ? 'border-primary text-text-primary bg-fg/[0.03]'
              : 'border-transparent text-text-muted hover:text-text-primary hover:bg-fg/[0.04]'
          "
          @click="activeTab = 'files'"
        >
          Files
        </button>
        <button
          class="flex-1 md:flex-none px-4 py-3 text-sm md:px-4 md:py-2 md:text-sm font-medium transition-colors border-t-2 md:border-t-0 md:rounded-full"
          :class="
            activeTab === 'git'
              ? 'border-primary text-text-primary bg-fg/[0.03]'
              : 'border-transparent text-text-muted hover:text-text-primary hover:bg-fg/[0.04]'
          "
          @click="activeTab = 'git'"
        >
          Git
        </button>
      </div>
    </div>

    <ConfirmModal
      v-model="bShowDeleteModal"
      title="Delete session"
      :description="`Delete '${session?.name}'? All messages will be lost and this cannot be undone.`"
      confirm-label="Delete"
      :loading="bDeletingSession"
      @confirm="deleteSession"
    />

    <SessionEditModal
      v-model="bShowEditModal"
      :session="session"
      :loading="bSavingEdit"
      :existing-tags="sessionTagSuggestions"
      @save="saveSessionEdit"
    />

    <!-- Model settings (Cursor) -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div
          v-if="bShowModelSelector"
          class="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-model-title"
        >
          <div class="absolute inset-0 bg-black/75 backdrop-blur-sm" @click="closeModelSettings" />
          <div
            class="modal-panel relative w-full max-w-sm bg-surface border border-fg/[0.09] rounded-2xl shadow-2xl shadow-black/60"
          >
            <div class="px-6 pt-5 pb-2">
              <h2 id="chat-model-title" class="font-semibold text-text-primary text-lg">Chat settings</h2>
              <p class="text-xs text-text-muted mt-1">
                Display options for this session.
              </p>
            </div>
            <div class="px-6 pb-5 space-y-4">
              <div v-if="session?.agentType === 'cursor-agent' || session?.agentType === 'open-code'">
                <label
                  for="model-select-modal"
                  class="block text-xs font-medium text-text-muted mb-1.5"
                  >Model</label
                >
                <select
                  id="model-select-modal"
                  :value="modelSelection"
                  @change="(e) => onModelChange((e.target as HTMLSelectElement).value)"
                  :disabled="bIsStreaming || bModelsLoading"
                  class="w-full text-sm px-3 py-3 rounded-lg border border-fg/[0.12] bg-fg/[0.04] text-text-primary focus:outline-none focus:border-primary/50 transition-colors disabled:opacity-50"
                >
                  <option v-for="m in (session?.agentType === 'open-code' ? openCodeModels : availableModels)" :key="m.id" :value="m.id">
                    {{ m.label }}
                  </option>
                </select>
              </div>
              <label
                class="flex cursor-pointer items-start gap-3 rounded-lg border border-fg/[0.12] bg-fg/[0.04] px-3 py-3 text-sm text-text-primary"
              >
                <input
                  id="hide-thinking-modal"
                  type="checkbox"
                  class="mt-0.5 h-4 w-4 shrink-0 rounded border-fg/[0.2] text-primary focus:ring-primary/40"
                  :checked="hideThinkingOutput"
                  @change="
                    onHideThinkingToggle(($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="min-w-0">
                  <span class="font-medium text-text-primary">Hide thinking output</span>
                  <span class="mt-0.5 block text-xs text-text-muted leading-snug">
                    When enabled, extended reasoning / thinking output is not shown in the chat
                    (saved in this browser only).
                  </span>
                </span>
              </label>
            </div>
            <div class="flex items-center justify-end gap-2 px-6 pb-5">
              <button
                type="button"
                class="px-4 py-2.5 text-sm font-medium bg-primary hover:bg-primary-hover text-white rounded-lg shadow-lg shadow-primary/20 transition-colors"
                @click="closeModelSettings"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Image lightbox -->
    <Teleport to="body">
      <Transition name="lightbox">
        <div
          v-if="lightboxSrc"
          class="lightbox-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          @click.self="lightboxSrc = null"
        >
          <button
            type="button"
            class="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-fg/10 text-white hover:bg-fg/20 transition-colors"
            @click="lightboxSrc = null"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
          <img
            :src="lightboxSrc"
            alt=""
            class="lightbox-img max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
        </div>
      </Transition>
    </Teleport>
  </div>

  <!-- Claude Limit Popup -->
  <ClaudeLimitPopup
    :show="bShowClaudeLimitPopup"
    :reset-time="claudeLimitResetTime"
    :reset-time-readable="claudeLimitResetTimeReadable"
    :initial-auto-continue="bClaudeAutoContinueEnabled"
    @update:show="bShowClaudeLimitPopup = $event"
    @auto-continue-updated="handleAutoContinueUpdated"
  />
</template>

<style scoped>
.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.22s ease;
}

.lightbox-enter-active .lightbox-img,
.lightbox-leave-active .lightbox-img {
  transition:
    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.22s ease;
}

.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}

.lightbox-enter-from .lightbox-img,
.lightbox-leave-to .lightbox-img {
  opacity: 0;
  transform: scale(0.94);
}

.lightbox-enter-to .lightbox-img,
.lightbox-leave-from .lightbox-img {
  opacity: 1;
  transform: scale(1);
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.mobile-session-menu-drop-enter-active,
.mobile-session-menu-drop-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
  transform-origin: top right;
}

.mobile-session-menu-drop-enter-from,
.mobile-session-menu-drop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.mobile-session-menu-drop-enter-to,
.mobile-session-menu-drop-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}

.send-wait-hourglass {
  display: inline-block;
  transform-origin: center;
  animation: send-hourglass-flip 1.2s ease-in-out infinite;
}

.chat-fixed-actions {
  display: inline-flex;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 0.375rem;
  overflow: hidden;
  background: rgb(255 255 255 / 0.04);
}

.chat-fixed-action {
  border: 0 !important;
  border-radius: 0 !important;
  width: 2rem !important;
  min-width: 2rem !important;
  height: 2rem !important;
}

@keyframes send-hourglass-flip {
  0% {
    transform: rotate(0deg);
  }
  22% {
    transform: rotate(180deg);
  }
  100% {
    transform: rotate(180deg);
  }
}
</style>

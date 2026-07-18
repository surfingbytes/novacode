<script setup lang="ts">
// node_modules
import { ref, computed, onMounted, onUnmounted, nextTick, watch, inject } from 'vue';
import { useRouter } from 'vue-router';
import { marked } from 'marked';
import { Bug, ChevronDown, Infinity as InfinityIcon, ListChecks, ListTodo, MessageSquare } from 'lucide-vue-next';

// components
import FilesView from '@/components/workspace/FilesComponent.vue';
import GitView from '@/components/workspace/GitView.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import SessionEditModal from '@/components/SessionEditModal.vue';
import ClaudeLimitPopup from '@/components/ClaudeLimitPopup.vue';
import AgentModelPicker from '@/components/AgentModelPicker.vue';

// classes
import {
  sessionsApi,
  settingsApi,
  buildChatWsUrl,
  type AgentErrorCode
} from '@/classes/api';
import { notifyTaskDone, notifyTodoCompleted } from '@/lib/notifications';

// stores
import { useWorkspacesStore } from '@/stores/workspaces';

// types
import type { AgentConfigOption, AgentModeOption, AgentModelOption, ChatMessage, ChatQueueItem, ChatWsServerMessage, LinkedPlanContext, PlanDocumentSummary, Session } from '@/@types/index';
import { APP_NAV_TOGGLE_KEY } from '@/constants/layout';

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
  (e: 'start-plan-session', payload: {
    defaultName: string;
    draftPrompt: string;
    linkedPlanContext?: LinkedPlanContext;
    defaultAgentType?: Session['agentType'];
    defaultModelSelection?: string;
  }): void;
}>();

// -------------------------------------------------- Store --------------------------------------------------
const router = useRouter();
const workspacesStore = useWorkspacesStore();
const toggleAppNav = inject(APP_NAV_TOGGLE_KEY, null);

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
const bModeMenuOpen = ref(false);
const modeMenuRef = ref<HTMLElement | null>(null);
const bPlanActionsMenuOpen = ref(false);
const planActionsMenuRef = ref<HTMLElement | null>(null);

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
function normalizeMarkdownForRendering(src: string): string {
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

function renderMd(src: string | undefined): string {
  if (!src) {
    return '';
  }
  return marked.parse(normalizeMarkdownForRendering(src), { async: false }) as string;
}

function setChatError(message: string, code?: AgentErrorCode | null): void {
  chatError.value = message;
  chatErrorCode.value = code ?? null;
}

function clearChatError(): void {
  chatError.value = null;
  chatErrorCode.value = null;
}

function retryLastPrompt(): void {
  if (!lastPromptRequest.value || !webSocket || webSocket.readyState !== WebSocket.OPEN) return;
  clearChatError();
  webSocket.send(
    JSON.stringify({
      type: 'prompt',
      text: lastPromptRequest.value.text,
      model: modelSelection.value,
      imagePaths: lastPromptRequest.value.imagePaths
    })
  );
}

function handleChatErrorAction(): void {
  if (chatErrorCode.value === 'auth_required') {
    router.push({ name: 'settings' });
    return;
  }
  if (chatErrorCode.value === 'timeout') {
    retryLastPrompt();
  }
}

function closeMobileSessionMenu(): void {
  bMobileSessionMenuOpen.value = false;
}

function closeModeMenu(): void {
  bModeMenuOpen.value = false;
}

function closePlanActionsMenu(): void {
  bPlanActionsMenuOpen.value = false;
}

function handleDocumentClickMobileMenu(e: MouseEvent): void {
  const target = e.target as Node;
  const mobileEl = mobileSessionMenuRef.value;
  if (bMobileSessionMenuOpen.value && mobileEl && !mobileEl.contains(target)) {
    closeMobileSessionMenu();
  }
  const modeEl = modeMenuRef.value;
  if (bModeMenuOpen.value && modeEl && !modeEl.contains(target)) {
    closeModeMenu();
  }
  const planActionsEl = planActionsMenuRef.value;
  if (bPlanActionsMenuOpen.value && planActionsEl && !planActionsEl.contains(target)) {
    closePlanActionsMenu();
  }
}

function handleKeydownMobileMenu(e: KeyboardEvent): void {
  if (e.key === 'Escape' && bMobileSessionMenuOpen.value) closeMobileSessionMenu();
  if (e.key === 'Escape' && bModeMenuOpen.value) closeModeMenu();
  if (e.key === 'Escape' && bPlanActionsMenuOpen.value) closePlanActionsMenu();
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

type SessionTab = 'chat' | 'files' | 'git' | 'plan';
const activeTab = ref<SessionTab>('chat');

// ── Chat state ───────────────────────────────────────────────────────────────
const messages = ref<ChatMessage[]>([]);
const bIsStreaming = ref(false);
const chatError = ref<string | null>(null);
const chatErrorCode = ref<AgentErrorCode | null>(null);
const promptText = ref<string>('');
const messagesEl = ref<HTMLElement | null>(null);
/** Bottom sentinel inside the scroll area so follow-bottom includes streaming + thinking. */
const messagesScrollAnchor = ref<HTMLElement | null>(null);
const textareaEl = ref<HTMLTextAreaElement | null>(null);
const promptInputBoxRef = ref<HTMLElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);
const lightboxSrc = ref<string | null>(null);
const bShowScrollToBottom = ref(false);
const modelSelection = ref<string>('auto');
const MODE_SENTINEL = 'default';
const sessionMode = ref<string>(MODE_SENTINEL);
const acpReportedModeId = ref<string | null>(null);
const acpReportedModelId = ref<string | null>(null);

const HIDE_THINKING_LS_KEY = 'nova:chat:hideThinkingOutput';

function readHideThinkingFromLs(): boolean {
  try {
    return localStorage.getItem(HIDE_THINKING_LS_KEY) === '1';
  } catch {
    return false;
  }
}

const hideThinkingOutput = ref(readHideThinkingFromLs());
const modelOptions = ref<AgentModelOption[]>([]);
const modeOptions = ref<AgentModeOption[]>([]);
const agentConfigOptions = ref<AgentConfigOption[]>([]);
const sessionConfig = ref<Record<string, string>>({});
const bModelsLoading = ref(false);
const bModesLoading = ref(false);
const bConfigLoading = ref(false);
const bSavingModelSelection = ref(false);
const bSavingSessionMode = ref(false);
const bSavingSessionConfig = ref(false);
const bShowAllCursorModels = ref(false);
let modelSelectionSaveSeq = 0;
let sessionModeSaveSeq = 0;
const queuedPrompts = ref<ChatQueueItem[]>([]);
const lastPromptRequest = ref<{ text: string; imagePaths: string[] } | null>(null);
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

const chatErrorActionLabel = computed(() => {
  if (chatErrorCode.value === 'auth_required') return 'Open Settings';
  if (chatErrorCode.value === 'timeout' && lastPromptRequest.value) return 'Try again';
  return '';
});

// ── Attachments ───────────────────────────────────────────────────────────────
interface PendingAttachment {
  filename: string;
  displayName: string;
  dataUrl: string;
  serverPath: string;
  isImage: boolean;
}

const pendingImages = ref<PendingAttachment[]>([]);
const bUploadingImage = ref(false);

const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp)$/i;

function isImageAttachmentPath(path: string): boolean {
  return IMAGE_PATH_RE.test(path);
}

function attachmentDisplayName(path: string): string {
  return path.split('/').pop() ?? path;
}

function imageApiUrl(serverPath: string): string {
  // serverPath is <configDir>/prompt-images/<sessionId>/<filename>
  const parts = serverPath.split('/');
  const fname = parts[parts.length - 1];
  const sid = parts[parts.length - 2];
  return sessionsApi.imageUrl(sid, fname);
}

/** Markdown-rendered assistant bubbles: copy code blocks and open images in the lightbox */
async function copyCodeBlockFromEvent(e: MouseEvent): Promise<void> {
  const btn = (e.target as HTMLElement | null)?.closest('.code-copy-btn') as HTMLButtonElement | null;
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const code = btn.closest('.code-block-card')?.querySelector('code');
  const text = code?.textContent ?? '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    btn.setAttribute('aria-label', 'Copied');
    btn.setAttribute('title', 'Copied');
    btn.dataset.copied = '1';
    window.setTimeout(() => {
      btn.textContent = prev ?? 'Copy';
      btn.setAttribute('aria-label', 'Copy code');
      btn.setAttribute('title', 'Copy');
      delete btn.dataset.copied;
    }, 2000);
  } catch {
    // Clipboard may be unavailable; leave button unchanged.
  }
}

function onChatMarkdownClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest('.code-copy-btn')) {
    void copyCodeBlockFromEvent(e);
    return;
  }
  if (!(target instanceof HTMLImageElement)) return;
  e.preventDefault();
  e.stopPropagation();
  const src = target.currentSrc || target.src;
  if (src) lightboxSrc.value = src;
}

function uploadAttachmentFile(file: File): void {
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const dataUrl = ev.target?.result as string;
    const base64 = dataUrl.split(',')[1];
    const isImage = file.type.startsWith('image/') || isImageAttachmentPath(file.name);
    bUploadingImage.value = true;
    try {
      const mimeType = file.type || 'application/octet-stream';
      const { data } = await sessionsApi.uploadImage(
        props.sessionId,
        base64,
        mimeType,
        file.name
      );
      pendingImages.value.push({
        filename: data.filename,
        displayName: file.name,
        dataUrl: isImage ? dataUrl : '',
        serverPath: data.path,
        isImage
      });
    } catch {
      setChatError('Failed to upload file');
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
    if (file) uploadAttachmentFile(file);
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
    uploadAttachmentFile(file);
  }
  // allow selecting the same file again
  input.value = '';
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sortLabelValues(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

const THINKING_ORDER = ['auto', 'default', 'none', 'minimal', 'low', 'medium', 'high', 'max'];
const MORE_MODEL_OPTION_VALUE = '__more_models__';
const CURSOR_MODEL_VALUE_PREFIX = 'model:';
const CURSOR_PRESET_VALUE_PREFIX = 'preset:';
const CURSOR_CURRENT_VALUE_PREFIX = 'current:';
const BASIC_CURSOR_MODEL_PRESETS = [
  { label: 'Auto', thinking: 'Auto', modelNames: ['Auto'] },
  { label: 'Composer 2.5', thinking: 'Fast', modelNames: ['Composer 2.5'] },
  { label: 'Opus 4.8', thinking: 'High', modelNames: ['Claude Opus 4 8'] },
  { label: 'GPT 5.5', thinking: 'Medium', modelNames: ['GPT 5.5'] },
  { label: 'Fable 5', thinking: 'High', modelNames: ['Claude Fable 5'] },
  { label: 'Sonnet 5', thinking: 'High', modelNames: ['Claude Sonnet 5'] },
  { label: 'Sonnet 4.6', thinking: 'Medium', modelNames: ['Claude 4.6 Sonnet'] },
  { label: 'Codex 5.3', thinking: 'Medium', modelNames: ['GPT 5.3 Codex'] }
];
type CursorModelPreset = (typeof BASIC_CURSOR_MODEL_PRESETS)[number];
type ModelSelectOption = { value: string; label: string };

function thinkingRank(value: string): number {
  const lower = value.toLowerCase();
  const direct = THINKING_ORDER.indexOf(lower);
  if (direct >= 0) return direct;
  if (lower.includes('minimal')) return THINKING_ORDER.indexOf('minimal');
  if (lower.includes('low')) return THINKING_ORDER.indexOf('low');
  if (lower.includes('medium')) return THINKING_ORDER.indexOf('medium');
  if (lower.includes('high')) return THINKING_ORDER.indexOf('high');
  if (lower.includes('max')) return THINKING_ORDER.indexOf('max');
  return THINKING_ORDER.length;
}

function sortThinkingValues(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const rankDiff = thinkingRank(a) - thinkingRank(b);
    return rankDiff || a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
}

function normalizeModelName(value: string): string {
  return value.trim().toLowerCase();
}

function cursorPresetValue(label: string): string {
  return `${CURSOR_PRESET_VALUE_PREFIX}${label}`;
}

function cursorCurrentValue(id: string): string {
  return `${CURSOR_CURRENT_VALUE_PREFIX}${id}`;
}

function cursorModelValue(model: string): string {
  return `${CURSOR_MODEL_VALUE_PREFIX}${model}`;
}

function optionMatchesCursorPreset(option: AgentModelOption, preset: CursorModelPreset): boolean {
  return preset.modelNames.includes(option.model);
}

function findCursorPresetForOption(option: AgentModelOption): CursorModelPreset | null {
  return BASIC_CURSOR_MODEL_PRESETS.find((preset) => optionMatchesCursorPreset(option, preset)) ?? null;
}

function findCursorPresetByLabel(label: string): CursorModelPreset | null {
  return BASIC_CURSOR_MODEL_PRESETS.find((preset) => preset.label === label) ?? null;
}

function pickPreferredValue(values: string[], preferred: string[]): string {
  for (const want of preferred) {
    const found = values.find((value) => normalizeModelName(value) === normalizeModelName(want));
    if (found) return found;
  }
  return values[0] ?? preferred[0] ?? 'Default';
}

function parseContextSize(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto' || normalized === 'default') return 0;
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([km])?$/);
  if (!match) return Number.POSITIVE_INFINITY;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === 'm') return amount * 1_000_000;
  if (unit === 'k') return amount * 1_000;
  return amount;
}

function sortContextValues(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const sizeDiff = parseContextSize(a) - parseContextSize(b);
    return sizeDiff || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
}

const FALLBACK_THINKING_VALUES = ['minimal', 'low', 'medium', 'high', 'max', 'fast', 'none'];
const FALLBACK_CONTEXT_VALUES = ['32k', '64k', '128k', '200k', '256k', '1m', '2m'];

function titleModelToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === 'gpt') return 'GPT';
  if (/^\d/.test(token)) return token.toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function prettifyModelId(id: string): string {
  return id
    .split(/[/:_\-\s]+/)
    .filter(Boolean)
    .map(titleModelToken)
    .join(' ');
}

function parseConfiguredModelId(id: string): { baseId: string; config: Record<string, string> } | null {
  const match = id.match(/^([^\[]+)\[([^\]]+)\]$/);
  if (!match) return null;

  const config: Record<string, string> = {};
  for (const part of match[2].split(',')) {
    const [keyRaw, ...valueParts] = part.split('=');
    const key = keyRaw?.trim().toLowerCase();
    const value = valueParts.join('=').trim();
    if (key && value) config[key] = value;
  }

  return { baseId: match[1].trim(), config };
}

function normalizeFallbackContext(value: string | undefined): string {
  if (!value) return 'Default';
  const lower = value.toLowerCase();
  if (lower.endsWith('m')) return `${lower.slice(0, -1)}M`;
  if (lower.endsWith('k')) return `${lower.slice(0, -1)}K`;
  return titleModelToken(value);
}

function normalizeFallbackFast(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  return null;
}

function fallbackModelOption(id: string): AgentModelOption {
  if (!id || id === 'auto') {
    return { id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null };
  }

  const configured = parseConfiguredModelId(id);
  if (configured) {
    return {
      id,
      label: id,
      model: prettifyModelId(configured.baseId),
      thinking: configured.config['reasoning'] || configured.config['thinking']
        ? titleModelToken(configured.config['reasoning'] ?? configured.config['thinking'])
        : 'Default',
      context: normalizeFallbackContext(configured.config['context']),
      fast: normalizeFallbackFast(configured.config['fast'])
    };
  }

  const source = id.toLowerCase();
  const thinking = FALLBACK_THINKING_VALUES.find((value) =>
    new RegExp(`(?:^|[\\s_\\-/])(?:thinking[\\s_\\-/]?)?${value}(?:$|[\\s_\\-/])`, 'i').test(source)
  );
  const context = FALLBACK_CONTEXT_VALUES.find((value) =>
    new RegExp(`(?:^|[\\s_\\-/()])${value}(?:$|[\\s_\\-/()])`, 'i').test(source)
  );
  const modelTokens = id.split(/[/:_\-\s]+/).filter((token) => {
    const lower = token.toLowerCase();
    return (
      lower !== 'thinking' &&
      lower !== 'context' &&
      !FALLBACK_THINKING_VALUES.includes(lower) &&
      !FALLBACK_CONTEXT_VALUES.includes(lower)
    );
  });
  const model = modelTokens.length > 0 ? modelTokens.map(titleModelToken).join(' ') : id;
  return {
    id,
    label: `${id} (not found)`,
    model,
    thinking: thinking ? titleModelToken(thinking) : 'Default',
    context: normalizeFallbackContext(context),
    fast: null
  };
}

function normalizeStoredMode(mode: string | undefined): string {
  // `auto` is the legacy mode sentinel (renamed to `default`); map it so old sessions don't
  // treat it as a non-existent concrete mode.
  if (!mode || mode === 'auto') return MODE_SENTINEL;
  return mode;
}

function syncAcpReportedFromOptions(): void {
  if (acpReportedModeId.value && !modeOptions.value.some((m) => m.id === acpReportedModeId.value)) {
    acpReportedModeId.value = null;
  }
  if (acpReportedModelId.value && !modelOptions.value.some((m) => m.id === acpReportedModelId.value)) {
    acpReportedModelId.value = null;
  }
}

const displaySessionMode = computed(() => {
  if (acpReportedModeId.value) return acpReportedModeId.value;
  const stored = normalizeStoredMode(sessionMode.value);
  if (stored !== MODE_SENTINEL) return stored;
  return modeOptions.value.find((m) => m.current)?.id ?? modeOptions.value[0]?.id ?? MODE_SENTINEL;
});
const selectedModeOption = computed(
  () =>
    modeOptions.value.find((option) => option.id === displaySessionMode.value) ??
    modeOptions.value[0] ?? {
      id: MODE_SENTINEL,
      label: 'Default'
    }
);
function modeIconName(modeId: string): 'plan' | 'debug' | 'multi' | 'ask' | 'agent' {
  const id = modeId.toLowerCase();
  if (id.includes('plan')) return 'plan';
  if (id.includes('debug')) return 'debug';
  if (id.includes('multi')) return 'multi';
  if (id.includes('ask')) return 'ask';
  return 'agent';
}
const selectedModeIconName = computed(() => modeIconName(selectedModeOption.value.id));

// The user's selection is authoritative for the model (Cursor can't change it at runtime, so any
// echoed value reflects a startup default, not a real switch). Always show what the user picked.
const effectiveModelSelection = computed(() => modelSelection.value || 'auto');

const selectedModelOption = computed(
  () =>
    modelOptions.value.find((option) => option.id === effectiveModelSelection.value) ??
    fallbackModelOption(effectiveModelSelection.value)
);
const bSelectedModelMissing = computed(
  () =>
    !!modelSelection.value &&
    modelSelection.value !== 'auto' &&
    !parseConfiguredModelId(modelSelection.value) &&
    !modelOptions.value.some((option) => option.id === modelSelection.value)
);

const effectiveModelOptions = computed(() => {
  const selected = selectedModelOption.value;
  if (modelOptions.value.some((option) => option.id === selected.id)) {
    return modelOptions.value;
  }
  return [selected, ...modelOptions.value];
});

const modelPickerState = computed(() => {
  const options = effectiveModelOptions.value;
  const current = selectedModelOption.value;

  const modelList = sortLabelValues(uniqueValues(options.map((option) => option.model)));
  const selectedModelName = current.model;
  const thinkingList = sortThinkingValues(
    uniqueValues(
      options
        .filter((option) => option.model === selectedModelName)
        .map((option) => option.thinking)
    )
  );
  const selectedThinkingName =
    current.model === selectedModelName ? current.thinking : thinkingList[0] ?? 'Default';
  const contextList = sortContextValues(
    uniqueValues(
      options
        .filter(
          (option) => option.model === selectedModelName && option.thinking === selectedThinkingName
        )
        .map((option) => option.context)
    )
  );
  const selectedContextName =
    current.model === selectedModelName && current.thinking === selectedThinkingName
      ? current.context
      : contextList[0] ?? 'Default';
  const bFastAvailable = options.some(
    (option) =>
      option.model === selectedModelName &&
      option.thinking === selectedThinkingName &&
      option.context === selectedContextName &&
      option.fast !== null
  );
  const selectedFastValue =
    current.model === selectedModelName &&
    current.thinking === selectedThinkingName &&
    current.context === selectedContextName &&
    current.fast !== null
      ? current.fast
      : false;

  return {
    modelList,
    selectedModelName,
    thinkingList,
    selectedThinkingName,
    contextList,
    selectedContextName,
    bFastAvailable,
    selectedFastValue
  };
});
const modelList = computed(() => modelPickerState.value.modelList);
const selectedModelName = computed(() => modelPickerState.value.selectedModelName);
const thinkingList = computed(() => modelPickerState.value.thinkingList);
const selectedThinkingName = computed(() => modelPickerState.value.selectedThinkingName);
const contextList = computed(() => modelPickerState.value.contextList);
const selectedContextName = computed(() => modelPickerState.value.selectedContextName);
const bFastAvailable = computed(() => modelPickerState.value.bFastAvailable);
const selectedFastValue = computed(() => modelPickerState.value.selectedFastValue);
const bCursorAgentSession = computed(() => session.value?.agentType === 'cursor-agent');
const cursorPresetOptions = computed<ModelSelectOption[]>(() =>
  BASIC_CURSOR_MODEL_PRESETS.filter((preset) =>
    effectiveModelOptions.value.some((option) => optionMatchesCursorPreset(option, preset))
  ).map((preset) => ({ value: cursorPresetValue(preset.label), label: preset.label }))
);
const selectedCursorPreset = computed(() => findCursorPresetForOption(selectedModelOption.value));
const modelSelectValue = computed(() => {
  if (!bCursorAgentSession.value) return selectedModelName.value;

  const preset = selectedCursorPreset.value;
  const defaultOption = preset ? resolveDefaultCursorModelOption(preset) : null;
  if (preset && defaultOption?.id === selectedModelOption.value.id) {
    return cursorPresetValue(preset.label);
  }
  if (preset) {
    return cursorCurrentValue(selectedModelOption.value.id);
  }
  return cursorModelValue(selectedModelName.value);
});
const visibleModelOptions = computed<ModelSelectOption[]>(() => {
  if (!bCursorAgentSession.value) {
    return modelList.value.map((model) => ({ value: model, label: model }));
  }

  const options = [...cursorPresetOptions.value];
  const selectedValue = modelSelectValue.value;
  if (
    selectedValue.startsWith(CURSOR_CURRENT_VALUE_PREFIX) &&
    !options.some((option) => option.value === selectedValue)
  ) {
    const current = selectedModelOption.value;
    const context = current.context === 'Default' ? '' : `, ${current.context}`;
    options.push({
      value: selectedValue,
      label: `${current.model} (${current.thinking}${context})`
    });
  } else if (
    selectedValue.startsWith(CURSOR_MODEL_VALUE_PREFIX) &&
    !options.some((option) => option.value === selectedValue)
  ) {
    options.push({ value: selectedValue, label: selectedModelName.value });
  }

  if (bShowAllCursorModels.value) {
    const presetModelNames = new Set(
      BASIC_CURSOR_MODEL_PRESETS.flatMap((preset) => preset.modelNames)
    );
    for (const model of modelList.value) {
      if (presetModelNames.has(model)) continue;
      const value = cursorModelValue(model);
      if (!options.some((option) => option.value === value)) {
        options.push({ value, label: model });
      }
    }
  }

  return options;
});
const bHasHiddenModelOptions = computed(
  () =>
    bCursorAgentSession.value &&
    !bShowAllCursorModels.value &&
    (modelList.value.length > cursorPresetOptions.value.length ||
      effectiveModelOptions.value.some((option) => !findCursorPresetForOption(option)))
);

async function loadAvailableModels() {
  const agentType = session.value?.agentType;
  if (!agentType) return;
  bModelsLoading.value = true;
  try {
    const { data } = await settingsApi.getAgentModels(agentType);
    modelOptions.value = data.models.length > 0
      ? data.models
      : [{ id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null }];
  } catch {
    modelOptions.value = [{ id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null }];
  } finally {
    bModelsLoading.value = false;
  }
}

async function loadAvailableModes() {
  const agentType = session.value?.agentType;
  if (!agentType) return;
  bModesLoading.value = true;
  try {
    const { data } = await settingsApi.getAgentModes(agentType);
    modeOptions.value = data.modes.length > 0 ? data.modes : [{ id: MODE_SENTINEL, label: 'Default' }];
    syncAcpReportedFromOptions();
  } catch {
    modeOptions.value = [{ id: MODE_SENTINEL, label: 'Default' }];
  } finally {
    bModesLoading.value = false;
  }
}

async function loadAgentConfigOptions() {
  const agentType = session.value?.agentType;
  if (!agentType) return;
  bConfigLoading.value = true;
  try {
    const { data } = await settingsApi.getAgentConfigOptions(agentType);
    agentConfigOptions.value = data.options;
    for (const opt of data.options) {
      if (!sessionConfig.value[opt.id] && opt.currentValue) {
        sessionConfig.value = { ...sessionConfig.value, [opt.id]: opt.currentValue };
      }
    }
  } catch {
    agentConfigOptions.value = [];
  } finally {
    bConfigLoading.value = false;
  }
}

function agentConfigDisplayValue(option: AgentConfigOption): string {
  return sessionConfig.value[option.id] ?? option.currentValue ?? option.options[0]?.value ?? '';
}

async function persistSessionConfig(next: Record<string, string>) {
  const prev = { ...sessionConfig.value };
  const prevSession = session.value;
  sessionConfig.value = next;
  if (session.value) {
    session.value = { ...session.value, sessionConfigJson: next };
  }
  bSavingSessionConfig.value = true;
  try {
    const { data: updated } = await sessionsApi.update(props.workspaceId, props.sessionId, {
      sessionConfigJson: next
    });
    session.value = updated;
    sessionConfig.value = updated.sessionConfigJson ?? next;
  } catch {
    sessionConfig.value = prev;
    session.value = prevSession;
  } finally {
    bSavingSessionConfig.value = false;
  }
}

function onAgentConfigChange(configId: string, value: string): void {
  if (!value) return;
  const next = { ...sessionConfig.value, [configId]: value };
  if (next[configId] === sessionConfig.value[configId]) return;
  void persistSessionConfig(next);
}

// The agent's reported mode/model is the source of truth: always reflect and persist it so the
// UI can never show a different mode/model than the one the agent is actually running.
function applyInboundModeUpdate(modeId: string): void {
  acpReportedModeId.value = modeId;
  modeOptions.value = modeOptions.value.map((m) => ({ ...m, current: m.id === modeId }));
  if (normalizeStoredMode(sessionMode.value) !== modeId) {
    void syncSessionModeFromAgent(modeId);
  }
}

// The user's model selection is authoritative — Cursor never changes the model on its own, and it
// echoes its own default when our pick isn't applied. Record what the agent reports (for a mismatch
// indicator) but never overwrite/persist the user's chosen model.
function applyInboundModelUpdate(modelId: string): void {
  acpReportedModelId.value = modelId;
  modelOptions.value = modelOptions.value.map((m) => ({ ...m, current: m.id === modelId }));
}

async function syncSessionModeFromAgent(modeId: string): Promise<void> {
  const seq = ++sessionModeSaveSeq;
  const prev = sessionMode.value;
  const prevSession = session.value;
  sessionMode.value = modeId;
  if (session.value) {
    session.value = { ...session.value, sessionMode: modeId };
  }
  try {
    const { data: updated } = await sessionsApi.update(props.workspaceId, props.sessionId, {
      sessionMode: modeId
    });
    if (seq !== sessionModeSaveSeq) return;
    session.value = updated;
    sessionMode.value = normalizeStoredMode(updated.sessionMode);
    acpReportedModeId.value = null;
  } catch {
    if (seq !== sessionModeSaveSeq) return;
    sessionMode.value = prev;
    session.value = prevSession;
  }
}

function applyInboundConfigUpdate(config: Record<string, string>): void {
  for (const [id, value] of Object.entries(config)) {
    const opt = agentConfigOptions.value.find((o) => o.id === id);
    if (opt) {
      opt.currentValue = value;
    }
    if (!sessionConfig.value[id]) {
      sessionConfig.value = { ...sessionConfig.value, [id]: value };
    }
  }
}

function resolveModelOption(model: string, thinking: string, context: string, fast?: boolean | null): AgentModelOption | null {
  const wantsFast = fast !== undefined && fast !== null;
  return (
    effectiveModelOptions.value.find(
      (option) =>
        option.model === model &&
        option.thinking === thinking &&
        option.context === context &&
        (!wantsFast || option.fast === fast)
    ) ??
    effectiveModelOptions.value.find((option) => option.model === model && option.thinking === thinking) ??
    effectiveModelOptions.value.find((option) => option.model === model) ??
    effectiveModelOptions.value[0] ??
    null
  );
}

function resolveBestModelOption(options: AgentModelOption[], preferredThinking: string[]): AgentModelOption | null {
  const scored = options
    .map((option) => {
      const thinkingIndex = preferredThinking.findIndex(
        (thinking) => normalizeModelName(thinking) === normalizeModelName(option.thinking)
      );
      const bThinkingMatched = thinkingIndex >= 0;
      const bDefaultContext = normalizeModelName(option.context) === 'default';
      const bAutoContext = normalizeModelName(option.context) === 'auto';
      const bSlowFast = option.fast === false;
      return {
        option,
        score:
          (bThinkingMatched ? 10_000 - thinkingIndex * 100 : 0) +
          (bDefaultContext || bAutoContext ? 1_000 : 0) +
          (bSlowFast ? 5 : 0) -
          parseContextSize(option.context) / 1_000_000_000_000
      };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.option ?? null;
}

function resolveDefaultCursorModelOption(preset: CursorModelPreset): AgentModelOption | null {
  const options = effectiveModelOptions.value.filter((option) => optionMatchesCursorPreset(option, preset));
  if (!options.length) return null;

  const preferredThinking = [
    preset.thinking,
    preset.label === 'Auto' ? 'Auto' : 'Default',
    'Medium',
    'High'
  ].filter((value): value is string => Boolean(value));

  return resolveBestModelOption(options, preferredThinking);
}

function resolveDefaultModelOption(model: string): AgentModelOption | null {
  const options = effectiveModelOptions.value.filter((option) => option.model === model);
  if (!options.length) return null;

  const modelKey = normalizeModelName(model);
  const sortedThinking = sortThinkingValues(uniqueValues(options.map((option) => option.thinking)));
  const preset = findCursorPresetByLabel(model);
  const preferredThinking = [
    preset?.thinking,
    modelKey === 'auto' ? 'Auto' : 'Default',
    'Medium',
    'High'
  ].filter((value): value is string => Boolean(value));
  const thinking = pickPreferredValue(sortedThinking, preferredThinking);
  const contextValues = sortContextValues(
    uniqueValues(
      options
        .filter((option) => option.thinking === thinking)
        .map((option) => option.context)
    )
  );
  const context = pickPreferredValue(contextValues, [
    modelKey === 'auto' ? 'Auto' : 'Default',
    '128K',
    '1M'
  ]);
  const bHasSlowFastVariant = options.some(
    (option) => option.thinking === thinking && option.context === context && option.fast === false
  );
  const bHasFastVariants = options.some(
    (option) => option.thinking === thinking && option.context === context && option.fast !== null
  );

  return resolveModelOption(model, thinking, context, bHasFastVariants && bHasSlowFastVariant ? false : null);
}

async function persistModelSelection(newModelSelection: string) {
  const seq = ++modelSelectionSaveSeq;
  const prev = modelSelection.value;
  const prevSession = session.value;
  acpReportedModelId.value = null;
  modelSelection.value = newModelSelection;
  if (session.value) {
    session.value = { ...session.value, modelSelection: newModelSelection };
  }
  bSavingModelSelection.value = true;
  try {
    const { data: updated } = await sessionsApi.update(props.workspaceId, props.sessionId, {
      modelSelection: newModelSelection
    });
    if (seq !== modelSelectionSaveSeq) return;
    session.value = updated;
    modelSelection.value = updated.modelSelection ?? newModelSelection;
  } catch {
    if (seq !== modelSelectionSaveSeq) return;
    modelSelection.value = prev;
    session.value = prevSession;
  } finally {
    if (seq === modelSelectionSaveSeq) bSavingModelSelection.value = false;
  }
}

function reopenModelSelect(selectEl: HTMLSelectElement): void {
  selectEl.focus();
  try {
    selectEl.showPicker?.();
  } catch {
    // Some browsers only allow showPicker during the original user gesture.
  }
}

function onModelSelectChange(value: string, selectEl: HTMLSelectElement): void {
  if (value === MORE_MODEL_OPTION_VALUE) {
    bShowAllCursorModels.value = true;
    void nextTick(() => reopenModelSelect(selectEl));
    return;
  }

  if (bCursorAgentSession.value && value.startsWith(CURSOR_PRESET_VALUE_PREFIX)) {
    const preset = findCursorPresetByLabel(value.slice(CURSOR_PRESET_VALUE_PREFIX.length));
    const next = preset ? resolveDefaultCursorModelOption(preset) : null;
    if (next && next.id !== modelSelection.value) {
      bShowAllCursorModels.value = false;
      void persistModelSelection(next.id);
    }
    return;
  }

  if (bCursorAgentSession.value && value.startsWith(CURSOR_CURRENT_VALUE_PREFIX)) {
    return;
  }

  const model = bCursorAgentSession.value && value.startsWith(CURSOR_MODEL_VALUE_PREFIX)
    ? value.slice(CURSOR_MODEL_VALUE_PREFIX.length)
    : value;
  const next = bCursorAgentSession.value ? resolveDefaultModelOption(model) : resolveModelOption(
    model,
    selectedThinkingName.value,
    selectedContextName.value,
    bFastAvailable.value ? selectedFastValue.value : null
  );
  if (next && next.id !== modelSelection.value) {
    bShowAllCursorModels.value = false;
    void persistModelSelection(next.id);
  }
}

function onModelDimensionChange(kind: 'thinking' | 'context', value: string): void {
  const nextModel = selectedModelName.value;
  const next = resolveModelOption(
    nextModel,
    kind === 'thinking' ? value : selectedThinkingName.value,
    kind === 'context' ? value : selectedContextName.value,
    bFastAvailable.value ? selectedFastValue.value : null
  );
  if (next && next.id !== modelSelection.value) {
    void persistModelSelection(next.id);
  }
}

function onModelFastChange(checked: boolean): void {
  const next = resolveModelOption(
    selectedModelName.value,
    selectedThinkingName.value,
    selectedContextName.value,
    checked
  );
  if (next && next.id !== modelSelection.value) {
    void persistModelSelection(next.id);
  }
}

function onSharedModelPickerUpdate(nextModelSelection: string): void {
  if (nextModelSelection && nextModelSelection !== modelSelection.value) {
    void persistModelSelection(nextModelSelection);
  }
}

async function persistSessionMode(newSessionMode: string) {
  const seq = ++sessionModeSaveSeq;
  const prev = sessionMode.value;
  const prevSession = session.value;
  sessionMode.value = newSessionMode;
  if (session.value) {
    session.value = { ...session.value, sessionMode: newSessionMode };
  }
  bSavingSessionMode.value = true;
  try {
    const { data: updated } = await sessionsApi.update(props.workspaceId, props.sessionId, {
      sessionMode: newSessionMode
    });
    if (seq !== sessionModeSaveSeq) return;
    session.value = updated;
    sessionMode.value = updated.sessionMode ?? newSessionMode;
  } catch {
    if (seq !== sessionModeSaveSeq) return;
    sessionMode.value = prev;
    session.value = prevSession;
  } finally {
    if (seq === sessionModeSaveSeq) bSavingSessionMode.value = false;
  }
}

function onSessionModeChange(value: string): void {
  const normalized = value || MODE_SENTINEL;
  acpReportedModeId.value = null;
  if (normalized !== normalizeStoredMode(sessionMode.value)) {
    void persistSessionMode(normalized);
  }
}

function selectSessionMode(value: string): void {
  closeModeMenu();
  onSessionModeChange(value);
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

function onShowThinkingToggle(checked: boolean): void {
  onHideThinkingToggle(!checked);
}

const bHasMore = ref(false);
const bLoadingMore = ref(false);
let webSocket: WebSocket | null = null;
const bWsConnected = ref(false);
const bWsReconnecting = ref(false);
let wsReconnectTimer: ReturnType<typeof setTimeout> | null = null;
const planDocumentsRefreshTimers = new Set<ReturnType<typeof setTimeout>>();
let wsUnmounted = false;
let fetchSessionSeq = 0;

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

interface PlanDocument {
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

interface DisplayItem {
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

interface DisplayChatMessage {
  msg: ChatMessage;
  key: string;
  items: DisplayItem[];
  fallbackHtml: string;
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
const selectedPlanId = ref<string | null>(null);

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

function shouldKeepAssistantTextChunk(assistantText: string, items: DisplayItem[]): boolean {
  return Boolean(assistantText.trim() || items[items.length - 1]?.kind === 'text');
}

function processAcpUpdate(
  update: Record<string, unknown>,
  items: DisplayItem[],
  opts?: { liveThinking?: boolean; applyConfigSync?: boolean; sourceSessionId?: string }
): void {
  const sessionUpdate = update.sessionUpdate as string | undefined;

  if (sessionUpdate === 'agent_message_chunk') {
    const content = update.content as { type?: string; text?: string } | undefined;
    if (
      content?.type === 'text' &&
      typeof content.text === 'string' &&
      shouldKeepAssistantTextChunk(content.text, items)
    ) {
      mergeAssistantTextIntoDisplayItems(content.text, items);
    }
    return;
  }

  if (sessionUpdate === 'agent_thought_chunk') {
    const content = update.content as AgentThoughtChunkContent | undefined;
    if (opts?.liveThinking && !hideThinkingOutput.value && content?.text) {
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
    if (opts?.liveThinking && typeof used === 'number' && typeof size === 'number') {
      streamingUsage.value = {
        used,
        size,
        cost: update.cost as { amount: number; currency: string } | undefined,
      };
    }
    return;
  }

  if (sessionUpdate === 'current_mode_update') {
    const modeId = update.currentModeId as string | undefined;
    if (modeId && opts?.applyConfigSync !== false) applyInboundModeUpdate(modeId);
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
      applyInboundModelUpdate(modelOpt.currentValue);
    }
    const config: Record<string, string> = {};
    for (const opt of rawOpts) {
      if (opt.type !== 'select') continue;
      const cat = opt.category ?? opt.id;
      if (cat === 'mode' || cat === 'model' || opt.id === 'mode' || opt.id === 'model') continue;
      if (typeof opt.currentValue === 'string') config[opt.id] = opt.currentValue;
    }
    if (Object.keys(config).length > 0) applyInboundConfigUpdate(config);
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
 * Stream providers mix cumulative snapshots with incremental deltas and may repeat boundary tokens
 * (e.g. send "The shared" then " shared"). Merge without doubling identical or overlapping text.
 */
function mergeStreamingTextChunks(previousText: string, incomingText: string): string {
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

type AgentThoughtChunkContent = {
  type?: string;
  text?: string;
  annotations?: {
    _meta?: {
      heartbeat?: boolean;
      elapsedSeconds?: number;
    };
  };
};

/** Strip cursor-agent-acp elapsed suffix, e.g. "Doing the thing... (12s)" → "Doing the thing..." */
function agentThoughtStatusBase(text: string): string {
  return text.replace(/\s\(\d+s\)\s*$/, '');
}

/**
 * cursor-agent-acp sends funny progress lines as agent_thought_chunk (see getRandomProcessingText).
 * Heartbeats replace the previous line; only genuine incremental thought text is appended.
 */
function mergeAgentThoughtChunk(text: string, content?: AgentThoughtChunkContent): void {
  const isHeartbeat = content?.annotations?._meta?.heartbeat === true;
  const prev = streamingThinkingText.value;

  if (isHeartbeat || !prev) {
    streamingThinkingText.value = text;
    return;
  }

  const textBase = agentThoughtStatusBase(text);
  const prevBase = agentThoughtStatusBase(prev);
  if (textBase === prevBase || text.startsWith(prevBase) || prev.startsWith(textBase)) {
    streamingThinkingText.value = text;
    return;
  }

  streamingThinkingText.value = mergeStreamingTextChunks(prev, text);
}

function mergeAssistantTextIntoDisplayItems(
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

// ── Parse events → DisplayItems ───────────────────────────────────────────────
function processEventLine(
  line: string,
  items: DisplayItem[],
  opts?: { liveThinking?: boolean; applyConfigSync?: boolean }
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
    if (modeId) applyInboundModeUpdate(modeId);
    if (modelId) applyInboundModelUpdate(modelId);
    if (config) applyInboundConfigUpdate(config);
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
      !hideThinkingOutput.value &&
      event.subtype === 'delta' &&
      typeof event.text === 'string'
    ) {
      streamingThinkingText.value = mergeStreamingTextChunks(streamingThinkingText.value, event.text);
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

function parseEventsToItems(
  events: string[],
  opts?: { liveThinking?: boolean; applyConfigSync?: boolean }
): DisplayItem[] {
  const items: DisplayItem[] = [];
  for (const line of events) processEventLine(line, items, opts);
  return items;
}

const markdownRenderCache = new Map<string, string>();

function renderMdCached(src: string | undefined): string {
  if (!src) return '';
  const cached = markdownRenderCache.get(src);
  if (cached !== undefined) return cached;
  const rendered = renderMd(src);
  if (markdownRenderCache.size > 500) markdownRenderCache.clear();
  markdownRenderCache.set(src, rendered);
  return rendered;
}

function prepareDisplayItem(item: DisplayItem): DisplayItem {
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

function isPlanEntryCompleted(status: string | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return normalized === 'completed' || normalized === 'done' || normalized === 'todo_status_completed';
}

function isPlanEntryInProgress(status: string | undefined): boolean {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return normalized === 'in_progress' || normalized === 'in-progress' || normalized === 'running' || normalized === 'todo_status_in_progress';
}

function planStatusIcon(status: string | undefined): 'completed' | 'in_progress' | 'pending' {
  if (isPlanEntryCompleted(status)) return 'completed';
  if (isPlanEntryInProgress(status)) return 'in_progress';
  return 'pending';
}

function escapePlanEntryContent(content: string): string {
  return content.replace(/\r\n/g, '\n').trim();
}

function markdownFromPlanEntries(entries: PlanEntry[]): string {
  if (entries.length === 0) return '';
  return entries
    .map((entry) => {
      const box = isPlanEntryCompleted(entry.status) ? 'x' : ' ';
      const content = escapePlanEntryContent(entry.content).replace(/\n/g, '\n  ');
      return `- [${box}] ${content}`;
    })
    .join('\n');
}

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

function entriesFromPlanMarkdown(markdown: string): PlanEntry[] {
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

  return numberedEntries.length ? numberedEntries : (actionEntries.length ? actionEntries : headingEntries);
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

function renderPlanMarkdownWithActions(markdown: string, entries: PlanEntry[]): string {
  if (!entries.length) return renderMdCached(markdown);

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceMarker: '`' | '~' | null = null;
  let entryIndex = 0;
  const hasNumberedEntries = lines.some((line) =>
    /^#{1,4}\s+\d+[\.)]\s+/.test(line) || /^\s{0,3}\d+[\.)]\s+/.test(line)
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
    const bActionTarget = hasNumberedEntries ? bNumberedLine : bNumberedLine || bTaskLine || bHeadingLine;
    if (!bActionTarget) continue;

    const fullPlanAttribute = bHeadingLine && !bNumberedLine && !bTaskLine
      ? ' data-plan-full-plan="true"'
      : '';
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

interface PlanMarkdownCandidate {
  markdown: string;
  normalized: string;
  index: number;
  planId?: string;
  sourceSessionId?: string;
}

function normalizePlanSearchText(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function unwrapMarkdownFence(markdown: string): string {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^```(?:md|markdown)?\s*\n([\s\S]*?)\n```$/i);
  return (match?.[1] ?? trimmed).trim();
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

function planMarkdownCandidatesFromDocuments(
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
        sourceSessionId: doc.sessionId,
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

function bestPlanMarkdownFallback(
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
  return best && bestScore > 0 ? best : undefined;
}

function planDocumentFromItem(
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

function planDocumentFromFileSummary(doc: PlanDocumentSummary, index: number): PlanDocument | null {
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

const displayMessages = computed<DisplayChatMessage[]>(() =>
  messages.value.map((msg, index) => {
    const items =
      msg.role === 'assistant'
        ? parseEventsToItems(msg.events ?? [], { applyConfigSync: false }).map(prepareDisplayItem)
        : [];
    let planIndex = 0;
    for (const item of items) {
      if (item.kind !== 'plan') continue;
      item.planId = `${msg.createdAt}-${index}-plan-${planIndex}`;
      planIndex += 1;
    }
    return {
      msg,
      key: `${msg.createdAt}-${index}`,
      items,
      fallbackHtml: items.length === 0 && msg.content ? renderMdCached(msg.content) : ''
    };
  })
);
const streamingDisplayItems = computed(() => {
  const items = streamingItems.value.map(prepareDisplayItem);
  let planIndex = 0;
  for (const item of items) {
    if (item.kind !== 'plan') continue;
    item.planId = `live-plan-${planIndex}`;
    planIndex += 1;
  }
  return items;
});

const planDocuments = computed<PlanDocument[]>(() => {
  const docs: PlanDocument[] = [];
  const seenMarkdown = new Set<string>();
  const addPlanDocument = (doc: PlanDocument | null): void => {
    if (!doc) return;
    const key = normalizePlanSearchText(doc.markdown);
    if (key && seenMarkdown.has(key)) return;
    if (key) seenMarkdown.add(key);
    docs.push(doc);
  };
  const filePlanDocuments = session.value?.planDocuments;
  for (const { msg, items, key } of displayMessages.value) {
    let planIndex = 0;
    for (const item of items) {
      if (item.kind !== 'plan') continue;
      const fileMarkdownCandidates = planMarkdownCandidatesFromDocuments(
        filePlanDocuments,
        item.planSourceSessionId
      );
      const doc = planDocumentFromItem(
        item,
        item.planId ?? `${key}-plan-${planIndex}`,
        planIndex,
        msg.createdAt,
        false,
        bestPlanMarkdownFallback(item, fileMarkdownCandidates)
      );
      addPlanDocument(doc);
      planIndex += 1;
    }
  }
  let livePlanIndex = 0;
  for (const item of streamingDisplayItems.value) {
    if (item.kind !== 'plan') continue;
    const fileMarkdownCandidates = planMarkdownCandidatesFromDocuments(
      filePlanDocuments,
      item.planSourceSessionId
    );
    const doc = planDocumentFromItem(
      item,
      item.planId ?? `live-plan-${livePlanIndex}`,
      livePlanIndex,
      new Date().toISOString(),
      true,
      bestPlanMarkdownFallback(item, fileMarkdownCandidates)
    );
    addPlanDocument(doc);
    livePlanIndex += 1;
  }
  filePlanDocuments?.forEach((doc, index) => addPlanDocument(planDocumentFromFileSummary(doc, index)));
  return docs;
});

const selectedPlanDocument = computed<PlanDocument | null>(() => {
  if (selectedPlanId.value) {
    const selected = planDocuments.value.find((doc) => doc.id === selectedPlanId.value);
    if (selected) return selected;
  }
  return planDocuments.value[planDocuments.value.length - 1] ?? null;
});

const latestPlanDocumentId = computed(() => planDocuments.value.at(-1)?.id ?? null);

watch(latestPlanDocumentId, (latestId, previousId) => {
  if (!latestId || latestId === previousId || activeTab.value !== 'plan') return;
  selectedPlanId.value = latestId;
});

const bShowPlanTab = computed(() => activeTab.value === 'plan' || planDocuments.value.length > 0);

function openPlan(planId: string | undefined): void {
  if (planId) selectedPlanId.value = planId;
  activeTab.value = 'plan';
}

function safeDownloadName(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'plan'}.plan.md`;
}

function downloadPlan(plan: PlanDocument | null): void {
  if (!plan?.markdown.trim()) return;
  closePlanActionsMenu();
  const blob = new Blob([`${plan.markdown.trim()}\n`], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeDownloadName(plan.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function shortPlanEntry(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function startSessionFromFullPlan(plan: PlanDocument | null): void {
  if (!plan?.markdown.trim()) return;
  closePlanActionsMenu();

  const linkedPlanContext = plan.backendPlanId && plan.planSourceSessionId
    ? {
        sourceSessionId: props.sessionId,
        sourceAcpSessionId: plan.planSourceSessionId,
        planId: plan.backendPlanId,
        planTitle: plan.title,
        entryIndex: 0,
        entryContent: plan.title,
        contextMode: 'full' as const,
      }
    : undefined;

  emit('start-plan-session', {
    defaultName: `Plan: ${plan.title.slice(0, 80)}`,
    draftPrompt: linkedPlanContext
      ? `Implement the linked plan "${plan.title}".`
      : `Implement this plan:\n\n${plan.markdown.trim()}`,
    linkedPlanContext,
    defaultAgentType: session.value?.agentType,
    defaultModelSelection: modelSelection.value,
  });
}

function startSessionFromPlanEntry(plan: PlanDocument, entry: PlanEntry, index: number): void {
  const entryText = entry.content.trim();
  if (!entryText) return;

  const pointNumber = index + 1;
  const linkedPlanContext = plan.backendPlanId && plan.planSourceSessionId
    ? {
        sourceSessionId: props.sessionId,
        sourceAcpSessionId: plan.planSourceSessionId,
        planId: plan.backendPlanId,
        planTitle: plan.title,
        entryIndex: index,
        entryContent: entryText,
        contextMode: 'target-only' as const,
      }
    : undefined;

  emit('start-plan-session', {
    defaultName: `Point ${pointNumber}: ${shortPlanEntry(entryText).slice(0, 80)}`,
    draftPrompt: linkedPlanContext
      ? `Implement point ${pointNumber} from the linked plan.`
      : `Implement point ${pointNumber} from "${plan.title}":\n\n${entryText}`,
    linkedPlanContext,
    defaultAgentType: session.value?.agentType,
    defaultModelSelection: modelSelection.value,
  });
}

function onPlanMarkdownClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>('[data-plan-entry-index]');
  if (!button) return;

  const plan = selectedPlanDocument.value;
  if (button.dataset.planFullPlan === 'true') {
    startSessionFromFullPlan(plan);
    return;
  }

  const index = Number(button.dataset.planEntryIndex);
  const entry = Number.isFinite(index) ? plan?.startableEntries[index] : undefined;
  if (plan && entry) {
    startSessionFromPlanEntry(plan, entry, index);
  }
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
  const wsSessionId = props.sessionId;
  const socket = new WebSocket(buildChatWsUrl(wsSessionId));
  webSocket = socket;

  socket.onopen = () => {
    if (socket !== webSocket || wsSessionId !== props.sessionId) return;
    bWsConnected.value = true;
    bWsReconnecting.value = false;
  };

  socket.onmessage = (event: MessageEvent) => {
    if (socket !== webSocket || wsSessionId !== props.sessionId) return;
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
          lastPromptRequest.value = {
            text: prompt.text,
            imagePaths: prompt.imagePaths ?? []
          };
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
        const previousPlanCount = streamingItems.value.filter((item) => item.kind === 'plan').length;
        streamingRawLines.push(line);
        processEventLine(line, streamingItems.value, { liveThinking: true });
        const nextPlanCount = streamingItems.value.filter((item) => item.kind === 'plan').length;
        if (nextPlanCount > previousPlanCount) {
          selectedPlanId.value = `live-plan-${nextPlanCount - 1}`;
          activeTab.value = 'plan';
        }
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
        schedulePlanDocumentsRefresh(250, { selectLatest: activeTab.value === 'plan' });
        schedulePlanDocumentsRefresh(1500, { selectLatest: activeTab.value === 'plan' });
        scrollToBottomIfPinned();
        notifyTaskDone(
          session.value?.name ?? 'Session',
          workspaceName.value,
          lastAssistantMessage,
          props.workspaceId,
          props.sessionId
        );
      } else if (msg.type === 'error') {
        setChatError(msg.message ?? 'Unknown error', msg.code ?? null);
        streamingItems.value = [];
        streamingRawLines.length = 0;
        streamingThinkingText.value = '';
        streamingUsage.value = null;
        notifiedTodoIds.clear();
        bIsStreaming.value = false;
      } else if (msg.type === 'server-shutdown') {
        setChatError('Server disconnected');
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

  socket.onclose = (event: CloseEvent) => {
    if (socket !== webSocket) return;
    bWsConnected.value = false;
    webSocket = null;
    if (event.code === 4001 || event.code === 4004) {
      setChatError(event.reason || 'Connection closed');
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

  socket.onerror = () => {
    if (socket !== webSocket) return;
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

  clearChatError();
  const imagePaths = pendingImages.value.map((img) => img.serverPath);
  lastPromptRequest.value = { text, imagePaths };
  const promptMode = displaySessionMode.value;
  webSocket.send(JSON.stringify({
    type: 'prompt',
    text,
    model: modelSelection.value,
    mode: promptMode,
    imagePaths
  }));
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
async function fetchSession(): Promise<boolean> {
  const seq = ++fetchSessionSeq;
  const workspaceId = props.workspaceId;
  const sessionId = props.sessionId;
  try {
    bLoading.value = true;
    error.value = null;
    const response = await sessionsApi.get(workspaceId, sessionId);
    if (seq !== fetchSessionSeq || workspaceId !== props.workspaceId || sessionId !== props.sessionId) {
      return false;
    }
    session.value = response.data;
    modelSelection.value = response.data.modelSelection ?? 'auto';
    sessionMode.value = normalizeStoredMode(response.data.sessionMode);
    sessionConfig.value = response.data.sessionConfigJson ?? {};
    acpReportedModeId.value = null;
    acpReportedModelId.value = null;
    void Promise.allSettled([
      loadAvailableModels(),
      loadAvailableModes(),
      loadAgentConfigOptions()
    ]);
    return true;
  } catch (e) {
    if (seq !== fetchSessionSeq || workspaceId !== props.workspaceId || sessionId !== props.sessionId) {
      return false;
    }
    error.value = 'Failed to load session';
    console.error('Failed to fetch session:', e);
    return false;
  } finally {
    if (seq === fetchSessionSeq && workspaceId === props.workspaceId && sessionId === props.sessionId) {
      bLoading.value = false;
    }
  }
}

async function refreshPlanDocuments(opts: { selectLatest?: boolean } = {}): Promise<void> {
  try {
    const response = await sessionsApi.get(props.workspaceId, props.sessionId);
    if (!session.value || response.data.id !== session.value.id) return;
    session.value = {
      ...session.value,
      planDocuments: response.data.planDocuments ?? []
    };
    if (opts.selectLatest) {
      await nextTick();
      const latestId = latestPlanDocumentId.value;
      if (latestId) selectedPlanId.value = latestId;
    }
  } catch (e) {
    console.error('Failed to refresh plan documents:', e);
  }
}

function schedulePlanDocumentsRefresh(delayMs: number, opts: { selectLatest?: boolean } = {}): void {
  const timer = setTimeout(() => {
    planDocumentsRefreshTimers.delete(timer);
    void refreshPlanDocuments(opts);
  }, delayMs);
  planDocumentsRefreshTimers.add(timer);
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible' && !webSocket && activeTab.value === 'chat') {
    if (wsReconnectTimer !== null) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    clearChatError();
    connectChatWs();
  }
}

const PROMPT_SINGLE_LINE_HEIGHT = 32;
const bPromptMultiline = ref(false);
/** Mobile portrait — tight horizontal space uses stacked prompt controls when text wraps */
const bPromptCompactLayout = ref(false);
let promptCompactMql: MediaQueryList | null = null;
let promptInputResizeObserver: ResizeObserver | null = null;
let promptInputObservedWidth = 0;

const bPromptUseCompactMultiline = computed(
  () => bPromptCompactLayout.value && bPromptMultiline.value
);

function syncPromptLayoutBreakpoint(): void {
  const wasCompact = bPromptCompactLayout.value;
  bPromptCompactLayout.value =
    promptCompactMql?.matches ??
    window.matchMedia('(max-width: 767px) and (orientation: portrait)').matches;
  if (wasCompact !== bPromptCompactLayout.value) {
    nextTick(() => resizeTextarea());
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

function measurePromptMultiline(el: HTMLTextAreaElement): boolean {
  if (!bPromptCompactLayout.value) return false;
  if (promptText.value.includes('\n')) return true;

  const box = promptInputBoxRef.value;
  if (!box) return false;

  const modeEl = box.querySelector('.prompt-mode') as HTMLElement | null;
  const attachEl = box.querySelector('.prompt-attach') as HTMLElement | null;
  const modeWidth = modeEl?.offsetWidth ?? 0;
  const attachWidth = attachEl?.offsetWidth ?? 36;
  const boxStyles = getComputedStyle(box);
  const padL = parseFloat(boxStyles.paddingLeft);
  const padR = parseFloat(boxStyles.paddingRight);
  const inlineWidth = box.clientWidth - modeWidth - attachWidth - padL - padR - 8;

  const savedWidth = el.style.width;
  const savedHeight = el.style.height;
  el.style.width = `${Math.max(inlineWidth, 0)}px`;
  el.style.height = '0px';
  const naturalHeight = el.scrollHeight;
  el.style.width = savedWidth;
  el.style.height = savedHeight;

  return naturalHeight > PROMPT_SINGLE_LINE_HEIGHT + 1;
}

function applyTextareaHeight(el: HTMLTextAreaElement): void {
  el.style.height = '0px';
  const height = Math.min(Math.max(el.scrollHeight, PROMPT_SINGLE_LINE_HEIGHT), 160);
  el.style.height = `${height}px`;
}

function resizeTextarea() {
  const el = textareaEl.value;
  if (!el) return;

  const nextMultiline = measurePromptMultiline(el);
  const multilineChanged = bPromptMultiline.value !== nextMultiline;
  bPromptMultiline.value = nextMultiline;

  if (multilineChanged) {
    nextTick(() => {
      requestAnimationFrame(() => {
        if (textareaEl.value) applyTextareaHeight(textareaEl.value);
      });
    });
    return;
  }

  applyTextareaHeight(el);
}

function observePromptInputBox() {
  promptInputResizeObserver?.disconnect();
  promptInputResizeObserver = null;
  const box = promptInputBoxRef.value;
  if (!box) return;
  promptInputObservedWidth = box.clientWidth;
  promptInputResizeObserver = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width ?? 0;
    if (Math.abs(width - promptInputObservedWidth) < 1) return;
    promptInputObservedWidth = width;
    resizeTextarea();
  });
  promptInputResizeObserver.observe(box);
}

watch(activeTab, (tab) => {
  if (tab === 'chat') {
    nextTick(() => {
      resizeTextarea();
      observePromptInputBox();
    });
    if (!webSocket) {
      if (wsReconnectTimer !== null) {
        clearTimeout(wsReconnectTimer);
        wsReconnectTimer = null;
      }
      connectChatWs();
    }
  } else if (tab === 'plan') {
    schedulePlanDocumentsRefresh(0, { selectLatest: true });
  }
});

watch(
  () => props.sessionId,
  async (newId, oldId) => {
    if (!newId || newId === oldId) return;
    for (const timer of planDocumentsRefreshTimers) {
      clearTimeout(timer);
    }
    planDocumentsRefreshTimers.clear();
    // reset chat state for new session
    messages.value = [];
    seenVibeMessageIds.clear();
    seenVibeToolCallIds.clear();
    streamingItems.value = [];
    streamingRawLines.length = 0;
    streamingThinkingText.value = '';
    streamingUsage.value = null;
    notifiedTodoIds.clear();
    selectedPlanId.value = null;
    if (activeTab.value === 'plan') activeTab.value = 'chat';
    clearChatError();
    session.value = null;
    bLoading.value = true;
    pendingImages.value = [];
    queuedPrompts.value = [];
    modelOptions.value = [];
    modeOptions.value = [];
    agentConfigOptions.value = [];
    expandedToolOutputIds.value = new Set();
    bShowAllCursorModels.value = false;
    bHasMore.value = false;
    bLoadingMore.value = false;

    const savedPrompt = localStorage.getItem(promptStorageKey.value);
    promptText.value = savedPrompt ?? '';

    disconnectChatWs();
    const loaded = await fetchSession();
    if (!loaded) return;
    if (activeTab.value === 'chat') {
      connectChatWs();
      await nextTick();
      resizeTextarea();
      observePromptInputBox();
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
  promptCompactMql = window.matchMedia('(max-width: 767px) and (orientation: portrait)');
  syncPromptLayoutBreakpoint();
  promptCompactMql.addEventListener('change', syncPromptLayoutBreakpoint);

  const savedPrompt = localStorage.getItem(promptStorageKey.value);
  if (savedPrompt != null) promptText.value = savedPrompt;
  await nextTick();
  resizeTextarea();
  observePromptInputBox();

  await fetchSession();
  connectChatWs();
  try {
    const { data } = await settingsApi.get();
    if (typeof data.claudeAutoContinue === 'boolean') {
      bClaudeAutoContinueEnabled.value = data.claudeAutoContinue;
    }
  } catch {
    // keep defaults
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('click', handleDocumentClickMobileMenu);
  document.addEventListener('keydown', handleKeydownMobileMenu);
});

onUnmounted(() => {
  wsUnmounted = true;
  promptInputResizeObserver?.disconnect();
  promptInputResizeObserver = null;
  if (chatInputMql) {
    chatInputMql.removeEventListener('change', syncChatInputBreakpoint);
    chatInputMql = null;
  }
  if (promptCompactMql) {
    promptCompactMql.removeEventListener('change', syncPromptLayoutBreakpoint);
    promptCompactMql = null;
  }
  for (const timer of planDocumentsRefreshTimers) {
    clearTimeout(timer);
  }
  planDocumentsRefreshTimers.clear();
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
        <div class="flex items-center min-w-0">
          <button
            v-if="toggleAppNav"
            type="button"
            class="button is-transparent is-icon mr-1 lg:hidden! shrink-0"
            title="App menu"
            aria-label="App menu"
            @click="toggleAppNav()"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18 M3 12h18 M3 18h18" /></svg>
          </button>
          <button
            v-if="props.showSidebarToggle"
            @click="emit('toggle-sidebar')"
            class="button is-transparent is-icon mr-2 lg:hidden! shrink-0"
            title="Sessions list"
            aria-label="Sessions list"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></svg>
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
      <div v-show="activeTab === 'chat'" class="flex-1 overflow-hidden flex flex-col min-h-0">
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
                  class="h-16 w-full md:w-[85%] max-w-md rounded-2xl rounded-bl-sm bg-fg/10 animate-pulse"
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
            <template v-for="{ msg, key, items, fallbackHtml } in displayMessages" :key="key">
              <!-- User bubble -->
              <div v-if="msg.role === 'user'" class="flex justify-end">
                <div class="max-w-[75%] flex flex-col items-end gap-2">
                  <div v-if="msg.imagePaths?.length" class="flex flex-wrap gap-2 justify-end">
                    <template v-for="(imgPath, j) in msg.imagePaths" :key="j">
                      <img
                        v-if="isImageAttachmentPath(imgPath)"
                        :src="msg.imageDataUrls?.[j] ?? imageApiUrl(imgPath)"
                        class="max-h-48 max-w-[12rem] rounded-xl object-cover border border-fg/10 cursor-pointer"
                        title="View full size"
                        @click="lightboxSrc = msg.imageDataUrls?.[j] ?? imageApiUrl(imgPath)"
                      />
                      <a
                        v-else
                        :href="imageApiUrl(imgPath)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex max-w-[12rem] items-center gap-1.5 rounded-xl border border-fg/10 bg-fg/[0.06] px-3 py-2 text-xs text-text-primary hover:bg-fg/[0.1]"
                        :title="attachmentDisplayName(imgPath)"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-text-muted" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        <span class="truncate">{{ attachmentDisplayName(imgPath) }}</span>
                      </a>
                    </template>
                  </div>
                  <div
                    v-if="msg.content"
                    class="bg-primary text-white px-4 py-2 rounded-2xl rounded-br-sm text-sm whitespace-pre-wrap break-words"
                  >
                    {{ msg.content }}
                  </div>
                </div>
              </div>

              <!-- Assistant turn -->
              <template v-else>
                <template v-for="(item, j) in items" :key="j">
                  <div v-if="item.kind === 'text'" class="flex justify-start">
                    <div
                      class="chat-markdown max-w-full md:max-w-[85%] bg-fg/[0.06] text-text-primary px-4 py-2 rounded-2xl rounded-bl-sm text-sm"
                      v-html="item.renderedHtml"
                      @click="onChatMarkdownClick"
                    ></div>
                  </div>
                  <div v-else-if="item.kind === 'todos'" class="flex justify-start">
                    <div
                      class="max-w-full md:max-w-[85%] w-80 rounded-xl border border-fg/10 bg-fg/[0.03] overflow-hidden"
                    >
                      <div class="flex items-center gap-2 px-3 py-1.5 border-b border-fg/10">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none text-text-muted shrink-0" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12l2 2 4-4"/></svg>
                        <span class="text-xs font-medium text-text-primary">Todos</span>
                        <span class="ml-auto text-xs text-text-muted">
                          {{ item.todoDoneCount }}/{{ item.todoItems?.length }}
                        </span>
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
                      class="max-w-full md:max-w-[85%] w-80 rounded-xl border border-fg/10 bg-fg/[0.03] overflow-hidden"
                    >
                      <div class="flex items-center gap-2 px-3 py-2">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none text-text-muted shrink-0" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-xs font-medium text-text-primary">
                            {{ item.planTitle ?? 'Plan ready' }}
                          </div>
                          <div class="text-[11px] text-text-muted">
                            <template v-if="item.planEntries?.length">
                              {{ item.planCompletedCount }}/{{ item.planEntries.length }} completed
                            </template>
                            <template v-else>Document ready</template>
                          </div>
                        </div>
                        <button
                          type="button"
                          class="shrink-0 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                          @click="openPlan(item.planId)"
                        >
                          Show plan
                        </button>
                      </div>
                    </div>
                  </div>
                  <!-- Tool card -->
                  <div v-else class="flex justify-start">
                    <div class="flex flex-col gap-0.5 max-w-full md:max-w-[85%]">
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
                  v-if="fallbackHtml"
                  class="flex justify-start"
                >
                  <div
                    class="chat-markdown max-w-full md:max-w-[85%] bg-fg/[0.06] text-text-primary px-4 py-2 rounded-2xl rounded-bl-sm text-sm"
                    v-html="fallbackHtml"
                    @click="onChatMarkdownClick"
                  ></div>
                </div>
              </template>
            </template>

            <!-- Live streaming turn -->
            <template v-if="bIsStreaming">
              <template v-for="(item, j) in streamingDisplayItems" :key="'s' + j">
                <div v-if="item.kind === 'text'" class="flex justify-start">
                  <div
                    class="chat-markdown max-w-full md:max-w-[85%] bg-fg/[0.06] text-text-primary px-4 py-2 rounded-2xl rounded-bl-sm text-sm"
                    v-html="item.renderedHtml"
                    @click="onChatMarkdownClick"
                  ></div>
                </div>
                <div v-else-if="item.kind === 'todos'" class="flex justify-start">
                  <div
                    class="max-w-full md:max-w-[85%] w-80 rounded-xl border border-fg/10 bg-fg/[0.03] overflow-hidden"
                  >
                    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-fg/10">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none text-text-muted shrink-0" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12l2 2 4-4"/></svg>
                      <span class="text-xs font-medium text-text-primary">Todos</span>
                      <span v-if="item.status === 'running'" class="ml-auto">
                        <svg class="animate-spin text-primary select-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
                      </span>
                      <span v-else class="ml-auto text-xs text-text-muted">
                        {{ item.todoDoneCount }}/{{ item.todoItems?.length }}
                      </span>
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
                    class="max-w-full md:max-w-[85%] w-80 rounded-xl border border-fg/10 bg-fg/[0.03] overflow-hidden"
                  >
                    <div class="flex items-center gap-2 px-3 py-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none text-text-muted shrink-0" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
                      <div class="min-w-0 flex-1">
                        <div class="truncate text-xs font-medium text-text-primary">
                          {{ item.planTitle ?? 'Plan ready' }}
                        </div>
                        <div class="text-[11px] text-text-muted">
                          <template v-if="item.planEntries?.length">
                            {{ item.planCompletedCount }}/{{ item.planEntries.length }} completed
                          </template>
                          <template v-else>Document ready</template>
                        </div>
                      </div>
                      <button
                        type="button"
                        class="shrink-0 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                        @click="openPlan(item.planId)"
                      >
                        Show plan
                      </button>
                    </div>
                  </div>
                </div>
                <!-- Tool card — live -->
                <div v-else class="flex justify-start">
                  <div class="flex flex-col gap-0.5 max-w-full md:max-w-[85%]">
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
                  class="flex h-[240px] max-w-full md:max-w-[85%] min-h-0 flex-col overflow-hidden rounded-xl border border-fg/10 border-dashed bg-fg/[0.03] px-3 py-2 text-xs text-text-muted"
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
                class="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/30 px-3 py-1.5 rounded-lg"
              >
                <span>{{ chatError }}</span>
                <button
                  v-if="chatErrorActionLabel"
                  type="button"
                  class="text-xs font-medium underline underline-offset-2 hover:text-destructive/80"
                  @click="handleChatErrorAction"
                >
                  {{ chatErrorActionLabel }}
                </button>
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
                    {{ item.imagePaths.length }} attachment{{ item.imagePaths.length === 1 ? '' : 's' }}
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
          <!-- Pending attachment previews -->
          <div
            v-if="pendingImages.length > 0 || bUploadingImage"
            class="flex flex-wrap gap-2 pb-1 px-2"
          >
            <div v-for="(attachment, i) in pendingImages" :key="i" class="relative shrink-0">
              <img
                v-if="attachment.isImage"
                :src="attachment.dataUrl"
                class="h-16 w-16 object-cover rounded-lg border border-fg/10 cursor-pointer"
                title="View full size"
                @click="lightboxSrc = attachment.dataUrl"
              />
              <div
                v-else
                class="flex h-16 max-w-[10rem] items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/[0.06] px-2 text-xs text-text-primary"
                :title="attachment.displayName"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-text-muted" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <span class="truncate">{{ attachment.displayName }}</span>
              </div>
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
              ref="promptInputBoxRef"
              class="prompt-input-box flex-1 min-w-0 min-h-[44px] rounded-md border border-fg/10 bg-fg/[0.06] pl-1 pr-1 transition-colors focus-within:border-primary/50"
              :class="{ 'prompt-input-box--multiline': bPromptUseCompactMultiline }"
            >
              <div
                ref="modeMenuRef"
                class="prompt-mode relative ml-0.5 shrink-0"
                :class="bPromptUseCompactMultiline ? 'mb-0.5' : 'mb-[6px]'"
                :title="`Mode: ${selectedModeOption.label}`"
              >
                <button
                  type="button"
                  class="flex h-7 max-w-[136px] items-center gap-1.5 rounded-full border border-fg/[0.08] bg-fg/[0.08] px-2 text-xs font-medium leading-none text-text-primary transition-colors hover:bg-fg/[0.12] focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="bIsStreaming || bModesLoading || bSavingSessionMode"
                  :aria-expanded="bModeMenuOpen"
                  aria-haspopup="menu"
                  @click.stop="bModeMenuOpen = !bModeMenuOpen"
                >
                  <ListChecks
                    v-if="selectedModeIconName === 'plan'"
                    :size="14"
                    :stroke-width="1.8"
                    class="shrink-0"
                  />
                  <Bug
                    v-else-if="selectedModeIconName === 'debug'"
                    :size="14"
                    :stroke-width="1.8"
                    class="shrink-0"
                  />
                  <ListTodo
                    v-else-if="selectedModeIconName === 'multi'"
                    :size="14"
                    :stroke-width="1.8"
                    class="shrink-0"
                  />
                  <MessageSquare
                    v-else-if="selectedModeIconName === 'ask'"
                    :size="14"
                    :stroke-width="1.8"
                    class="shrink-0"
                  />
                  <InfinityIcon
                    v-else
                    :size="14"
                    :stroke-width="1.8"
                    class="shrink-0"
                  />
                  <span class="min-w-0 truncate">{{ selectedModeOption.label }}</span>
                  <ChevronDown
                    :size="13"
                    :stroke-width="1.8"
                    class="shrink-0 opacity-70"
                  />
                </button>
                <div
                  v-if="bModeMenuOpen"
                  class="absolute left-0 bottom-full z-50 mb-1 min-w-[128px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
                  role="menu"
                  @click.stop
                >
                  <button
                    v-for="mode in modeOptions"
                    :key="mode.id"
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text-primary transition-colors hover:bg-fg/[0.08]"
                    :class="mode.id === displaySessionMode ? 'bg-fg/[0.08]' : ''"
                    role="menuitem"
                    @click="selectSessionMode(mode.id)"
                  >
                    <ListChecks
                      v-if="modeIconName(mode.id) === 'plan'"
                      :size="14"
                      :stroke-width="1.8"
                      class="shrink-0 text-text-muted"
                    />
                    <Bug
                      v-else-if="modeIconName(mode.id) === 'debug'"
                      :size="14"
                      :stroke-width="1.8"
                      class="shrink-0 text-text-muted"
                    />
                    <ListTodo
                      v-else-if="modeIconName(mode.id) === 'multi'"
                      :size="14"
                      :stroke-width="1.8"
                      class="shrink-0 text-text-muted"
                    />
                    <MessageSquare
                      v-else-if="modeIconName(mode.id) === 'ask'"
                      :size="14"
                      :stroke-width="1.8"
                      class="shrink-0 text-text-muted"
                    />
                    <InfinityIcon
                      v-else
                      :size="14"
                      :stroke-width="1.8"
                      class="shrink-0 text-text-muted"
                    />
                    <span class="min-w-0 truncate">{{ mode.label }}</span>
                  </button>
                </div>
              </div>
              <textarea
                ref="textareaEl"
                v-model="promptText"
                @keydown.enter="onKeydown"
                @paste="onPaste"
                :placeholder="promptPlaceholder"
                rows="1"
                class="prompt-textarea w-full min-w-0 resize-none bg-transparent text-text-primary placeholder-text-muted text-sm px-2 py-1.5 leading-5 rounded-none border-0 shadow-none focus:outline-none focus:ring-0 box-border"
                style="height: 32px; max-height: 160px; overflow-y: auto"
              ></textarea>
              <button
                type="button"
                @click="onAttachClick"
                :disabled="bIsStreaming"
                title="Attach file"
                class="prompt-attach button is-transparent is-icon h-[36px]! px-0! aspect-square! shrink-0"
                :class="bPromptUseCompactMultiline ? 'mb-0.5' : 'mb-[3px]'"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
              </button>
            </div>
            <input
              ref="fileInputEl"
              type="file"
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
          <div class="px-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-none">
            <div class="flex min-w-0 flex-nowrap items-center gap-1.5 sm:gap-3">
              <label
                v-for="cfg in agentConfigOptions"
                :key="cfg.id"
                class="flex min-w-0 items-center gap-1"
              >
                <span class="hidden shrink-0 text-[9px] font-medium uppercase tracking-wide text-text-muted sm:inline">{{ cfg.label }}</span>
                <select
                  :value="agentConfigDisplayValue(cfg)"
                  :disabled="bIsStreaming || bConfigLoading || bSavingSessionConfig"
                  :aria-label="cfg.label"
                  class="h-5! min-h-0! w-[4.25rem] rounded border border-fg/[0.08] bg-transparent px-1! py-0! text-[11px] leading-none text-text-primary focus:border-primary/50 focus:outline-none disabled:opacity-50 sm:w-24 sm:px-1.5!"
                  @change="onAgentConfigChange(cfg.id, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="opt in cfg.options" :key="opt.value" :value="opt.value">
                    {{ opt.label }}
                  </option>
                </select>
              </label>
              <AgentModelPicker
                :model-value="modelSelection"
                :agent-type="session?.agentType"
                :model-options="modelOptions"
                :disabled="bIsStreaming || bModelsLoading || bSavingModelSelection"
                variant="compact"
                @update:model-value="onSharedModelPickerUpdate"
              />
            </div>
            <button
              type="button"
              class="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-primary sm:hidden"
              :class="!hideThinkingOutput ? 'text-yellow-400 hover:text-yellow-300' : 'text-text-muted'"
              :aria-pressed="!hideThinkingOutput"
              :aria-label="hideThinkingOutput ? 'Show thinking process' : 'Hide thinking process'"
              :title="hideThinkingOutput ? 'Show thinking process' : 'Hide thinking process'"
              @click="onHideThinkingToggle(!hideThinkingOutput)"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M9 18h6" />
                <path d="M10 22h4" />
                <path d="M8.5 14.5A6 6 0 1 1 15.5 14.5c-.8.7-1.3 1.6-1.5 2.5h-4c-.2-.9-.7-1.8-1.5-2.5Z" />
              </svg>
            </button>
            <label
              class="ml-auto hidden cursor-pointer items-center gap-1.5 text-text-muted hover:text-text-primary sm:flex"
            >
              <input
                type="checkbox"
                class="h-3 w-3 shrink-0 rounded border-fg/[0.2] text-primary focus:ring-primary/40"
                :checked="!hideThinkingOutput"
                @change="onShowThinkingToggle(($event.target as HTMLInputElement).checked)"
              />
              <span>Show thinking process</span>
            </label>
            <span v-if="bSelectedModelMissing" class="w-full text-[10px] text-warning">
              Saved model not found: {{ modelSelection }}
            </span>
          </div>
        </div>
      </div>

      <!-- Plan -->
      <div
        v-if="activeTab === 'plan'"
        class="flex-1 min-h-0 overflow-hidden flex flex-col bg-bg"
      >
        <div class="shrink-0 border-b border-fg/10 px-4 md:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div class="min-w-0 sm:flex-1">
            <div
              v-if="planDocuments.length <= 1"
              class="flex items-center gap-2"
            >
              <span class="truncate text-sm font-semibold text-text-primary">
                {{ selectedPlanDocument?.title ?? 'Plan' }}
              </span>
              <span
                v-if="selectedPlanDocument?.live"
                class="shrink-0 rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              >
                Live
              </span>
            </div>
            <div
              v-if="selectedPlanDocument"
              class="text-xs text-text-muted whitespace-nowrap"
            >
              <template v-if="selectedPlanDocument.startableEntries.length">
                {{ selectedPlanDocument.completedCount }}/{{ selectedPlanDocument.startableEntries.length }} completed
              </template>
              <template v-else>Plan document</template>
            </div>
          </div>

          <div class="flex min-w-0 items-center gap-2 sm:ml-auto sm:shrink-0">
            <select
              v-if="planDocuments.length > 1"
              class="min-w-0 flex-1 max-w-none rounded-md border border-fg/15 bg-bg px-2 py-1 text-xs text-text-primary outline-none focus:border-primary sm:max-w-[12rem] sm:flex-none"
              :value="selectedPlanDocument?.id"
              @change="selectedPlanId = ($event.target as HTMLSelectElement).value"
            >
              <option
                v-for="plan in planDocuments"
                :key="plan.id"
                :value="plan.id"
              >
                {{ plan.title }}{{ plan.live ? ' (live)' : '' }}
              </option>
            </select>

            <div
              v-if="selectedPlanDocument"
              ref="planActionsMenuRef"
              class="relative inline-flex shrink-0"
            >
            <button
              type="button"
              class="button is-transparent rounded-r-none! text-xs"
              title="Download plan as Markdown"
              @click="downloadPlan(selectedPlanDocument)"
            >
              Download
            </button>
            <button
              type="button"
              class="button is-transparent is-icon rounded-l-none! border-l border-fg/10"
              title="Plan actions"
              @click.stop="bPlanActionsMenuOpen = !bPlanActionsMenuOpen"
            >
              <ChevronDown class="h-3.5 w-3.5" />
            </button>
            <div
              v-if="bPlanActionsMenuOpen"
              class="absolute right-0 top-full z-30 mt-1 min-w-56 overflow-hidden rounded-lg border border-fg/10 bg-surface shadow-xl"
            >
              <button
                type="button"
                class="flex w-full items-center px-3 py-2 text-left text-xs text-text-primary hover:bg-fg/[0.06]"
                @click="startSessionFromFullPlan(selectedPlanDocument)"
              >
                Start whole plan in new session
              </button>
              <button
                type="button"
                class="flex w-full items-center px-3 py-2 text-left text-xs text-text-primary hover:bg-fg/[0.06]"
                @click="downloadPlan(selectedPlanDocument)"
              >
                Download markdown
              </button>
            </div>
            </div>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-6">
          <div
            v-if="selectedPlanDocument"
            class="mx-auto flex max-w-3xl flex-col gap-4"
          >
            <div class="rounded-2xl border border-fg/10 bg-fg/[0.03] px-5 py-4 md:px-8 md:py-6">
              <div
                class="chat-markdown plan-markdown text-sm text-text-primary"
                v-html="selectedPlanDocument.renderedHtml"
                @click="onPlanMarkdownClick"
              ></div>
            </div>
            <div
              v-if="selectedPlanDocument.startableEntries.length"
              class="rounded-2xl border border-fg/10 bg-fg/[0.03] overflow-hidden"
            >
              <div class="flex items-center gap-2 border-b border-fg/10 px-4 py-2.5">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none text-text-muted shrink-0" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12l2 2 4-4"/></svg>
                <span class="text-xs font-medium text-text-primary">Plan points</span>
                <span class="ml-auto text-xs text-text-muted">
                  {{ selectedPlanDocument.completedCount }}/{{ selectedPlanDocument.startableEntries.length }}
                </span>
              </div>
              <ul class="space-y-1.5 px-4 py-3">
                <li
                  v-for="(entry, index) in selectedPlanDocument.startableEntries"
                  :key="`${selectedPlanDocument.id}-todo-${index}`"
                  class="flex items-start gap-2 text-xs"
                >
                  <svg v-if="planStatusIcon(entry.status) === 'completed'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-green-500 select-none shrink-0 mt-px" aria-hidden="true"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  <svg v-else-if="planStatusIcon(entry.status) === 'in_progress'" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-primary select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="text-text-muted select-none shrink-0 mt-px" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>
                  <span
                    class="min-w-0 flex-1 leading-snug"
                    :class="
                      isPlanEntryCompleted(entry.status)
                        ? 'text-text-muted line-through'
                        : 'text-text-primary'
                    "
                  >
                    {{ entry.content }}
                  </span>
                  <button
                    type="button"
                    class="shrink-0 rounded-md border border-fg/10 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
                    title="Start a new session from this plan point"
                    @click="startSessionFromPlanEntry(selectedPlanDocument, entry, index)"
                  >
                    Start session
                  </button>
                </li>
              </ul>
            </div>
          </div>
          <div v-else class="h-full flex items-center justify-center text-sm text-text-muted">
            No plan has been created for this session yet.
          </div>
        </div>
      </div>

      <!-- Files -->
      <FilesView
        v-if="activeTab === 'files'"
        :workspace-id="workspaceId"
        :active="activeTab === 'files'"
      />

      <!-- Git -->
      <GitView
        v-if="activeTab === 'git'"
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
          v-if="bShowPlanTab"
          class="flex-1 md:flex-none px-4 py-3 text-sm md:px-4 md:py-2 md:text-sm font-medium transition-colors border-t-2 md:border-t-0 md:rounded-full inline-flex items-center justify-center gap-1"
          :class="
            activeTab === 'plan'
              ? 'border-primary text-text-primary bg-fg/[0.03]'
              : 'border-transparent text-text-muted hover:text-text-primary hover:bg-fg/[0.04]'
          "
          @click="openPlan(selectedPlanDocument?.id)"
        >
          Plan
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
.prompt-input-box {
  display: grid;
  align-items: end;
  gap: 0.25rem;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto;
}

.prompt-input-box:not(.prompt-input-box--multiline) .prompt-mode {
  grid-column: 1;
  grid-row: 1;
}

.prompt-input-box:not(.prompt-input-box--multiline) .prompt-textarea {
  grid-column: 2;
  grid-row: 1;
  align-self: center;
}

.prompt-input-box:not(.prompt-input-box--multiline) .prompt-attach {
  grid-column: 3;
  grid-row: 1;
}

.prompt-input-box--multiline {
  grid-template-columns: auto 1fr auto;
  grid-template-rows: auto auto;
}

.prompt-input-box--multiline .prompt-textarea {
  grid-column: 1 / -1;
  grid-row: 1;
  align-self: start;
}

.prompt-input-box--multiline .prompt-mode {
  grid-column: 1;
  grid-row: 2;
}

.prompt-input-box--multiline .prompt-attach {
  grid-column: 3;
  grid-row: 2;
  align-self: end;
}

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

.plan-markdown {
  line-height: 1.65;
}

.plan-markdown :deep(h1),
.plan-markdown :deep(h2),
.plan-markdown :deep(h3) {
  color: var(--color-text-primary);
  font-weight: 700;
  line-height: 1.25;
}

.plan-markdown :deep(h1) {
  margin: 0 0 1rem;
  font-size: 1.5rem;
}

.plan-markdown :deep(h2) {
  margin: 1.5rem 0 0.65rem;
  padding-top: 0.75rem;
  border-top: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  font-size: 1.125rem;
}

.plan-markdown :deep(h3) {
  margin: 1.15rem 0 0.5rem;
  font-size: 0.98rem;
}

.plan-markdown :deep(p),
.plan-markdown :deep(ul),
.plan-markdown :deep(ol),
.plan-markdown :deep(blockquote),
.plan-markdown :deep(pre) {
  margin: 0.65rem 0;
}

.plan-markdown :deep(ul),
.plan-markdown :deep(ol) {
  padding-left: 1.25rem;
}

.plan-markdown :deep(ul) {
  list-style: disc;
}

.plan-markdown :deep(ol) {
  list-style: decimal;
}

.plan-markdown :deep(li) {
  margin: 0.35rem 0;
  padding-left: 0.15rem;
}

.plan-markdown :deep(.plan-start-actions-card) {
  margin: 1.25rem 0 0;
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  border-radius: 0.85rem;
  background: color-mix(in srgb, var(--color-fg) 4%, transparent);
  overflow: hidden;
}

.plan-markdown :deep(.plan-start-actions-title) {
  border-bottom: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  padding: 0.65rem 0.85rem;
  color: var(--color-text-primary);
  font-size: 0.78rem;
  font-weight: 700;
}

.plan-markdown :deep(.plan-start-actions-card ol) {
  margin: 0;
  padding: 0.5rem 0.75rem;
  list-style: none;
}

.plan-markdown :deep(.plan-start-action-row) {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  margin: 0;
  padding: 0.45rem 0;
}

.plan-markdown :deep(.plan-start-action-row + .plan-start-action-row) {
  border-top: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
}

.plan-markdown :deep(.plan-start-action-row span) {
  min-width: 0;
  flex: 1;
  line-height: 1.35;
}

.plan-markdown :deep(.plan-start-action-inline) {
  margin: -0.25rem 0 0.75rem;
}

.plan-markdown :deep(.plan-start-session-btn) {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--color-primary) 25%, transparent);
  border-radius: 0.45rem;
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
  padding: 0.3rem 0.5rem;
  color: var(--color-primary);
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1;
  vertical-align: middle;
}

.plan-markdown :deep(.plan-start-session-btn:hover) {
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
}

.plan-markdown :deep(strong) {
  color: var(--color-text-primary);
  font-weight: 700;
}

.plan-markdown :deep(blockquote) {
  border-left: 3px solid color-mix(in srgb, var(--color-fg) 18%, transparent);
  padding-left: 0.9rem;
  color: var(--color-text-muted);
}

.plan-markdown :deep(code) {
  border-radius: 0.35rem;
  background: color-mix(in srgb, var(--color-fg) 8%, transparent);
  padding: 0.1rem 0.3rem;
  font-size: 0.86em;
}

.plan-markdown :deep(pre) {
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--color-fg) 6%, transparent);
  padding: 0.85rem 1rem;
}

.plan-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
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

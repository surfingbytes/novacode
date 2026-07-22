<script setup lang="ts">
/**
 * Chat composer: prompt textarea (autosize + compact mobile layout), mode
 * picker, attachments, prompt queue, model/config controls row.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Bug, ChevronDown, Infinity as InfinityIcon, ListChecks, ListTodo, MessageSquare } from 'lucide-vue-next';

// components
import AgentModelPicker from '@/components/AgentModelPicker.vue';

// types
import type {
  AgentConfigOption,
  AgentModeOption,
  AgentModelOption,
  AgentThinkingOptionGroup,
  AgentType,
  ChatQueueItem
} from '@/@types/index';

// -------------------------------------------------- Types --------------------------------------------------

export interface PendingAttachment {
  filename: string;
  displayName: string;
  dataUrl: string;
  serverPath: string;
  isImage: boolean;
}

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    bIsStreaming: boolean;
    bWsConnected: boolean;
    queuedPrompts: ChatQueueItem[];
    // mode
    modeOptions: AgentModeOption[];
    displaySessionMode: string;
    selectedModeLabel: string;
    selectedModeIcon: 'plan' | 'debug' | 'multi' | 'ask' | 'agent';
    bModesLoading: boolean;
    bSavingSessionMode: boolean;
    // model / config
    agentType?: AgentType | null;
    modelSelection: string;
    modelOptions: AgentModelOption[];
    thinkingOptions: AgentThinkingOptionGroup | null;
    thinkingValue?: string | null;
    bModelsLoading: boolean;
    bSavingModelSelection: boolean;
    bSelectedModelMissing: boolean;
    agentConfigOptions: AgentConfigOption[];
    agentConfigDisplayValue: (option: AgentConfigOption) => string;
    bConfigLoading: boolean;
    bSavingSessionConfig: boolean;
    hideThinkingOutput: boolean;
    bMdUp: boolean;
    bUploadingImage: boolean;
  }>(),
  {
    agentType: null,
    thinkingValue: null
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'send', payload: { text: string; imagePaths: string[] }): void;
  (e: 'cancel'): void;
  (e: 'pushQueue', id: string): void;
  (e: 'deleteQueue', id: string): void;
  (e: 'selectMode', id: string): void;
  (e: 'configChange', id: string, value: string): void;
  (e: 'modelUpdate', value: string): void;
  (e: 'thinkingUpdate', value: string): void;
  (e: 'hideThinkingToggle', checked: boolean): void;
  (e: 'lightbox', src: string): void;
  (e: 'uploadFiles', files: File[]): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const promptText = defineModel<string>('promptText', { default: '' });
const pendingImages = defineModel<PendingAttachment[]>('pendingImages', { default: () => [] });

const textareaEl = ref<HTMLTextAreaElement | null>(null);
const promptInputBoxRef = ref<HTMLElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);
const modeMenuRef = ref<HTMLElement | null>(null);
const bModeMenuOpen = ref(false);

const PROMPT_SINGLE_LINE_HEIGHT = 32;
const bPromptMultiline = ref(false);
const bPromptCompactLayout = ref(false);
let promptCompactMql: MediaQueryList | null = null;
let promptInputResizeObserver: ResizeObserver | null = null;
let promptInputObservedWidth = 0;

// -------------------------------------------------- Computed --------------------------------------------------

const bPromptUseCompactMultiline = computed(
  () => bPromptCompactLayout.value && bPromptMultiline.value
);

const promptPlaceholder = computed(() => {
  if (props.bIsStreaming) return 'Type your next message…';
  if (props.bMdUp) {
    return 'Type a message… (Ctrl+Enter to send, Enter for newline)';
  }
  return 'Type a message…';
});

// -------------------------------------------------- Methods --------------------------------------------------

function send(): void {
  const text = promptText.value.trim();
  const imagePaths = pendingImages.value.map((img) => img.serverPath);
  if ((!text && imagePaths.length === 0) || !props.bWsConnected) {
    return;
  }
  emit('send', { text, imagePaths });
  promptText.value = '';
  pendingImages.value = [];
  nextTick(() => textareaEl.value?.focus());
}

function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    send();
  }
}

function onPaste(e: ClipboardEvent): void {
  const items = e.clipboardData?.items;
  if (!items) return;

  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (!item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length > 0) {
    e.preventDefault();
    emit('uploadFiles', files);
  }
}

function onAttachClick(): void {
  fileInputEl.value?.click();
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  const files = input.files;
  if (files && files.length > 0) {
    emit('uploadFiles', Array.from(files));
  }
  // allow selecting the same file again
  input.value = '';
}

function openModeMenu(): void {
  bModeMenuOpen.value = !bModeMenuOpen.value;
}

function closeModeMenu(): void {
  bModeMenuOpen.value = false;
}

function selectMode(id: string): void {
  closeModeMenu();
  emit('selectMode', id);
}

function handleDocumentClick(e: MouseEvent): void {
  const el = modeMenuRef.value;
  if (bModeMenuOpen.value && el && !el.contains(e.target as Node)) {
    closeModeMenu();
  }
}

function handleDocumentKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && bModeMenuOpen.value) {
    closeModeMenu();
  }
}

// -------------------------------------------------- Textarea autosize --------------------------------------------------

function syncPromptLayoutBreakpoint(): void {
  const wasCompact = bPromptCompactLayout.value;
  bPromptCompactLayout.value =
    promptCompactMql?.matches ??
    window.matchMedia('(max-width: 767px) and (orientation: portrait)').matches;
  if (wasCompact !== bPromptCompactLayout.value) {
    nextTick(() => resizeTextarea());
  }
}

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

function resizeTextarea(): void {
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

function observePromptInputBox(): void {
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

// -------------------------------------------------- Watchers --------------------------------------------------

watch(promptText, () => {
  nextTick(() => resizeTextarea());
});

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  promptCompactMql = window.matchMedia('(max-width: 767px) and (orientation: portrait)');
  syncPromptLayoutBreakpoint();
  promptCompactMql.addEventListener('change', syncPromptLayoutBreakpoint);
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleDocumentKeydown);
  nextTick(() => {
    resizeTextarea();
    observePromptInputBox();
  });
});

onUnmounted(() => {
  promptInputResizeObserver?.disconnect();
  promptInputResizeObserver = null;
  if (promptCompactMql) {
    promptCompactMql.removeEventListener('change', syncPromptLayoutBreakpoint);
    promptCompactMql = null;
  }
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('keydown', handleDocumentKeydown);
});

defineExpose({
  focus: () => textareaEl.value?.focus(),
  resizeTextarea,
  observePromptInputBox
});
</script>

<template>
  <div class="pt-2 pb-3 border-t border-fg/10 flex flex-col gap-2 shrink-0">
    <!-- Prompt queue -->
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
            aria-label="Send next"
            class="button is-transparent is-icon h-7! w-7! min-w-7! px-0!"
            @click="emit('pushQueue', item.id)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
          </button>
          <button
            type="button"
            title="Remove from queue"
            aria-label="Remove from queue"
            class="button is-transparent is-icon h-7! w-7! min-w-7! px-0!"
            @click="emit('deleteQueue', item.id)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Pending attachment previews -->
    <div v-if="pendingImages.length > 0 || bUploadingImage" class="flex flex-wrap gap-2 pb-1 px-2">
      <div v-for="(attachment, i) in pendingImages" :key="i" class="relative shrink-0">
        <img
          v-if="attachment.isImage"
          :src="attachment.dataUrl"
          class="h-16 w-16 object-cover rounded-lg border border-fg/10 cursor-pointer"
          title="View full size"
          @click="emit('lightbox', attachment.dataUrl)"
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
          aria-label="Remove attachment"
          @click.stop="pendingImages.splice(i, 1)"
          class="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-on-accent rounded-full text-xs flex items-center justify-center leading-none shadow-sm"
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

    <!-- Input row -->
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
          :title="`Mode: ${selectedModeLabel}`"
        >
          <button
            type="button"
            class="flex h-7 max-w-[136px] items-center gap-1.5 rounded-full border border-fg/[0.08] bg-fg/[0.08] px-2 text-xs font-medium leading-none text-text-primary transition-colors hover:bg-fg/[0.12] focus:border-primary/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="bIsStreaming || bModesLoading || bSavingSessionMode"
            :aria-expanded="bModeMenuOpen"
            aria-haspopup="menu"
            aria-label="Select session mode"
            @click.stop="openModeMenu"
          >
            <ListChecks v-if="selectedModeIcon === 'plan'" :size="14" :stroke-width="1.8" class="shrink-0" aria-hidden="true" />
            <Bug v-else-if="selectedModeIcon === 'debug'" :size="14" :stroke-width="1.8" class="shrink-0" aria-hidden="true" />
            <ListTodo v-else-if="selectedModeIcon === 'multi'" :size="14" :stroke-width="1.8" class="shrink-0" aria-hidden="true" />
            <MessageSquare v-else-if="selectedModeIcon === 'ask'" :size="14" :stroke-width="1.8" class="shrink-0" aria-hidden="true" />
            <InfinityIcon v-else :size="14" :stroke-width="1.8" class="shrink-0" aria-hidden="true" />
            <span class="min-w-0 truncate">{{ selectedModeLabel }}</span>
            <ChevronDown :size="13" :stroke-width="1.8" class="shrink-0 opacity-70" aria-hidden="true" />
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
              @click="selectMode(mode.id)"
            >
              <ListChecks v-if="mode.id.toLowerCase().includes('plan')" :size="14" :stroke-width="1.8" class="shrink-0 text-text-muted" aria-hidden="true" />
              <Bug v-else-if="mode.id.toLowerCase().includes('debug')" :size="14" :stroke-width="1.8" class="shrink-0 text-text-muted" aria-hidden="true" />
              <ListTodo v-else-if="mode.id.toLowerCase().includes('multi')" :size="14" :stroke-width="1.8" class="shrink-0 text-text-muted" aria-hidden="true" />
              <MessageSquare v-else-if="mode.id.toLowerCase().includes('ask')" :size="14" :stroke-width="1.8" class="shrink-0 text-text-muted" aria-hidden="true" />
              <InfinityIcon v-else :size="14" :stroke-width="1.8" class="shrink-0 text-text-muted" aria-hidden="true" />
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
          aria-label="Message"
          class="prompt-textarea w-full min-w-0 resize-none bg-transparent text-text-primary placeholder-text-muted text-sm px-2 py-1.5 leading-5 rounded-none border-0 shadow-none focus:outline-none focus:ring-0 box-border"
          style="height: 32px; max-height: 160px; overflow-y: auto"
        ></textarea>
        <button
          type="button"
          @click="onAttachClick"
          :disabled="bIsStreaming"
          title="Attach file"
          aria-label="Attach file"
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
      <kbd
        class="hidden sm:inline-flex items-center h-[18px] px-1.5 rounded border border-fg/10 bg-fg/[0.04] font-mono text-[10.5px] text-text-muted select-none shrink-0 self-center"
        title="Send with ⌘/Ctrl + Enter"
        aria-hidden="true"
      >⌘↵</kbd>
      <button
        type="button"
        @click="send"
        :disabled="(!promptText.trim() && !pendingImages.length) || !bWsConnected"
        :aria-label="bIsStreaming ? 'Waiting for response' : 'Send message'"
        :title="bIsStreaming ? 'Waiting for response' : 'Send message'"
        class="button is-primary is-icon !h-[44px] !w-[44px] !min-w-[44px] shrink-0 !rounded-md !p-0"
      >
        <svg v-if="bIsStreaming" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none send-wait-hourglass" aria-hidden="true"><path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 00-.586-1.414L12 12M7 22v-4.172a2 2 0 01.586-1.414L12 12M17 2v4.172a2 2 0 01-.586 1.414L12 12M7 2v4.172a2 2 0 00.586 1.414L12 12"/></svg>
        <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>

    <!-- Model / config controls -->
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
            @change="emit('configChange', cfg.id, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="opt in cfg.options" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>
        <AgentModelPicker
          :model-value="modelSelection"
          :agent-type="agentType"
          :model-options="modelOptions"
          :thinking-options="thinkingOptions"
          :thinking-value="thinkingOptions ? thinkingValue : null"
          :disabled="bIsStreaming || bModelsLoading || bSavingModelSelection || bSavingSessionConfig"
          variant="compact"
          @update:model-value="(v) => emit('modelUpdate', v)"
          @update:thinking-value="(v) => emit('thinkingUpdate', v)"
        />
      </div>
      <button
        type="button"
        class="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-primary sm:hidden"
        :class="!hideThinkingOutput ? 'text-yellow-400 hover:text-yellow-300' : 'text-text-muted'"
        :aria-pressed="!hideThinkingOutput"
        :aria-label="hideThinkingOutput ? 'Show thinking process' : 'Hide thinking process'"
        :title="hideThinkingOutput ? 'Show thinking process' : 'Hide thinking process'"
        @click="emit('hideThinkingToggle', !hideThinkingOutput)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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
          @change="emit('hideThinkingToggle', !($event.target as HTMLInputElement).checked)"
        />
        <span>Show thinking process</span>
      </label>
      <span v-if="bSelectedModelMissing" class="w-full text-[10px] text-warning">
        Saved model not found: {{ modelSelection }}
      </span>
    </div>
  </div>
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

.send-wait-hourglass {
  display: inline-block;
  transform-origin: center;
  animation: send-hourglass-flip 1.2s ease-in-out infinite;
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

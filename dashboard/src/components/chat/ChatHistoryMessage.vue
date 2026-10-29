<script setup lang="ts">
/**
 * One history message: user attachments + text, or assistant display items
 * (with the rendered-markdown fallback).
 * Extracted from ChatMessageList.vue.
 */

// node_modules
import { computed } from 'vue';

// components
import ChatDisplayItems from '@/components/chat/ChatDisplayItems.vue';
import ChatMessageRow from '@/components/chat/ChatMessageRow.vue';

// classes
import { sessionsApi } from '@/classes/api';

// composables
import type { DisplayChatMessage } from '@/composables/useChatDisplayItems';

// utils
import { relativeTimeShort } from '@/utils/relativeTime';
import { handleChatMarkdownClick } from '@/utils/chatMarkdownClick';

// types
import type { AgentType } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    entry: DisplayChatMessage;
    agentType?: AgentType | null;
    userName?: string | null;
    userInitial: string;
    agentInitial: string;
    agentDisplayName: string;
    hideToolCalls: boolean;
    expandedToolOutputIds: Set<string>;
    bFindMatch: boolean;
    bCopied: boolean;
  }>(),
  {
    agentType: null,
    userName: null
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'copy', text: string): void;
  (e: 'toggleToolOutput', callId: string): void;
  (e: 'openPlan', planId: string | undefined): void;
  (e: 'openFile', path: string): void;
  (e: 'lightbox', src: string): void;
}>();

// -------------------------------------------------- Computed --------------------------------------------------

/** Raw (markdown) text of the message; falls back to the assistant's text items. */
const copyText = computed((): string => {
  if (props.entry.msg.content) return props.entry.msg.content;
  return props.entry.items
    .filter((item) => item.kind === 'text' && item.text)
    .map((item) => item.text as string)
    .join('\n\n');
});

// -------------------------------------------------- Attachments / markdown clicks --------------------------------------------------

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

function onChatMarkdownClick(e: MouseEvent): void {
  handleChatMarkdownClick(e, (src) => emit('lightbox', src));
}
</script>

<template>
  <ChatMessageRow
    :avatar-variant="entry.msg.role === 'user' ? 'user' : (agentType ?? 'agent')"
    :initial="entry.msg.role === 'user' ? userInitial : agentInitial"
    :name="entry.msg.role === 'user' ? (userName ?? 'You') : agentDisplayName"
    :age="relativeTimeShort(entry.msg.createdAt)"
    :find-key="entry.key"
    :b-find-match="bFindMatch"
    :b-copyable="Boolean(copyText)"
    :b-copied="bCopied"
    @copy="emit('copy', copyText)"
  >
    <!-- User attachments -->
    <div v-if="entry.msg.role === 'user' && entry.msg.imagePaths?.length" class="flex flex-wrap gap-2">
      <template v-for="(imgPath, j) in entry.msg.imagePaths" :key="j">
        <img
          v-if="isImageAttachmentPath(imgPath)"
          :src="entry.msg.imageDataUrls?.[j] ?? imageApiUrl(imgPath)"
          class="max-h-48 max-w-[12rem] rounded-lg object-cover border border-fg/10 cursor-pointer"
          title="View full size"
          @click="emit('lightbox', entry.msg.imageDataUrls?.[j] ?? imageApiUrl(imgPath))"
        />
        <a
          v-else
          :href="imageApiUrl(imgPath)"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex max-w-[12rem] items-center gap-1.5 rounded-lg border border-fg/10 bg-fg/[0.06] px-3 py-2 text-xs text-text-primary hover:bg-fg/[0.1]"
          :title="attachmentDisplayName(imgPath)"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-text-muted" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span class="truncate">{{ attachmentDisplayName(imgPath) }}</span>
        </a>
      </template>
    </div>

    <!-- User text -->
    <div
      v-if="entry.msg.role === 'user' && entry.msg.content"
      class="chat-bubble text-text-primary px-3.5 py-3 rounded-lg text-sm whitespace-pre-wrap break-words max-w-full md:max-w-[85%]"
    >
      {{ entry.msg.content }}
    </div>

    <!-- Assistant items -->
    <template v-if="entry.msg.role === 'assistant'">
      <ChatDisplayItems
        :items="entry.items"
        :hide-tool-calls="hideToolCalls"
        :expanded-tool-output-ids="expandedToolOutputIds"
        @toggle-tool-output="(callId) => emit('toggleToolOutput', callId)"
        @open-plan="(planId) => emit('openPlan', planId)"
        @open-file="(path) => emit('openFile', path)"
        @markdown-click="onChatMarkdownClick"
      />
      <div
        v-if="entry.fallbackHtml"
        class="flex justify-start"
      >
        <div
          class="chat-markdown chat-bubble max-w-full md:max-w-[85%] text-text-primary px-3.5 py-3 rounded-lg text-sm"
          @click="onChatMarkdownClick"
          v-html="entry.fallbackHtml"
        ></div>
      </div>
    </template>
  </ChatMessageRow>
</template>

<style scoped>
.chat-bubble {
  background: var(--bg-elev-2);
}
</style>

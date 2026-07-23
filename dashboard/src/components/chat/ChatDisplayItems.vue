<script setup lang="ts">
/**
 * Renders a list of DisplayItems (text bubbles, tool cards, todos, plan cards).
 * Single source used for BOTH history turns and the live stream — the two
 * copy-pasted loops previously inline in SessionChat.vue.
 * `bLive` adds the running spinners only shown during streaming.
 */

// components
import { getToolIconSvg, type DisplayItem } from '@/utils/chatDisplayItems';

// -------------------------------------------------- Props --------------------------------------------------

withDefaults(
  defineProps<{
    items: DisplayItem[];
    bLive?: boolean;
    expandedToolOutputIds: Set<string>;
  }>(),
  { bLive: false }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'toggleToolOutput', callId: string): void;
  (e: 'openPlan', planId: string | undefined): void;
  (e: 'markdownClick', event: MouseEvent): void;
}>();
</script>

<template>
  <template v-for="(item, j) in items" :key="j">
    <!-- Text bubble -->
    <div v-if="item.kind === 'text'" class="flex justify-start">
      <div
        class="chat-markdown max-w-full md:max-w-[85%] text-text-primary px-3.5 py-3 rounded-lg text-sm chat-bubble"
        v-html="item.renderedHtml"
        @click="(e) => emit('markdownClick', e)"
      ></div>
    </div>

    <!-- Todos row (compact trace — the live list itself lives in ChatTodoPanel) -->
    <div v-else-if="item.kind === 'todos'" class="flex justify-start">
      <div
        class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-muted text-xs font-mono chat-card max-w-full md:max-w-[85%]"
      >
        <span class="shrink-0" v-html="getToolIconSvg('checklist')" />
        <span class="font-sans font-medium text-text-primary shrink-0">Todos</span>
        <span class="truncate"
          >{{ item.todoDoneCount ?? 0 }}/{{ item.todoItems?.length ?? 0 }} completed</span
        >
        <span class="shrink-0 ml-auto pl-2">
          <svg
            v-if="bLive && item.status === 'running'"
            class="animate-spin text-primary select-none"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
          </svg>
          <svg
            v-else-if="item.status === 'success'"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="text-green-500 select-none"
            aria-hidden="true"
          >
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <svg
            v-else-if="item.status === 'rejected'"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="text-text-muted select-none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </span>
      </div>
    </div>

    <!-- Plan card (ACP native) -->
    <div v-else-if="item.kind === 'plan'" class="flex justify-start">
      <div class="max-w-full md:max-w-[85%] w-80 rounded-lg overflow-hidden chat-card">
        <div class="flex items-center gap-2 px-3 py-2">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="select-none text-text-muted shrink-0"
            aria-hidden="true"
          >
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
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
            @click="emit('openPlan', item.planId)"
          >
            Show plan
          </button>
        </div>
      </div>
    </div>

    <!-- Context-reset notice -->
    <div v-else-if="item.kind === 'notice'" class="flex justify-start">
      <div
        class="chat-card flex items-start gap-2 max-w-full md:max-w-[85%] px-3 py-2 rounded-lg text-xs text-text-muted"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="select-none shrink-0 mt-px text-yellow-500"
          aria-hidden="true"
        >
          <path
            d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
          />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span class="leading-snug">{{ item.text }}</span>
      </div>
    </div>

    <!-- Tool card -->
    <div v-else class="flex justify-start">
      <div class="flex flex-col gap-0.5 max-w-full md:max-w-[85%]">
        <div
          class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-muted text-xs font-mono chat-card"
        >
          <span class="shrink-0" v-html="getToolIconSvg(item.toolIcon ?? '')" />
          <span class="font-sans font-medium text-text-primary shrink-0">{{ item.toolName }}</span>
          <span class="truncate">{{ item.toolSummary }}</span>
          <span class="shrink-0 ml-auto pl-2">
            <svg
              v-if="bLive && item.status === 'running'"
              class="animate-spin text-primary select-none"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            <svg
              v-else-if="item.status === 'success'"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="text-green-500 select-none"
              aria-hidden="true"
            >
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <svg
              v-else-if="item.status === 'rejected'"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="text-text-muted select-none"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
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
            @click="emit('toggleToolOutput', item.callId!)"
          >
            <svg
              v-if="expandedToolOutputIds.has(item.callId!)"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="18 15 12 9 6 15" />
            </svg>
            <svg
              v-else
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
            output
          </button>
          <pre
            v-if="expandedToolOutputIds.has(item.callId!)"
            class="mt-1 text-[11px] font-mono text-text-muted/80 whitespace-pre-wrap break-words max-h-32 overflow-y-auto rounded bg-fg/[0.04] px-2 py-1"
            >{{ item.toolOutput }}</pre>
        </div>
      </div>
    </div>
  </template>
</template>

<style scoped>
/* Redesign message treatment: flat second-level surfaces, no heavy borders */
.chat-bubble {
  background: var(--bg-elev-2);
}
.chat-card {
  background: var(--bg-elev-2);
  border: 1px solid var(--line);
}
</style>

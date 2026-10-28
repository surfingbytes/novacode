<script setup lang="ts">
/**
 * "Continued from / Continued in" banner above the message list, with the
 * collapsible handoff summary. Extracted from SessionChat.vue.
 */
// classes
import { renderMdCached } from '@/utils/chatDisplayItems';

// types
import type { SessionHandoffSource } from '@novacode/shared';

// -------------------------------------------------- Props --------------------------------------------------

defineProps<{
  continuedFrom: SessionHandoffSource | null;
  continuedInSessionId: string | null;
  continuedInSessionName: string;
}>();

/** Whether the handoff summary is expanded. */
const bSummaryOpen = defineModel<boolean>('bSummaryOpen', { required: true });

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  /** Navigate to the linked session. */
  (e: 'open-session', sessionId: string): void;
}>();
</script>

<template>
  <div
    v-if="continuedFrom || continuedInSessionId"
    class="mx-4 md:mx-6 mt-2 shrink-0 rounded-md border border-fg/10 bg-fg/[0.03] text-xs text-text-muted"
  >
    <div v-if="continuedFrom" class="flex items-center gap-2 px-3 py-1.5">
      <span class="min-w-0 truncate">
        Continued from
        <button
          type="button"
          class="font-medium text-text-primary hover:underline"
          @click="emit('open-session', continuedFrom.sessionId)"
        >{{ continuedFrom.sessionName.trim() || 'Untitled session' }}</button>
      </span>
      <button
        type="button"
        class="ml-auto shrink-0 hover:text-text-primary"
        :aria-expanded="bSummaryOpen"
        @click="bSummaryOpen = !bSummaryOpen"
      >
        {{ bSummaryOpen ? 'Hide handoff' : 'Show handoff' }}
      </button>
    </div>
    <div
      v-if="continuedFrom && bSummaryOpen"
      class="chat-markdown max-h-72 overflow-y-auto border-t border-fg/10 px-3 py-2 text-sm text-text-primary"
      v-html="renderMdCached(continuedFrom.summary)"
    />
    <div
      v-if="continuedInSessionId"
      class="flex items-center gap-2 px-3 py-1.5"
      :class="{ 'border-t border-fg/10': continuedFrom }"
    >
      <span class="min-w-0 truncate">
        Continued in
        <button
          type="button"
          class="font-medium text-text-primary hover:underline"
          @click="emit('open-session', continuedInSessionId)"
        >{{ continuedInSessionName }}</button>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Token usage meter for the live turn (current usage + per-turn breakdown).
 * Extracted from ChatMessageList.vue.
 */

// utils
import { relativeTimeShort } from '@/utils/relativeTime';
import type { StreamUsage } from '@/utils/chatDisplayItems';

// types
import type { SessionUsageTurn } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------

defineProps<{
  streamingUsage: StreamUsage | null;
  usageTurns: SessionUsageTurn[];
}>();
</script>

<template>
  <div class="flex justify-start">
    <div class="flex flex-col gap-1 px-2 py-1 text-[11px] text-text-muted/50 font-mono">
      <div v-if="streamingUsage" class="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none shrink-0" aria-hidden="true"><path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5M12 12l-3-3"/></svg>
        {{ streamingUsage.used.toLocaleString() }} /
        {{ streamingUsage.size.toLocaleString() }}
        <template v-if="streamingUsage.cost">
          <span class="text-text-muted/30">·</span>
          ${{ streamingUsage.cost.amount.toFixed(4) }}
          <span v-if="streamingUsage.cost.currency && streamingUsage.cost.currency !== 'USD'" class="text-text-muted/30">{{ streamingUsage.cost.currency }}</span>
        </template>
      </div>
      <details v-if="usageTurns.length > 1" class="text-text-muted/40">
        <summary class="cursor-pointer select-none">{{ usageTurns.length }} turns</summary>
        <ul class="mt-1 space-y-0.5 pl-4">
          <li v-for="turn in usageTurns" :key="turn.id">
            {{ turn.used.toLocaleString() }} / {{ turn.size.toLocaleString() }}
            <template v-if="turn.cost"> · ${{ turn.cost.amount.toFixed(4) }}</template>
            <span class="text-text-muted/30"> · {{ relativeTimeShort(turn.createdAt) }}</span>
          </li>
        </ul>
      </details>
    </div>
  </div>
</template>

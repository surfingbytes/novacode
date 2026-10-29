<script setup lang="ts">
/**
 * Fixed-height box streaming the model's thinking text (newest at the bottom).
 * Extracted from ChatMessageList.vue.
 */

// -------------------------------------------------- Props --------------------------------------------------

defineProps<{
  text: string;
}>();
</script>

<template>
  <div class="flex justify-start">
    <div
      class="flex h-[240px] max-w-full md:max-w-[85%] min-h-0 flex-col overflow-hidden rounded-lg chat-card px-3 py-2 text-xs text-text-muted"
    >
      <div class="flex shrink-0 items-center gap-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted/90">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="select-none shrink-0" aria-hidden="true"><path d="M9 12a3 3 0 006 0 3 3 0 00-6 0"/><path d="M12 2a7 7 0 00-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 002 2h4a2 2 0 002-2v-2.26A7 7 0 0012 2z"/><path d="M9 17v1a3 3 0 006 0v-1"/></svg>
        Thinking
      </div>
      <div class="min-h-0 flex-1 overflow-hidden">
        <div class="flex h-full max-h-full flex-col-reverse overflow-y-auto overflow-x-hidden [overflow-anchor:none]">
          <pre class="w-full min-w-0 whitespace-pre-wrap break-words font-sans leading-snug text-text-muted">{{ text }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-card {
  background: var(--bg-elev-2);
  border: 1px solid var(--line);
}
</style>

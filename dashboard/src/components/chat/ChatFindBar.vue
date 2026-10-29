<script setup lang="ts">
/**
 * Find-in-conversation bar (query input, match counter, prev/next/close).
 * Extracted from ChatMessageList.vue; state lives in useChatFind.
 */

// node_modules
import { ref } from 'vue';

// -------------------------------------------------- Props --------------------------------------------------

defineProps<{
  matchIndex: number;
  matchCount: number;
}>();

const query = defineModel<string>('query', { required: true });

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'step', delta: number): void;
  (e: 'close'): void;
  (e: 'keydown', event: KeyboardEvent): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const inputRef = ref<HTMLInputElement | null>(null);

function focusInput(): void {
  inputRef.value?.focus();
  inputRef.value?.select();
}

defineExpose({ focusInput });
</script>

<template>
  <div class="flex items-center gap-2 px-4 md:px-6 py-2 border-b border-fg/10 shrink-0">
    <input
      ref="inputRef"
      v-model="query"
      type="search"
      placeholder="Find in conversation"
      class="flex-1 min-w-0 bg-transparent text-sm text-text-primary outline-none"
      aria-label="Find in conversation"
      @keydown="(event) => emit('keydown', event)"
    />
    <span class="text-[11px] text-text-muted tabular-nums shrink-0 nc-mono">
      {{
        query.trim()
          ? matchCount
            ? `${matchIndex + 1}/${matchCount}`
            : '0/0'
          : ''
      }}
    </span>
    <button
      type="button"
      class="button is-transparent is-icon"
      title="Previous"
      aria-label="Previous match"
      :disabled="matchCount === 0"
      @click="emit('step', -1)"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>
    </button>
    <button
      type="button"
      class="button is-transparent is-icon"
      title="Next"
      aria-label="Next match"
      :disabled="matchCount === 0"
      @click="emit('step', 1)"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <button
      type="button"
      class="button is-transparent is-icon"
      title="Close"
      aria-label="Close find"
      @click="emit('close')"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18 M6 6l12 12"/></svg>
    </button>
  </div>
</template>

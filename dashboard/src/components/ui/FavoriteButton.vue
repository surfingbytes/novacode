<script setup lang="ts">
/** Star toggle shown next to a chat / orchestrator title. */
defineProps<{
  bFavorite: boolean;
}>();

const emit = defineEmits<{
  (e: 'toggle'): void;
}>();
</script>

<template>
  <button
    type="button"
    class="favorite-btn"
    :class="{ 'favorite-btn--on': bFavorite }"
    :title="bFavorite ? 'Remove favorite' : 'Add to favorites'"
    :aria-label="bFavorite ? 'Remove favorite' : 'Add to favorites'"
    :aria-pressed="bFavorite"
    @click="emit('toggle')"
  >
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      :fill="bFavorite ? 'currentColor' : 'none'"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
    </svg>
  </button>
</template>

<style scoped>
.favorite-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--fg-subtle);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.1s,
    color 0.1s;
}
.favorite-btn:hover {
  background: var(--bg-hover);
  color: var(--fg-muted);
}
.favorite-btn--on {
  color: var(--accent);
}
.favorite-btn--on:hover {
  color: var(--accent);
  background: color-mix(in oklab, var(--accent) 12%, transparent);
}
</style>

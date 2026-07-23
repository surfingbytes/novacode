<script setup lang="ts">
/**
 * Per-item status icon for todo lists — the canonical TODO_STATUS_* visuals
 * (extracted from the old inline todos card in ChatDisplayItems, now shared
 * with ChatTodoPanel).
 */

// -------------------------------------------------- Props --------------------------------------------------

defineProps<{ status: string }>();
</script>

<template>
  <svg
    v-if="status === 'TODO_STATUS_COMPLETED'"
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="text-green-500 select-none shrink-0 mt-px"
    aria-hidden="true"
  >
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
  <svg
    v-else-if="status === 'TODO_STATUS_IN_PROGRESS'"
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="text-primary select-none shrink-0 mt-px"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
  <svg
    v-else-if="status === 'TODO_STATUS_CANCELLED'"
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="text-text-muted select-none shrink-0 mt-px"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M15 9l-6 6M9 9l6 6" />
  </svg>
  <svg
    v-else
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="text-text-muted select-none shrink-0 mt-px"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
  </svg>
</template>

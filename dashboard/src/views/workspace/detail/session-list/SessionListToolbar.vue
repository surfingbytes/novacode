<script setup lang="ts">
// types
import type { SessionListViewMode } from './types';

// -------------------------------------------------- Props --------------------------------------------------
defineProps<{
  viewMode: SessionListViewMode;
}>();

// -------------------------------------------------- Emits --------------------------------------------------
const emit = defineEmits<{
  'update:viewMode': [mode: SessionListViewMode];
  newSession: [];
  newOrchestrator: [];
}>();
</script>

<template>
  <div class="flex flex-wrap justify-between sm:justify-end gap-y-2 mb-3">
    <div class="button-select-small mr-2 mt-0">
      <button
        class="button is-icon"
        :class="{ 'is-active': viewMode === 'list' }"
        aria-label="List view"
        :aria-pressed="viewMode === 'list'"
        @click="emit('update:viewMode', 'list')"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>
      <button
        class="button is-icon"
        :class="{ 'is-active': viewMode === 'grid' }"
        aria-label="Grid view"
        :aria-pressed="viewMode === 'grid'"
        @click="emit('update:viewMode', 'grid')"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
      </button>
    </div>
    <div class="flex flex-wrap items-center gap-2 shrink-0">
      <button type="button" class="button" @click="emit('newOrchestrator')">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <path d="M21 3H15v4h6V3zM9 3H3v4h6V3zM15 17H9v4h6v-4z" />
          <path d="M12 7v4M6 7v6h12V7" />
        </svg>
        New orchestrator
      </button>
      <button type="button" class="button is-primary" @click="emit('newSession')">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          width="16"
          height="16"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        New Session
      </button>
    </div>
  </div>
</template>

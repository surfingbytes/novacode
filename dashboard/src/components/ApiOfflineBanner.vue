<script setup lang="ts">
// node_modules
import { storeToRefs } from 'pinia';

// stores
import { useApiHealthStore } from '@/stores/apiHealth';

// -------------------------------------------------- Store --------------------------------------------------

const apiHealth = useApiHealthStore();
const { bApiReachable } = storeToRefs(apiHealth);

// -------------------------------------------------- Methods --------------------------------------------------

async function retry(): Promise<void> {
  await apiHealth.ping();
}
</script>

<template>
  <div
    v-if="!bApiReachable"
    class="flex-none z-50 flex flex-wrap items-center justify-center gap-2 border-b border-warning/40 bg-warning/15 px-3 py-2 text-center text-sm text-text-primary"
    role="status"
    aria-live="polite"
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0 text-warning"><path d="M22.61 16.95A5 5 0 0018 10h-1.26a8 8 0 00-7.05-6M5 5a8 8 0 004 15h9a5 5 0 001.7-.3M1 1l22 22"/></svg>
    <span>
      The API is unreachable. Check your network or that the server is running, then try again.
    </span>
    <button
      type="button"
      class="shrink-0 rounded-md border border-warning/50 bg-surface px-2 py-1 text-xs font-medium text-text-primary hover:bg-card"
      @click="retry"
    >
      Retry
    </button>
  </div>
</template>

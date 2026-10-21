<script setup lang="ts">
// node_modules
import { storeToRefs } from 'pinia';

// stores
import { useApiHealthStore } from '@/stores/apiHealth';

// -------------------------------------------------- Props --------------------------------------------------

withDefaults(
  defineProps<{
    /** Floating badge for layouts without a top bar (phone full-height routes). */
    floating?: boolean;
  }>(),
  { floating: false }
);

// -------------------------------------------------- Store --------------------------------------------------

const apiHealth = useApiHealthStore();
const { bApiReachable } = storeToRefs(apiHealth);

// -------------------------------------------------- Methods --------------------------------------------------

async function retry(): Promise<void> {
  await apiHealth.ping();
}
</script>

<template>
  <!-- Compact pill: never takes layout space when the API is fine, never shifts
       content when it is not — it lives in the top bar's action cluster. -->
  <button
    v-if="!bApiReachable"
    type="button"
    class="api-offline"
    :class="{ 'api-offline--floating': floating }"
    role="status"
    aria-live="polite"
    title="The API is unreachable. Check your network or that the server is running. Click to retry."
    @click="retry"
  >
    <span class="api-offline__dot" aria-hidden="true" />
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="shrink-0"><path d="M22.61 16.95A5 5 0 0018 10h-1.26a8 8 0 00-7.05-6M5 5a8 8 0 004 15h9a5 5 0 001.7-.3M1 1l22 22"/></svg>
    <span class="api-offline__label">API unreachable</span>
  </button>
</template>

<style scoped>
.api-offline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--color-warning) 60%, transparent);
  background: color-mix(in srgb, var(--color-warning) 18%, var(--bg));
  color: var(--fg);
  font-size: 12px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  animation: api-offline-in 0.18s ease-out;
}
.api-offline:hover {
  background: color-mix(in srgb, var(--color-warning) 28%, var(--bg));
}

.api-offline__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--color-warning);
  box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-warning) 60%, transparent);
  animation: api-offline-pulse 1.4s ease-out infinite;
  flex-shrink: 0;
}

.api-offline--floating {
  position: fixed;
  top: 8px;
  right: 8px;
  z-index: 60;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
}

@keyframes api-offline-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-warning) 60%, transparent);
  }
  100% {
    box-shadow: 0 0 0 8px transparent;
  }
}

@keyframes api-offline-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 1023px) {
  .api-offline__label {
    display: none;
  }
}
</style>

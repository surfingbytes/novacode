<script setup lang="ts">
// stores
import { useToastStore } from '@/stores/toasts';

// -------------------------------------------------- Store --------------------------------------------------
const toastStore = useToastStore();

// -------------------------------------------------- Methods --------------------------------------------------
function toastClasses(kind: string): string {
  if (kind === 'error') {
    return 'border-destructive/40 bg-card text-text-primary';
  }
  if (kind === 'success') {
    return 'border-success/40 bg-card text-text-primary';
  }
  return 'border-border bg-card text-text-primary';
}

function dotClasses(kind: string): string {
  if (kind === 'error') {
    return 'bg-destructive';
  }
  if (kind === 'success') {
    return 'bg-success';
  }
  return 'bg-primary';
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed bottom-4 right-4 z-[400] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
    >
      <TransitionGroup name="toast">
        <div
          v-for="toast in toastStore.toasts"
          :key="toast.id"
          class="flex items-start gap-2.5 rounded-lg border px-3.5 py-3 shadow-lg shadow-black/40 backdrop-blur-sm"
          :class="toastClasses(toast.kind)"
          :role="toast.kind === 'error' ? 'alert' : 'status'"
        >
          <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full" :class="dotClasses(toast.kind)" aria-hidden="true"></span>
          <p class="min-w-0 flex-1 text-sm leading-snug break-words">{{ toast.text }}</p>
          <button
            type="button"
            class="-mr-1 -mt-0.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-fg/[0.07] hover:text-text-primary"
            aria-label="Dismiss notification"
            @click="toastStore.dismiss(toast.id)"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(16px);
}
.toast-move {
  transition: transform 0.2s ease;
}
</style>

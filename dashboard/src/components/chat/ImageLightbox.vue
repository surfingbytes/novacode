<script setup lang="ts">
/**
 * Full-screen image preview overlay. Extracted from SessionChat.vue.
 */

// node_modules
import { onMounted, onUnmounted } from 'vue';

// -------------------------------------------------- Model --------------------------------------------------

const src = defineModel<string | null>({ default: null });

// -------------------------------------------------- Methods --------------------------------------------------

function close(): void {
  src.value = null;
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && src.value) close();
}

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="lightbox">
      <div
        v-if="src"
        class="lightbox-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Attached image preview"
        @click.self="close"
      >
        <button
          type="button"
          class="absolute top-4 right-4 z-10 w-10 h-10 flex items-center justify-center rounded-full bg-fg/10 text-white hover:bg-fg/20 transition-colors"
          aria-label="Close image preview"
          @click="close"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <img
          :src="src"
          alt="Attached image preview"
          class="lightbox-img max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lightbox-enter-active,
.lightbox-leave-active {
  transition: opacity 0.22s ease;
}

.lightbox-enter-active .lightbox-img,
.lightbox-leave-active .lightbox-img {
  transition:
    transform 0.24s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.22s ease;
}

.lightbox-enter-from,
.lightbox-leave-to {
  opacity: 0;
}

.lightbox-enter-from .lightbox-img,
.lightbox-leave-to .lightbox-img {
  opacity: 0;
  transform: scale(0.94);
}

.lightbox-enter-to .lightbox-img,
.lightbox-leave-from .lightbox-img {
  opacity: 1;
  transform: scale(1);
}
</style>

<script setup lang="ts">
// node_modules
import { onMounted, onUnmounted, ref, watch } from 'vue';

// classes
import { settingsApi } from '@/classes/api';

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  show: boolean;
  resetTime: string;
  resetTimeReadable: string;
  initialAutoContinue: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'update:show', value: boolean): void;
  (e: 'auto-continue-updated', value: boolean): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const bShowPopup = ref(props.show);
const bAutoContinueEnabled = ref(props.initialAutoContinue);
const bSaving = ref(false);
const saveError = ref<string | null>(null);

const countdown = ref('');
let countdownInterval: number | null = null;

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.show,
  (newValue) => {
    bShowPopup.value = newValue;
  }
);

watch(
  () => props.initialAutoContinue,
  (newValue) => {
    bAutoContinueEnabled.value = newValue;
  }
);

watch(bShowPopup, (newValue) => {
  if (newValue) {
    startCountdown();
  } else {
    stopCountdown();
  }
});

// -------------------------------------------------- Methods --------------------------------------------------

function closePopup(): void {
  bShowPopup.value = false;
  emit('update:show', false);
}

async function toggleAutoContinue(): Promise<void> {
  const newValue = !bAutoContinueEnabled.value;
  bSaving.value = true;
  saveError.value = null;

  try {
    await settingsApi.update({ claudeAutoContinue: newValue });
    bAutoContinueEnabled.value = newValue;
    emit('auto-continue-updated', newValue);
  } catch (error) {
    saveError.value = 'Failed to update preference. Please try again.';
    console.error('Failed to update auto-continue preference:', error);
  } finally {
    bSaving.value = false;
  }
}

function formatCountdown(resetTimeIso: string): string {
  try {
    const resetDate = new Date(resetTimeIso);
    const now = new Date();
    const diff = resetDate.getTime() - now.getTime();

    if (diff <= 0) {
      return 'Ready to continue';
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s remaining`;
    }
    return `${seconds}s remaining`;
  } catch {
    return 'Calculating...';
  }
}

function startCountdown(): void {
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }
  countdown.value = formatCountdown(props.resetTime);
  countdownInterval = window.setInterval(() => {
    countdown.value = formatCountdown(props.resetTime);
  }, 1000);
}

function stopCountdown(): void {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && bShowPopup.value) {
    closePopup();
  }
}

// -------------------------------------------------- Lifecycle --------------------------------------------------

onMounted(() => {
  document.addEventListener('keydown', onDocumentKeydown);
});

onUnmounted(() => {
  stopCountdown();
  document.removeEventListener('keydown', onDocumentKeydown);
});

startCountdown();
</script>

<template>
  <!-- Backdrop -->
  <transition name="fade">
    <div
      v-if="bShowPopup"
      class="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
      @click="closePopup"
    ></div>
  </transition>

  <!-- Popup -->
  <transition name="slide-up">
    <div
      v-if="bShowPopup"
      class="fixed bottom-6 left-1/2 transform -translate-x-1/2 w-full max-w-md mx-4 z-50"
      role="alertdialog"
      aria-labelledby="claude-limit-title"
    >
      <div class="bg-fg border border-fg/[0.15] rounded-2xl shadow-2xl overflow-hidden">
        <!-- Header -->
        <div class="bg-primary/10 p-4 border-b border-fg/[0.1]">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="text-primary"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div>
              <h3 id="claude-limit-title" class="font-semibold text-text-primary">Claude API Limit Reached</h3>
              <p class="text-xs text-text-muted">
                {{ countdown }}
              </p>
            </div>
            <button
              @click="closePopup"
              class="ml-auto text-text-muted hover:text-text-primary transition-colors"
              title="Close"
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <!-- Content -->
        <div class="p-5 space-y-4">
          <div class="text-center">
            <p class="text-text-primary mb-2">
              You've hit your Claude API limit.
            </p>
            <p class="text-sm text-text-muted">
              The limit will reset at <strong class="text-text-primary">{{ resetTimeReadable }}</strong> (UTC).
            </p>
          </div>

          <!-- Auto-continue option -->
          <div class="bg-fg/[0.03] border border-fg/[0.1] rounded-xl p-4">
            <div class="flex items-start gap-4">
              <div class="flex-1">
                <p class="text-sm font-medium text-text-primary mb-1">
                  Auto-continue when limit resets
                </p>
                <p class="text-xs text-text-muted">
                  Automatically send a "continue" prompt 1 minute after the limit resets.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="bAutoContinueEnabled"
                :disabled="bSaving"
                class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed"
                :class="bAutoContinueEnabled ? 'bg-primary' : 'bg-fg/[0.1]'"
                @click="toggleAutoContinue"
              >
                <span
                  class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200"
                  :class="bAutoContinueEnabled ? 'translate-x-5' : 'translate-x-0'"
                ></span>
              </button>
            </div>
            <div v-if="bSaving" class="mt-2 text-center">
              <p class="text-xs text-text-muted">Saving preference...</p>
            </div>
            <div v-if="saveError" class="mt-2 text-center">
              <p class="text-xs text-error">{{ saveError }}</p>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex gap-2">
            <button
              @click="closePopup"
              class="flex-1 py-2 px-4 rounded-lg border border-fg/[0.15] text-text-primary hover:bg-fg/[0.06] transition-colors"
            >
              Dismiss
            </button>
            <button
              @click="toggleAutoContinue"
              :disabled="bSaving"
              class="flex-1 py-2 px-4 rounded-lg btn-primary-solid disabled:cursor-not-allowed transition-colors"
            >
              <span v-if="!bAutoContinueEnabled">Enable Auto-Continue</span>
              <span v-else>Disable Auto-Continue</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active, .slide-up-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.slide-up-enter-from, .slide-up-leave-to {
  transform: translate(-50%, 20px);
  opacity: 0;
}
</style>

<script setup lang="ts">
// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    description: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'primary';
    loading?: boolean;
  }>(),
  {
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    variant: 'danger',
    loading: false,
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [];
}>();

// -------------------------------------------------- Methods --------------------------------------------------

const close = (): void => {
  if (!props.loading) {
    emit('update:modelValue', false);
  }
};

const onConfirm = (): void => {
  if (props.loading) {
    return;
  }
  emit('confirm');
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="'confirm-title'"
      >
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/75 backdrop-blur-sm" @click="close"></div>

        <!-- Panel -->
        <div
          class="modal-panel relative w-full max-w-sm bg-surface border border-fg/[0.09] rounded-2xl shadow-2xl shadow-black/60"
        >
          <div class="flex flex-shrink-0 px-6 pt-5">
            <h2 :id="'confirm-title'" class="font-semibold text-text-primary text-lg">
              {{ title }}
            </h2>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto px-6 py-3">
            <p class="text-sm text-text-muted mb-4">{{ description }}</p>
          </div>
          <div class="flex flex-shrink-0 items-center justify-end gap-2 px-6 pb-5">
            <button
              type="button"
              class="px-4 py-2.5 text-sm text-text-muted hover:text-text-primary bg-fg/[0.04] hover:bg-fg/[0.08] border border-fg/[0.08] rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="loading"
              @click="close"
            >
              {{ cancelLabel }}
            </button>
            <button
              type="button"
              class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              :class="
                variant === 'danger'
                  ? 'bg-destructive hover:bg-destructive/80 text-white shadow-lg shadow-destructive/20'
                  : 'bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/20'
              "
              :disabled="loading"
              @click="onConfirm"
            >
              <div
                v-if="loading"
                class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
              ></div>
              {{ confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

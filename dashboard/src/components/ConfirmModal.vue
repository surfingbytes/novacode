<script setup lang="ts">
// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    description: string;
    /** Eyebrow shown above the title, defaults to '// confirm' */
    eyebrow?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'primary';
    loading?: boolean;
  }>(),
  {
    eyebrow: '// confirm',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    variant: 'danger',
    loading: false
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
  <BaseModal
    :model-value="modelValue"
    labelledby="confirm-modal-title"
    panel-class="max-w-sm"
    :close-on-backdrop="!loading"
    :close-on-esc="!loading"
    @update:model-value="close"
  >
    <ModalHeader
      :eyebrow="eyebrow"
      :title="title"
      title-id="confirm-modal-title"
      :show-close="false"
    />
    <div class="flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-3">
      <p class="text-[13px] text-[var(--fg-muted)] leading-relaxed">{{ description }}</p>
    </div>
    <div class="flex flex-shrink-0 items-center justify-end gap-2 px-6 pb-5 pt-2">
      <button type="button" class="button" :disabled="loading" @click="close">
        {{ cancelLabel }}
      </button>
      <button
        type="button"
        class="button"
        :class="variant === 'danger' ? 'is-destructive' : 'is-primary'"
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
  </BaseModal>
</template>

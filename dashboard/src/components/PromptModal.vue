<script setup lang="ts">
// node_modules
import { ref, watch } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    label?: string;
    initialValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    loading?: boolean;
  }>(),
  {
    label: undefined,
    initialValue: '',
    placeholder: '',
    confirmLabel: 'Save',
    cancelLabel: 'Cancel',
    loading: false
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  confirm: [value: string];
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const inputValue = ref<string>('');

// -------------------------------------------------- Methods --------------------------------------------------

const close = (): void => {
  if (!props.loading) {
    emit('update:modelValue', false);
  }
};

const onSubmit = (): void => {
  if (props.loading || !inputValue.value.trim()) {
    return;
  }
  emit('confirm', inputValue.value.trim());
};

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.modelValue,
  (bOpen) => {
    if (bOpen) {
      inputValue.value = props.initialValue;
    }
  },
  { immediate: true }
);
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    labelledby="prompt-modal-title"
    panel-class="max-w-sm"
    :close-on-backdrop="!loading"
    :close-on-esc="!loading"
    @update:model-value="close"
  >
    <form class="contents" @submit.prevent="onSubmit">
      <div class="flex flex-shrink-0 px-6 pt-5">
        <h2 id="prompt-modal-title" class="font-semibold text-text-primary text-lg">
          {{ title }}
        </h2>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-6 py-3">
        <label v-if="label" for="prompt-modal-input" class="mb-1.5 block text-xs text-text-muted">
          {{ label }}
        </label>
        <input
          id="prompt-modal-input"
          v-model="inputValue"
          type="text"
          :placeholder="placeholder"
          data-modal-autofocus
          class="w-full"
        />
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
          type="submit"
          class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary hover:bg-primary-hover text-on-accent rounded-lg shadow-lg shadow-primary/20 transition-all disabled:opacity-50"
          :disabled="loading || !inputValue.trim()"
        >
          <div
            v-if="loading"
            class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"
          ></div>
          {{ confirmLabel }}
        </button>
      </div>
    </form>
  </BaseModal>
</template>

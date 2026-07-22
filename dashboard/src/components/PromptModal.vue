<script setup lang="ts">
// node_modules
import { ref, watch } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    eyebrow?: string;
    label?: string;
    initialValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    loading?: boolean;
  }>(),
  {
    eyebrow: undefined,
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
      <ModalHeader
        :eyebrow="eyebrow"
        :title="title"
        title-id="prompt-modal-title"
        :show-close="false"
      />
      <div class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
        <div class="nc-field">
          <label v-if="label" for="prompt-modal-input" class="nc-field-label">{{ label }}</label>
          <input
            id="prompt-modal-input"
            v-model="inputValue"
            type="text"
            :placeholder="placeholder"
            data-modal-autofocus
          />
        </div>
      </div>
      <div class="flex flex-shrink-0 items-center justify-end gap-2 px-6 pb-5">
        <button type="button" class="button" :disabled="loading" @click="close">
          {{ cancelLabel }}
        </button>
        <button
          type="submit"
          class="button is-primary"
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

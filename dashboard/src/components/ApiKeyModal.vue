<script setup lang="ts">
// node_modules
import { computed, getCurrentInstance, ref, watch } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// -------------------------------------------------- Props --------------------------------------------------

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** Display name of the provider, e.g. 'Codex' — used for the title. */
    providerName: string;
    eyebrow: string;
    description?: string;
    /** Footer line, e.g. "Get your key from Mistral Console." */
    helpText?: string;
    helpUrl?: string;
    bConfigured: boolean;
    bSaving: boolean;
    bDeleting?: boolean;
    errorMessage?: string | null;
    placeholder?: string;
  }>(),
  {
    description: undefined,
    helpText: undefined,
    helpUrl: undefined,
    bDeleting: false,
    errorMessage: null,
    placeholder: undefined
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [apiKey: string];
  delete: [];
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const apiKeyInput = ref<string>('');

// -------------------------------------------------- Computed --------------------------------------------------

const providerSlug = computed(() => props.providerName.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
const titleId = computed(() => `api-key-modal-title-${providerSlug.value}`);
const inputId = computed(() => `api-key-modal-input-${providerSlug.value}`);
const inputPlaceholder = computed(() => props.placeholder ?? `Your ${props.providerName} API key`);

// The destructive action is only offered when the parent actually handles `delete`.
const instance = getCurrentInstance();
const bHasDeleteHandler = computed(() => {
  const vnodeProps = instance?.vnode.props;
  return !!vnodeProps && 'onDelete' in vnodeProps;
});

// -------------------------------------------------- Methods --------------------------------------------------

const close = (): void => {
  emit('update:modelValue', false);
};

const onSave = (): void => {
  if (props.bSaving || props.bDeleting) {
    return;
  }
  emit('save', apiKeyInput.value);
};

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.modelValue,
  (bOpen) => {
    if (bOpen) {
      apiKeyInput.value = '';
    }
  }
);
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :labelledby="titleId"
    panel-class="max-w-md"
    @update:model-value="close"
  >
    <ModalHeader
      :eyebrow="eyebrow"
      :title="`${providerName} API key`"
      :title-id="titleId"
      @close="close"
    />
    <div class="flex-1 min-h-0 p-4 space-y-4">
      <p v-if="description || $slots.description" class="text-sm text-text-muted">
        <slot name="description">{{ description }}</slot>
      </p>
      <div class="nc-field">
        <label class="nc-field-label" :for="inputId">API key</label>
        <input
          :id="inputId"
          v-model="apiKeyInput"
          type="password"
          :placeholder="inputPlaceholder"
          :disabled="bSaving"
          autocomplete="off"
          @keydown.enter="onSave"
        />
        <p v-if="errorMessage" class="nc-field-hint is-error">{{ errorMessage }}</p>
      </div>
      <p v-if="helpText" class="text-xs text-text-muted">
        <a
          v-if="helpUrl"
          :href="helpUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary hover:underline"
          >{{ helpText }}</a
        >
        <template v-else>{{ helpText }}</template>
      </p>
    </div>
    <div class="flex flex-shrink-0 gap-2 p-4 pt-0">
      <button
        type="button"
        class="button is-primary flex-1"
        :disabled="!apiKeyInput.trim() || bSaving"
        @click="onSave"
      >
        {{ bSaving ? 'Saving…' : 'Save' }}
      </button>
      <button
        v-if="bConfigured && bHasDeleteHandler"
        type="button"
        class="button is-destructive flex-1"
        :disabled="bDeleting"
        @click="emit('delete')"
      >
        {{ bDeleting ? 'Removing…' : 'Remove key' }}
      </button>
    </div>
  </BaseModal>
</template>

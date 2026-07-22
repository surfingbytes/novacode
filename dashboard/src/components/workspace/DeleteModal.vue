<script setup lang="ts">
// components
import BaseModal from '@/components/BaseModal.vue';

// types
import type { Workspace } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  modelValue: boolean;
  workspace?: Workspace;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'delete', workspaceId: string): void;
}>();

// -------------------------------------------------- Methods --------------------------------------------------

const submit = async (): Promise<void> => {
  emit('delete', props.workspace?.id ?? '');
};

const close = (): void => {
  emit('update:modelValue', false);
};
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    labelledby="delete-workspace-modal-title"
    panel-class="max-w-md"
    @update:model-value="close"
  >
    <!-- Header -->
    <div class="modal-header">
      <div id="delete-workspace-modal-title">Delete Workspace</div>
      <button class="close-button" aria-label="Close dialog" @click="close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>

    <!-- Body -->
    <div class="modal-body">
      <p class="text-sm text-text-primary">
        Are you sure you want to delete the workspace
        <span class="font-bold">{{ workspace?.name }}</span
        >?
        <br />
        <span class="text-text-muted">This action cannot be undone.</span>
      </p>
    </div>

    <!-- Footer -->
    <div class="modal-footer flex items-center justify-between gap-2">
      <button class="button is-transparent" @click="close">Cancel</button>

      <button class="button is-destructive" @click="submit">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        Delete Workspace
      </button>
    </div>
  </BaseModal>
</template>

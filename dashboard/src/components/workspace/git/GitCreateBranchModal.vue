<script setup lang="ts">
// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// types
import type { GitRepoStatus } from '@/@types/index';

defineProps<{
  bOpen: boolean;
  activeRepo: GitRepoStatus | null;
  bCreatingBranch: boolean;
  canCreateBranch: boolean;
  gitOperationInProgress: boolean;
}>();

const newBranchName = defineModel<string>('newBranchName', { required: true });

const emit = defineEmits<{
  'close': [];
  'create': [];
}>();
</script>

<template>
  <BaseModal
    :model-value="bOpen && !!activeRepo"
    labelledby="create-branch-title"
    panel-class="max-w-sm"
    @update:model-value="emit('close')"
  >
    <template v-if="activeRepo">
    <form class="contents"
          @submit.prevent="emit('create')"
        >
          <ModalHeader
            eyebrow="// create branch"
            title="Create branch"
            title-id="create-branch-title"
            @close="emit('close')"
          />
          <p class="px-6 pt-1 text-xs text-text-muted">From <span class="font-mono">{{ activeRepo?.currentBranch }}</span></p>
          <div class="px-5 pb-5">
            <label class="text-xs font-medium text-text-muted">Branch name</label>
            <input
              v-model="newBranchName"
              class="mt-1.5 w-full rounded-lg border border-fg/[0.12] bg-fg/[0.04] px-3 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none"
              placeholder="feature/my-branch"
              autocomplete="off"
              autofocus
              :disabled="gitOperationInProgress"
              @keydown.escape="emit('close')"
            />
          </div>
          <div class="flex justify-end gap-2 border-t border-fg/[0.08] px-5 py-4">
            <button
              class="rounded-lg px-3 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
              type="button"
              :disabled="gitOperationInProgress"
              @click="emit('close')"
            >
              Cancel
            </button>
            <button
              class="rounded-lg bg-primary px-4 py-2 text-sm text-on-accent transition-colors hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
              type="submit"
              :disabled="!canCreateBranch"
            >
              <span v-if="!bCreatingBranch">Create and switch</span>
              <span v-else>Creating...</span>
            </button>
          </div>
        </form>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
// node_modules
import {
  CloudDownload,
  GitBranch as GitBranchIcon,
  Plus,
  RefreshCw
} from 'lucide-vue-next';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// types
import type { GitRepoStatus } from '@/@types/index';

defineProps<{
  bOpen: boolean;
  activeRepo: GitRepoStatus | null;
  bFetching: boolean;
  bPulling: boolean;
  canFetchActiveRepo: boolean;
  canPullActiveRepo: boolean;
  gitOperationInProgress: boolean;
}>();

const emit = defineEmits<{
  'close': [];
  'fetch': [];
  'pull': [];
  'switch-branch': [];
  'create-branch': [];
}>();
</script>

<template>
  <BaseModal
    :model-value="bOpen && !!activeRepo"
    labelledby="git-actions-title"
    panel-class="max-w-sm"
    @update:model-value="emit('close')"
  >
    <template v-if="activeRepo">
          <ModalHeader
            eyebrow="// git actions"
            title="Git actions"
            title-id="git-actions-title"
            @close="emit('close')"
          />
          <p class="px-6 pt-1 truncate font-mono text-xs text-text-muted">{{ activeRepo?.currentBranch }}</p>
          <div class="px-3 pb-3">
            <button
              class="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-text-primary hover:bg-fg/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
              :disabled="!canFetchActiveRepo"
              @click="emit('fetch')"
            >
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-fg/[0.05] text-text-muted">
                <div
                  v-if="bFetching"
                  class="w-3.5 h-3.5 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
                ></div>
                <RefreshCw v-else :size="16" :stroke-width="1.7" class="select-none" aria-hidden="true" />
              </span>
              <span class="min-w-0">
                <span class="block font-medium">Fetch</span>
                <span class="block text-xs text-text-muted">Update remote branch info without merging</span>
              </span>
            </button>
            <button
              class="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-text-primary hover:bg-fg/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
              :disabled="!canPullActiveRepo"
              @click="emit('pull')"
            >
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-fg/[0.05] text-text-muted">
                <div
                  v-if="bPulling"
                  class="w-3.5 h-3.5 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
                ></div>
                <CloudDownload v-else :size="16" :stroke-width="1.7" class="select-none" aria-hidden="true" />
              </span>
              <span class="min-w-0">
                <span class="block font-medium">Pull</span>
                <span class="block text-xs text-text-muted">
                  <template v-if="activeRepo?.upstreamBranch">Fast-forward from upstream</template>
                  <template v-else>No upstream configured</template>
                </span>
              </span>
            </button>
            <button
              class="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-text-primary hover:bg-fg/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
              :disabled="gitOperationInProgress"
              @click="emit('switch-branch')"
            >
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-fg/[0.05] text-text-muted">
                <GitBranchIcon :size="16" :stroke-width="1.7" class="select-none" aria-hidden="true" />
              </span>
              <span>
                <span class="block font-medium">Switch branch</span>
                <span class="block text-xs text-text-muted">Search and checkout another local branch</span>
              </span>
            </button>
            <button
              class="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-text-primary hover:bg-fg/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
              :disabled="gitOperationInProgress"
              @click="emit('create-branch')"
            >
              <span class="flex h-8 w-8 items-center justify-center rounded-lg bg-fg/[0.05] text-text-muted">
                <Plus :size="16" :stroke-width="1.7" class="select-none" aria-hidden="true" />
              </span>
              <span>
                <span class="block font-medium">Create branch</span>
                <span class="block text-xs text-text-muted">Create from the current HEAD and switch to it</span>
              </span>
            </button>
          </div>
    </template>
  </BaseModal>
</template>

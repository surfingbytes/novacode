<script setup lang="ts">
// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// types
import type { GitRepoStatus } from '@/@types/index';
import type { BranchOption } from './gitBranchOptions';

defineProps<{
  bOpen: boolean;
  activeRepo: GitRepoStatus | null;
  bBranchesLoading: boolean;
  filteredBranches: BranchOption[];
  bSwitchingBranch: boolean;
  selectedBranch: string;
  gitOperationInProgress: boolean;
}>();

const branchSearch = defineModel<string>('branchSearch', { required: true });

const emit = defineEmits<{
  'close': [];
  'switch': [branch: BranchOption];
}>();
</script>

<template>
  <BaseModal
    :model-value="bOpen && !!activeRepo"
    labelledby="switch-branch-title"
    panel-class="max-w-md"
    @update:model-value="emit('close')"
  >
    <template v-if="activeRepo">
          <ModalHeader
            eyebrow="// switch branch"
            title="Switch branch"
            title-id="switch-branch-title"
            @close="emit('close')"
          />
          <p class="px-6 pt-1 text-xs text-text-muted">Current: <span class="font-mono">{{ activeRepo?.currentBranch }}</span></p>
          <div class="px-5 pb-3">
            <input
              v-model="branchSearch"
              class="w-full rounded-lg border border-fg/[0.12] bg-fg/[0.04] px-3 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none"
              placeholder="Search branches..."
              autocomplete="off"
              autofocus
              @keydown.escape="emit('close')"
            />
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            <div v-if="bBranchesLoading" class="px-3 py-4 text-sm text-text-muted">
              Loading branches...
            </div>
            <div v-else-if="!filteredBranches.length" class="px-3 py-4 text-sm text-text-muted">
              No branches found.
            </div>
            <button
              v-for="branch in filteredBranches"
              :key="branch.key"
              class="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-fg/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
              :disabled="branch.current || gitOperationInProgress"
              @click="emit('switch', branch)"
            >
              <span class="min-w-0">
                <span class="block truncate font-mono text-sm text-text-primary">{{ branch.name }}</span>
                <span v-if="branch.upstream" class="block truncate text-xs text-text-muted">{{ branch.upstream }}</span>
              </span>
              <span
                v-if="branch.current"
                class="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-primary"
              >
                Current
              </span>
              <div
                v-else-if="bSwitchingBranch && selectedBranch === branch.key"
                class="w-4 h-4 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
              ></div>
              <span
                v-else-if="branch.remote"
                class="rounded-full bg-fg/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-muted"
              >
                Remote
              </span>
            </button>
          </div>
    </template>
  </BaseModal>
</template>

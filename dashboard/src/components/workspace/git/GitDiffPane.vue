<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next';

import type { GitCommit, GitFile } from '@/classes/api';
import { gitDiffRowClass as diffRowClass, gitStatusBadgeClass as statusBadgeClass } from './gitDisplay';

defineProps<{
  bShowDetail: boolean;
  bWidePane: boolean;
  bSidePanelOpen: boolean;
  bSidePanelToggleVisible: boolean;
  selectedCommit: GitCommit | null;
  selectedFile: GitFile | null;
  bCommitPatchLoading: boolean;
  commitPatchError: string | null;
  commitPatchLines: string[];
  bDiffLoading: boolean;
  diffError: string | null;
  diffContent: string;
  diffLines: string[];
  bDiscarding: boolean;
  setSidePanelOpen: (open: boolean) => void;
  clearSelectedFile: () => void;
  discardFiles: (paths: string[], repo: string) => void;
}>();
</script>

<template>
    <div
      v-show="bShowDetail"
      class="flex flex-col min-h-0 min-w-0 overflow-hidden"
      :class="bWidePane ? 'flex-1' : 'w-full flex-1'"
    >
      <div
        class="flex items-center gap-2 px-3 py-2 border-b border-fg/[0.08] flex-shrink-0 min-w-0"
      >
        <button
          v-if="bSidePanelToggleVisible && !bSidePanelOpen"
          type="button"
          class="flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-muted hover:text-text-primary hover:bg-fg/[0.06] transition-colors"
          title="Show file list"
          aria-label="Show file list"
          @click="setSidePanelOpen(true)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M11 9l3 3-3 3"/></svg>
        </button>
        <button
          v-if="!bWidePane && (selectedFile || selectedCommit)"
          class="flex-shrink-0 text-xs text-primary hover:text-primary-hover transition-colors"
          @click="clearSelectedFile"
        >
          <ArrowLeft :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
          Back
        </button>
        <template v-if="selectedCommit">
          <span class="text-[10px] font-mono text-text-muted shrink-0">{{ selectedCommit.shortHash }}</span>
          <span class="text-xs text-text-primary truncate">{{ selectedCommit.subject }}</span>
        </template>
        <template v-else-if="selectedFile">
          <span
            class="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded font-mono"
            :class="statusBadgeClass(selectedFile.status)"
            >{{ selectedFile.status || '?' }}</span
          >
          <span class="text-xs text-text-muted font-mono truncate">{{ selectedFile.file }}</span>
          <button
            class="ml-auto flex-shrink-0 text-xs text-destructive hover:text-destructive/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            :disabled="bDiscarding"
            @click="discardFiles([selectedFile.file], selectedFile.repo)"
          >
            Discard
          </button>
        </template>
        <span v-else class="text-xs text-text-muted truncate">Select a file or commit</span>
      </div>

      <div
        v-if="selectedCommit"
        class="flex-1 min-h-0 flex flex-col"
      >
        <div
          v-if="bCommitPatchLoading"
          class="flex-1 overflow-auto px-3 py-2 space-y-1"
        >
          <div class="h-3 rounded bg-fg/10 animate-pulse w-full max-w-[280px]" />
          <div class="h-3 rounded bg-fg/10 animate-pulse w-full" />
          <div class="h-3 rounded bg-fg/10 animate-pulse w-4/5" />
        </div>
        <div
          v-else-if="commitPatchError"
          class="flex flex-col items-center justify-center flex-1 gap-2 px-6 text-center"
        >
          <p class="text-text-muted text-sm">{{ commitPatchError }}</p>
        </div>
        <div v-else class="flex-1 overflow-auto">
          <div
            v-for="(line, i) in commitPatchLines"
            :key="'commit-' + i"
            class="px-3 py-0 leading-5 whitespace-pre-wrap break-all text-xs font-mono"
            :class="diffRowClass(line)"
          >
            {{ line }}
          </div>
        </div>
      </div>

      <div
        v-else-if="!selectedFile"
        class="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center"
      >
        <p class="text-text-muted text-sm">Select a changed file</p>
        <p class="text-text-muted/50 text-xs">Diff preview appears here</p>
      </div>

      <!-- Diff skeleton -->
      <div v-else-if="bDiffLoading" class="flex-1 overflow-auto px-3 py-2 space-y-1">
        <div class="h-3 rounded bg-fg/10 animate-pulse w-full max-w-[280px]" />
        <div class="h-3 rounded bg-fg/10 animate-pulse w-full max-w-[180px]" />
        <div class="h-3 rounded bg-fg/10 animate-pulse w-full" />
        <div class="h-3 rounded bg-fg/10 animate-pulse w-4/5" />
        <div class="h-3 rounded bg-fg/10 animate-pulse w-full" />
        <div class="h-3 rounded bg-fg/10 animate-pulse w-3/4" />
        <div class="h-3 rounded bg-fg/10 animate-pulse w-full" />
        <div class="h-3 rounded bg-fg/10 animate-pulse w-5/6" />
      </div>

      <div
        v-else-if="diffError"
        class="flex flex-col items-center justify-center flex-1 gap-2 px-6 text-center"
      >
        <p class="text-text-muted text-sm">{{ diffError }}</p>
      </div>

      <div v-else-if="!diffContent.trim()" class="flex items-center justify-center flex-1">
        <p class="text-text-muted text-sm">No diff available</p>
      </div>

      <div v-else class="flex-1 overflow-auto">
        <div
          v-for="(line, i) in diffLines"
          :key="i"
          class="px-3 py-0 leading-5 whitespace-pre-wrap break-all text-xs font-mono"
          :class="diffRowClass(line)"
        >
          {{ line || '\u00a0' }}
        </div>
      </div>
    </div>
</template>

<style scoped>
.diff-row--added {
  background: color-mix(in oklab, var(--success) 14%, transparent);
  color: var(--success);
  box-shadow: inset 2px 0 0 color-mix(in oklab, var(--success) 55%, transparent);
}

.diff-row--removed {
  background: color-mix(in oklab, var(--danger) 14%, transparent);
  color: var(--danger);
  box-shadow: inset 2px 0 0 color-mix(in oklab, var(--danger) 55%, transparent);
}

.diff-row--hunk {
  background: var(--accent-soft);
  color: var(--fg-muted);
}

.diff-row--meta {
  color: var(--fg-subtle);
}

:global(html[data-theme='light']) .diff-row--added {
  color: color-mix(in oklab, var(--success), #000 25%);
}

:global(html[data-theme='light']) .diff-row--removed {
  color: color-mix(in oklab, var(--danger), #000 20%);
}
</style>

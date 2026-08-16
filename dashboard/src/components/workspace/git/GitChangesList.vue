<script setup lang="ts">
import {
  Check,
  ChevronRight,
  CloudUpload,
  GitBranch as GitBranchIcon,
  History,
  Minus,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Trash2
} from 'lucide-vue-next';

import type { GitCommit, GitFile, GitRepoStatus } from '@/classes/api';
import {
  gitFileKey as fileKey,
  gitFormatCommitDate as formatCommitDate,
  gitStatusBadgeClass as statusBadgeClass
} from './gitDisplay';

type GitActionBanner = { type: 'success' | 'error'; text: string; repo?: string } | null;

const selectedGitRepo = defineModel<string>('selectedGitRepo', { required: true });
const commitMessage = defineModel<string>('commitMessage', { required: true });

defineProps<{
  bShowList: boolean;
  bWidePane: boolean;
  bSidePanelToggleVisible: boolean;
  repos: GitRepoStatus[];
  activeRepo: GitRepoStatus | null;
  files: GitFile[];
  filesInSelectedRepo: GitFile[];
  selectedFiles: Set<string>;
  selectedFile: GitFile | null;
  selectedCommit: GitCommit | null;
  bIsLoading: boolean;
  bHasLoadedStatus: boolean;
  error: string | null;
  listPane: 'changes' | 'history';
  bHistoryLoading: boolean;
  commits: GitCommit[];
  committingRepo: string | null;
  pushingRepo: string | null;
  bGeneratingCommitMessage: boolean;
  bDiscarding: boolean;
  commitResult: GitActionBanner;
  pushResult: GitActionBanner;
  gitActionResult: GitActionBanner;
  canCommit: boolean;
  canCommitActiveRepo: boolean;
  canDiscardSelected: boolean;
  canPushActiveRepo: boolean;
  canPushSingleRepo: boolean;
  allSelected: boolean;
  someSelected: boolean;
  hasMixedSelection: boolean;
  selectedFilesInActiveRepo: string[];
  commitMessagesByRepo: Record<string, string>;
  openSwitchBranchDialog: () => void;
  openGitActions: (e: MouseEvent) => void;
  setSidePanelOpen: (open: boolean) => void;
  setListPane: (pane: 'changes' | 'history') => void;
  refresh: () => void;
  loadHistory: () => void;
  openFile: (file: GitFile) => void;
  openCommit: (commit: GitCommit) => void;
  toggleFile: (file: GitFile) => void;
  toggleAll: () => void;
  discardFiles: (paths: string[], repo: string) => void;
  commitChanges: (repo: string) => void;
  pushChanges: (repo: string) => void;
  generateCommitMessage: (repo: string) => void;
  canGenerateCommitMessage: (repo: string) => boolean;
  selectedCountInRepo: (repo: string) => number;
}>();

const emit = defineEmits<{
  'update:commitMessageForRepo': [repo: string, value: string];
}>();

function onRepoCommitMessageInput(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value;
  emit('update:commitMessageForRepo', selectedGitRepo.value, value);
}
</script>

<template>
    <div
      v-show="bShowList"
      class="flex flex-col min-h-0 overflow-hidden shrink-0"
      :class="bWidePane ? 'w-[min(22rem,40%)] border-r border-fg/[0.08]' : 'w-full'"
    >
      <div
        class="flex flex-col gap-2 px-3 py-2 border-b border-fg/[0.08] flex-shrink-0"
      >
        <div v-if="repos.length > 1" class="flex flex-col gap-1">
          <label class="text-xs font-medium text-text-muted" for="git-repo-select">Repository</label>
          <select
            id="git-repo-select"
            v-model="selectedGitRepo"
            class="w-full min-w-0 bg-card border border-fg/[0.08] rounded-lg px-3 py-2 text-sm text-text-primary font-mono outline-none focus:border-primary/50"
          >
            <option v-for="r in repos" :key="r.repo || '.'" :value="r.repo">
              {{ r.repo || '.' }}{{ r.files.length ? ` · ${r.files.length} changed` : ''
              }}{{ r.aheadCount > 0 ? ` · ↑${r.aheadCount}` : '' }}
            </option>
          </select>
        </div>
        <div
          v-if="activeRepo"
          class="rounded-xl border border-fg/[0.08] bg-card/60 p-2"
        >
          <div class="flex items-center justify-between gap-2">
            <button
              class="min-w-0 flex-1 flex items-center gap-2 text-left rounded-lg px-2 py-1.5 hover:bg-fg/[0.04] transition-colors"
              type="button"
              @click="openSwitchBranchDialog"
            >
              <GitBranchIcon :size="14" :stroke-width="1.6" class="select-none flex-shrink-0 text-text-muted" aria-hidden="true" />
              <span class="min-w-0 flex-1">
                <span class="block truncate font-mono text-sm text-text-primary">
                  {{ activeRepo.currentBranch }}
                </span>
                <span class="block truncate text-[11px] text-text-muted">
                  <template v-if="activeRepo.upstreamBranch">{{ activeRepo.upstreamBranch }}</template>
                  <template v-else>No upstream</template>
                </span>
              </span>
            </button>
            <div class="flex items-center gap-1.5 flex-shrink-0">
              <span
                v-if="activeRepo.detached"
                class="hidden sm:inline rounded-full bg-text-muted/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-text-muted"
              >
                Detached
              </span>
              <span v-if="activeRepo.aheadCount > 0" class="text-xs text-text-muted">↑{{ activeRepo.aheadCount }}</span>
              <span v-if="activeRepo.behindCount > 0" class="text-xs text-text-muted">↓{{ activeRepo.behindCount }}</span>
              <button
                class="h-8 px-2.5 rounded-lg border border-fg/10 text-text-muted hover:text-text-primary hover:bg-fg/[0.04] transition-colors"
                type="button"
                title="Git actions"
                @click="openGitActions"
              >
                <MoreHorizontal :size="16" :stroke-width="1.8" class="select-none" aria-hidden="true" />
              </button>
            </div>
          </div>

          <p
            v-if="
              gitActionResult &&
              (gitActionResult.repo === undefined || gitActionResult.repo === selectedGitRepo)
            "
            class="text-xs"
            :class="gitActionResult.type === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ gitActionResult.text }}
          </p>
        </div>
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <div
              class="inline-flex shrink-0 items-center rounded-md border border-border bg-input p-0.5 gap-0.5 h-7"
              role="group"
              aria-label="Git list"
            >
              <button
                type="button"
                class="h-6 px-2.5 rounded text-[11px] font-medium transition-colors"
                :class="
                  listPane === 'changes'
                    ? 'bg-surface text-primary'
                    : 'text-text-muted hover:text-text-primary'
                "
                :aria-pressed="listPane === 'changes'"
                @click="setListPane('changes')"
              >
                Changes
              </button>
              <button
                type="button"
                class="h-6 px-2.5 rounded text-[11px] font-medium transition-colors"
                :class="
                  listPane === 'history'
                    ? 'bg-surface text-primary'
                    : 'text-text-muted hover:text-text-primary'
                "
                :aria-pressed="listPane === 'history'"
                @click="setListPane('history')"
              >
                History
              </button>
            </div>
          </div>
          <div class="flex items-center gap-1 flex-shrink-0">
            <button
              class="text-text-muted hover:text-text-primary transition-colors px-1"
              :class="{ 'animate-spin': listPane === 'changes' ? bIsLoading : bHistoryLoading }"
              title="Refresh"
              @click="listPane === 'history' ? loadHistory() : refresh()"
            >
              <RefreshCw :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
            </button>
            <button
              v-if="bSidePanelToggleVisible"
              type="button"
              class="inline-flex items-center justify-center w-9 h-9 rounded-lg text-text-muted hover:text-text-primary hover:bg-fg/[0.06] transition-colors"
              title="Hide file list"
              aria-label="Hide file list"
              @click="setSidePanelOpen(false)"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M14 9l-3 3 3 3"/></svg>
            </button>
          </div>
        </div>
        <div v-if="listPane === 'changes'" class="flex items-center gap-2 min-w-0">
          <button
            v-if="filesInSelectedRepo.length"
            class="flex items-center justify-center w-4 h-4 rounded border transition-colors flex-shrink-0"
            :class="
              allSelected
                ? 'bg-primary border-primary'
                : someSelected
                  ? 'bg-primary/40 border-primary'
                  : 'border-fg/20 hover:border-fg/40'
            "
            title="Select all / none"
            @click.stop="toggleAll"
          >
            <Check v-if="allSelected" :size="10" :stroke-width="1.6" class="select-none text-white" aria-hidden="true" />
            <Minus v-else-if="someSelected" :size="10" :stroke-width="1.6" class="select-none text-white" aria-hidden="true" />
          </button>
          <span class="text-xs font-medium text-text-muted truncate">
            Changed files
            <span
              v-if="repos.length > 1 ? filesInSelectedRepo.length : files.length"
              class="ml-1 text-text-muted/60"
              >({{ repos.length > 1 ? filesInSelectedRepo.length : files.length }})</span
            >
          </span>
        </div>
        <div v-else class="text-xs font-medium text-text-muted truncate">Recent commits</div>
      </div>

      <div
        v-if="error"
        class="flex flex-col items-center justify-center flex-1 gap-3 px-6 text-center"
      >
        <p class="text-text-muted text-sm">{{ error }}</p>
        <button
          class="text-xs text-primary hover:text-primary-hover transition-colors"
          @click="refresh"
        >
          Try again
        </button>
      </div>

      <!-- Git file list skeleton -->
      <div v-else-if="listPane === 'changes' && bIsLoading && !bHasLoadedStatus" class="flex-1 overflow-hidden flex flex-col">
        <div
          v-for="i in 5"
          :key="'git-skel-' + i"
          class="w-full flex items-center gap-2.5 px-3 py-2 border-b border-fg/[0.03]"
        >
          <div class="w-4 h-4 rounded border border-fg/10 bg-fg/5 animate-pulse flex-shrink-0" />
          <div class="h-3 w-8 rounded bg-fg/10 animate-pulse flex-shrink-0" />
          <div class="h-3 rounded bg-fg/10 animate-pulse flex-1 min-w-0 max-w-[220px]" />
        </div>
      </div>

      <div
        v-else-if="listPane === 'changes' && !files.length && repos.length === 1"
        class="flex flex-col items-center justify-center flex-1 gap-1"
      >
        <p class="text-text-muted text-sm">No changes</p>
        <p class="text-text-muted/50 text-xs">Working tree clean</p>
      </div>

      <div
        v-else-if="listPane === 'changes' && !files.length && repos.length > 1"
        class="flex flex-col items-center justify-center flex-1 gap-1 px-6 text-center"
      >
        <p class="text-text-muted text-sm">No changes</p>
        <p class="text-text-muted/50 text-xs">Working tree clean in all repositories</p>
      </div>

      <div
        v-else-if="listPane === 'changes' && repos.length > 1 && files.length && !filesInSelectedRepo.length"
        class="flex flex-col items-center justify-center flex-1 gap-1 px-6 text-center"
      >
        <p class="text-text-muted text-sm">No changes in this repository</p>
        <p class="text-text-muted/50 text-xs">Switch repository above to see other files</p>
      </div>

      <div v-else-if="listPane === 'history'" class="flex-1 overflow-y-auto min-h-0">
        <div
          v-if="bHistoryLoading && commits.length === 0"
          class="px-3 py-2 text-xs text-text-muted"
        >
          Loading history…
        </div>
        <div
          v-else-if="commits.length === 0"
          class="flex flex-col items-center justify-center h-full gap-1 px-6 text-center"
        >
          <History :size="20" :stroke-width="1.5" class="opacity-40" aria-hidden="true" />
          <p class="text-text-muted text-sm">No commits yet</p>
        </div>
        <button
          v-for="commit in commits"
          :key="commit.hash"
          type="button"
          class="w-full text-left px-3 py-2 border-b border-fg/[0.03] hover:bg-fg/[0.04] transition-colors"
          :class="selectedCommit?.hash === commit.hash ? 'bg-primary/15' : ''"
          @click="openCommit(commit)"
        >
          <p class="text-xs text-text-primary truncate">{{ commit.subject }}</p>
          <p class="text-[11px] text-text-muted mt-0.5 truncate font-mono">
            {{ commit.shortHash }} · {{ commit.author }} · {{ formatCommitDate(commit.date) }}
          </p>
        </button>
      </div>

      <div v-else class="flex-1 overflow-y-auto min-h-0">
        <div
          v-for="f in filesInSelectedRepo"
          :key="fileKey(f)"
          class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-fg/[0.04] transition-colors text-left border-b border-fg/[0.03]"
          :class="
            selectedFile && fileKey(selectedFile) === fileKey(f) ? 'bg-primary/15' : ''
          "
        >
          <button
            class="flex items-center justify-center w-4 h-4 rounded border transition-colors flex-shrink-0"
            :class="
              selectedFiles.has(fileKey(f))
                ? 'bg-primary border-primary'
                : 'border-fg/20 hover:border-fg/40'
            "
            @click.stop="toggleFile(f)"
          >
            <Check v-if="selectedFiles.has(fileKey(f))" :size="10" :stroke-width="1.6" class="select-none text-white" aria-hidden="true" />
          </button>
          <button class="flex items-center gap-2.5 flex-1 min-w-0" @click="openFile(f)">
            <span
              class="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded font-mono tracking-wide"
              :class="statusBadgeClass(f.status)"
              >{{ f.status || '?' }}</span
            >
            <span
              class="text-xs truncate font-mono flex-1 text-left"
              :class="
                selectedFile && fileKey(selectedFile) === fileKey(f)
                  ? 'text-primary'
                  : 'text-text-primary'
              "
              >{{ f.file }}</span
            >
            <ChevronRight
              v-if="!bWidePane"
              :size="14"
              :stroke-width="1.6"
              class="select-none flex-shrink-0 text-text-muted/50"
              aria-hidden="true"
            />
          </button>
          <button
            class="flex-shrink-0 text-text-muted hover:text-destructive transition-colors p-1 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Discard changes"
            :disabled="bDiscarding"
            @click.stop="discardFiles([f.file], f.repo)"
          >
            <Trash2 :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
          </button>
        </div>
      </div>

      <!-- Commit & Push actions -->
      <div
        v-if="!error && repos.length && listPane === 'changes'"
        class="flex-shrink-0 border-t border-fg/[0.08] px-3 py-3 flex flex-col gap-2"
      >
        <!-- Single Git root: one bar -->
        <template v-if="repos.length === 1">
          <template v-if="files.length">
            <div class="flex items-stretch gap-2">
              <textarea
                v-model="commitMessage"
                rows="2"
                class="min-w-0 flex-1 bg-card border border-fg/[0.08] focus:border-primary/50 focus:ring-2 focus:ring-primary/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-all resize-none"
                placeholder="Commit message..."
                :disabled="committingRepo !== null || bGeneratingCommitMessage"
              />
              <button
                class="flex-shrink-0 w-10 rounded-lg transition-all flex items-center justify-center"
                :class="
                  bGeneratingCommitMessage
                    ? 'text-primary'
                    : 'text-text-muted hover:text-primary hover:bg-fg/[0.06] disabled:opacity-40 disabled:cursor-not-allowed'
                "
                type="button"
                title="Generate commit message"
                aria-label="Generate commit message"
                :aria-busy="bGeneratingCommitMessage"
                :disabled="!canGenerateCommitMessage(repos[0].repo)"
                @click="generateCommitMessage(repos[0].repo)"
              >
                <div
                  v-if="bGeneratingCommitMessage"
                  class="w-4 h-4 border-2 border-primary/35 border-t-primary rounded-full animate-spin"
                  aria-hidden="true"
                ></div>
                <Sparkles v-else :size="17" :stroke-width="1.7" class="select-none" aria-hidden="true" />
              </button>
            </div>
          </template>
          <!-- Wide split: Commit full-width, Push/Discard share a row. Laptop: one even row. -->
          <div v-if="bWidePane" class="flex flex-col gap-2">
            <button
              v-if="files.length"
              class="h-9 w-full text-sm px-3 btn-primary-solid rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              :disabled="!canCommit"
              @click="commitChanges(repos[0].repo)"
            >
              <div
                v-if="committingRepo === repos[0].repo"
                class="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin"
              ></div>
              <Check v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
              Commit ({{ selectedFiles.size }})
            </button>
            <div class="flex gap-2 w-full min-w-0">
              <button
                class="h-9 flex-1 text-sm px-3 text-text-primary border border-fg/10 hover:border-primary/30 hover:bg-primary/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 min-w-0"
                :disabled="!canPushSingleRepo"
                @click="pushChanges(repos[0].repo)"
              >
                <div
                  v-if="pushingRepo === repos[0].repo"
                  class="w-3 h-3 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
                ></div>
                <CloudUpload v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
                Push<template v-if="repos[0].aheadCount > 0"> ({{ repos[0].aheadCount }})</template>
              </button>
              <button
                v-if="files.length"
                class="h-9 flex-1 text-sm px-3 text-destructive border border-destructive/20 hover:border-destructive/40 hover:bg-destructive/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 min-w-0"
                :disabled="!canDiscardSelected"
                @click="discardFiles(selectedFilesInActiveRepo, repos[0].repo)"
              >
                <div
                  v-if="bDiscarding"
                  class="w-3 h-3 border border-destructive/30 border-t-destructive rounded-full animate-spin"
                ></div>
                <Trash2 v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
                Discard ({{ selectedFilesInActiveRepo.length }})
              </button>
            </div>
          </div>
          <div v-else class="flex flex-wrap gap-2">
            <button
              v-if="files.length"
              class="h-9 text-sm px-3 btn-primary-solid rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              :disabled="!canCommit"
              @click="commitChanges(repos[0].repo)"
            >
              <div
                v-if="committingRepo === repos[0].repo"
                class="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin"
              ></div>
              <Check v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
              Commit ({{ selectedFiles.size }})
            </button>
            <button
              class="h-9 text-sm px-3 text-text-primary border border-fg/10 hover:border-primary/30 hover:bg-primary/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              :disabled="!canPushSingleRepo"
              @click="pushChanges(repos[0].repo)"
            >
              <div
                v-if="pushingRepo === repos[0].repo"
                class="w-3 h-3 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
              ></div>
              <CloudUpload v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
              Push<template v-if="repos[0].aheadCount > 0"> ({{ repos[0].aheadCount }})</template>
            </button>
            <button
              v-if="files.length"
              class="h-9 text-sm px-3 text-destructive border border-destructive/20 hover:border-destructive/40 hover:bg-destructive/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              :disabled="!canDiscardSelected"
              @click="discardFiles(selectedFilesInActiveRepo, repos[0].repo)"
            >
              <div
                v-if="bDiscarding"
                class="w-3 h-3 border border-destructive/30 border-t-destructive rounded-full animate-spin"
              ></div>
              <Trash2 v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
              Discard ({{ selectedFilesInActiveRepo.length }})
            </button>
          </div>
          <p
            v-if="commitResult"
            class="text-xs"
            :class="commitResult.type === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ commitResult.text }}
          </p>
          <p
            v-if="pushResult"
            class="text-xs"
            :class="pushResult.type === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ pushResult.text }}
          </p>
          <p v-if="hasMixedSelection" class="text-xs text-text-muted">
            Select files from a single repository for commit/push.
          </p>
        </template>

        <!-- Multiple Git roots: one message + actions for the repository selected above -->
        <template v-else-if="activeRepo">
          <template v-if="activeRepo.files.length">
            <div class="flex items-stretch gap-2">
              <textarea
                :value="commitMessagesByRepo[selectedGitRepo] ?? ''"
                @input="onRepoCommitMessageInput"
                rows="2"
                class="min-w-0 flex-1 bg-card border border-fg/[0.08] focus:border-primary/50 focus:ring-2 focus:ring-primary/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-all resize-none"
                placeholder="Commit message..."
                :disabled="committingRepo !== null || bGeneratingCommitMessage"
              />
              <button
                class="flex-shrink-0 w-10 rounded-lg transition-all flex items-center justify-center"
                :class="
                  bGeneratingCommitMessage
                    ? 'text-primary'
                    : 'text-text-muted hover:text-primary hover:bg-fg/[0.06] disabled:opacity-40 disabled:cursor-not-allowed'
                "
                type="button"
                title="Generate commit message"
                aria-label="Generate commit message"
                :aria-busy="bGeneratingCommitMessage"
                :disabled="!canGenerateCommitMessage(activeRepo.repo)"
                @click="generateCommitMessage(activeRepo.repo)"
              >
                <div
                  v-if="bGeneratingCommitMessage"
                  class="w-4 h-4 border-2 border-primary/35 border-t-primary rounded-full animate-spin"
                  aria-hidden="true"
                ></div>
                <Sparkles v-else :size="17" :stroke-width="1.7" class="select-none" aria-hidden="true" />
              </button>
            </div>
          </template>
          <div v-if="bWidePane" class="flex flex-col gap-2">
            <button
              v-if="activeRepo.files.length"
              class="h-9 w-full text-sm px-3 btn-primary-solid rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              :disabled="!canCommitActiveRepo"
              @click="commitChanges(activeRepo.repo)"
            >
              <div
                v-if="committingRepo === activeRepo.repo"
                class="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin"
              ></div>
              <Check v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
              Commit ({{ selectedCountInRepo(activeRepo.repo) }})
            </button>
            <div class="flex gap-2 w-full min-w-0">
              <button
                class="h-9 flex-1 text-sm px-3 text-text-primary border border-fg/10 hover:border-primary/30 hover:bg-primary/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 min-w-0"
                :disabled="!canPushActiveRepo"
                @click="pushChanges(activeRepo.repo)"
              >
                <div
                  v-if="pushingRepo === activeRepo.repo"
                  class="w-3 h-3 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
                ></div>
                <CloudUpload v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
                Push<template v-if="activeRepo.aheadCount > 0"> ({{ activeRepo.aheadCount }})</template>
              </button>
              <button
                v-if="activeRepo.files.length"
                class="h-9 flex-1 text-sm px-3 text-destructive border border-destructive/20 hover:border-destructive/40 hover:bg-destructive/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 min-w-0"
                :disabled="!canDiscardSelected"
                @click="discardFiles(selectedFilesInActiveRepo, activeRepo.repo)"
              >
                <div
                  v-if="bDiscarding"
                  class="w-3 h-3 border border-destructive/30 border-t-destructive rounded-full animate-spin"
                ></div>
                <Trash2 v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
                Discard ({{ selectedFilesInActiveRepo.length }})
              </button>
            </div>
          </div>
          <div v-else class="flex flex-wrap gap-2">
            <button
              v-if="activeRepo.files.length"
              class="h-9 text-sm px-3 btn-primary-solid rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              :disabled="!canCommitActiveRepo"
              @click="commitChanges(activeRepo.repo)"
            >
              <div
                v-if="committingRepo === activeRepo.repo"
                class="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin"
              ></div>
              <Check v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
              Commit ({{ selectedCountInRepo(activeRepo.repo) }})
            </button>
            <button
              class="h-9 text-sm px-3 text-text-primary border border-fg/10 hover:border-primary/30 hover:bg-primary/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              :disabled="!canPushActiveRepo"
              @click="pushChanges(activeRepo.repo)"
            >
              <div
                v-if="pushingRepo === activeRepo.repo"
                class="w-3 h-3 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
              ></div>
              <CloudUpload v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
              Push<template v-if="activeRepo.aheadCount > 0"> ({{ activeRepo.aheadCount }})</template>
            </button>
            <button
              v-if="activeRepo.files.length"
              class="h-9 text-sm px-3 text-destructive border border-destructive/20 hover:border-destructive/40 hover:bg-destructive/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              :disabled="!canDiscardSelected"
              @click="discardFiles(selectedFilesInActiveRepo, activeRepo.repo)"
            >
              <div
                v-if="bDiscarding"
                class="w-3 h-3 border border-destructive/30 border-t-destructive rounded-full animate-spin"
              ></div>
              <Trash2 v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
              Discard ({{ selectedFilesInActiveRepo.length }})
            </button>
          </div>
          <p
            v-if="
              commitResult &&
              (!commitResult.repo || commitResult.repo === selectedGitRepo)
            "
            class="text-xs"
            :class="commitResult.type === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ commitResult.text }}
          </p>
          <p
            v-if="pushResult && (!pushResult.repo || pushResult.repo === selectedGitRepo)"
            class="text-xs"
            :class="pushResult.type === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ pushResult.text }}
          </p>
        </template>
      </div>
    </div>
</template>

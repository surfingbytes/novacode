<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

// classes
import { gitApi, type GitFile, type GitRepoStatus } from '@/classes/api';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';

// -------------------------------------------------- Props --------------------------------------------------
const props = withDefaults(
  defineProps<{
    workspaceId: string;
    active: boolean;
    initialFilePath?: string | null;
  }>(),
  { initialFilePath: null }
);

const emit = defineEmits<{
  'update:selectedFilePath': [path: string | null];
}>();

// -------------------------------------------------- Types --------------------------------------------------
// (none)

// -------------------------------------------------- Refs --------------------------------------------------
const files = ref<GitFile[]>([]);
const repos = ref<GitRepoStatus[]>([]);
const bIsLoading = ref<boolean>(false);
const error = ref<string | null>(null);

const selectedFiles = ref<Set<string>>(new Set());
/** When multiple Git roots exist, controls which repo’s files and actions are shown. */
const selectedGitRepo = ref<string>('');

const selectedFile = ref<GitFile | null>(null);
const diffContent = ref<string>('');
const bDiffLoading = ref<boolean>(false);
const diffError = ref<string | null>(null);

const commitMessage = ref<string>('');
/** Per-repo messages when the workspace has multiple Git roots. */
const commitMessagesByRepo = ref<Record<string, string>>({});
const committingRepo = ref<string | null>(null);
const pushingRepo = ref<string | null>(null);
const discardingRepo = ref<string | null>(null);
const bShowDiscardModal = ref<boolean>(false);
const discardTargetRepo = ref<string>('');
const commitResult = ref<{ type: 'success' | 'error'; text: string; repo?: string } | null>(null);
const pushResult = ref<{ type: 'success' | 'error'; text: string; repo?: string } | null>(null);
const discardResult = ref<{ type: 'success' | 'error'; text: string; repo?: string } | null>(null);

let pollTimer: ReturnType<typeof setInterval> | null = null;
let commitResultTimer: ReturnType<typeof setTimeout> | null = null;
let pushResultTimer: ReturnType<typeof setTimeout> | null = null;
let discardResultTimer: ReturnType<typeof setTimeout> | null = null;

// -------------------------------------------------- Computed --------------------------------------------------
const diffLines = computed((): string[] => diffContent.value.split('\n'));
const allSelected = computed((): boolean => {
  const list = filesInSelectedRepo.value;
  return (
    list.length > 0 && list.every((f) => selectedFiles.value.has(fileKey(f)))
  );
});
const someSelected = computed((): boolean => {
  const list = filesInSelectedRepo.value;
  const n = list.filter((f) => selectedFiles.value.has(fileKey(f))).length;
  return n > 0 && n < list.length;
});
const filesInSelectedRepo = computed((): GitFile[] => {
  if (repos.value.length <= 1) return files.value;
  return files.value.filter((f) => f.repo === selectedGitRepo.value);
});
const activeRepo = computed((): GitRepoStatus | null => {
  const list = repos.value;
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  const found = list.find((r) => r.repo === selectedGitRepo.value);
  return found ?? list[0];
});
const hasMixedSelection = computed((): boolean => {
  const selectedRepos = new Set<string>();
  for (const key of selectedFiles.value) selectedRepos.add(parseFileKey(key).repo);
  return selectedRepos.size > 1;
});
const selectedCountInRepo = (repo: string): number =>
  [...selectedFiles.value].filter((key) => parseFileKey(key).repo === repo).length;
const canCommit = computed(
  (): boolean =>
    !!commitMessage.value.trim() &&
    selectedFiles.value.size > 0 &&
    committingRepo.value === null &&
    pushingRepo.value === null &&
    discardingRepo.value === null &&
    !hasMixedSelection.value
);
const canPushSingleRepo = computed(
  (): boolean =>
    pushingRepo.value === null &&
    committingRepo.value === null &&
    discardingRepo.value === null &&
    repos.value.length === 1
);
const canCommitActiveRepo = computed((): boolean => {
  const r = activeRepo.value;
  if (!r || repos.value.length <= 1) return false;
  const msg = (commitMessagesByRepo.value[r.repo] ?? '').trim();
  return (
    !!msg &&
    selectedCountInRepo(r.repo) > 0 &&
    committingRepo.value === null &&
    pushingRepo.value === null &&
    discardingRepo.value === null
  );
});
const canPushActiveRepo = computed(
  (): boolean =>
    !!activeRepo.value &&
    pushingRepo.value === null &&
    committingRepo.value === null &&
    discardingRepo.value === null
);
const canDiscardInRepo = (repo: string): boolean =>
  selectedCountInRepo(repo) > 0 &&
  committingRepo.value === null &&
  pushingRepo.value === null &&
  discardingRepo.value === null &&
  !hasMixedSelection.value;
const discardModalDescription = computed((): string => {
  const repo = discardTargetRepo.value;
  const count = selectedCountInRepo(repo);
  const noun = count === 1 ? 'file' : 'files';
  return `This will permanently discard uncommitted changes in ${count} selected ${noun}. This cannot be undone.`;
});

const fileKey = (file: GitFile): string => `${file.repo}::${file.file}`;
const parseFileKey = (key: string): { repo: string; file: string } => {
  const sep = key.indexOf('::');
  if (sep < 0) return { repo: '', file: key };
  return { repo: key.slice(0, sep), file: key.slice(sep + 2) };
};

// -------------------------------------------------- Methods --------------------------------------------------
const refresh = async (): Promise<void> => {
  bIsLoading.value = true;
  error.value = null;
  try {
    const response = await gitApi.status(props.workspaceId);
    files.value = response.data.files;
    repos.value = response.data.repos ?? [];

    if (repos.value.length === 1) {
      selectedGitRepo.value = repos.value[0].repo;
    } else if (repos.value.length > 1) {
      const ok = repos.value.some((r) => r.repo === selectedGitRepo.value);
      if (!ok) {
        const withChanges = repos.value.find((r) => r.files.length > 0);
        selectedGitRepo.value = withChanges?.repo ?? repos.value[0].repo;
      }
    }

    // Prune selections for files that no longer exist
    const currentPaths = new Set(response.data.files.map((f) => fileKey(f)));
    for (const key of selectedFiles.value) {
      if (!currentPaths.has(key)) selectedFiles.value.delete(key);
    }

    // Auto-select all new files if nothing was previously selected
    if (selectedFiles.value.size === 0 && response.data.files.length > 0) {
      selectedFiles.value = new Set(response.data.files.map((f) => fileKey(f)));
    }
  } catch (e: unknown) {
    const msg = e as { response?: { data?: { error?: string } }; message?: string };
    error.value = msg?.response?.data?.error ?? msg?.message ?? 'Failed to get git status';
  } finally {
    bIsLoading.value = false;
  }
};

const openFile = async (file: GitFile): Promise<void> => {
  selectedFile.value = file;
  emit('update:selectedFilePath', file.file);
  diffContent.value = '';
  diffError.value = null;
  bDiffLoading.value = true;
  try {
    const response = await gitApi.diff(props.workspaceId, file.file, file.status, file.repo);
    diffContent.value = response.data.diff;
  } catch (e: unknown) {
    const msg = e as { response?: { data?: { error?: string } }; message?: string };
    diffError.value = msg?.response?.data?.error ?? msg?.message ?? 'Failed to get diff';
  } finally {
    bDiffLoading.value = false;
  }
};

const clearSelectedFile = (): void => {
  selectedFile.value = null;
  emit('update:selectedFilePath', null);
};

const toggleFile = (file: GitFile): void => {
  const key = fileKey(file);
  if (selectedFiles.value.has(key)) {
    selectedFiles.value.delete(key);
  } else {
    selectedFiles.value.add(key);
  }
  // Trigger reactivity
  selectedFiles.value = new Set(selectedFiles.value);
};

const toggleAll = (): void => {
  const list = filesInSelectedRepo.value;
  if (list.length === 0) return;
  const allOn = list.every((f) => selectedFiles.value.has(fileKey(f)));
  const next = new Set(selectedFiles.value);
  if (allOn) {
    for (const f of list) next.delete(fileKey(f));
  } else {
    for (const f of list) next.add(fileKey(f));
  }
  selectedFiles.value = next;
};

const commitChanges = async (targetRepo: string): Promise<void> => {
  const msg =
    repos.value.length === 1
      ? commitMessage.value.trim()
      : (commitMessagesByRepo.value[targetRepo] ?? '').trim();
  if (!msg || selectedCountInRepo(targetRepo) === 0) return;
  committingRepo.value = targetRepo;
  commitResult.value = null;
  try {
    const filesToCommit = [...selectedFiles.value]
      .map((key) => parseFileKey(key))
      .filter((entry) => entry.repo === targetRepo)
      .map((entry) => entry.file);
    const response = await gitApi.commit(props.workspaceId, msg, filesToCommit, targetRepo);
    commitResult.value = {
      type: 'success',
      text: `Committed ${response.data.hash.slice(0, 7)}`,
      repo: repos.value.length > 1 ? targetRepo : undefined
    };
    if (repos.value.length === 1) {
      commitMessage.value = '';
    } else {
      const next = { ...commitMessagesByRepo.value };
      next[targetRepo] = '';
      commitMessagesByRepo.value = next;
    }
    await refresh();
  } catch (e: unknown) {
    const caughtError = e as { response?: { data?: { error?: string } }; message?: string };
    commitResult.value = {
      type: 'error',
      text: caughtError?.response?.data?.error ?? caughtError?.message ?? 'Commit failed',
      repo: repos.value.length > 1 ? targetRepo : undefined
    };
  } finally {
    committingRepo.value = null;
    if (commitResultTimer) clearTimeout(commitResultTimer);
    commitResultTimer = setTimeout(() => {
      commitResult.value = null;
    }, 5000);
  }
};

const pushChanges = async (targetRepo: string): Promise<void> => {
  pushingRepo.value = targetRepo;
  pushResult.value = null;
  try {
    await gitApi.push(props.workspaceId, targetRepo);
    pushResult.value = {
      type: 'success',
      text: 'Pushed successfully',
      repo: repos.value.length > 1 ? targetRepo : undefined
    };
    await refresh();
  } catch (e: unknown) {
    const caughtError = e as { response?: { data?: { error?: string } }; message?: string };
    pushResult.value = {
      type: 'error',
      text: caughtError?.response?.data?.error ?? caughtError?.message ?? 'Push failed',
      repo: repos.value.length > 1 ? targetRepo : undefined
    };
  } finally {
    pushingRepo.value = null;
    if (pushResultTimer) clearTimeout(pushResultTimer);
    pushResultTimer = setTimeout(() => {
      pushResult.value = null;
    }, 5000);
  }
};

const openDiscardModal = (targetRepo: string): void => {
  if (!canDiscardInRepo(targetRepo)) return;
  discardTargetRepo.value = targetRepo;
  bShowDiscardModal.value = true;
};

const discardChanges = async (): Promise<void> => {
  const targetRepo = discardTargetRepo.value;
  const filesToDiscard = [...selectedFiles.value]
    .map((key) => parseFileKey(key))
    .filter((entry) => entry.repo === targetRepo)
    .map((entry) => entry.file);
  if (filesToDiscard.length === 0) return;

  discardingRepo.value = targetRepo;
  discardResult.value = null;
  try {
    const response = await gitApi.discard(props.workspaceId, filesToDiscard, targetRepo);
    discardResult.value = {
      type: 'success',
      text: `Discarded ${response.data.discarded} file${response.data.discarded === 1 ? '' : 's'}`,
      repo: repos.value.length > 1 ? targetRepo : undefined
    };
    if (selectedFile.value && filesToDiscard.includes(selectedFile.value.file)) {
      clearSelectedFile();
    }
    bShowDiscardModal.value = false;
    await refresh();
  } catch (e: unknown) {
    const caughtError = e as { response?: { data?: { error?: string } }; message?: string };
    discardResult.value = {
      type: 'error',
      text: caughtError?.response?.data?.error ?? caughtError?.message ?? 'Discard failed',
      repo: repos.value.length > 1 ? targetRepo : undefined
    };
  } finally {
    discardingRepo.value = null;
    if (discardResultTimer) clearTimeout(discardResultTimer);
    discardResultTimer = setTimeout(() => {
      discardResult.value = null;
    }, 5000);
  }
};

const statusBadgeClass = (status: string): string => {
  const s = status.toUpperCase();
  if (s === 'M' || s === 'MM' || s === ' M' || s === 'M ')
    return 'bg-yellow-500/20 text-yellow-400';
  if (s === 'A' || s === 'A ') return 'bg-green-500/20 text-green-400';
  if (s === 'D' || s === ' D' || s === 'D ') return 'bg-red-500/20 text-red-400';
  if (s === 'R' || s.startsWith('R')) return 'bg-blue-500/20 text-blue-400';
  if (s === '??') return 'bg-text-muted/20 text-text-muted';
  return 'bg-text-muted/20 text-text-muted';
};

const diffRowClass = (line: string): string => {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-green-950/50';
  if (line.startsWith('-') && !line.startsWith('---')) return 'bg-red-950/50';
  if (line.startsWith('@@')) return 'bg-primary/10';
  if (
    line.startsWith('diff ') ||
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ')
  )
    return 'bg-surface';
  return '';
};

// -------------------------------------------------- Lifecycle --------------------------------------------------
// When files load and initialFilePath is set, open that file (e.g. from URL ?file=path)
watch(
  [() => props.initialFilePath, files],
  ([path, fileList]) => {
    const p = path as string | null | undefined;
    const list = fileList as GitFile[];
    if (!p || !list?.length || selectedFile.value) return;
    const match = list.find((f) => f.file === p);
    if (match) openFile(match);
  },
  { flush: 'post' }
);

watch(
  repos,
  (list) => {
    const cur = { ...commitMessagesByRepo.value };
    let changed = false;
    for (const r of list) {
      if (!(r.repo in cur)) {
        cur[r.repo] = '';
        changed = true;
      }
    }
    if (changed) commitMessagesByRepo.value = cur;
  },
  { deep: true }
);

watch(
  () => props.active,
  (active: boolean) => {
    if (active) {
      refresh();
      pollTimer = setInterval(refresh, 5000);
    } else {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }
  }
);

onMounted((): void => {
  if (props.active) {
    refresh();
    pollTimer = setInterval(refresh, 5000);
  }
});

onUnmounted((): void => {
  if (pollTimer) clearInterval(pollTimer);
  if (commitResultTimer) clearTimeout(commitResultTimer);
  if (pushResultTimer) clearTimeout(pushResultTimer);
  if (discardResultTimer) clearTimeout(discardResultTimer);
});
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-bg">
    <!-- File list -->
    <template v-if="!selectedFile">
      <div
        class="flex flex-col gap-2 px-3 py-2 border-b border-fg/[0.08] flex-shrink-0"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
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
              <svg v-if="allSelected" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none text-white"><polyline points="20 6 9 17 4 12"/></svg>
              <svg v-else-if="someSelected" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none text-white"><line x1="5" y1="12" x2="19" y2="12"/></svg>
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
          <button
            class="text-text-muted hover:text-text-primary transition-colors px-1 flex-shrink-0"
            :class="{ 'animate-spin': bIsLoading }"
            title="Refresh"
            @click="refresh"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          </button>
        </div>
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
      <div v-else-if="bIsLoading && !files.length" class="flex-1 overflow-hidden flex flex-col">
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
        v-else-if="!files.length && repos.length === 1"
        class="flex flex-col items-center justify-center flex-1 gap-1"
      >
        <p class="text-text-muted text-sm">No changes</p>
        <p class="text-text-muted/50 text-xs">Working tree clean</p>
      </div>

      <div
        v-else-if="!files.length && repos.length > 1"
        class="flex flex-col items-center justify-center flex-1 gap-1 px-6 text-center"
      >
        <p class="text-text-muted text-sm">No changes</p>
        <p class="text-text-muted/50 text-xs">Working tree clean in all repositories</p>
      </div>

      <div
        v-else-if="repos.length > 1 && files.length && !filesInSelectedRepo.length"
        class="flex flex-col items-center justify-center flex-1 gap-1 px-6 text-center"
      >
        <p class="text-text-muted text-sm">No changes in this repository</p>
        <p class="text-text-muted/50 text-xs">Switch repository above to see other files</p>
      </div>

      <div v-else class="flex-1 overflow-y-auto">
        <div
          v-for="f in filesInSelectedRepo"
          :key="fileKey(f)"
          class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-fg/[0.04] transition-colors text-left border-b border-fg/[0.03]"
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
            <svg v-if="selectedFiles.has(fileKey(f))" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none text-white"><polyline points="20 6 9 17 4 12"/></svg>
          </button>
          <button class="flex items-center gap-2.5 flex-1 min-w-0" @click="openFile(f)">
            <span
              class="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded font-mono tracking-wide"
              :class="statusBadgeClass(f.status)"
              >{{ f.status || '?' }}</span
            >
            <span class="text-xs text-text-primary truncate font-mono flex-1 text-left">{{
              f.file
            }}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none flex-shrink-0 text-text-muted/50"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </div>

      <!-- Commit & Push actions -->
      <div
        v-if="!error && repos.length"
        class="flex-shrink-0 border-t border-fg/[0.08] px-3 py-3 flex flex-col gap-2"
      >
        <!-- Single Git root: one bar -->
        <template v-if="repos.length === 1">
          <template v-if="files.length">
            <textarea
              v-model="commitMessage"
              rows="2"
              class="w-full bg-card border border-fg/[0.08] focus:border-primary/50 focus:ring-2 focus:ring-primary/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-all resize-none"
              placeholder="Commit message..."
              :disabled="committingRepo !== null"
            />
          </template>
          <div class="flex items-center gap-2">
            <button
              v-if="files.length"
              class="text-sm px-3 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              :disabled="!canCommit"
              @click="commitChanges(repos[0].repo)"
            >
              <div
                v-if="committingRepo === repos[0].repo"
                class="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin"
              ></div>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><polyline points="20 6 9 17 4 12"/></svg>
              Commit ({{ selectedFiles.size }})
            </button>
            <button
              class="text-sm px-3 py-2 text-text-primary border border-fg/10 hover:border-primary/30 hover:bg-primary/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              :disabled="!canPushSingleRepo"
              @click="pushChanges(repos[0].repo)"
            >
              <div
                v-if="pushingRepo === repos[0].repo"
                class="w-3 h-3 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
              ></div>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
              Push<template v-if="repos[0].aheadCount > 0"> ({{ repos[0].aheadCount }})</template>
            </button>
            <button
              v-if="files.length"
              class="text-sm px-3 py-2 text-destructive border border-destructive/20 hover:border-destructive/40 hover:bg-destructive/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              :disabled="!canDiscardInRepo(repos[0].repo)"
              @click="openDiscardModal(repos[0].repo)"
            >
              <div
                v-if="discardingRepo === repos[0].repo"
                class="w-3 h-3 border border-destructive/30 border-t-destructive rounded-full animate-spin"
              ></div>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
              Discard ({{ selectedFiles.size }})
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
          <p
            v-if="discardResult"
            class="text-xs"
            :class="discardResult.type === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ discardResult.text }}
          </p>
          <p v-if="hasMixedSelection" class="text-xs text-text-muted">
            Select files from a single repository for commit/push.
          </p>
        </template>

        <!-- Multiple Git roots: one message + actions for the repository selected above -->
        <template v-else-if="activeRepo">
          <template v-if="activeRepo.files.length">
            <textarea
              v-model="commitMessagesByRepo[selectedGitRepo]"
              rows="2"
              class="w-full bg-card border border-fg/[0.08] focus:border-primary/50 focus:ring-2 focus:ring-primary/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-all resize-none"
              placeholder="Commit message..."
              :disabled="committingRepo !== null"
            />
          </template>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              v-if="activeRepo.files.length"
              class="text-sm px-3 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              :disabled="!canCommitActiveRepo"
              @click="commitChanges(activeRepo.repo)"
            >
              <div
                v-if="committingRepo === activeRepo.repo"
                class="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin"
              ></div>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><polyline points="20 6 9 17 4 12"/></svg>
              Commit ({{ selectedCountInRepo(activeRepo.repo) }})
            </button>
            <button
              class="text-sm px-3 py-2 text-text-primary border border-fg/10 hover:border-primary/30 hover:bg-primary/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              :disabled="!canPushActiveRepo"
              @click="pushChanges(activeRepo.repo)"
            >
              <div
                v-if="pushingRepo === activeRepo.repo"
                class="w-3 h-3 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
              ></div>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/></svg>
              Push<template v-if="activeRepo.aheadCount > 0"> ({{ activeRepo.aheadCount }})</template>
            </button>
            <button
              v-if="activeRepo.files.length"
              class="text-sm px-3 py-2 text-destructive border border-destructive/20 hover:border-destructive/40 hover:bg-destructive/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
              :disabled="!canDiscardInRepo(activeRepo.repo)"
              @click="openDiscardModal(activeRepo.repo)"
            >
              <div
                v-if="discardingRepo === activeRepo.repo"
                class="w-3 h-3 border border-destructive/30 border-t-destructive rounded-full animate-spin"
              ></div>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
              Discard ({{ selectedCountInRepo(activeRepo.repo) }})
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
          <p
            v-if="
              discardResult &&
              (!discardResult.repo || discardResult.repo === selectedGitRepo)
            "
            class="text-xs"
            :class="discardResult.type === 'success' ? 'text-success' : 'text-destructive'"
          >
            {{ discardResult.text }}
          </p>
        </template>
      </div>
    </template>

    <!-- Diff view -->
    <template v-else>
      <div
        class="flex items-center gap-2 px-3 py-2 border-b border-fg/[0.08] flex-shrink-0 min-w-0"
      >
        <button
          class="flex-shrink-0 text-xs text-primary hover:text-primary-hover transition-colors"
          @click="clearSelectedFile"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back
        </button>
        <span
          class="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded font-mono"
          :class="statusBadgeClass(selectedFile.status)"
          >{{ selectedFile.status || '?' }}</span
        >
        <span class="text-xs text-text-muted font-mono truncate">{{ selectedFile.file }}</span>
      </div>

      <!-- Diff skeleton -->
      <div v-if="bDiffLoading" class="flex-1 overflow-auto px-3 py-2 space-y-1">
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
    </template>
  </div>

  <ConfirmModal
    v-model="bShowDiscardModal"
    title="Discard changes?"
    :description="discardModalDescription"
    confirm-label="Discard"
    :loading="discardingRepo !== null"
    @confirm="discardChanges"
  />
</template>

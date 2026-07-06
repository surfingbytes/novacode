<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CloudDownload,
  CloudUpload,
  GitBranch as GitBranchIcon,
  Minus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X
} from 'lucide-vue-next';

// classes
import { gitApi, type GitBranch, type GitFile, type GitRepoStatus } from '@/classes/api';

// components
import ContextMenu from '@/components/ContextMenu.vue';
import type { ContextMenuItem } from '@/components/ContextMenu.vue';

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
const bHasLoadedStatus = ref<boolean>(false);
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
const bGeneratingCommitMessage = ref<boolean>(false);
const commitResult = ref<{ type: 'success' | 'error'; text: string; repo?: string } | null>(null);
const pushResult = ref<{ type: 'success' | 'error'; text: string; repo?: string } | null>(null);
const gitActionResult = ref<{ type: 'success' | 'error'; text: string; repo?: string } | null>(null);

const branches = ref<GitBranch[]>([]);
const bBranchesLoading = ref<boolean>(false);
const bPulling = ref<boolean>(false);
const bSwitchingBranch = ref<boolean>(false);
const bCreatingBranch = ref<boolean>(false);
const bDiscarding = ref<boolean>(false);
const selectedBranch = ref<string>('');
const newBranchName = ref<string>('');
const branchSearch = ref<string>('');
const bShowGitActions = ref<boolean>(false);
const bShowSwitchBranch = ref<boolean>(false);
const bShowCreateBranch = ref<boolean>(false);
const bGitActionsMenuOpen = ref<boolean>(false);
const gitActionsMenuX = ref<number>(0);
const gitActionsMenuY = ref<number>(0);
const gitActionsButtonRef = ref<HTMLElement | null>(null);

let pollTimer: ReturnType<typeof setInterval> | null = null;
let commitResultTimer: ReturnType<typeof setTimeout> | null = null;
let pushResultTimer: ReturnType<typeof setTimeout> | null = null;
let gitActionResultTimer: ReturnType<typeof setTimeout> | null = null;

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
    !bPulling.value &&
    !bSwitchingBranch.value &&
    !bCreatingBranch.value &&
    !bDiscarding.value &&
    !bGeneratingCommitMessage.value &&
    !hasMixedSelection.value
);
const canPushSingleRepo = computed(
  (): boolean =>
    pushingRepo.value === null &&
    committingRepo.value === null &&
    !bPulling.value &&
    !bSwitchingBranch.value &&
    !bCreatingBranch.value &&
    !bDiscarding.value &&
    !bGeneratingCommitMessage.value &&
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
    !bPulling.value &&
    !bSwitchingBranch.value &&
    !bCreatingBranch.value &&
    !bDiscarding.value &&
    !bGeneratingCommitMessage.value
  );
});
const canPushActiveRepo = computed(
  (): boolean =>
    !!activeRepo.value &&
    pushingRepo.value === null &&
    committingRepo.value === null &&
    !bPulling.value &&
    !bSwitchingBranch.value &&
    !bCreatingBranch.value &&
    !bDiscarding.value &&
    !bGeneratingCommitMessage.value
);
const selectedFilesInActiveRepo = computed((): string[] => {
  const r = activeRepo.value;
  if (!r) return [];
  return [...selectedFiles.value]
    .map((key) => parseFileKey(key))
    .filter((entry) => entry.repo === r.repo)
    .map((entry) => entry.file);
});
const gitOperationInProgress = computed(
  (): boolean =>
    committingRepo.value !== null ||
    pushingRepo.value !== null ||
    bPulling.value ||
    bSwitchingBranch.value ||
    bCreatingBranch.value ||
    bDiscarding.value ||
    bGeneratingCommitMessage.value
);
const canPullActiveRepo = computed(
  (): boolean => !!activeRepo.value?.upstreamBranch && !gitOperationInProgress.value
);
const canSwitchBranch = computed(
  (): boolean =>
    !!activeRepo.value &&
    !!selectedBranch.value &&
    selectedBranch.value !== activeRepo.value.currentBranch &&
    !gitOperationInProgress.value
);
const canCreateBranch = computed(
  (): boolean => !!activeRepo.value && !!newBranchName.value.trim() && !gitOperationInProgress.value
);
const canDiscardSelected = computed(
  (): boolean => !!activeRepo.value && selectedFilesInActiveRepo.value.length > 0 && !gitOperationInProgress.value
);
const filteredBranches = computed((): GitBranch[] => {
  const q = branchSearch.value.trim().toLowerCase();
  if (!q) return branches.value;
  return branches.value.filter(
    (branch) =>
      branch.name.toLowerCase().includes(q) ||
      branch.upstream?.toLowerCase().includes(q)
  );
});
const gitActionsMenuItems = computed(
  (): ContextMenuItem[] => [
    {
      key: 'pull',
      label: 'Pull',
      disabled: !canPullActiveRepo.value
    },
    {
      key: 'switch',
      label: 'Switch branch',
      disabled: gitOperationInProgress.value
    },
    {
      key: 'create',
      label: 'Create branch',
      disabled: gitOperationInProgress.value
    }
  ]
);

const fileKey = (file: GitFile): string => `${file.repo}::${file.file}`;
const parseFileKey = (key: string): { repo: string; file: string } => {
  const sep = key.indexOf('::');
  if (sep < 0) return { repo: '', file: key };
  return { repo: key.slice(0, sep), file: key.slice(sep + 2) };
};
const canGenerateCommitMessage = (targetRepo: string): boolean =>
  selectedCountInRepo(targetRepo) > 0 &&
  committingRepo.value === null &&
  pushingRepo.value === null &&
  !bPulling.value &&
  !bSwitchingBranch.value &&
  !bCreatingBranch.value &&
  !bDiscarding.value &&
  !bGeneratingCommitMessage.value &&
  (repos.value.length === 1 || activeRepo.value?.repo === targetRepo);

// -------------------------------------------------- Methods --------------------------------------------------
const gitErrorMessage = (e: unknown, fallback: string): string => {
  const msg = e as { response?: { data?: { error?: string } }; message?: string };
  return msg?.response?.data?.error ?? msg?.message ?? fallback;
};

const setGitActionResult = (
  type: 'success' | 'error',
  text: string,
  repo?: string
): void => {
  gitActionResult.value = { type, text, repo: repos.value.length > 1 ? repo : undefined };
  if (gitActionResultTimer) clearTimeout(gitActionResultTimer);
  gitActionResultTimer = setTimeout(() => {
    gitActionResult.value = null;
  }, 6000);
};

const loadBranches = async (repo: string): Promise<void> => {
  bBranchesLoading.value = true;
  try {
    const response = await gitApi.branches(props.workspaceId, repo);
    branches.value = response.data.branches;
    selectedBranch.value = response.data.currentBranch;
  } catch (e: unknown) {
    setGitActionResult('error', gitErrorMessage(e, 'Failed to load branches'), repo);
    branches.value = [];
    selectedBranch.value = '';
  } finally {
    bBranchesLoading.value = false;
  }
};

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

    const repo = activeRepo.value?.repo ?? selectedGitRepo.value;
    if (repo !== undefined && repos.value.length > 0) await loadBranches(repo);
  } catch (e: unknown) {
    error.value = gitErrorMessage(e, 'Failed to get git status');
  } finally {
    bHasLoadedStatus.value = true;
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
    diffError.value = gitErrorMessage(e, 'Failed to get diff');
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

const generateCommitMessage = async (targetRepo: string): Promise<void> => {
  if (!canGenerateCommitMessage(targetRepo)) return;
  const filesToSummarize = [...selectedFiles.value]
    .map((key) => parseFileKey(key))
    .filter((entry) => entry.repo === targetRepo)
    .map((entry) => entry.file);

  if (!filesToSummarize.length) return;

  bGeneratingCommitMessage.value = true;
  commitResult.value = null;
  try {
    const response = await gitApi.generateCommitMessage(
      props.workspaceId,
      filesToSummarize,
      targetRepo
    );
    if (repos.value.length === 1) {
      commitMessage.value = response.data.message;
    } else {
      commitMessagesByRepo.value = {
        ...commitMessagesByRepo.value,
        [targetRepo]: response.data.message
      };
    }
    setGitActionResult('success', 'Generated commit message', targetRepo);
  } catch (e: unknown) {
    commitResult.value = {
      type: 'error',
      text: gitErrorMessage(e, 'Failed to generate commit message'),
      repo: repos.value.length > 1 ? targetRepo : undefined
    };
    if (commitResultTimer) clearTimeout(commitResultTimer);
    commitResultTimer = setTimeout(() => {
      commitResult.value = null;
    }, 5000);
  } finally {
    bGeneratingCommitMessage.value = false;
  }
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

const pullActiveRepo = async (): Promise<void> => {
  const r = activeRepo.value;
  if (!r || !canPullActiveRepo.value) return;
  bShowGitActions.value = false;
  bGitActionsMenuOpen.value = false;
  bPulling.value = true;
  try {
    await gitApi.pull(props.workspaceId, r.repo);
    setGitActionResult('success', 'Pulled latest changes', r.repo);
    await refresh();
  } catch (e: unknown) {
    setGitActionResult('error', gitErrorMessage(e, 'Pull failed'), r.repo);
  } finally {
    bPulling.value = false;
  }
};

const openSwitchBranchDialog = async (): Promise<void> => {
  const r = activeRepo.value;
  if (!r) return;
  selectedBranch.value = r.currentBranch;
  branchSearch.value = '';
  bShowGitActions.value = false;
  bGitActionsMenuOpen.value = false;
  bShowSwitchBranch.value = true;
  if (!branches.value.length) await loadBranches(r.repo);
};

const openCreateBranchDialog = (): void => {
  newBranchName.value = '';
  bShowGitActions.value = false;
  bGitActionsMenuOpen.value = false;
  bShowCreateBranch.value = true;
};

const openGitActions = (): void => {
  const button = gitActionsButtonRef.value;
  if (!button || window.matchMedia('(max-width: 767px)').matches) {
    bShowGitActions.value = true;
    return;
  }

  const rect = button.getBoundingClientRect();
  gitActionsMenuX.value = rect.right - 176;
  gitActionsMenuY.value = rect.bottom + 6;
  bGitActionsMenuOpen.value = true;
};

const onGitActionPick = (key: string): void => {
  if (key === 'pull') {
    pullActiveRepo();
    return;
  }
  if (key === 'switch') {
    openSwitchBranchDialog();
    return;
  }
  if (key === 'create') {
    openCreateBranchDialog();
  }
};

const switchBranch = async (branchName = selectedBranch.value): Promise<void> => {
  const r = activeRepo.value;
  selectedBranch.value = branchName;
  if (!r || !canSwitchBranch.value) return;
  bSwitchingBranch.value = true;
  try {
    const response = await gitApi.checkout(props.workspaceId, selectedBranch.value, r.repo);
    setGitActionResult('success', `Switched to ${response.data.branch}`, r.repo);
    bShowSwitchBranch.value = false;
    clearSelectedFile();
    await refresh();
  } catch (e: unknown) {
    selectedBranch.value = r.currentBranch;
    setGitActionResult('error', gitErrorMessage(e, 'Switch branch failed'), r.repo);
  } finally {
    bSwitchingBranch.value = false;
  }
};

const createBranch = async (): Promise<void> => {
  const r = activeRepo.value;
  const branch = newBranchName.value.trim();
  if (!r || !branch || !canCreateBranch.value) return;
  bCreatingBranch.value = true;
  try {
    const response = await gitApi.createBranch(props.workspaceId, branch, r.repo);
    newBranchName.value = '';
    setGitActionResult('success', `Created ${response.data.branch}`, r.repo);
    bShowCreateBranch.value = false;
    clearSelectedFile();
    await refresh();
  } catch (e: unknown) {
    setGitActionResult('error', gitErrorMessage(e, 'Create branch failed'), r.repo);
  } finally {
    bCreatingBranch.value = false;
  }
};

const discardFiles = async (targetFiles: string[], repo: string): Promise<void> => {
  if (!targetFiles.length || bDiscarding.value) return;
  const label = targetFiles.length === 1 ? targetFiles[0] : `${targetFiles.length} files`;
  if (!window.confirm(`Discard changes in ${label}? This cannot be undone.`)) return;

  bDiscarding.value = true;
  try {
    await gitApi.discard(props.workspaceId, targetFiles, repo);
    setGitActionResult('success', `Discarded ${label}`, repo);
    if (selectedFile.value && targetFiles.includes(selectedFile.value.file)) clearSelectedFile();
    const discarded = new Set(targetFiles.map((file) => `${repo}::${file}`));
    selectedFiles.value = new Set([...selectedFiles.value].filter((key) => !discarded.has(key)));
    await refresh();
  } catch (e: unknown) {
    setGitActionResult('error', gitErrorMessage(e, 'Discard failed'), repo);
  } finally {
    bDiscarding.value = false;
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

watch(selectedGitRepo, (repo) => {
  if (!props.active || (!repo && repos.value.length === 0)) return;
  loadBranches(repo);
});

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
  if (gitActionResultTimer) clearTimeout(gitActionResultTimer);
});
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-bg">
    <!-- File list -->
    <template v-if="!selectedFile">
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
                ref="gitActionsButtonRef"
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
          <button
            class="text-text-muted hover:text-text-primary transition-colors px-1 flex-shrink-0"
            :class="{ 'animate-spin': bIsLoading }"
            title="Refresh"
            @click="refresh"
          >
            <RefreshCw :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
          </button>
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
      <div v-else-if="bIsLoading && !bHasLoadedStatus" class="flex-1 overflow-hidden flex flex-col">
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
            <Check v-if="selectedFiles.has(fileKey(f))" :size="10" :stroke-width="1.6" class="select-none text-white" aria-hidden="true" />
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
            <ChevronRight :size="14" :stroke-width="1.6" class="select-none flex-shrink-0 text-text-muted/50" aria-hidden="true" />
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
        v-if="!error && repos.length"
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
                class="flex-shrink-0 w-10 rounded-lg text-text-muted hover:text-primary hover:bg-fg/[0.06] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                type="button"
                title="Generate commit message"
                aria-label="Generate commit message"
                :disabled="!canGenerateCommitMessage(repos[0].repo)"
                @click="generateCommitMessage(repos[0].repo)"
              >
                <div
                  v-if="bGeneratingCommitMessage"
                  class="w-4 h-4 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
                ></div>
                <Sparkles v-else :size="17" :stroke-width="1.7" class="select-none" aria-hidden="true" />
              </button>
            </div>
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
              <Check v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
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
              <CloudUpload v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
              Push<template v-if="repos[0].aheadCount > 0"> ({{ repos[0].aheadCount }})</template>
            </button>
            <button
              v-if="files.length"
              class="text-sm px-3 py-2 text-destructive border border-destructive/20 hover:border-destructive/40 hover:bg-destructive/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
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
                v-model="commitMessagesByRepo[selectedGitRepo]"
                rows="2"
                class="min-w-0 flex-1 bg-card border border-fg/[0.08] focus:border-primary/50 focus:ring-2 focus:ring-primary/10 rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none transition-all resize-none"
                placeholder="Commit message..."
                :disabled="committingRepo !== null || bGeneratingCommitMessage"
              />
              <button
                class="flex-shrink-0 w-10 rounded-lg text-text-muted hover:text-primary hover:bg-fg/[0.06] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center"
                type="button"
                title="Generate commit message"
                aria-label="Generate commit message"
                :disabled="!canGenerateCommitMessage(activeRepo.repo)"
                @click="generateCommitMessage(activeRepo.repo)"
              >
                <div
                  v-if="bGeneratingCommitMessage"
                  class="w-4 h-4 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
                ></div>
                <Sparkles v-else :size="17" :stroke-width="1.7" class="select-none" aria-hidden="true" />
              </button>
            </div>
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
              <Check v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
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
              <CloudUpload v-else :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
              Push<template v-if="activeRepo.aheadCount > 0"> ({{ activeRepo.aheadCount }})</template>
            </button>
            <button
              v-if="activeRepo.files.length"
              class="text-sm px-3 py-2 text-destructive border border-destructive/20 hover:border-destructive/40 hover:bg-destructive/[0.06] rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
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
          <ArrowLeft :size="14" :stroke-width="1.6" class="select-none" aria-hidden="true" />
          Back
        </button>
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

  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="bShowGitActions && activeRepo"
        class="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-actions-title"
      >
        <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="bShowGitActions = false" />
        <div class="modal-panel relative w-full max-w-sm rounded-2xl border border-fg/[0.09] bg-surface shadow-2xl shadow-black/60">
          <div class="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <div class="min-w-0">
              <h2 id="git-actions-title" class="font-semibold text-text-primary">Git actions</h2>
              <p class="mt-1 truncate font-mono text-xs text-text-muted">{{ activeRepo.currentBranch }}</p>
            </div>
            <button
              class="text-text-muted hover:text-text-primary transition-colors"
              type="button"
              @click="bShowGitActions = false"
            >
              <X :size="18" :stroke-width="1.8" class="select-none" aria-hidden="true" />
            </button>
          </div>
          <div class="px-3 pb-3">
            <button
              class="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-text-primary hover:bg-fg/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
              :disabled="!canPullActiveRepo"
              @click="pullActiveRepo"
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
                  <template v-if="activeRepo.upstreamBranch">Fast-forward from upstream</template>
                  <template v-else>No upstream configured</template>
                </span>
              </span>
            </button>
            <button
              class="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-text-primary hover:bg-fg/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
              :disabled="gitOperationInProgress"
              @click="openSwitchBranchDialog"
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
              @click="openCreateBranchDialog"
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
        </div>
      </div>
    </Transition>
  </Teleport>

  <ContextMenu
    v-model="bGitActionsMenuOpen"
    :x="gitActionsMenuX"
    :y="gitActionsMenuY"
    :items="gitActionsMenuItems"
    @pick="onGitActionPick"
  />

  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="bShowSwitchBranch && activeRepo"
        class="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="switch-branch-title"
      >
        <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="bShowSwitchBranch = false" />
        <div class="modal-panel relative flex max-h-[85vh] w-full max-w-md flex-col rounded-2xl border border-fg/[0.09] bg-surface shadow-2xl shadow-black/60">
          <div class="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <div>
              <h2 id="switch-branch-title" class="font-semibold text-text-primary">Switch branch</h2>
              <p class="mt-1 text-xs text-text-muted">Current: <span class="font-mono">{{ activeRepo.currentBranch }}</span></p>
            </div>
            <button
              class="text-text-muted hover:text-text-primary transition-colors"
              type="button"
              @click="bShowSwitchBranch = false"
            >
              <X :size="18" :stroke-width="1.8" class="select-none" aria-hidden="true" />
            </button>
          </div>
          <div class="px-5 pb-3">
            <input
              v-model="branchSearch"
              class="w-full rounded-lg border border-fg/[0.12] bg-fg/[0.04] px-3 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none"
              placeholder="Search branches..."
              autocomplete="off"
              autofocus
              @keydown.escape="bShowSwitchBranch = false"
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
              :key="branch.name"
              class="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-fg/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
              :disabled="branch.current || gitOperationInProgress"
              @click="switchBranch(branch.name)"
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
                v-else-if="bSwitchingBranch && selectedBranch === branch.name"
                class="w-4 h-4 border border-text-muted/30 border-t-text-muted rounded-full animate-spin"
              ></div>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <Teleport to="body">
    <Transition name="modal-fade">
      <div
        v-if="bShowCreateBranch && activeRepo"
        class="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-branch-title"
      >
        <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="bShowCreateBranch = false" />
        <form
          class="modal-panel relative w-full max-w-sm rounded-2xl border border-fg/[0.09] bg-surface shadow-2xl shadow-black/60"
          @submit.prevent="createBranch"
        >
          <div class="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
            <div>
              <h2 id="create-branch-title" class="font-semibold text-text-primary">Create branch</h2>
              <p class="mt-1 text-xs text-text-muted">From <span class="font-mono">{{ activeRepo.currentBranch }}</span></p>
            </div>
            <button
              class="text-text-muted hover:text-text-primary transition-colors"
              type="button"
              @click="bShowCreateBranch = false"
            >
              <X :size="18" :stroke-width="1.8" class="select-none" aria-hidden="true" />
            </button>
          </div>
          <div class="px-5 pb-5">
            <label class="text-xs font-medium text-text-muted">Branch name</label>
            <input
              v-model="newBranchName"
              class="mt-1.5 w-full rounded-lg border border-fg/[0.12] bg-fg/[0.04] px-3 py-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary/50 focus:outline-none"
              placeholder="feature/my-branch"
              autocomplete="off"
              autofocus
              :disabled="gitOperationInProgress"
              @keydown.escape="bShowCreateBranch = false"
            />
          </div>
          <div class="flex justify-end gap-2 border-t border-fg/[0.08] px-5 py-4">
            <button
              class="rounded-lg px-3 py-2 text-sm text-text-muted hover:text-text-primary transition-colors"
              type="button"
              :disabled="gitOperationInProgress"
              @click="bShowCreateBranch = false"
            >
              Cancel
            </button>
            <button
              class="rounded-lg bg-primary px-4 py-2 text-sm text-white transition-colors hover:bg-primary-hover disabled:opacity-40 disabled:cursor-not-allowed"
              type="submit"
              :disabled="!canCreateBranch"
            >
              <span v-if="!bCreatingBranch">Create and switch</span>
              <span v-else>Creating...</span>
            </button>
          </div>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>

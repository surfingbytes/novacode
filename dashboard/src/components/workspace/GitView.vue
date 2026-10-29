<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';

// classes
import { apiErrorMessage, forgeApi, gitApi } from '@/classes/api';

// types
import type { GitFile, GitRepoStatus } from '@/@types/index';

// composables
import { usePaneLayout } from '@/composables/usePaneLayout';
import { useCiStatus } from '@/composables/useCiStatus';
import { usePolling } from '@/composables/usePolling';
import { useGitFileSelection } from '@/components/workspace/git/useGitFileSelection';
import { useGitBranches } from '@/components/workspace/git/useGitBranches';
import { useGitActionGuards } from '@/components/workspace/git/useGitActionGuards';
import { useGitHistory } from '@/components/workspace/git/useGitHistory';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import type { ContextMenuItem } from '@/components/ContextMenu.vue';
import GitChangesList from '@/components/workspace/git/GitChangesList.vue';
import GitDiffPane from '@/components/workspace/git/GitDiffPane.vue';
import GitCiStatus from '@/components/workspace/git/GitCiStatus.vue';
import GitActionsSheet from '@/components/workspace/git/GitActionsSheet.vue';
import GitSwitchBranchModal from '@/components/workspace/git/GitSwitchBranchModal.vue';
import GitCreateBranchModal from '@/components/workspace/git/GitCreateBranchModal.vue';
import type { BranchOption } from '@/components/workspace/git/gitBranchOptions';
import { gitFileKey as fileKey, gitParseFileKey as parseFileKey } from '@/components/workspace/git/gitDisplay';
import {
  gitErrorMessage,
  gitFetchResultMessage as fetchResultMessage,
  gitPullResultMessage as pullResultMessage
} from '@/components/workspace/git/gitMessages';

// -------------------------------------------------- Props --------------------------------------------------
const props = withDefaults(
  defineProps<{
    workspaceId: string;
    active: boolean;
    initialFilePath?: string | null;
    /** Session hosting this view — CI notifications link back to it; enables "Fix with agent". */
    sessionId?: string | null;
  }>(),
  { initialFilePath: null, sessionId: null }
);

const emit = defineEmits<{
  'update:selectedFilePath': [path: string | null];
  /** Prompt asking the agent to fix a failed CI build (includes job logs when available). */
  'fix-build': [prompt: string];
}>();

const {
  bWidePane,
  bSidePanelOpen,
  bSidePanelToggleVisible,
  setSidePanelOpen,
  listVisible,
  detailVisible
} = usePaneLayout('novacode:gitSidePanel');

// -------------------------------------------------- Types --------------------------------------------------
// (none)

// -------------------------------------------------- Refs --------------------------------------------------
const files = ref<GitFile[]>([]);
const repos = ref<GitRepoStatus[]>([]);
const bIsLoading = ref<boolean>(false);
const bHasLoadedStatus = ref<boolean>(false);
const error = ref<string | null>(null);

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

const bPulling = ref<boolean>(false);
const bFetching = ref<boolean>(false);
const bSwitchingBranch = ref<boolean>(false);
const bCreatingBranch = ref<boolean>(false);
const bDiscarding = ref<boolean>(false);
const bShowGitActions = ref<boolean>(false);
const bShowSwitchBranch = ref<boolean>(false);
const bShowCreateBranch = ref<boolean>(false);
const bGitActionsMenuOpen = ref<boolean>(false);
const gitActionsMenuX = ref<number>(0);
const gitActionsMenuY = ref<number>(0);
const listPane = ref<'changes' | 'history'>('changes');
const {
  commits,
  bHistoryLoading,
  selectedCommit,
  commitPatch,
  bCommitPatchLoading,
  commitPatchError,
  loadHistory,
  openCommit
} = useGitHistory({
  getWorkspaceId: () => props.workspaceId,
  getRepo: () => activeRepo.value?.repo ?? selectedGitRepo.value,
  onError: (message, repo) => setGitActionResult('error', message, repo),
  onOpenCommit: () => {
    selectedFile.value = null;
    emit('update:selectedFilePath', null);
  }
});

const bFixingBuild = ref<boolean>(false);

let ciAfterPushTimer: ReturnType<typeof setTimeout> | null = null;
let commitResultTimer: ReturnType<typeof setTimeout> | null = null;
let pushResultTimer: ReturnType<typeof setTimeout> | null = null;
let gitActionResultTimer: ReturnType<typeof setTimeout> | null = null;

// -------------------------------------------------- Computed --------------------------------------------------
const diffLines = computed((): string[] => diffContent.value.split('\n'));
const commitPatchLines = computed((): string[] => commitPatch.value.split('\n'));
const bShowList = computed((): boolean =>
  listVisible(selectedFile.value !== null || selectedCommit.value !== null)
);
const bShowDetail = computed((): boolean =>
  detailVisible(selectedFile.value !== null || selectedCommit.value !== null)
);
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
const {
  status: ciStatus,
  bLoading: bCiLoading,
  refresh: refreshCiStatus
} = useCiStatus({
  workspaceId: computed(() => props.workspaceId),
  repo: computed(() => activeRepo.value?.repo ?? ''),
  sessionId: computed(() => props.sessionId),
  active: computed(() => props.active && activeRepo.value !== null),
  trigger: computed(() => activeRepo.value?.currentBranch ?? '')
});
const {
  selectedFiles,
  allSelected,
  someSelected,
  hasMixedSelection,
  selectedCountInRepo,
  selectedFilesInActiveRepo,
  toggleFile,
  toggleAll
} = useGitFileSelection({ filesInSelectedRepo, activeRepo });
const {
  branches,
  bBranchesLoading,
  selectedBranch,
  newBranchName,
  branchSearch,
  filteredBranches,
  loadBranches
} = useGitBranches({
  getWorkspaceId: () => props.workspaceId,
  onError: (message, repo) => setGitActionResult('error', message, repo)
});
const {
  gitOperationInProgress,
  canCommit,
  canPushSingleRepo,
  canCommitActiveRepo,
  canPushActiveRepo,
  canPullActiveRepo,
  canFetchActiveRepo,
  canSwitchBranch,
  canCreateBranch,
  canDiscardSelected,
  canGenerateCommitMessage
} = useGitActionGuards({
  committingRepo,
  pushingRepo,
  bPulling,
  bFetching,
  bSwitchingBranch,
  bCreatingBranch,
  bDiscarding,
  bGeneratingCommitMessage,
  repos,
  activeRepo,
  commitMessage,
  commitMessagesByRepo,
  selectedFiles,
  hasMixedSelection,
  selectedCountInRepo,
  selectedFilesInActiveRepo,
  selectedBranch,
  newBranchName
});
const gitActionsMenuItems = computed(
  (): ContextMenuItem[] => [
    {
      key: 'fetch',
      label: 'Fetch',
      disabled: !canFetchActiveRepo.value
    },
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

// -------------------------------------------------- Methods --------------------------------------------------
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

let bStatusFailed = false;

const refresh = async (): Promise<void> => {
  bIsLoading.value = true;
  bStatusFailed = false;
  try {
    const response = await gitApi.status(props.workspaceId);
    files.value = response.data.files;
    repos.value = response.data.repos ?? [];
    error.value = null;

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
    if (listPane.value === 'history') {
      await loadHistory();
    }
  } catch (e: unknown) {
    bStatusFailed = true;
    const message = gitErrorMessage(e, 'Failed to get git status');
    // Keep the last-known file list visible — a failed poll (e.g. while a long
    // commit-message request holds browser connections) must not wipe the pane.
    if (!bHasLoadedStatus.value) {
      error.value = message;
    } else {
      setGitActionResult('error', message);
    }
  } finally {
    bHasLoadedStatus.value = true;
    bIsLoading.value = false;
  }
};

// Background status poll: never overlaps a slow `git status`, pauses while the tab is hidden and
// backs off while the API keeps failing.
const statusPoll = usePolling(
  async (): Promise<void> => {
    await refresh();
    if (bStatusFailed) throw new Error('git status failed');
  },
  5000,
  { immediate: true, backoffOnError: true }
);

const openFile = async (file: GitFile): Promise<void> => {
  selectedCommit.value = null;
  commitPatch.value = '';
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
  selectedCommit.value = null;
  commitPatch.value = '';
  emit('update:selectedFilePath', null);
};

function setListPane(pane: 'changes' | 'history'): void {
  listPane.value = pane;
  if (pane === 'history') {
    selectedFile.value = null;
    emit('update:selectedFilePath', null);
    void loadHistory();
    return;
  }
  selectedCommit.value = null;
  commitPatch.value = '';
}

const generateCommitMessage = async (targetRepo: string): Promise<void> => {
  if (!canGenerateCommitMessage(targetRepo)) return;
  const filesToSummarize = [...selectedFiles.value]
    .map((key) => parseFileKey(key))
    .filter((entry) => entry.repo === targetRepo)
    .map((entry) => entry.file);

  if (!filesToSummarize.length) return;

  bGeneratingCommitMessage.value = true;
  commitResult.value = null;
  // Pause status polling so hung/slow AI requests do not starve the browser's
  // per-host connection pool and make status look like a Network Error.
  statusPoll.stop();
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
    if (props.active) statusPoll.start();
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

const fetchActiveRepo = async (): Promise<void> => {
  const r = activeRepo.value;
  if (!r || !canFetchActiveRepo.value) return;
  bShowGitActions.value = false;
  bGitActionsMenuOpen.value = false;
  bFetching.value = true;
  try {
    const response = await gitApi.fetch(props.workspaceId, r.repo);
    setGitActionResult(
      'success',
      fetchResultMessage(response.data.upToDate, response.data.behindCount, !!r.upstreamBranch),
      r.repo
    );
    await refresh();
  } catch (e: unknown) {
    setGitActionResult('error', gitErrorMessage(e, 'Fetch failed'), r.repo);
  } finally {
    bFetching.value = false;
  }
};

const pullActiveRepo = async (): Promise<void> => {
  const r = activeRepo.value;
  if (!r || !canPullActiveRepo.value) return;
  bShowGitActions.value = false;
  bGitActionsMenuOpen.value = false;
  bPulling.value = true;
  try {
    const response = await gitApi.pull(props.workspaceId, r.repo);
    setGitActionResult(
      'success',
      pullResultMessage(response.data.upToDate, response.data.commitCount),
      r.repo
    );
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
  selectedBranch.value = `local:${r.currentBranch}`;
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

const openGitActions = (e?: MouseEvent): void => {
  const button = (e?.currentTarget as HTMLElement | undefined) ?? null;
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
  if (key === 'fetch') {
    void fetchActiveRepo();
    return;
  }
  if (key === 'pull') {
    void pullActiveRepo();
    return;
  }
  if (key === 'switch') {
    void openSwitchBranchDialog();
    return;
  }
  if (key === 'create') {
    openCreateBranchDialog();
  }
};

const switchBranch = async (branch: BranchOption): Promise<void> => {
  const r = activeRepo.value;
  selectedBranch.value = branch.key;
  if (!r || !canSwitchBranch.value) return;
  bSwitchingBranch.value = true;
  try {
    const response = await gitApi.checkout(
      props.workspaceId,
      branch.name,
      r.repo,
      branch.remoteName ?? undefined
    );
    setGitActionResult('success', `Switched to ${response.data.branch}`, r.repo);
    bShowSwitchBranch.value = false;
    clearSelectedFile();
    await refresh();
  } catch (e: unknown) {
    selectedBranch.value = `local:${r.currentBranch}`;
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

const bShowDiscardConfirm = ref<boolean>(false);
const pendingDiscard = ref<{ files: string[]; repo: string } | null>(null);

const discardLabel = computed((): string => {
  const pending = pendingDiscard.value;
  if (!pending) return '';
  return pending.files.length === 1 ? pending.files[0] : `${pending.files.length} files`;
});

const discardFiles = (targetFiles: string[], repo: string): void => {
  if (!targetFiles.length || bDiscarding.value) return;
  pendingDiscard.value = { files: targetFiles, repo };
  bShowDiscardConfirm.value = true;
};

const confirmDiscardFiles = async (): Promise<void> => {
  const pending = pendingDiscard.value;
  if (!pending) return;
  const { files: targetFiles, repo } = pending;
  const label = targetFiles.length === 1 ? targetFiles[0] : `${targetFiles.length} files`;

  bDiscarding.value = true;
  try {
    await gitApi.discard(props.workspaceId, targetFiles, repo);
    setGitActionResult('success', `Discarded ${label}`, repo);
    if (selectedFile.value && targetFiles.includes(selectedFile.value.file)) clearSelectedFile();
    const discarded = new Set(targetFiles.map((file) => `${repo}::${file}`));
    selectedFiles.value = new Set([...selectedFiles.value].filter((key) => !discarded.has(key)));
    await refresh();
    bShowDiscardConfirm.value = false;
    pendingDiscard.value = null;
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
    // Give the forge a moment to register the push-triggered run.
    if (ciAfterPushTimer) clearTimeout(ciAfterPushTimer);
    ciAfterPushTimer = setTimeout(() => void refreshCiStatus(), 4000);
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

const fixFailedBuild = async (runId: number): Promise<void> => {
  bFixingBuild.value = true;
  try {
    const { data } = await forgeApi.fixPrompt(props.workspaceId, runId, activeRepo.value?.repo ?? '');
    emit('fix-build', data.prompt);
  } catch (e: unknown) {
    setGitActionResult('error', apiErrorMessage(e, 'Could not load the failed build'), activeRepo.value?.repo);
  } finally {
    bFixingBuild.value = false;
  }
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
    if (match) void openFile(match);
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
  void loadBranches(repo);
  if (listPane.value === 'history') {
    void loadHistory();
  }
});

watch(
  () => props.active,
  (active: boolean) => {
    if (active) statusPoll.start();
    else statusPoll.stop();
  }
);

onMounted((): void => {
  if (props.active) statusPoll.start();
});

onUnmounted((): void => {
  if (commitResultTimer) clearTimeout(commitResultTimer);
  if (pushResultTimer) clearTimeout(pushResultTimer);
  if (gitActionResultTimer) clearTimeout(gitActionResultTimer);
  if (ciAfterPushTimer) clearTimeout(ciAfterPushTimer);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 overflow-hidden bg-bg">
    <GitChangesList
      v-model:selected-git-repo="selectedGitRepo"
      v-model:commit-message="commitMessage"
      :b-show-list="bShowList"
      :b-wide-pane="bWidePane"
      :b-side-panel-toggle-visible="bSidePanelToggleVisible"
      :repos="repos"
      :active-repo="activeRepo"
      :files="files"
      :files-in-selected-repo="filesInSelectedRepo"
      :selected-files="selectedFiles"
      :selected-file="selectedFile"
      :selected-commit="selectedCommit"
      :b-is-loading="bIsLoading"
      :b-has-loaded-status="bHasLoadedStatus"
      :error="error"
      :list-pane="listPane"
      :b-history-loading="bHistoryLoading"
      :commits="commits"
      :committing-repo="committingRepo"
      :pushing-repo="pushingRepo"
      :b-generating-commit-message="bGeneratingCommitMessage"
      :b-discarding="bDiscarding"
      :commit-result="commitResult"
      :push-result="pushResult"
      :git-action-result="gitActionResult"
      :can-commit="canCommit"
      :can-commit-active-repo="canCommitActiveRepo"
      :can-discard-selected="canDiscardSelected"
      :can-push-active-repo="canPushActiveRepo"
      :can-push-single-repo="canPushSingleRepo"
      :all-selected="allSelected"
      :some-selected="someSelected"
      :has-mixed-selection="hasMixedSelection"
      :selected-files-in-active-repo="selectedFilesInActiveRepo"
      :commit-messages-by-repo="commitMessagesByRepo"
      :open-switch-branch-dialog="openSwitchBranchDialog"
      :open-git-actions="openGitActions"
      :set-side-panel-open="setSidePanelOpen"
      :set-list-pane="setListPane"
      :refresh="refresh"
      :load-history="loadHistory"
      :open-file="openFile"
      :open-commit="openCommit"
      :toggle-file="toggleFile"
      :toggle-all="toggleAll"
      :discard-files="discardFiles"
      :commit-changes="commitChanges"
      :push-changes="pushChanges"
      :generate-commit-message="generateCommitMessage"
      :can-generate-commit-message="canGenerateCommitMessage"
      :selected-count-in-repo="selectedCountInRepo"
      @update:commit-message-for-repo="
        (repo, value) => {
          commitMessagesByRepo[repo] = value;
        }
      "
    >
      <template #branch-footer>
        <GitCiStatus
          :status="ciStatus"
          :b-loading="bCiLoading"
          :b-can-fix="Boolean(sessionId)"
          :b-fixing="bFixingBuild"
          @refresh="refreshCiStatus"
          @fix="(run) => fixFailedBuild(run.id)"
        />
      </template>
    </GitChangesList>
    <GitDiffPane
      :b-show-detail="bShowDetail"
      :b-wide-pane="bWidePane"
      :b-side-panel-open="bSidePanelOpen"
      :b-side-panel-toggle-visible="bSidePanelToggleVisible"
      :selected-commit="selectedCommit"
      :selected-file="selectedFile"
      :b-commit-patch-loading="bCommitPatchLoading"
      :commit-patch-error="commitPatchError"
      :commit-patch-lines="commitPatchLines"
      :b-diff-loading="bDiffLoading"
      :diff-error="diffError"
      :diff-content="diffContent"
      :diff-lines="diffLines"
      :b-discarding="bDiscarding"
      :set-side-panel-open="setSidePanelOpen"
      :clear-selected-file="clearSelectedFile"
      :discard-files="discardFiles"
    />
  </div>

  <GitActionsSheet
    :b-open="bShowGitActions"
    :active-repo="activeRepo"
    :b-fetching="bFetching"
    :b-pulling="bPulling"
    :can-fetch-active-repo="canFetchActiveRepo"
    :can-pull-active-repo="canPullActiveRepo"
    :git-operation-in-progress="gitOperationInProgress"
    @close="bShowGitActions = false"
    @fetch="fetchActiveRepo"
    @pull="pullActiveRepo"
    @switch-branch="openSwitchBranchDialog"
    @create-branch="openCreateBranchDialog"
  />

  <ContextMenu
    v-model="bGitActionsMenuOpen"
    :x="gitActionsMenuX"
    :y="gitActionsMenuY"
    :items="gitActionsMenuItems"
    @pick="onGitActionPick"
  />

  <GitSwitchBranchModal
    v-model:branch-search="branchSearch"
    :b-open="bShowSwitchBranch"
    :active-repo="activeRepo"
    :b-branches-loading="bBranchesLoading"
    :filtered-branches="filteredBranches"
    :b-switching-branch="bSwitchingBranch"
    :selected-branch="selectedBranch"
    :git-operation-in-progress="gitOperationInProgress"
    @close="bShowSwitchBranch = false"
    @switch="switchBranch"
  />

  <GitCreateBranchModal
    v-model:new-branch-name="newBranchName"
    :b-open="bShowCreateBranch"
    :active-repo="activeRepo"
    :b-creating-branch="bCreatingBranch"
    :can-create-branch="canCreateBranch"
    :git-operation-in-progress="gitOperationInProgress"
    @close="bShowCreateBranch = false"
    @create="createBranch"
  />

  <ConfirmModal
    v-model="bShowDiscardConfirm"
    title="Discard changes"
    :description="`Discard changes in ${discardLabel}? This cannot be undone.`"
    confirm-label="Discard"
    :loading="bDiscarding"
    @confirm="confirmDiscardFiles"
  />
</template>

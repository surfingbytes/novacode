<script setup lang="ts">
// node_modules
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  CloudDownload,
  GitBranch as GitBranchIcon,
  Plus,
  RefreshCw
} from 'lucide-vue-next';

// classes
import { gitApi, type GitBranch, type GitCommit, type GitFile, type GitRepoStatus } from '@/classes/api';

// composables
import { usePaneLayout } from '@/composables/usePaneLayout';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';
import ContextMenu from '@/components/ContextMenu.vue';
import type { ContextMenuItem } from '@/components/ContextMenu.vue';
import GitChangesList from '@/components/workspace/git/GitChangesList.vue';
import GitDiffPane from '@/components/workspace/git/GitDiffPane.vue';
import { gitFileKey as fileKey, gitParseFileKey as parseFileKey } from '@/components/workspace/git/gitDisplay';

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
const remoteBranches = ref<string[]>([]);
const bBranchesLoading = ref<boolean>(false);
const bPulling = ref<boolean>(false);
const bFetching = ref<boolean>(false);
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
const listPane = ref<'changes' | 'history'>('changes');
const commits = ref<GitCommit[]>([]);
const bHistoryLoading = ref<boolean>(false);
const selectedCommit = ref<GitCommit | null>(null);
const commitPatch = ref<string>('');
const bCommitPatchLoading = ref<boolean>(false);
const commitPatchError = ref<string | null>(null);

let pollTimer: ReturnType<typeof setInterval> | null = null;
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
    !bFetching.value &&
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
    !bFetching.value &&
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
    !bFetching.value &&
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
    !bFetching.value &&
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
    bFetching.value ||
    bSwitchingBranch.value ||
    bCreatingBranch.value ||
    bDiscarding.value ||
    bGeneratingCommitMessage.value
);
const canPullActiveRepo = computed(
  (): boolean => !!activeRepo.value?.upstreamBranch && !gitOperationInProgress.value
);
const canFetchActiveRepo = computed(
  (): boolean => !!activeRepo.value && !gitOperationInProgress.value
);
const canSwitchBranch = computed(
  (): boolean =>
    !!activeRepo.value &&
    !!selectedBranch.value &&
    selectedBranch.value !== `local:${activeRepo.value.currentBranch}` &&
    !gitOperationInProgress.value
);
const canCreateBranch = computed(
  (): boolean => !!activeRepo.value && !!newBranchName.value.trim() && !gitOperationInProgress.value
);
const canDiscardSelected = computed(
  (): boolean => !!activeRepo.value && selectedFilesInActiveRepo.value.length > 0 && !gitOperationInProgress.value
);
type BranchOption = GitBranch & {
  key: string;
  remote: boolean;
  remoteName: string | null;
};

const localNameFromRemoteBranch = (remoteBranch: string): string => {
  const slash = remoteBranch.indexOf('/');
  return slash < 0 ? remoteBranch : remoteBranch.slice(slash + 1);
};

const branchOptions = computed((): BranchOption[] => {
  const localNames = new Set(branches.value.map((branch) => branch.name));
  const upstreams = new Set(
    branches.value
      .map((branch) => branch.upstream)
      .filter((upstream): upstream is string => !!upstream)
  );

  const localBranches = branches.value.map((branch) => ({
    ...branch,
    key: `local:${branch.name}`,
    remote: false,
    remoteName: null
  }));

  const remoteOnlyBranches = remoteBranches.value
    .filter((remoteBranch) => {
      const localName = localNameFromRemoteBranch(remoteBranch);
      return !localNames.has(localName) && !upstreams.has(remoteBranch);
    })
    .map((remoteBranch) => ({
      name: localNameFromRemoteBranch(remoteBranch),
      current: false,
      upstream: remoteBranch,
      key: `remote:${remoteBranch}`,
      remote: true,
      remoteName: remoteBranch
    }));

  return [...localBranches, ...remoteOnlyBranches];
});

const filteredBranches = computed((): BranchOption[] => {
  const q = branchSearch.value.trim().toLowerCase();
  if (!q) return branchOptions.value;
  return branchOptions.value.filter(
    (branch) =>
      branch.name.toLowerCase().includes(q) ||
      branch.upstream?.toLowerCase().includes(q)
  );
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

const canGenerateCommitMessage = (targetRepo: string): boolean =>
  selectedCountInRepo(targetRepo) > 0 &&
  committingRepo.value === null &&
  pushingRepo.value === null &&
  !bPulling.value &&
  !bFetching.value &&
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
    remoteBranches.value = response.data.remoteBranches;
    selectedBranch.value = `local:${response.data.currentBranch}`;
  } catch (e: unknown) {
    setGitActionResult('error', gitErrorMessage(e, 'Failed to load branches'), repo);
    branches.value = [];
    remoteBranches.value = [];
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
    if (listPane.value === 'history') {
      await loadHistory();
    }
  } catch (e: unknown) {
    error.value = gitErrorMessage(e, 'Failed to get git status');
  } finally {
    bHasLoadedStatus.value = true;
    bIsLoading.value = false;
  }
};

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

async function loadHistory(): Promise<void> {
  const repo = activeRepo.value?.repo ?? selectedGitRepo.value;
  bHistoryLoading.value = true;
  try {
    const response = await gitApi.log(props.workspaceId, repo, 80);
    commits.value = response.data.commits;
    if (
      selectedCommit.value &&
      !commits.value.some((commit) => commit.hash === selectedCommit.value?.hash)
    ) {
      selectedCommit.value = null;
      commitPatch.value = '';
    }
  } catch (e: unknown) {
    commits.value = [];
    setGitActionResult('error', gitErrorMessage(e, 'Failed to load history'), repo);
  } finally {
    bHistoryLoading.value = false;
  }
}

async function openCommit(commit: GitCommit): Promise<void> {
  selectedFile.value = null;
  emit('update:selectedFilePath', null);
  selectedCommit.value = commit;
  commitPatch.value = '';
  commitPatchError.value = null;
  bCommitPatchLoading.value = true;
  try {
    const repo = activeRepo.value?.repo ?? selectedGitRepo.value;
    const response = await gitApi.show(props.workspaceId, commit.hash, repo);
    commitPatch.value = response.data.patch;
  } catch (e: unknown) {
    commitPatchError.value = gitErrorMessage(e, 'Failed to load commit');
  } finally {
    bCommitPatchLoading.value = false;
  }
}

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

const pullResultMessage = (upToDate: boolean, commitCount: number): string => {
  if (upToDate) return 'Already up to date';
  return `Pulled ${commitCount} commit${commitCount === 1 ? '' : 's'}`;
};

const fetchResultMessage = (upToDate: boolean, behindCount: number, hasUpstream: boolean): string => {
  if (!hasUpstream) return 'Fetched from remote';
  if (upToDate) return 'Already up to date with remote';
  return `Fetched from remote · ${behindCount} commit${behindCount === 1 ? '' : 's'} behind`;
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
    fetchActiveRepo();
    return;
  }
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
  if (listPane.value === 'history') {
    void loadHistory();
  }
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
  <div class="flex h-full min-h-0 overflow-hidden bg-bg">
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
    />
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

  <BaseModal
    :model-value="bShowGitActions && !!activeRepo"
    labelledby="git-actions-title"
    panel-class="max-w-sm"
    @update:model-value="bShowGitActions = false"
  >
    <template v-if="activeRepo">
          <ModalHeader
            eyebrow="// git actions"
            title="Git actions"
            title-id="git-actions-title"
            @close="bShowGitActions = false"
          />
          <p class="px-6 pt-1 truncate font-mono text-xs text-text-muted">{{ activeRepo.currentBranch }}</p>
          <div class="px-3 pb-3">
            <button
              class="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-text-primary hover:bg-fg/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
              :disabled="!canFetchActiveRepo"
              @click="fetchActiveRepo"
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
    </template>
  </BaseModal>

  <ContextMenu
    v-model="bGitActionsMenuOpen"
    :x="gitActionsMenuX"
    :y="gitActionsMenuY"
    :items="gitActionsMenuItems"
    @pick="onGitActionPick"
  />

  <BaseModal
    :model-value="bShowSwitchBranch && !!activeRepo"
    labelledby="switch-branch-title"
    panel-class="max-w-md"
    @update:model-value="bShowSwitchBranch = false"
  >
    <template v-if="activeRepo">
          <ModalHeader
            eyebrow="// switch branch"
            title="Switch branch"
            title-id="switch-branch-title"
            @close="bShowSwitchBranch = false"
          />
          <p class="px-6 pt-1 text-xs text-text-muted">Current: <span class="font-mono">{{ activeRepo.currentBranch }}</span></p>
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
              :key="branch.key"
              class="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-fg/[0.06] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              type="button"
              :disabled="branch.current || gitOperationInProgress"
              @click="switchBranch(branch)"
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

  <BaseModal
    :model-value="bShowCreateBranch && !!activeRepo"
    labelledby="create-branch-title"
    panel-class="max-w-sm"
    @update:model-value="bShowCreateBranch = false"
  >
    <template v-if="activeRepo">
    <form class="contents"
          @submit.prevent="createBranch"
        >
          <ModalHeader
            eyebrow="// create branch"
            title="Create branch"
            title-id="create-branch-title"
            @close="bShowCreateBranch = false"
          />
          <p class="px-6 pt-1 text-xs text-text-muted">From <span class="font-mono">{{ activeRepo.currentBranch }}</span></p>
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

  <ConfirmModal
    v-model="bShowDiscardConfirm"
    title="Discard changes"
    :description="`Discard changes in ${discardLabel}? This cannot be undone.`"
    confirm-label="Discard"
    :loading="bDiscarding"
    @confirm="confirmDiscardFiles"
  />
</template>

// node_modules
import { computed } from 'vue';
import type { Ref } from 'vue';

// types
import type { GitRepoStatus } from '@/@types/index';

/** Enabled-state of every git action; no action may start while another git operation runs. */
export function useGitActionGuards(options: {
  committingRepo: Ref<string | null>;
  pushingRepo: Ref<string | null>;
  bPulling: Ref<boolean>;
  bFetching: Ref<boolean>;
  bSwitchingBranch: Ref<boolean>;
  bCreatingBranch: Ref<boolean>;
  bDiscarding: Ref<boolean>;
  bGeneratingCommitMessage: Ref<boolean>;
  repos: Ref<GitRepoStatus[]>;
  activeRepo: Readonly<Ref<GitRepoStatus | null>>;
  commitMessage: Ref<string>;
  commitMessagesByRepo: Ref<Record<string, string>>;
  selectedFiles: Ref<Set<string>>;
  hasMixedSelection: Readonly<Ref<boolean>>;
  selectedCountInRepo: (repo: string) => number;
  selectedFilesInActiveRepo: Readonly<Ref<string[]>>;
  selectedBranch: Ref<string>;
  newBranchName: Ref<string>;
}) {
  const {
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
  } = options;

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
  const canCommit = computed(
    (): boolean =>
      !!commitMessage.value.trim() &&
      selectedFiles.value.size > 0 &&
      !gitOperationInProgress.value &&
      !hasMixedSelection.value
  );
  const canPushSingleRepo = computed(
    (): boolean => !gitOperationInProgress.value && repos.value.length === 1
  );
  const canCommitActiveRepo = computed((): boolean => {
    const r = activeRepo.value;
    if (!r || repos.value.length <= 1) return false;
    const msg = (commitMessagesByRepo.value[r.repo] ?? '').trim();
    return !!msg && selectedCountInRepo(r.repo) > 0 && !gitOperationInProgress.value;
  });
  const canPushActiveRepo = computed(
    (): boolean => !!activeRepo.value && !gitOperationInProgress.value
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
  const canGenerateCommitMessage = (targetRepo: string): boolean =>
    selectedCountInRepo(targetRepo) > 0 &&
    !gitOperationInProgress.value &&
    (repos.value.length === 1 || activeRepo.value?.repo === targetRepo);

  return {
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
  };
}

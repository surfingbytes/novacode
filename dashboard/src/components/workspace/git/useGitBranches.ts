// node_modules
import { ref, computed } from 'vue';

// classes
import { gitApi } from '@/classes/api';
import { gitBranchOptions, gitFilterBranchOptions } from './gitBranchOptions';
import type { BranchOption } from './gitBranchOptions';
import { gitErrorMessage } from './gitMessages';

// types
import type { GitBranch } from '@/@types/index';

/** Local + remote branches of the active repo, with the switch-branch search and create-branch name. */
export function useGitBranches(options: {
  getWorkspaceId: () => string;
  onError: (message: string, repo: string) => void;
}) {
  const branches = ref<GitBranch[]>([]);
  const remoteBranches = ref<string[]>([]);
  const bBranchesLoading = ref<boolean>(false);
  const selectedBranch = ref<string>('');
  const newBranchName = ref<string>('');
  const branchSearch = ref<string>('');

  const branchOptions = computed((): BranchOption[] => gitBranchOptions(branches.value, remoteBranches.value));
  const filteredBranches = computed((): BranchOption[] =>
    gitFilterBranchOptions(branchOptions.value, branchSearch.value)
  );

  const loadBranches = async (repo: string): Promise<void> => {
    bBranchesLoading.value = true;
    try {
      const response = await gitApi.branches(options.getWorkspaceId(), repo);
      branches.value = response.data.branches;
      remoteBranches.value = response.data.remoteBranches;
      selectedBranch.value = `local:${response.data.currentBranch}`;
    } catch (e: unknown) {
      options.onError(gitErrorMessage(e, 'Failed to load branches'), repo);
      branches.value = [];
      remoteBranches.value = [];
      selectedBranch.value = '';
    } finally {
      bBranchesLoading.value = false;
    }
  };

  return {
    branches,
    bBranchesLoading,
    selectedBranch,
    newBranchName,
    branchSearch,
    filteredBranches,
    loadBranches
  };
}

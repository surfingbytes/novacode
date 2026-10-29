// node_modules
import { ref } from 'vue';

// classes
import { gitApi } from '@/classes/api';
import { gitErrorMessage } from './gitMessages';

// types
import type { GitCommit } from '@/@types/index';

/** Recent commits of the active repo and the patch of the selected commit. */
export function useGitHistory(options: {
  getWorkspaceId: () => string;
  /** Repo whose history is shown (evaluated per request). */
  getRepo: () => string;
  onError: (message: string, repo: string) => void;
  /** Called before a commit's patch loads, e.g. to clear the selected changed file. */
  onOpenCommit: () => void;
}) {
  const commits = ref<GitCommit[]>([]);
  const bHistoryLoading = ref<boolean>(false);
  const selectedCommit = ref<GitCommit | null>(null);
  const commitPatch = ref<string>('');
  const bCommitPatchLoading = ref<boolean>(false);
  const commitPatchError = ref<string | null>(null);

  async function loadHistory(): Promise<void> {
    const repo = options.getRepo();
    bHistoryLoading.value = true;
    try {
      const response = await gitApi.log(options.getWorkspaceId(), repo, 80);
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
      options.onError(gitErrorMessage(e, 'Failed to load history'), repo);
    } finally {
      bHistoryLoading.value = false;
    }
  }

  async function openCommit(commit: GitCommit): Promise<void> {
    options.onOpenCommit();
    selectedCommit.value = commit;
    commitPatch.value = '';
    commitPatchError.value = null;
    bCommitPatchLoading.value = true;
    try {
      const repo = options.getRepo();
      const response = await gitApi.show(options.getWorkspaceId(), commit.hash, repo);
      commitPatch.value = response.data.patch;
    } catch (e: unknown) {
      commitPatchError.value = gitErrorMessage(e, 'Failed to load commit');
    } finally {
      bCommitPatchLoading.value = false;
    }
  }

  return {
    commits,
    bHistoryLoading,
    selectedCommit,
    commitPatch,
    bCommitPatchLoading,
    commitPatchError,
    loadHistory,
    openCommit
  };
}

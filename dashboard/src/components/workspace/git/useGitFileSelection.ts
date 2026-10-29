// node_modules
import { ref, computed } from 'vue';
import type { Ref } from 'vue';

// types
import type { GitFile, GitRepoStatus } from '@/@types/index';
import { gitFileKey as fileKey, gitParseFileKey as parseFileKey } from './gitDisplay';

/** Checked changed files (keyed by `repo::file`) across all Git roots of the workspace. */
export function useGitFileSelection(options: {
  filesInSelectedRepo: Readonly<Ref<GitFile[]>>;
  activeRepo: Readonly<Ref<GitRepoStatus | null>>;
}) {
  const { filesInSelectedRepo, activeRepo } = options;
  const selectedFiles = ref<Set<string>>(new Set());

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
  const hasMixedSelection = computed((): boolean => {
    const selectedRepos = new Set<string>();
    for (const key of selectedFiles.value) selectedRepos.add(parseFileKey(key).repo);
    return selectedRepos.size > 1;
  });
  const selectedCountInRepo = (repo: string): number =>
    [...selectedFiles.value].filter((key) => parseFileKey(key).repo === repo).length;
  const selectedFilesInActiveRepo = computed((): string[] => {
    const r = activeRepo.value;
    if (!r) return [];
    return [...selectedFiles.value]
      .map((key) => parseFileKey(key))
      .filter((entry) => entry.repo === r.repo)
      .map((entry) => entry.file);
  });

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

  return {
    selectedFiles,
    allSelected,
    someSelected,
    hasMixedSelection,
    selectedCountInRepo,
    selectedFilesInActiveRepo,
    toggleFile,
    toggleAll
  };
}

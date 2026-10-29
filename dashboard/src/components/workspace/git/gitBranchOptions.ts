import type { GitBranch } from '@/@types/index';

export type BranchOption = GitBranch & {
  key: string;
  remote: boolean;
  remoteName: string | null;
};

const localNameFromRemoteBranch = (remoteBranch: string): string => {
  const slash = remoteBranch.indexOf('/');
  return slash < 0 ? remoteBranch : remoteBranch.slice(slash + 1);
};

/** Local branches plus remote branches that have no local counterpart or tracking branch. */
export function gitBranchOptions(branches: GitBranch[], remoteBranches: string[]): BranchOption[] {
  const localNames = new Set(branches.map((branch) => branch.name));
  const upstreams = new Set(
    branches
      .map((branch) => branch.upstream)
      .filter((upstream): upstream is string => !!upstream)
  );

  const localBranches = branches.map((branch) => ({
    ...branch,
    key: `local:${branch.name}`,
    remote: false,
    remoteName: null
  }));

  const remoteOnlyBranches = remoteBranches
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
}

export function gitFilterBranchOptions(options: BranchOption[], search: string): BranchOption[] {
  const q = search.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (branch) =>
      branch.name.toLowerCase().includes(q) ||
      branch.upstream?.toLowerCase().includes(q)
  );
}

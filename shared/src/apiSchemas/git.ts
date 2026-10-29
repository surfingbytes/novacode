// node_modules
import { Type, type Static } from '@sinclair/typebox';

// ---------------------------------- Status / diff ----------------------------------
export const GitFileSchema = Type.Object({
  status: Type.String(),
  file: Type.String(),
  repo: Type.String()
});
export type GitFile = Static<typeof GitFileSchema>;

export const GitRepoStatusSchema = Type.Object({
  repo: Type.String(),
  currentBranch: Type.String(),
  upstreamBranch: Type.Union([Type.String(), Type.Null()]),
  aheadCount: Type.Number(),
  behindCount: Type.Number(),
  detached: Type.Boolean(),
  dirty: Type.Boolean(),
  files: Type.Array(GitFileSchema)
});
export type GitRepoStatus = Static<typeof GitRepoStatusSchema>;

export const GitStatusResponseSchema = Type.Object({
  files: Type.Array(GitFileSchema),
  aheadCount: Type.Number(),
  repos: Type.Array(GitRepoStatusSchema)
});
export type GitStatusResponse = Static<typeof GitStatusResponseSchema>;

export const GitDiffResponseSchema = Type.Object({ diff: Type.String() });
export type GitDiffResponse = Static<typeof GitDiffResponseSchema>;

export const GitCommitMessageResponseSchema = Type.Object({ message: Type.String() });
export type GitCommitMessageResponse = Static<typeof GitCommitMessageResponseSchema>;

// ---------------------------------- Branches / remote ----------------------------------
export const GitBranchSchema = Type.Object({
  name: Type.String(),
  current: Type.Boolean(),
  upstream: Type.Union([Type.String(), Type.Null()])
});
export type GitBranch = Static<typeof GitBranchSchema>;

export const GitBranchesResponseSchema = Type.Object({
  branches: Type.Array(GitBranchSchema),
  remoteBranches: Type.Array(Type.String()),
  currentBranch: Type.String(),
  upstreamBranch: Type.Union([Type.String(), Type.Null()]),
  detached: Type.Boolean()
});
export type GitBranchesResponse = Static<typeof GitBranchesResponseSchema>;

export const GitFetchResponseSchema = Type.Object({
  output: Type.String(),
  upToDate: Type.Boolean(),
  behindCount: Type.Number()
});
export type GitFetchResponse = Static<typeof GitFetchResponseSchema>;

export const GitPullResponseSchema = Type.Object({
  output: Type.String(),
  upToDate: Type.Boolean(),
  commitCount: Type.Number()
});
export type GitPullResponse = Static<typeof GitPullResponseSchema>;

export const GitCheckoutResponseSchema = Type.Object({ branch: Type.String() });
export type GitCheckoutResponse = Static<typeof GitCheckoutResponseSchema>;

export const GitCreateBranchResponseSchema = Type.Object({ branch: Type.String(), checkedOut: Type.Boolean() });
export type GitCreateBranchResponse = Static<typeof GitCreateBranchResponseSchema>;

export const GitPushResponseSchema = Type.Object({ output: Type.String() });
export type GitPushResponse = Static<typeof GitPushResponseSchema>;

// ---------------------------------- Changes ----------------------------------
export const GitDiscardResponseSchema = Type.Object({ discarded: Type.Array(Type.String()) });
export type GitDiscardResponse = Static<typeof GitDiscardResponseSchema>;

export const GitCommitResponseSchema = Type.Object({ hash: Type.String(), message: Type.String() });
export type GitCommitResponse = Static<typeof GitCommitResponseSchema>;

// ---------------------------------- History ----------------------------------
export const GitCommitSchema = Type.Object({
  hash: Type.String(),
  shortHash: Type.String(),
  author: Type.String(),
  date: Type.String(),
  subject: Type.String()
});
export type GitCommit = Static<typeof GitCommitSchema>;

export const GitLogResponseSchema = Type.Object({ commits: Type.Array(GitCommitSchema) });
export type GitLogResponse = Static<typeof GitLogResponseSchema>;

export const GitShowResponseSchema = Type.Object({ hash: Type.String(), patch: Type.String() });
export type GitShowResponse = Static<typeof GitShowResponseSchema>;

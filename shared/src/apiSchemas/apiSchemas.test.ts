import { describe, expect, it } from 'vitest';
import type { TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import * as schemas from './index.js';

const gitFile = { status: 'M', file: 'api/src/index.ts', repo: 'api' };
const repoStatus = {
  repo: 'api',
  currentBranch: 'main',
  upstreamBranch: 'origin/main',
  aheadCount: 1,
  behindCount: 0,
  detached: false,
  dirty: true,
  files: [gitFile]
};
const commit = { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'Nova', date: '2026-10-29T10:00:00+01:00', subject: 'Fix' };
const workspace = {
  id: 'ws-1',
  name: 'Nova',
  path: 'novacode',
  group: null,
  createdAt: '2026-10-29T10:00:00.000Z',
  defaultAgentType: 'claude',
  tags: ['api'],
  archived: false,
  isFavorite: true,
  favoriteOrder: 0,
  forgeConnectionId: null
};
const searchHit = { id: 's-1', name: 'Chat', type: 'session', workspaceId: 'ws-1', workspaceName: 'Nova' };

/** One realistic API payload per exported schema. */
const samples: Record<string, unknown> = {
  // git
  GitFileSchema: gitFile,
  GitRepoStatusSchema: repoStatus,
  GitStatusResponseSchema: { files: [gitFile], aheadCount: 1, repos: [repoStatus] },
  GitDiffResponseSchema: { diff: '@@ -1 +1 @@\n-a\n+b\n' },
  GitCommitMessageResponseSchema: { message: 'Fix typo' },
  GitBranchSchema: { name: 'main', current: true, upstream: null },
  GitBranchesResponseSchema: {
    branches: [{ name: 'main', current: true, upstream: 'origin/main' }],
    remoteBranches: ['origin/main'],
    currentBranch: 'main',
    upstreamBranch: 'origin/main',
    detached: false
  },
  GitFetchResponseSchema: { output: '', upToDate: true, behindCount: 0 },
  GitPullResponseSchema: { output: 'Fast-forward', upToDate: false, commitCount: 2 },
  GitCheckoutResponseSchema: { branch: 'feature' },
  GitCreateBranchResponseSchema: { branch: 'feature', checkedOut: true },
  GitPushResponseSchema: { output: 'Everything up-to-date' },
  GitDiscardResponseSchema: { discarded: ['api/src/index.ts'] },
  GitCommitResponseSchema: { hash: commit.hash, message: 'Fix' },
  GitCommitSchema: commit,
  GitLogResponseSchema: { commits: [commit] },
  GitShowResponseSchema: { hash: commit.hash, patch: 'commit aaaa' },
  // files
  FileEntrySchema: { name: 'src', path: 'src', isDirectory: true },
  FileListResponseSchema: { path: '.', entries: [{ name: 'a.ts', path: 'a.ts', isDirectory: false }] },
  FileReadResponseSchema: { content: 'x', path: 'a.ts', encoding: 'utf8' },
  FilePathResponseSchema: { path: 'a.ts' },
  // search
  SearchResultSchema: searchHit,
  SearchResponseSchema: { workspaces: [], sessions: [searchHit], orchestrators: [], roleTemplates: [], automations: [] },
  // sessions
  CreateSessionBodySchema: {
    name: 'Chat',
    tags: 'a, b',
    agentType: 'claude',
    modelSelection: null,
    linkedPlanContext: null,
    sessionMode: null,
    approvalPolicy: 'ask'
  },
  UpdateSessionBodySchema: { tags: ['a'], archived: true, sessionConfigJson: { mode: 'x' } },
  PlanUpdateBodySchema: { title: 'Plan', entries: [{ content: 'Step', status: 'pending' }] },
  SessionBulkIdsBodySchema: { ids: ['s-1'] },
  SessionBulkArchiveBodySchema: { ids: ['s-1'], archived: true },
  PlanUpdateResponseSchema: { ok: true },
  SessionBulkDeleteResponseSchema: { deleted: 2 },
  SessionBulkArchiveResponseSchema: { updated: 2 },
  // usage
  UsageOverviewQuerySchema: { from: '2026-10-01T00:00:00.000Z' },
  UsageOverviewSchema: {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-29T00:00:00.000Z',
    totals: { turnCount: 3, used: 1200, costAmount: 0.42, costCurrency: 'USD' },
    byWorkspace: [{ workspaceId: 'ws-1', workspaceName: 'Nova', turnCount: 3, used: 1200, costAmount: 0.42 }],
    byAgentType: [{ agentType: 'claude', turnCount: 3, used: 1200, costAmount: 0.42 }],
    byModel: [{ agentType: 'claude', model: 'auto', turnCount: 3, used: 1200, costAmount: null }],
    byDay: [{ date: '2026-10-28', turnCount: 3, used: 1200, costAmount: 0.42 }]
  },
  // workspaces
  WorkspaceSchema: workspace,
  WorkspaceListResponseSchema: [workspace],
  CreateWorkspaceBodySchema: { name: 'Nova', path: 'novacode', tags: null },
  UpdateWorkspaceBodySchema: { isFavorite: true, forgeRepo: 'org/repo' },
  WorkspaceUsageSummarySchema: { turnCount: 3, used: 1200, size: 200000, costAmount: null, costCurrency: null },
  BrowseEntrySchema: { name: 'novacode', path: 'novacode', isDirectory: true },
  WorkspaceBrowseResponseSchema: { path: '/opt/src', root: '/opt/src', entries: [] },
  WorkspaceMkdirResponseSchema: { path: '/opt/src/new' }
};

const exportedSchemas = Object.entries(schemas).filter(([name]) => name.endsWith('Schema')) as [string, TSchema][];

describe('shared API schemas', () => {
  it('has a sample payload for every exported schema', () => {
    expect(exportedSchemas.map(([name]) => name).sort()).toEqual(Object.keys(samples).sort());
  });

  it.each(exportedSchemas)('%s accepts a sample API payload', (name, schema) => {
    expect([...Value.Errors(schema, samples[name])]).toEqual([]);
    expect(Value.Check(schema, samples[name])).toBe(true);
  });

  it('rejects payloads that break the contract', () => {
    expect(Value.Check(schemas.FileReadResponseSchema, { content: 'x', path: 'a', encoding: 'latin1' })).toBe(false);
    expect(Value.Check(schemas.GitStatusResponseSchema, { files: [], aheadCount: '1', repos: [] })).toBe(false);
    expect(Value.Check(schemas.SearchResultSchema, { ...searchHit, type: 'file' })).toBe(false);
    expect(Value.Check(schemas.CreateSessionBodySchema, { modelSelection: 1 })).toBe(false);
    expect(Value.Check(schemas.CreateSessionBodySchema, { linkedPlanContext: [] })).toBe(false);
    expect(Value.Check(schemas.WorkspaceSchema, { ...workspace, archived: undefined })).toBe(false);
  });
});

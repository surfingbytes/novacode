import { describe, expect, it } from 'vitest';

import { ciBadgeState, ciBadgeTitle, ciPollIntervalMs } from './ciStatusDisplay';

import type { CiRun, CiStatusResponse } from '@/@types/index';

function run(id: number, status: CiRun['status']): CiRun {
  return { id, number: id, title: 't', status, branch: 'main', sha: null, event: null, url: null, createdAt: null, updatedAt: null };
}

function status(patch: Partial<CiStatusResponse>): CiStatusResponse {
  return {
    configured: true,
    connectionId: 'c1',
    connectionName: 'Gitea',
    provider: 'gitea',
    repo: 'o/r',
    repoSource: 'remote',
    repoUrl: null,
    runsUrl: null,
    branch: 'main',
    source: 'actions',
    lastCompleted: null,
    running: [],
    queued: [],
    queuedTotal: 0,
    fetchedAt: 0,
    ...patch
  };
}

describe('ciStatusDisplay', () => {
  it('prefers activity over the last result', () => {
    expect(ciBadgeState(status({ running: [run(2, 'running')], lastCompleted: run(1, 'failure') }))).toBe('running');
    expect(ciBadgeState(status({ queuedTotal: 2, lastCompleted: run(1, 'success') }))).toBe('queued');
    expect(ciBadgeState(status({ lastCompleted: run(1, 'failure') }))).toBe('failure');
  });

  it('hides the badge without a repo or on errors', () => {
    expect(ciBadgeState(null)).toBe('none');
    expect(ciBadgeState(status({ repo: null }))).toBe('none');
    expect(ciBadgeState(status({ error: 'boom', lastCompleted: run(1, 'success') }))).toBe('none');
  });

  it('describes the last build and polls faster while active', () => {
    expect(ciBadgeTitle(status({ lastCompleted: run(7, 'success') }))).toBe('CI: last build #7 passed');
    expect(ciPollIntervalMs(status({ queuedTotal: 1 }))).toBe(10_000);
    expect(ciPollIntervalMs(status({}))).toBe(30_000);
  });
});

import { describe, expect, it } from 'vitest';

import {
  buildFixBuildPrompt,
  cleanJobLog,
  commitStatusesToRuns,
  normalizeActionsRun,
  normalizeGitlabPipeline,
  summarizeCiRuns,
  tailLog
} from './forgeCi';
import { diffFinishedRuns } from './ciWatcher';

import type { CiRun } from '@novacode/shared';

const FORGE = 'http://gitea:3000';

function run(id: number, status: CiRun['status'], branch = 'main'): CiRun {
  return {
    id,
    number: id,
    title: `Run ${id}`,
    status,
    branch,
    sha: null,
    event: 'push',
    url: null,
    createdAt: null,
    updatedAt: null
  };
}

describe('run normalization', () => {
  it('maps Gitea/GitHub runs (status + conclusion)', () => {
    const r = normalizeActionsRun(
      {
        id: 2071,
        run_number: 1990,
        display_title: 'Fix login',
        status: 'completed',
        conclusion: 'failure',
        head_branch: 'main',
        head_sha: 'abc',
        event: 'push',
        html_url: 'http://gitea:3000/tomas/x/actions/runs/2071'
      },
      FORGE
    );
    expect(r).toMatchObject({ id: 2071, number: 1990, title: 'Fix login', status: 'failure', branch: 'main', sha: 'abc' });
  });

  it('maps Forgejo runs (single status, prettyref, relative URL)', () => {
    const r = normalizeActionsRun(
      { id: 7, index_in_repo: 3, title: 'CI', status: 'waiting', prettyref: 'feature', commit_sha: 'def', html_url: '/o/r/actions/runs/3' },
      FORGE
    );
    expect(r).toMatchObject({ number: 3, status: 'queued', branch: 'feature', sha: 'def', url: `${FORGE}/o/r/actions/runs/3` });
  });

  it('maps GitLab pipelines', () => {
    expect(
      normalizeGitlabPipeline({ id: 99, iid: 12, status: 'failed', ref: 'main', sha: 'abc', source: 'push', web_url: 'https://gitlab.com/g/p/-/pipelines/99' })
    ).toMatchObject({ id: 99, number: 12, title: 'Pipeline #12', status: 'failure', branch: 'main', event: 'push' });
    expect(normalizeGitlabPipeline({ id: 1, status: 'waiting_for_resource' })?.status).toBe('queued');
    expect(normalizeGitlabPipeline({ id: 2, status: 'canceled' })?.status).toBe('cancelled');
    expect(normalizeGitlabPipeline({ id: 3, status: 'manual' })?.status).toBe('unknown');
  });

  it('maps commit statuses (Gitea `status`, GitHub `state`), treating pending as running', () => {
    const runs = commitStatusesToRuns(
      {
        sha: 'abc',
        statuses: [
          { id: 1, state: 'success', context: 'lint', updated_at: '2026-01-01T00:00:00Z' },
          { id: 2, status: 'pending', context: 'ci/woodpecker', target_url: 'https://ci/1', updated_at: '2026-01-01T00:01:00Z' }
        ]
      },
      FORGE,
      'main'
    );
    expect(runs.map((r) => [r.title, r.status])).toEqual([
      ['ci/woodpecker', 'running'],
      ['lint', 'success']
    ]);
  });
});

describe('summarizeCiRuns', () => {
  it('splits running, newest-first queue (next 3 in line) and last finished on the branch', () => {
    const runs = [
      run(9, 'queued'),
      run(8, 'queued'),
      run(7, 'queued'),
      run(6, 'queued'),
      run(5, 'running'),
      run(4, 'success', 'other'),
      run(3, 'skipped'),
      run(2, 'failure'),
      run(1, 'success')
    ];
    const summary = summarizeCiRuns(runs, 'main');
    expect(summary.running.map((r) => r.id)).toEqual([5]);
    expect(summary.queued.map((r) => r.id)).toEqual([8, 7, 6]);
    expect(summary.queuedTotal).toBe(4);
    expect(summary.lastCompleted?.id).toBe(2);
  });

  it('prefers a real result over a manual (unknown) pipeline', () => {
    expect(summarizeCiRuns([run(2, 'unknown'), run(1, 'success')], 'main').lastCompleted?.id).toBe(1);
  });
});

describe('fix-build prompt', () => {
  it('strips runner timestamps, ANSI codes and GitLab section markers', () => {
    expect(cleanJobLog('2026-10-19T07:18:11.1234567Z \u001b[31merror\u001b[0m TS2345')).toBe('error TS2345');
    expect(cleanJobLog('section_start:1700000000:build_script\r\u001b[0K$ npm test\nboom')).toBe('$ npm test\nboom');
  });

  it('tails long logs', () => {
    const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    expect(tailLog(long, 3)).toBe('line 497\nline 498\nline 499');
  });

  it('fences logs safely, names failed steps and links the run', () => {
    const prompt = buildFixBuildPrompt({
      repo: 'o/r',
      branch: 'main',
      run: run(12, 'failure'),
      runUrl: 'http://gitea:3000/o/r/actions/runs/12',
      jobs: [{ name: 'build', log: 'has ``` inside', failedSteps: ['Unit tests'] }]
    });
    expect(prompt).toContain('branch `main` of `o/r` failed');
    expect(prompt).toContain('http://gitea:3000/o/r/actions/runs/12');
    expect(prompt).toContain('`build` (failed step: Unit tests)');
    expect(prompt).toContain('````text\nhas ``` inside\n````');
  });
});

describe('ciWatcher.diffFinishedRuns', () => {
  it('reports only runs that were active before and finished now', () => {
    const previous = new Map([
      [1, run(1, 'running')],
      [2, run(2, 'queued')]
    ]);
    const finished = diffFinishedRuns(previous, [run(1, 'success'), run(2, 'running'), run(3, 'failure')]);
    expect(finished.map((r) => r.id)).toEqual([1]);
    expect(diffFinishedRuns(null, [run(1, 'success')])).toEqual([]);
  });
});

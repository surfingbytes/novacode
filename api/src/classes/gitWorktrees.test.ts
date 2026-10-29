import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addWorktree,
  applyCommitRangeToWorkingTree,
  branchExists,
  changedFiles,
  commitAll,
  concludeMerge,
  condenseApplyError,
  filesWithConflictMarkers,
  createSnapshotCommit,
  git,
  headCommit,
  linkIgnoredEntries,
  mergeBranch,
  resolveRepo
} from './gitWorktrees';

const ENV = {
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com'
};

let root: string;
let repo: string;

async function sh(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args, { env: ENV });
  if (result.code !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'nova-wt-test-'));
  repo = join(root, 'repo');
  await mkdir(join(repo, 'node_modules', 'dep'), { recursive: true });
  await sh(root, ['init', '-q', '-b', 'main', repo]);
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n.env\n');
  await writeFile(join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  await writeFile(join(repo, '.env'), 'SECRET=1\n');
  await sh(repo, ['add', '-A']);
  await sh(repo, ['commit', '-q', '-m', 'init']);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('gitWorktrees', () => {
  it('rejects non-repositories', async () => {
    const plain = join(root, 'plain');
    await mkdir(plain);
    expect(await resolveRepo(plain)).toHaveProperty('error');
    expect(await resolveRepo(repo)).toEqual({ root: repo, subdir: '' });
  });

  it('snapshots uncommitted work without touching the index, runs steps in worktrees and applies the merge', async () => {
    // Uncommitted edit + untracked file in the user's tree.
    await writeFile(join(repo, 'a.txt'), 'one\ntwo\nthree\nfour (wip)\n');
    await writeFile(join(repo, 'new.txt'), 'untracked\n');
    const statusBefore = await sh(repo, ['status', '--porcelain']);

    const base = await createSnapshotCommit(repo, ENV);
    expect(await sh(repo, ['status', '--porcelain'])).toBe(statusBefore);
    expect(await sh(repo, ['show', `${base}:new.txt`])).toBe('untracked');

    const integration = join(root, 'wt', 'integration');
    await addWorktree(repo, integration, 'nova/test/integration', base);

    // Two parallel steps editing different files.
    const step1 = join(root, 'wt', 'step-1');
    const step2 = join(root, 'wt', 'step-2');
    await addWorktree(repo, step1, 'nova/test/step-1', base);
    await addWorktree(repo, step2, 'nova/test/step-2', base);
    const linked = await linkIgnoredEntries(repo, step1);
    expect(linked.sort()).toEqual(['.env', 'node_modules']);
    expect(lstatSync(join(step1, 'node_modules')).isSymbolicLink()).toBe(true);

    await writeFile(join(step1, 'b.txt'), 'from step 1\n');
    await writeFile(join(step2, 'c.txt'), 'from step 2\n');
    expect(await commitAll(step1, 'step 1', ENV, linked)).toBe(true);
    expect(await commitAll(step2, 'step 2', ENV)).toBe(true);
    expect(await sh(step1, ['show', '--name-only', '--format=', 'HEAD'])).toBe('b.txt');

    expect(await mergeBranch(integration, 'nova/test/step-1', 'merge 1', ENV)).toEqual({ ok: true });
    expect(await mergeBranch(integration, 'nova/test/step-2', 'merge 2', ENV)).toEqual({ ok: true });

    expect(await branchExists(repo, 'nova/test/integration')).toBe(true);
    expect(await branchExists(repo, 'nova/test/nope')).toBe(false);
    expect((await changedFiles(repo, base, 'nova/test/integration')).sort()).toEqual(['b.txt', 'c.txt']);

    // A branch name works as the range end, like a commit.
    const applied = await applyCommitRangeToWorkingTree(repo, base, 'nova/test/integration');
    expect(applied).toEqual({ ok: true, bChanged: true });
    expect(await filesWithConflictMarkers(repo, ['b.txt', 'c.txt'])).toEqual([]);
    expect(await readFile(join(repo, 'b.txt'), 'utf8')).toBe('from step 1\n');
    expect(await readFile(join(repo, 'c.txt'), 'utf8')).toBe('from step 2\n');
    // The user's own uncommitted work is still there, still uncommitted.
    expect(await readFile(join(repo, 'a.txt'), 'utf8')).toContain('four (wip)');
    expect((await sh(repo, ['log', '--format=%s'])).split('\n')).toEqual(['init']);
  });

  it('leaves conflicting merges in progress and concludes them once resolved', async () => {
    const base = await headCommit(repo);
    const integration = join(root, 'wt', 'integration');
    await addWorktree(repo, integration, 'nova/test/integration', base);
    const step1 = join(root, 'wt', 'step-1');
    const step2 = join(root, 'wt', 'step-2');
    await addWorktree(repo, step1, 'nova/test/step-1', base);
    await addWorktree(repo, step2, 'nova/test/step-2', base);
    await writeFile(join(step1, 'a.txt'), 'one\nTWO by 1\nthree\n');
    await writeFile(join(step2, 'a.txt'), 'one\nTWO by 2\nthree\n');
    await commitAll(step1, 'step 1', ENV);
    await commitAll(step2, 'step 2', ENV);

    expect(await mergeBranch(integration, 'nova/test/step-1', 'merge 1', ENV)).toEqual({ ok: true });
    const conflicted = await mergeBranch(integration, 'nova/test/step-2', 'merge 2', ENV);
    expect(conflicted).toMatchObject({ ok: false, conflicts: ['a.txt'] });
    expect(await concludeMerge(integration, ENV)).toBe(false);

    await writeFile(join(integration, 'a.txt'), 'one\nTWO by 1 and 2\nthree\n');
    expect(await concludeMerge(integration, ENV)).toBe(true);
    expect(existsSync(join(integration, '.git'))).toBe(true);
    expect(await sh(integration, ['show', 'HEAD:a.txt'])).toContain('TWO by 1 and 2');
  });

  it('reports a short error when the merged result conflicts with the workspace', async () => {
    const base = await headCommit(repo);
    const step1 = join(root, 'wt', 'step-1');
    await addWorktree(repo, step1, 'nova/test/step-1', base);
    await writeFile(join(step1, 'a.txt'), 'one\nTWO by step\nthree\n');
    await commitAll(step1, 'step 1', ENV);
    // The user changed the same line meanwhile.
    await writeFile(join(repo, 'a.txt'), 'one\nTWO by user\nthree\n');

    const applied = await applyCommitRangeToWorkingTree(repo, base, 'nova/test/step-1');
    expect(applied.ok).toBe(false);
    const error = !applied.ok ? applied.error : '';
    expect(error).toContain('a.txt');
    expect(error).not.toContain('Falling back');
    expect(error.split('\n').length).toBeLessThanOrEqual(13);
    const conflicted = await filesWithConflictMarkers(repo, ['a.txt']);
    // Either the three-way apply left markers, or nothing was applied; both are recoverable by the merge agent.
    expect(conflicted.length === 0 || conflicted[0] === 'a.txt').toBe(true);
  });
});

describe('condenseApplyError', () => {
  it('keeps the error lines and drops the per-file chatter', () => {
    const output = [
      "Applied patch to 'a.ts' cleanly.",
      'Falling back to direct application...',
      'error: patch failed: b.ts:10',
      'error: b.ts: patch does not apply',
      'Falling back to direct application...',
      "Applied patch to 'c.ts' cleanly.",
      'error: patch failed: b.ts:10'
    ].join('\n');
    expect(condenseApplyError(output)).toBe('error: patch failed: b.ts:10\nerror: b.ts: patch does not apply');
  });

  it('caps the number of lines', () => {
    const output = Array.from({ length: 20 }, (_, i) => `error: patch failed: f${i}.ts:1`).join('\n');
    const lines = condenseApplyError(output).split('\n');
    expect(lines).toHaveLength(13);
    expect(lines[12]).toBe('… and 8 more');
  });
});

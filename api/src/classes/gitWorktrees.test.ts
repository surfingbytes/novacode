import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  addWorktree,
  applyCommitRangeToWorkingTree,
  commitAll,
  concludeMerge,
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

    const applied = await applyCommitRangeToWorkingTree(repo, base, await headCommit(integration));
    expect(applied).toEqual({ ok: true, bChanged: true });
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
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_WORKSPACE_BROWSE_ROOT } from '@novacode/shared';

import {
  isDotEntry,
  joinWorkspaceRelative,
  normalizeRelativePath,
  resolveInsideWorkspace,
  resolveRealInsideWorkspace
} from './workspaceFs';

describe('isDotEntry', () => {
  it('treats dotfiles and dotdirs as hidden', () => {
    expect(isDotEntry('.env')).toBe(true);
    expect(isDotEntry('.cursor')).toBe(true);
    expect(isDotEntry('src')).toBe(false);
    expect(isDotEntry('.')).toBe(false);
    expect(isDotEntry('..')).toBe(false);
  });
});

describe('resolveInsideWorkspace', () => {
  const root = `${DEFAULT_WORKSPACE_BROWSE_ROOT}/acme`;

  it('resolves a nested file', () => {
    const resolved = resolveInsideWorkspace(root, 'src/.env');
    expect(resolved).toEqual({
      absolutePath: `${root}/src/.env`,
      relativePath: 'src/.env'
    });
  });

  it('rejects parent traversal', () => {
    expect(resolveInsideWorkspace(root, '../other')).toEqual({ error: 'Invalid path' });
    expect(resolveInsideWorkspace(root, 'src/../../etc/passwd')).toEqual({ error: 'Invalid path' });
  });

  it('allows the workspace root', () => {
    expect(resolveInsideWorkspace(root, '')).toEqual({
      absolutePath: root,
      relativePath: ''
    });
  });
});

describe('joinWorkspaceRelative', () => {
  it('joins under a parent or at root', () => {
    expect(joinWorkspaceRelative('src', 'lib')).toBe('src/lib');
    expect(joinWorkspaceRelative('', '.env')).toBe('.env');
    expect(normalizeRelativePath('/a//b/')).toBe('a/b');
  });
});

describe('resolveRealInsideWorkspace', () => {
  let tempRoot: string;
  let workspace: string;

  beforeAll(async () => {
    tempRoot = await realpath(await mkdtemp(join(tmpdir(), 'nova-wsfs-')));
    workspace = join(tempRoot, 'ws');
    const outside = join(tempRoot, 'outside');
    await mkdir(join(workspace, 'src'), { recursive: true });
    await mkdir(outside);
    await writeFile(join(workspace, 'src', 'a.txt'), 'a');
    await symlink(outside, join(workspace, 'escape'));
    await symlink(join(workspace, 'src'), join(workspace, 'inner-link'));
    await symlink(join(outside, 'missing'), join(workspace, 'dangling'));
  });

  afterAll(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('accepts existing and not-yet-existing nested paths', async () => {
    expect(await resolveRealInsideWorkspace(workspace, 'src/a.txt')).toEqual({
      absolutePath: join(workspace, 'src', 'a.txt'),
      relativePath: 'src/a.txt'
    });
    expect(await resolveRealInsideWorkspace(workspace, 'src/new/deep/b.txt')).toMatchObject({
      relativePath: 'src/new/deep/b.txt'
    });
  });

  it('accepts symlinks that stay inside the workspace', async () => {
    expect(await resolveRealInsideWorkspace(workspace, 'inner-link/a.txt')).toMatchObject({
      relativePath: 'inner-link/a.txt'
    });
  });

  it('rejects symlinks that lead outside, for existing and new targets', async () => {
    expect(await resolveRealInsideWorkspace(workspace, 'escape')).toMatchObject({ status: 403 });
    expect(await resolveRealInsideWorkspace(workspace, 'escape/new/file.txt')).toMatchObject({ status: 403 });
  });

  it('rejects dangling symlinks', async () => {
    expect(await resolveRealInsideWorkspace(workspace, 'dangling')).toMatchObject({ status: 403 });
    expect(await resolveRealInsideWorkspace(workspace, 'dangling/x')).toMatchObject({ status: 403 });
  });

  it('keeps lexical traversal a 400', async () => {
    expect(await resolveRealInsideWorkspace(workspace, '../outside')).toEqual({ error: 'Invalid path', status: 400 });
  });

  it('accepts a symlinked workspace root', async () => {
    const rootLink = join(tempRoot, 'ws-link');
    await symlink(workspace, rootLink);
    expect(await resolveRealInsideWorkspace(rootLink, 'src/a.txt')).toMatchObject({ relativePath: 'src/a.txt' });
  });
});

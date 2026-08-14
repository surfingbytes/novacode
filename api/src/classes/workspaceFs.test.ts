import { describe, expect, it } from 'vitest';

import {
  isDotEntry,
  joinWorkspaceRelative,
  normalizeRelativePath,
  resolveInsideWorkspace
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
  const root = '/data-root/acme';

  it('resolves a nested file', () => {
    const resolved = resolveInsideWorkspace(root, 'src/.env');
    expect(resolved).toEqual({
      absolutePath: '/data-root/acme/src/.env',
      relativePath: 'src/.env'
    });
  });

  it('rejects parent traversal', () => {
    expect(resolveInsideWorkspace(root, '../other')).toEqual({ error: 'Invalid path' });
    expect(resolveInsideWorkspace(root, 'src/../../etc/passwd')).toEqual({ error: 'Invalid path' });
  });

  it('allows the workspace root', () => {
    expect(resolveInsideWorkspace(root, '')).toEqual({
      absolutePath: '/data-root/acme',
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

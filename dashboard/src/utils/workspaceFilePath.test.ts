// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { ancestorDirectoryPaths, toWorkspaceRelativePath } from '@/utils/workspaceFilePath';
import { DEFAULT_WORKSPACE_BROWSE_ROOT } from '@/@types/index';

describe('toWorkspaceRelativePath', () => {
  const workspace = `${DEFAULT_WORKSPACE_BROWSE_ROOT}/opt/src/novacode`;

  it('strips the workspace root from an absolute path', () => {
    expect(toWorkspaceRelativePath(`${workspace}/api/src/index.ts`, workspace)).toBe(
      'api/src/index.ts'
    );
  });

  it('keeps already-relative paths', () => {
    expect(toWorkspaceRelativePath('dashboard/src/App.vue', workspace)).toBe(
      'dashboard/src/App.vue'
    );
  });

  it('rejects globs, quoted grep summaries, and non-paths', () => {
    expect(toWorkspaceRelativePath('**/*.ts', workspace)).toBeNull();
    expect(toWorkspaceRelativePath('"pattern"  src', workspace)).toBeNull();
    expect(toWorkspaceRelativePath('echo hello', workspace)).toBeNull();
  });
});

describe('ancestorDirectoryPaths', () => {
  it('returns each parent directory', () => {
    expect(ancestorDirectoryPaths('api/src/routes/chat.ts')).toEqual([
      'api',
      'api/src',
      'api/src/routes'
    ]);
  });

  it('returns nothing for a top-level file', () => {
    expect(ancestorDirectoryPaths('README.md')).toEqual([]);
  });
});

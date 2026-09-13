import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

describe('workspacePaths', () => {
  const originalEnv = process.env['WORKSPACE_BROWSE_ROOT'];

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['WORKSPACE_BROWSE_ROOT'];
    } else {
      process.env['WORKSPACE_BROWSE_ROOT'] = originalEnv;
    }
    vi.resetModules();
  });

  it('resolves relative paths under the configured browse root', async () => {
    process.env['WORKSPACE_BROWSE_ROOT'] = '/opt';
    const { resolveWorkspaceAbsolutePath, normalizeWorkspaceRelativePath, isPathUnderBrowseRoot } =
      await import('./workspacePaths');

    expect(normalizeWorkspaceRelativePath('')).toBe('.');
    expect(normalizeWorkspaceRelativePath('/')).toBe('.');
    expect(normalizeWorkspaceRelativePath('src/foo')).toBe('src/foo');
    expect(resolveWorkspaceAbsolutePath('.')).toBe('/opt');
    expect(resolveWorkspaceAbsolutePath('src/foo')).toBe('/opt/src/foo');
    expect(isPathUnderBrowseRoot('/opt')).toBe(true);
    expect(isPathUnderBrowseRoot('/opt/src')).toBe(true);
    expect(isPathUnderBrowseRoot('/etc')).toBe(false);
  });

  it('defaults browse root when WORKSPACE_BROWSE_ROOT is unset', async () => {
    delete process.env['WORKSPACE_BROWSE_ROOT'];
    const { DEFAULT_WORKSPACE_BROWSE_ROOT } = await import('./config');
    const { resolveWorkspaceAbsolutePath } = await import('./workspacePaths');
    expect(resolveWorkspaceAbsolutePath('opt/src/foo')).toBe(
      `${DEFAULT_WORKSPACE_BROWSE_ROOT}/opt/src/foo`
    );
  });
});

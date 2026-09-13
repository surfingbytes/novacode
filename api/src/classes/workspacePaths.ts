// node_modules
import { join, normalize, resolve } from 'node:path';

// classes
import { config } from './config';

/** Normalize a stored workspace path: relative to browse root, no leading slash; empty → `.`. */
export function normalizeWorkspaceRelativePath(path: string): string {
  const trimmed = path.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed === '/') {
    return '.';
  }
  const relative = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
  return relative || '.';
}

/** Absolute filesystem path for a workspace (browse root + relative path). */
export function resolveWorkspaceAbsolutePath(workspacePath: string): string {
  const rel = normalizeWorkspaceRelativePath(workspacePath);
  return resolve(config.workspaceBrowseRoot, rel === '.' ? '.' : rel);
}

/** True when `absolutePath` is the browse root or a path under it. */
export function isPathUnderBrowseRoot(absolutePath: string): boolean {
  const root = resolve(config.workspaceBrowseRoot);
  const rootNorm = normalize(root).replace(/\\/g, '/').replace(/\/+$/, '');
  const resolvedNorm = normalize(resolve(absolutePath)).replace(/\\/g, '/').replace(/\/+$/, '');
  return resolvedNorm === rootNorm || resolvedNorm.startsWith(rootNorm + '/');
}

/**
 * Relativize an absolute path to the browse root for storage.
 * Returns `.` when the path is the browse root itself.
 */
export function relativizeToBrowseRoot(absolutePath: string): string {
  const root = resolve(config.workspaceBrowseRoot);
  const rootNorm = normalize(root).replace(/\\/g, '/').replace(/\/+$/, '');
  const absNorm = normalize(resolve(absolutePath)).replace(/\\/g, '/').replace(/\/+$/, '');
  if (absNorm === rootNorm) {
    return '.';
  }
  if (!absNorm.startsWith(rootNorm + '/')) {
    throw new Error('Path is outside the workspace browse root');
  }
  return absNorm.slice(rootNorm.length + 1);
}

/** Join browse root with a relative path using POSIX-style normalization for display/cwd. */
export function joinBrowseRoot(relativePath: string): string {
  const rel = normalizeWorkspaceRelativePath(relativePath);
  if (rel === '.') {
    return resolve(config.workspaceBrowseRoot);
  }
  return join(resolve(config.workspaceBrowseRoot), rel);
}

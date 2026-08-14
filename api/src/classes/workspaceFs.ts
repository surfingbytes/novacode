// node_modules
import { normalize, resolve } from 'node:path';

export interface ResolvedWorkspacePath {
  absolutePath: string;
  relativePath: string;
}

function posixNorm(path: string): string {
  return normalize(path).replace(/\\/g, '/');
}

export function isDotEntry(name: string): boolean {
  return name.startsWith('.') && name !== '.' && name !== '..';
}

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function joinWorkspaceRelative(parentPath: string, name: string): string {
  const parent = normalizeRelativePath(parentPath);
  const trimmedName = name.trim();
  if (!parent || parent === '.') {
    return trimmedName;
  }
  return `${parent}/${trimmedName}`;
}

/**
 * Resolve a workspace-relative path and reject traversal outside the workspace root.
 * An empty relative path is the workspace root itself.
 */
export function resolveInsideWorkspace(
  workspaceAbsolute: string,
  relativePath: string
): ResolvedWorkspacePath | { error: string } {
  const baseNorm = posixNorm(workspaceAbsolute).replace(/\/?$/, '');
  const relative = normalizeRelativePath(relativePath);
  if (relative.split('/').some((segment) => segment === '..')) {
    return { error: 'Invalid path' };
  }
  const targetPath = resolve(workspaceAbsolute, relative || '.');
  const targetNorm = posixNorm(targetPath);
  if (targetNorm !== baseNorm && !targetNorm.startsWith(`${baseNorm}/`)) {
    return { error: 'Invalid path' };
  }
  return {
    absolutePath: targetPath,
    relativePath: relative
  };
}

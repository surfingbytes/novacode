// node_modules
import { lstat, realpath } from 'node:fs/promises';
import { dirname, normalize, resolve } from 'node:path';

/** Files above this size are not sent to the editor (413). */
export const MAX_FILE_READ_BYTES = 5 * 1024 * 1024;

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

function isInsideRoot(rootReal: string, candidate: string): boolean {
  const rootNorm = posixNorm(rootReal).replace(/\/?$/, '');
  const candidateNorm = posixNorm(candidate);
  return candidateNorm === rootNorm || candidateNorm.startsWith(`${rootNorm}/`);
}

/** Realpath of `path`, or of its nearest existing ancestor when it does not exist yet. */
async function realpathOfNearestExisting(path: string): Promise<string | null> {
  let candidate = path;
  for (;;) {
    let bExists = true;
    try {
      await lstat(candidate);
    } catch {
      bExists = false;
    }
    if (bExists) {
      try {
        return await realpath(candidate);
      } catch {
        // Dangling symlink — writing through it could land anywhere.
        return null;
      }
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      return null;
    }
    candidate = parent;
  }
}

/**
 * Like {@link resolveInsideWorkspace}, but also follows symlinks: the realpath of the
 * target (or, for paths that do not exist yet, of its nearest existing ancestor) must stay
 * inside the realpath of the workspace root.
 */
export async function resolveRealInsideWorkspace(
  workspaceAbsolute: string,
  relativePath: string
): Promise<ResolvedWorkspacePath | { error: string; status: 400 | 403 | 404 }> {
  const resolved = resolveInsideWorkspace(workspaceAbsolute, relativePath);
  if ('error' in resolved) {
    return { error: resolved.error, status: 400 };
  }
  let rootReal: string;
  try {
    rootReal = await realpath(workspaceAbsolute);
  } catch {
    return { error: 'Workspace path not found', status: 404 };
  }
  const targetReal = await realpathOfNearestExisting(resolved.absolutePath);
  // Symlinks must not lead out of the workspace.
  if (!targetReal || !isInsideRoot(rootReal, targetReal)) {
    return { error: 'Path is outside the workspace', status: 403 };
  }
  return resolved;
}

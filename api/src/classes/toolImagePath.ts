/**
 * Resolves an image a tool read (e.g. Claude's Read on a JPEG) so the chat can
 * show it from disk — the base64 copy is stripped from stored events.
 */

// node_modules
import { realpath } from 'node:fs/promises';
import { extname, isAbsolute, resolve } from 'node:path';

// classes
import { isUnderWorktreesRoot } from './gitWorktrees';
import { isPathUnderBrowseRoot } from './workspacePaths';

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

function isAllowedRoot(path: string): boolean {
  return isPathUnderBrowseRoot(path) || isUnderWorktreesRoot(path);
}

export async function resolveToolImagePath(
  path: string
): Promise<{ absolutePath: string; contentType: string } | { error: string; status: 400 | 403 | 404 }> {
  if (!isAbsolute(path)) {
    return { error: 'Path must be absolute', status: 400 };
  }
  const contentType = IMAGE_CONTENT_TYPES[extname(path).toLowerCase()];
  if (!contentType) {
    return { error: 'Not an image', status: 400 };
  }
  if (!isAllowedRoot(resolve(path))) {
    return { error: 'Path is outside the workspaces', status: 403 };
  }
  let absolutePath: string;
  try {
    absolutePath = await realpath(path);
  } catch {
    return { error: 'File not found', status: 404 };
  }
  // Symlinks must not lead out of the allowed roots.
  if (!isAllowedRoot(absolutePath)) {
    return { error: 'Path is outside the workspaces', status: 403 };
  }
  return { absolutePath, contentType };
}

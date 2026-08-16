/**
 * Last-opened workspace file path (files tab). Only the path is remembered —
 * never file contents. The editor always re-reads from disk when the pane
 * opens. Shared across sessions in the same workspace; a different workspace
 * starts with no selection.
 */

// lib
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/safeLocalStorage';

const KEY_PREFIX = 'novacode:filesOpenPath:';

export function filesOpenPathStorageKey(workspaceId: string): string {
  return `${KEY_PREFIX}${workspaceId}`;
}

export function readFilesOpenPath(workspaceId: string): string | null {
  const raw = safeGetItem(filesOpenPathStorageKey(workspaceId));
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed || null;
}

export function writeFilesOpenPath(workspaceId: string, path: string | null): void {
  const key = filesOpenPathStorageKey(workspaceId);
  if (!path || !path.trim()) {
    safeRemoveItem(key);
    return;
  }
  safeSetItem(key, path.trim());
}

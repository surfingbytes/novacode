/**
 * Drop per-session / per-orchestrator local data when the entity is deleted,
 * or all of it on logout.
 */

// lib
import { clearAllFilesOpenPaths } from '@/lib/filesOpenPath';
import { clearAllDraftPrompts, clearDraftsForEntityId, clearSessionPrompt } from '@/lib/pendingSessionPrompt';
import { clearAllSessionCaches, removeSessionCache, removeSessionCachesForId } from '@/lib/sessionCache';

export function forgetSessionLocalState(workspaceId: string, sessionId: string): void {
  removeSessionCache(workspaceId, sessionId);
  clearSessionPrompt(workspaceId, sessionId);
}

export function forgetLocalStateForId(id: string): void {
  removeSessionCachesForId(id);
  clearDraftsForEntityId(id);
}

/**
 * Logout: remove user content (chat snapshots, drafts, open file paths) from
 * this device. UI preferences (theme, view modes, pane layout) stay.
 */
export function clearAllUserLocalState(): void {
  clearAllSessionCaches();
  clearAllDraftPrompts();
  clearAllFilesOpenPaths();
}

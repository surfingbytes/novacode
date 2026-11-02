/**
 * Drop per-session / per-orchestrator local data when the entity is deleted,
 * or all of it on logout.
 */

// lib
import { clearAllFilesOpenPaths } from '@/lib/filesOpenPath';
import { clearListCaches } from '@/lib/listCache';
import { clearAllOfflinePrompts, removeOfflinePromptsForId } from '@/lib/offlinePrompts';
import { clearAllDraftPrompts, clearDraftsForEntityId, clearSessionPrompt } from '@/lib/pendingSessionPrompt';
import { clearAllSessionCaches, removeSessionCache, removeSessionCachesForId } from '@/lib/sessionCache';

export function forgetSessionLocalState(workspaceId: string, sessionId: string): void {
  removeSessionCache(workspaceId, sessionId);
  clearSessionPrompt(workspaceId, sessionId);
}

export function forgetLocalStateForId(id: string): void {
  removeSessionCachesForId(id);
  removeOfflinePromptsForId(id);
  clearDraftsForEntityId(id);
}

/**
 * Logout: remove user content (chat snapshots, lists, drafts, unsent prompts, open file paths) from
 * this device. UI preferences (theme, view modes, pane layout) stay.
 */
export function clearAllUserLocalState(): void {
  clearAllSessionCaches();
  clearListCaches();
  clearAllOfflinePrompts();
  clearAllDraftPrompts();
  clearAllFilesOpenPaths();
}

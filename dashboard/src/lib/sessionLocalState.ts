/**
 * Drop per-session / per-orchestrator local data when the entity is deleted.
 */

// lib
import { clearDraftsForEntityId, clearSessionPrompt } from '@/lib/pendingSessionPrompt';
import { removeSessionCache, removeSessionCachesForId } from '@/lib/sessionCache';

export function forgetSessionLocalState(workspaceId: string, sessionId: string): void {
  removeSessionCache(workspaceId, sessionId);
  clearSessionPrompt(workspaceId, sessionId);
}

export function forgetLocalStateForId(id: string): void {
  removeSessionCachesForId(id);
  clearDraftsForEntityId(id);
}

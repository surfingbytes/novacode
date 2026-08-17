// classes
import { db } from './database';
import { broadcastSessionListUpsert } from './sessionListBroadcast';

import type { SessionModel as Session } from '../generated/client/models/Session';

async function persistAndBroadcastUnread(
  sessionId: string,
  unread: boolean
): Promise<Session | undefined> {
  const updated = await db.setSessionUnread(sessionId, unread);
  if (updated) {
    broadcastSessionListUpsert(updated.workspaceId, updated);
  }
  return updated;
}

/** Clear unread when a client opens (or reconnects to) this session. */
export async function markSessionRead(sessionId: string): Promise<Session | undefined> {
  return persistAndBroadcastUnread(sessionId, false);
}

/**
 * After a run finishes: mark unread unless a chat client is currently viewing.
 * Viewers mark the session read themselves (and via chat WebSocket connect).
 */
export async function markSessionFinishedUnread(
  sessionId: string,
  hasViewers: boolean
): Promise<Session | undefined> {
  if (hasViewers) {
    return undefined;
  }
  return persistAndBroadcastUnread(sessionId, true);
}

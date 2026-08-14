// classes
import { normalizeSessionForApi } from './sessionNormalize';

type Broadcaster = (workspaceId: string, session: unknown) => void;

let broadcaster: Broadcaster | null = null;

export function registerSessionListBroadcaster(fn: Broadcaster): void {
  broadcaster = fn;
}

/** Push list-shaped session to clients (chat rows are not included). */
export function broadcastSessionListUpsert(workspaceId: string, session: { tags?: unknown }): void {
  if (!broadcaster) {
    return;
  }
  broadcaster(workspaceId, normalizeSessionForApi(session));
}

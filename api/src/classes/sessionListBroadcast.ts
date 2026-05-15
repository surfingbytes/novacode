// classes
import { normalizeSessionForApi } from './sessionNormalize';

type Broadcaster = (workspaceId: string, session: unknown) => void;

let broadcaster: Broadcaster | null = null;

export function registerSessionListBroadcaster(fn: Broadcaster): void {
  broadcaster = fn;
}

/** Push list-shaped session to clients (omit heavy `messageJson`). */
export function broadcastSessionListUpsert(workspaceId: string, session: { tags?: unknown; messageJson?: string }): void {
  if (!broadcaster) {
    return;
  }
  const normalized = normalizeSessionForApi(session);
  const { messageJson: _omit, ...rest } = normalized as typeof normalized & { messageJson?: string };
  broadcaster(workspaceId, rest);
}

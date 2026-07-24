/**
 * Per-session snapshot cache (localStorage) — lets the session view show the
 * last known chat + plan instantly after a cold start (e.g. Android killed the
 * PWA while it was in the background) while fresh data revalidates over
 * REST/WebSocket.
 *
 * Deliberately small and best-effort: only the latest messages are kept,
 * bulky client-only fields are stripped, and all failures (quota, private
 * mode, corrupt JSON) are swallowed.
 */

// types
import type { ChatMessage, Session } from '@/@types/index';

const CACHE_VERSION = 1;
const KEY_PREFIX = 'nova:sessionCache:';
const MAX_CACHED_MESSAGES = 50;
const RETRY_CACHED_MESSAGES = 10;

export interface SessionCacheSnapshot {
  session: Session | null;
  messages: ChatMessage[];
  bHasMore: boolean;
}

interface SessionCachePayload extends SessionCacheSnapshot {
  version: number;
  cachedAt: string;
}

function cacheKey(workspaceId: string, sessionId: string): string {
  return `${KEY_PREFIX}${workspaceId}:${sessionId}`;
}

export function readSessionCache(
  workspaceId: string,
  sessionId: string
): SessionCacheSnapshot | null {
  try {
    const raw = localStorage.getItem(cacheKey(workspaceId, sessionId));
    if (!raw) {
      return null;
    }
    const payload = JSON.parse(raw) as SessionCachePayload;
    if (payload?.version !== CACHE_VERSION || !Array.isArray(payload.messages)) {
      return null;
    }
    return {
      session: payload.session ?? null,
      messages: payload.messages,
      bHasMore: payload.bHasMore === true
    };
  } catch {
    return null;
  }
}

export function writeSessionCache(
  workspaceId: string,
  sessionId: string,
  snapshot: SessionCacheSnapshot
): void {
  // Nothing worth keeping — never clobber an existing snapshot with emptiness.
  if (!snapshot.session && snapshot.messages.length === 0) {
    return;
  }
  const base: SessionCachePayload = {
    version: CACHE_VERSION,
    cachedAt: new Date().toISOString(),
    // messageJson duplicates the whole history — the messages are cached separately.
    session: snapshot.session ? { ...snapshot.session, messageJson: undefined } : null,
    // imageDataUrls hold base64 image payloads and are only needed pre-round-trip.
    messages: snapshot.messages.map((m) => {
      if (!m.imageDataUrls) {
        return m;
      }
      const copy = { ...m };
      delete copy.imageDataUrls;
      return copy;
    }),
    bHasMore: snapshot.bHasMore
  };
  for (const limit of [MAX_CACHED_MESSAGES, RETRY_CACHED_MESSAGES]) {
    try {
      const payload = { ...base, messages: base.messages.slice(-limit) };
      localStorage.setItem(cacheKey(workspaceId, sessionId), JSON.stringify(payload));
      return;
    } catch {
      // quota exceeded — retry with fewer messages, then give up silently
    }
  }
}

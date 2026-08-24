// types
import type { Session } from '@/@types/index';

export type TabStatus = 'idle' | 'running' | 'attention';

export interface TabStatusCounts {
  /** Sessions with an agent currently working. */
  running: number;
  /** Sessions that finished and have not been looked at yet. */
  attention: number;
}

export const BASE_TAB_TITLE = 'Nova Code';

type CountableSession = Pick<Session, 'id' | 'archived' | 'busy' | 'unread'>;

export function countTabStatus(
  sessions: CountableSession[],
  isUnread: (session: { id: string; unread?: boolean }) => boolean
): TabStatusCounts {
  let running = 0;
  let attention = 0;
  for (const session of sessions) {
    if (session.archived) {
      continue;
    }
    if (session.busy) {
      running += 1;
    } else if (isUnread(session)) {
      attention += 1;
    }
  }
  return { running, attention };
}

/** Attention outranks running — a finished chat is the state worth acting on. */
export function deriveTabStatus(counts: TabStatusCounts): TabStatus {
  if (counts.attention > 0) {
    return 'attention';
  }
  if (counts.running > 0) {
    return 'running';
  }
  return 'idle';
}

/**
 * Tab titles truncate from the right, so the count that matters goes in front.
 * The running suffix is expendable — the favicon already carries that state.
 */
export function formatTabTitle(counts: TabStatusCounts): string {
  if (counts.attention > 0) {
    return `(${counts.attention}) ${BASE_TAB_TITLE}`;
  }
  if (counts.running > 0) {
    return `${BASE_TAB_TITLE} — ${counts.running} running`;
  }
  return BASE_TAB_TITLE;
}

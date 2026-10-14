// types
import type { ChatMessage } from '../@types/index';

export interface SessionMessageRow {
  id: string;
  sessionId: string;
  position: number;
  role: string;
  content: string;
  eventsJson: string | null;
  imagePathsJson: string | null;
  createdAt: string;
}

export function sessionMessageRowToChat(row: SessionMessageRow): ChatMessage {
  let events: string[] | undefined;
  if (row.eventsJson) {
    try {
      const parsed = JSON.parse(row.eventsJson) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        events = parsed;
      }
    } catch {
      events = undefined;
    }
  }

  let imagePaths: string[] | undefined;
  if (row.imagePathsJson) {
    try {
      const parsed = JSON.parse(row.imagePathsJson) as unknown;
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
        imagePaths = parsed;
      }
    } catch {
      imagePaths = undefined;
    }
  }

  return {
    role: row.role === 'user' ? 'user' : 'assistant',
    content: row.content || undefined,
    events,
    imagePaths,
    createdAt: row.createdAt
  };
}

export function chatMessageToRowData(
  sessionId: string,
  position: number,
  message: ChatMessage,
  id: string
): Omit<SessionMessageRow, 'sessionId'> & { sessionId: string } {
  return {
    id,
    sessionId,
    position,
    role: message.role,
    content: message.content ?? '',
    eventsJson: message.events && message.events.length > 0 ? JSON.stringify(message.events) : null,
    imagePathsJson:
      message.imagePaths && message.imagePaths.length > 0 ? JSON.stringify(message.imagePaths) : null,
    createdAt: message.createdAt
  };
}

function isPlanSessionUpdateLine(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as { update?: { sessionUpdate?: string } };
    return parsed?.update?.sessionUpdate === 'plan';
  } catch {
    return false;
  }
}

/**
 * Message that should receive a user plan edit: the latest assistant message
 * already carrying a plan update, else the latest assistant message; -1 if none.
 */
export function planUpdateTargetIndex(
  messages: Array<{ role: string; events?: string[] | null }>
): number {
  let fallback = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    if (fallback < 0) fallback = index;
    if (message.events?.some(isPlanSessionUpdateLine)) return index;
  }
  return fallback;
}

/** Escape `%`, `_`, and `\` so Prisma `contains` is a literal substring match. */
export function escapeIlikeContains(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

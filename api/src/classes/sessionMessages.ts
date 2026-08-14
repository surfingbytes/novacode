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

/** Escape `%`, `_`, and `\` so Prisma `contains` is a literal substring match. */
export function escapeIlikeContains(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

// classes
import { Prisma } from '../../generated/client/client';
import { escapeIlikeContains } from '../sessionMessages';

// types
import type { SessionModel as Session } from '../../generated/client/models/Session';
import type { OrchestratorModel as Orchestrator } from '../../generated/client/models/Orchestrator';
import type { ChatQueueItem } from '../../@types/index';

/** Session list/detail row (chat history lives in `session_messages`). */
export type SessionWithCategory = Session;
/** Session with all fields */
export type SessionWithCategoryAndMessages = Session;
/** Orchestrator (alias for backward compat) */
export type OrchestratorWithCategory = Orchestrator;

export class FavoriteLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FavoriteLimitError';
  }
}

export const SEARCH_LIMIT = 30;

// --------------------------------------------- Helpers ---------------------------------------------

/** Dedupe (case-insensitive), trim; used for workspace and session tag arrays. */
export function normalizeTagStringList(tags: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of tags) {
    if (typeof x !== 'string') {
      continue;
    }
    const t = x.trim();
    if (!t) {
      continue;
    }
    const k = t.toLowerCase();
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function ilikeContains(term: string): { contains: string; mode: 'insensitive' } {
  return { contains: escapeIlikeContains(term), mode: 'insensitive' };
}

// --------------------------------------------- Row mappers ---------------------------------------------

export type QueueRow = {
  id: string;
  sessionId: string;
  text: string;
  model: string;
  mode: string;
  imagePaths: string | null;
  createdAt: string;
};

/** RETURNING list mapping session_prompt_queue columns to QueueRow for raw queries. */
export const QUEUE_RETURNING = Prisma.sql`id, session_id AS "sessionId", text, model, session_mode AS "mode",
  image_paths_json AS "imagePaths", created_at AS "createdAt"`;

export function toChatQueueItem(row: QueueRow): ChatQueueItem {
  return {
    id: row.id,
    sessionId: row.sessionId,
    text: row.text,
    model: row.model,
    mode: row.mode,
    imagePaths: row.imagePaths ? (JSON.parse(row.imagePaths) as string[]) : undefined,
    createdAt: row.createdAt
  };
}

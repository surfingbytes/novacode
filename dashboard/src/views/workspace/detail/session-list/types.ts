// types
import type { Orchestrator, Session } from '@/@types/index';

export type SessionListViewMode = 'list' | 'grid';

export type CombinedItem =
  | { kind: 'session'; session: Session }
  | { kind: 'orchestrator'; orchestrator: Orchestrator; nestedSessions: Session[] };

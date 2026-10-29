/**
 * Workspace Sessions tab filtering: text, status, agent type and tag.
 * Pure helpers so SessionListView only wires state.
 */

// utils
import { isSessionUnread } from '@/utils/sessionUnread';

// types
import type { AgentType, Orchestrator, Session } from '@/@types/index';

export type SessionListStatusFilter = 'all' | 'busy' | 'unread' | 'idle';

export type SessionListFilter = {
  text: string;
  status: SessionListStatusFilter;
  agentType: AgentType | null;
  tag: string | null;
};

type FilterableSession = Pick<Session, 'id' | 'name' | 'tags' | 'agentType' | 'busy' | 'unread'>;
type FilterableOrchestrator = Pick<Orchestrator, 'name' | 'tags'>;

export function emptySessionListFilter(): SessionListFilter {
  return { text: '', status: 'all', agentType: null, tag: null };
}

export function isSessionListFilterActive(filter: SessionListFilter): boolean {
  return (
    filter.text.trim() !== '' ||
    filter.status !== 'all' ||
    filter.agentType !== null ||
    filter.tag !== null
  );
}

/** Busy wins over unread; anything else is idle. */
export function sessionStatusOf(session: FilterableSession): 'busy' | 'unread' | 'idle' {
  if (session.busy) {
    return 'busy';
  }
  if (isSessionUnread(session)) {
    return 'unread';
  }
  return 'idle';
}

function normalizedText(filter: SessionListFilter): string {
  return filter.text.trim().toLowerCase();
}

function sessionMatchesText(session: FilterableSession, needle: string): boolean {
  if (!needle) {
    return true;
  }
  if (session.name.toLowerCase().includes(needle)) {
    return true;
  }
  return (session.tags ?? []).some((tag) => tag.toLowerCase().includes(needle));
}

function sessionMatchesStatus(
  session: FilterableSession,
  status: SessionListStatusFilter
): boolean {
  return status === 'all' || sessionStatusOf(session) === status;
}

function sessionMatchesAgentType(session: FilterableSession, agentType: AgentType | null): boolean {
  return agentType === null || session.agentType === agentType;
}

function sessionMatchesTag(session: FilterableSession, tag: string | null): boolean {
  if (!tag) {
    return true;
  }
  const lowerTag = tag.toLowerCase();
  return (session.tags ?? []).some((sessionTag) => sessionTag.toLowerCase() === lowerTag);
}

export function matchesSession(session: FilterableSession, filter: SessionListFilter): boolean {
  return (
    sessionMatchesText(session, normalizedText(filter)) &&
    sessionMatchesStatus(session, filter.status) &&
    sessionMatchesAgentType(session, filter.agentType) &&
    sessionMatchesTag(session, filter.tag)
  );
}

/**
 * Orchestrators match text on their own name/tags or any nested session; status and agent type
 * match when any nested session does; tag keeps the exact `tags` equality.
 */
export function matchesOrchestrator(
  orchestrator: FilterableOrchestrator,
  nestedSessions: FilterableSession[],
  filter: SessionListFilter
): boolean {
  if (filter.tag && orchestrator.tags !== filter.tag) {
    return false;
  }
  const needle = normalizedText(filter);
  if (needle) {
    const bOwnMatch =
      orchestrator.name.toLowerCase().includes(needle) ||
      (orchestrator.tags ?? '').toLowerCase().includes(needle);
    if (!bOwnMatch && !nestedSessions.some((session) => sessionMatchesText(session, needle))) {
      return false;
    }
  }
  if (
    filter.status !== 'all' &&
    !nestedSessions.some((session) => sessionMatchesStatus(session, filter.status))
  ) {
    return false;
  }
  if (
    filter.agentType !== null &&
    !nestedSessions.some((session) => sessionMatchesAgentType(session, filter.agentType))
  ) {
    return false;
  }
  return true;
}

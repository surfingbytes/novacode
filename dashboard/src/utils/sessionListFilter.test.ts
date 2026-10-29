// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  emptySessionListFilter,
  isSessionListFilterActive,
  matchesOrchestrator,
  matchesSession,
  sessionStatusOf,
  type SessionListFilter
} from '@/utils/sessionListFilter';
import { resetSessionUnreadState, setViewingSession } from '@/utils/sessionUnread';

import type { AgentType } from '@/@types/index';

type TestSession = {
  id: string;
  name: string;
  tags: string[] | null;
  agentType: AgentType;
  busy?: boolean;
  unread?: boolean;
};

function makeSession(overrides: Partial<TestSession> = {}): TestSession {
  return { id: 's1', name: 'Fix login bug', tags: null, agentType: 'claude', ...overrides };
}

function makeFilter(overrides: Partial<SessionListFilter> = {}): SessionListFilter {
  return { ...emptySessionListFilter(), ...overrides };
}

describe('sessionListFilter', () => {
  beforeEach(() => {
    resetSessionUnreadState();
  });

  describe('isSessionListFilterActive', () => {
    it('is inactive for the empty filter and whitespace-only text', () => {
      expect(isSessionListFilterActive(emptySessionListFilter())).toBe(false);
      expect(isSessionListFilterActive(makeFilter({ text: '   ' }))).toBe(false);
    });

    it('is active when any field is set', () => {
      expect(isSessionListFilterActive(makeFilter({ text: 'x' }))).toBe(true);
      expect(isSessionListFilterActive(makeFilter({ status: 'busy' }))).toBe(true);
      expect(isSessionListFilterActive(makeFilter({ agentType: 'codex' }))).toBe(true);
      expect(isSessionListFilterActive(makeFilter({ tag: 'ui' }))).toBe(true);
    });
  });

  describe('sessionStatusOf', () => {
    it('prefers busy over unread', () => {
      expect(sessionStatusOf(makeSession({ busy: true, unread: true }))).toBe('busy');
    });

    it('returns unread, or idle while the session is being viewed', () => {
      const session = makeSession({ unread: true });
      expect(sessionStatusOf(session)).toBe('unread');
      setViewingSession(session.id);
      expect(sessionStatusOf(session)).toBe('idle');
    });

    it('returns idle otherwise', () => {
      expect(sessionStatusOf(makeSession())).toBe('idle');
    });
  });

  describe('matchesSession', () => {
    it('matches text case-insensitively against name and tags', () => {
      const session = makeSession({ tags: ['Frontend'] });
      expect(matchesSession(session, makeFilter({ text: 'LOGIN' }))).toBe(true);
      expect(matchesSession(session, makeFilter({ text: 'front' }))).toBe(true);
      expect(matchesSession(session, makeFilter({ text: 'backend' }))).toBe(false);
    });

    it('matches each status', () => {
      const busy = makeSession({ busy: true });
      const unread = makeSession({ unread: true });
      const idle = makeSession();
      expect(matchesSession(busy, makeFilter({ status: 'busy' }))).toBe(true);
      expect(matchesSession(idle, makeFilter({ status: 'busy' }))).toBe(false);
      expect(matchesSession(unread, makeFilter({ status: 'unread' }))).toBe(true);
      expect(matchesSession(busy, makeFilter({ status: 'unread' }))).toBe(false);
      expect(matchesSession(idle, makeFilter({ status: 'idle' }))).toBe(true);
      expect(matchesSession(unread, makeFilter({ status: 'idle' }))).toBe(false);
      expect(matchesSession(busy, makeFilter({ status: 'all' }))).toBe(true);
    });

    it('matches agent type', () => {
      const session = makeSession({ agentType: 'codex' });
      expect(matchesSession(session, makeFilter({ agentType: 'codex' }))).toBe(true);
      expect(matchesSession(session, makeFilter({ agentType: 'claude' }))).toBe(false);
    });

    it('matches tags case-insensitively and exactly', () => {
      const session = makeSession({ tags: ['UI'] });
      expect(matchesSession(session, makeFilter({ tag: 'ui' }))).toBe(true);
      expect(matchesSession(session, makeFilter({ tag: 'u' }))).toBe(false);
      expect(matchesSession(makeSession(), makeFilter({ tag: 'ui' }))).toBe(false);
    });

    it('requires every set field to match', () => {
      const session = makeSession({ busy: true, agentType: 'claude', tags: ['ui'] });
      expect(
        matchesSession(
          session,
          makeFilter({ text: 'login', status: 'busy', agentType: 'claude', tag: 'ui' })
        )
      ).toBe(true);
      expect(matchesSession(session, makeFilter({ text: 'login', status: 'idle' }))).toBe(false);
    });
  });

  describe('matchesOrchestrator', () => {
    const orchestrator = { name: 'Release plan', tags: 'Infra' };
    const nested = [
      makeSession({ id: 'a', name: 'Step 1: api', agentType: 'claude', busy: true }),
      makeSession({ id: 'b', name: 'Step 2: docs', agentType: 'codex', tags: ['writing'] })
    ];

    it('matches text on its own name and tags', () => {
      expect(matchesOrchestrator(orchestrator, [], makeFilter({ text: 'release' }))).toBe(true);
      expect(matchesOrchestrator(orchestrator, [], makeFilter({ text: 'infra' }))).toBe(true);
      expect(matchesOrchestrator(orchestrator, [], makeFilter({ text: 'docs' }))).toBe(false);
    });

    it('matches text via nested session names and tags', () => {
      expect(matchesOrchestrator(orchestrator, nested, makeFilter({ text: 'DOCS' }))).toBe(true);
      expect(matchesOrchestrator(orchestrator, nested, makeFilter({ text: 'writing' }))).toBe(true);
      expect(matchesOrchestrator(orchestrator, nested, makeFilter({ text: 'nothing' }))).toBe(
        false
      );
    });

    it('matches status when any nested session matches', () => {
      expect(matchesOrchestrator(orchestrator, nested, makeFilter({ status: 'busy' }))).toBe(true);
      expect(matchesOrchestrator(orchestrator, nested, makeFilter({ status: 'idle' }))).toBe(true);
      expect(matchesOrchestrator(orchestrator, nested, makeFilter({ status: 'unread' }))).toBe(
        false
      );
      expect(matchesOrchestrator(orchestrator, [], makeFilter({ status: 'idle' }))).toBe(false);
    });

    it('matches agent type when any nested session matches', () => {
      expect(matchesOrchestrator(orchestrator, nested, makeFilter({ agentType: 'codex' }))).toBe(
        true
      );
      expect(
        matchesOrchestrator(orchestrator, nested, makeFilter({ agentType: 'open-code' }))
      ).toBe(false);
    });

    it('keeps exact tag equality for orchestrators', () => {
      expect(matchesOrchestrator(orchestrator, nested, makeFilter({ tag: 'Infra' }))).toBe(true);
      expect(matchesOrchestrator(orchestrator, nested, makeFilter({ tag: 'infra' }))).toBe(false);
      expect(matchesOrchestrator(orchestrator, nested, makeFilter({ tag: 'writing' }))).toBe(false);
    });

    it('matches everything with the empty filter', () => {
      expect(matchesOrchestrator(orchestrator, [], emptySessionListFilter())).toBe(true);
    });
  });
});

import { describe, expect, it } from 'vitest';

import { countTabStatus, deriveTabStatus, formatTabTitle } from '@/utils/tabStatus';

type TestSession = Parameters<typeof countTabStatus>[0][number];

function session(overrides: Partial<TestSession> & { id: string }): TestSession {
  return { archived: false, ...overrides } as TestSession;
}

const unread = (candidate: { unread?: boolean }): boolean => candidate.unread === true;

describe('countTabStatus', () => {
  it('counts busy sessions as running and finished-unseen sessions as attention', () => {
    const counts = countTabStatus(
      [
        session({ id: 'a', busy: true }),
        session({ id: 'b', busy: true }),
        session({ id: 'c', unread: true }),
        session({ id: 'd' })
      ],
      unread
    );
    expect(counts).toEqual({ running: 2, attention: 1 });
  });

  it('counts a session that is busy again as running, not attention', () => {
    const counts = countTabStatus([session({ id: 'a', busy: true, unread: true })], unread);
    expect(counts).toEqual({ running: 1, attention: 0 });
  });

  it('ignores archived sessions', () => {
    const counts = countTabStatus(
      [
        session({ id: 'a', archived: true, busy: true }),
        session({ id: 'b', archived: true, unread: true })
      ],
      unread
    );
    expect(counts).toEqual({ running: 0, attention: 0 });
  });

  it('drops sessions the unread predicate excludes', () => {
    const counts = countTabStatus([session({ id: 'a', unread: true })], () => false);
    expect(counts).toEqual({ running: 0, attention: 0 });
  });
});

describe('deriveTabStatus', () => {
  it('ranks attention above running', () => {
    expect(deriveTabStatus({ running: 3, attention: 1 })).toBe('attention');
    expect(deriveTabStatus({ running: 1, attention: 0 })).toBe('running');
    expect(deriveTabStatus({ running: 0, attention: 0 })).toBe('idle');
  });
});

describe('formatTabTitle', () => {
  it('puts the attention count in front so truncation cannot hide it', () => {
    expect(formatTabTitle({ running: 2, attention: 3 })).toBe('(3) Nova Code');
  });

  it('appends the running count as expendable detail', () => {
    expect(formatTabTitle({ running: 2, attention: 0 })).toBe('Nova Code — 2 running');
  });

  it('falls back to the plain title when nothing is happening', () => {
    expect(formatTabTitle({ running: 0, attention: 0 })).toBe('Nova Code');
  });
});

import { describe, expect, it } from 'vitest';
import { sessionBusyLabel, sessionBusyTitle } from './sessionBusyLabel';

describe('sessionBusyLabel', () => {
  it('returns Busy when no subagent counts', () => {
    expect(sessionBusyLabel({})).toBe('Busy');
    expect(sessionBusyLabel({ busySubagents: null })).toBe('Busy');
    expect(sessionBusyLabel({ busySubagents: { running: 0, total: 0 } })).toBe('Busy');
  });

  it('returns Busy · running/total when subagents are outstanding', () => {
    expect(sessionBusyLabel({ busySubagents: { running: 2, total: 3 } })).toBe('Busy · 2/3');
  });
});

describe('sessionBusyTitle', () => {
  it('describes subagent progress', () => {
    expect(sessionBusyTitle({ busySubagents: { running: 1, total: 2 } })).toBe(
      'Session is running — 1 of 2 subagents still running'
    );
  });
});

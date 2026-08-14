import { describe, expect, it } from 'vitest';

import { parseGitLog } from './gitLog';

describe('parseGitLog', () => {
  it('parses unit-separated git log lines', () => {
    const stdout = [
      'abc123def\x1fabc123d\x1fAda\x1f2026-08-14T12:00:00+00:00\x1fFix search',
      'fff000aaa\x1ffff000a\x1fBob\x1f2026-08-13T08:00:00+00:00\x1fAdd files'
    ].join('\n');
    expect(parseGitLog(stdout)).toEqual([
      {
        hash: 'abc123def',
        shortHash: 'abc123d',
        author: 'Ada',
        date: '2026-08-14T12:00:00+00:00',
        subject: 'Fix search'
      },
      {
        hash: 'fff000aaa',
        shortHash: 'fff000a',
        author: 'Bob',
        date: '2026-08-13T08:00:00+00:00',
        subject: 'Add files'
      }
    ]);
  });

  it('skips empty lines', () => {
    expect(parseGitLog('\n')).toEqual([]);
  });
});

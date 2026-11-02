// node_modules
import { describe, expect, it } from 'vitest';

// classes
import { buildHistoryFrame } from './chatHistoryFrame';

// types
import type { ChatMessage } from '../@types/index';

const page: ChatMessage[] = [
  { role: 'user', content: 'hi', createdAt: '2026-11-02T10:00:00.000Z' },
  { role: 'assistant', events: ['{"type":"text"}'], createdAt: '2026-11-02T10:00:01.000Z' }
];

describe('buildHistoryFrame', () => {
  it('sends the messages and their fingerprint to a client without one', () => {
    const frame = buildHistoryFrame({ messages: page, hasMore: true, queue: [] });

    expect(frame).toMatchObject({ type: 'history', messages: page, hasMore: true, queue: [] });
    expect(frame.historyHash).toEqual(expect.any(String));
    expect(frame.unchanged).toBeUndefined();
    expect(frame.streaming).toBeUndefined();
  });

  it('leaves the messages out when the client already has this page', () => {
    const { historyHash } = buildHistoryFrame({ messages: page, hasMore: false, queue: [] });

    const frame = buildHistoryFrame({ messages: page, hasMore: false, queue: [], streaming: true, knownHistoryHash: historyHash });

    expect(frame.unchanged).toBe(true);
    expect(frame.messages).toBeUndefined();
    expect(frame.historyHash).toBe(historyHash);
    expect(frame.streaming).toBe(true);
  });

  it('sends the messages when the page changed since the client fingerprint', () => {
    const { historyHash } = buildHistoryFrame({ messages: page.slice(0, 1), hasMore: false, queue: [] });

    const frame = buildHistoryFrame({ messages: page, hasMore: false, queue: [], knownHistoryHash: historyHash });

    expect(frame.unchanged).toBeUndefined();
    expect(frame.messages).toEqual(page);
  });
});

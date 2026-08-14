import { describe, expect, it } from 'vitest';

import { normalizeUsageSnapshot, parseSessionUsageJson, parseUsageUpdateLine } from './sessionUsage';

describe('parseUsageUpdateLine', () => {
  it('reads an ACP SessionNotification usage_update', () => {
    const line = JSON.stringify({
      sessionId: 's1',
      update: {
        sessionUpdate: 'usage_update',
        used: 1200,
        size: 8000,
        cost: { amount: 0.0123, currency: 'USD' }
      }
    });
    const usage = parseUsageUpdateLine(line);
    expect(usage).toMatchObject({
      used: 1200,
      size: 8000,
      cost: { amount: 0.0123, currency: 'USD' }
    });
    expect(usage?.at).toEqual(expect.any(String));
  });

  it('ignores non-usage events', () => {
    expect(parseUsageUpdateLine(JSON.stringify({ sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk' } }))).toBeNull();
    expect(parseUsageUpdateLine('not-json')).toBeNull();
  });
});

describe('parseSessionUsageJson', () => {
  it('round-trips a snapshot', () => {
    const json = JSON.stringify({ used: 10, size: 100, cost: { amount: 1, currency: 'USD' }, at: '2026-08-14T00:00:00.000Z' });
    expect(parseSessionUsageJson(json)).toEqual({
      used: 10,
      size: 100,
      cost: { amount: 1, currency: 'USD' },
      at: '2026-08-14T00:00:00.000Z'
    });
  });

  it('returns null for garbage', () => {
    expect(parseSessionUsageJson(null)).toBeNull();
    expect(parseSessionUsageJson('{')).toBeNull();
    expect(normalizeUsageSnapshot({ used: 'nope' })).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { periodRange, toDateInputValue } from './usagePeriods';

const NOW = new Date(2026, 9, 15, 14, 30, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

describe('periodRange', () => {
  it('starts today at local midnight', () => {
    expect(periodRange('today', NOW)).toEqual({
      from: new Date(2026, 9, 15).toISOString(),
      to: NOW.toISOString()
    });
  });

  it('goes back 7 and 30 days from now', () => {
    expect(periodRange('7d', NOW).from).toBe(new Date(NOW.getTime() - 7 * DAY_MS).toISOString());
    expect(periodRange('30d', NOW).from).toBe(new Date(NOW.getTime() - 30 * DAY_MS).toISOString());
    expect(periodRange('30d', NOW).to).toBe(NOW.toISOString());
  });

  it('starts this month on the first at local midnight', () => {
    expect(periodRange('month', NOW).from).toBe(new Date(2026, 9, 1).toISOString());
  });

  it('covers both custom days fully', () => {
    expect(periodRange('custom', NOW, { from: '2026-09-01', to: '2026-09-10' })).toEqual({
      from: new Date(2026, 8, 1).toISOString(),
      to: new Date(2026, 8, 11).toISOString()
    });
  });

  it('falls back to 30 days for missing or malformed custom input', () => {
    const fallback = periodRange('30d', NOW);
    expect(periodRange('custom', NOW)).toEqual(fallback);
    expect(periodRange('custom', NOW, { from: '', to: '2026-09-10' })).toEqual(fallback);
  });
});

describe('toDateInputValue', () => {
  it('pads month and day', () => {
    expect(toDateInputValue(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

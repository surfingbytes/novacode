import { describe, expect, it } from 'vitest';

import { formatSessionCostLabel, resolveSessionCostAmount } from './sessionUsageDisplay';

describe('resolveSessionCostAmount', () => {
  it('returns the persisted total when idle', () => {
    expect(
      resolveSessionCostAmount({ persistedAmount: 0.04, liveAmount: 0.01, bStreaming: false })
    ).toBe(0.04);
  });

  it('adds the live turn while streaming', () => {
    expect(
      resolveSessionCostAmount({ persistedAmount: 0.04, liveAmount: 0.01, bStreaming: true })
    ).toBe(0.05);
  });

  it('uses the live amount when nothing is persisted yet', () => {
    expect(
      resolveSessionCostAmount({ persistedAmount: null, liveAmount: 0.0123, bStreaming: true })
    ).toBe(0.0123);
    expect(
      resolveSessionCostAmount({ persistedAmount: null, liveAmount: 0.0123, bStreaming: false })
    ).toBe(0.0123);
  });

  it('returns null when no agent reported cost', () => {
    expect(
      resolveSessionCostAmount({ persistedAmount: null, liveAmount: undefined, bStreaming: false })
    ).toBeNull();
  });
});

describe('formatSessionCostLabel', () => {
  it('formats USD with two decimals', () => {
    expect(formatSessionCostLabel(0.0123)).toBe('$0.01');
    expect(formatSessionCostLabel(1.2, 'USD')).toBe('$1.20');
  });

  it('shows sub-cent amounts as <$0.01', () => {
    expect(formatSessionCostLabel(0.0031)).toBe('<$0.01');
    expect(formatSessionCostLabel(0)).toBe('$0.00');
  });

  it('supports full precision for tooltips', () => {
    expect(formatSessionCostLabel(0.0031, null, 4)).toBe('$0.0031');
  });

  it('appends a non-USD currency', () => {
    expect(formatSessionCostLabel(0.5, 'EUR')).toBe('$0.50 EUR');
  });
});

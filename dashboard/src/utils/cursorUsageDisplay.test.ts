import { describe, expect, it } from 'vitest';

import {
  formatRemainingLabel,
  formatRulesSubtitleLabel,
  formatRulesSubtitleTitle,
  formatUsageBar,
  formatUsdFromCents
} from './cursorUsageDisplay';

describe('cursorUsageDisplay', () => {
  it('formats cents as US dollars', () => {
    expect(formatUsdFromCents(1246)).toBe('US$12.46');
    expect(formatUsageBar({ usedCents: 1246, limitCents: 6000 })).toBe('US$12.46 / US$60.00');
    expect(formatRemainingLabel(4754)).toBe('Remaining: US$47.54');
  });

  it('compacts rules labels', () => {
    expect(formatRulesSubtitleLabel(0, 0)).toBeNull();
    expect(formatRulesSubtitleLabel(1, 0)).toBe('1 rule');
    expect(formatRulesSubtitleLabel(3, 2)).toBe('3+2 rules');
    expect(formatRulesSubtitleTitle(3, 2)).toBe('3 workspace · 2 global');
  });
});

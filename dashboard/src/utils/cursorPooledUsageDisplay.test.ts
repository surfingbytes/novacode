import { describe, expect, it } from 'vitest';

import {
  formatPooledRemainingLabel,
  formatPooledUsageBar,
  formatRulesSubtitleLabel,
  formatRulesSubtitleTitle,
  formatUsdFromCents
} from './cursorPooledUsageDisplay';

describe('cursorPooledUsageDisplay', () => {
  it('formats cents as US dollars', () => {
    expect(formatUsdFromCents(1246)).toBe('US$12.46');
    expect(formatPooledUsageBar({ usedCents: 1246, limitCents: 6000 })).toBe(
      'US$12.46 / US$60.00'
    );
    expect(formatPooledRemainingLabel(4754)).toBe('Remaining: US$47.54');
  });

  it('compacts rules labels', () => {
    expect(formatRulesSubtitleLabel(0, 0)).toBeNull();
    expect(formatRulesSubtitleLabel(1, 0)).toBe('1 rule');
    expect(formatRulesSubtitleLabel(3, 0)).toBe('3 rules');
    expect(formatRulesSubtitleLabel(0, 2)).toBe('2 rules');
    expect(formatRulesSubtitleLabel(3, 2)).toBe('3+2 rules');
    expect(formatRulesSubtitleTitle(3, 2)).toBe('3 workspace · 2 global');
  });
});

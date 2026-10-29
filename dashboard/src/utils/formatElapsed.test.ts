import { describe, expect, it } from 'vitest';
import { formatElapsed } from './formatElapsed';

describe('formatElapsed', () => {
  it('formats seconds only', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(999)).toBe('0s');
    expect(formatElapsed(12_000)).toBe('12s');
    expect(formatElapsed(59_999)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatElapsed(60_000)).toBe('1m 0s');
    expect(formatElapsed(252_000)).toBe('4m 12s');
    expect(formatElapsed(3_599_000)).toBe('59m 59s');
  });

  it('formats hours with zero-padded minutes and no seconds', () => {
    expect(formatElapsed(3_600_000)).toBe('1h 00m');
    expect(formatElapsed(3_780_000)).toBe('1h 03m');
    expect(formatElapsed(3_780_000 + 45_000)).toBe('1h 03m');
    expect(formatElapsed(10 * 3_600_000 + 30 * 60_000)).toBe('10h 30m');
  });

  it('treats negative and invalid input as zero', () => {
    expect(formatElapsed(-5_000)).toBe('0s');
    expect(formatElapsed(Number.NaN)).toBe('0s');
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('0s');
  });
});

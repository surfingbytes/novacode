// node_modules
import { describe, it, expect } from 'vitest';

// utils
import {
  chunkRows,
  computeOffsets,
  findVisibleRange,
  gridColumnCount
} from '@/utils/virtualWindow';

describe('computeOffsets', () => {
  it('builds prefix sums starting at 0', () => {
    expect(computeOffsets(3, (i) => [10, 20, 30][i])).toEqual([0, 10, 30, 60]);
  });

  it('returns [0] for an empty list and clamps negative heights', () => {
    expect(computeOffsets(0, () => 10)).toEqual([0]);
    expect(computeOffsets(2, () => -5)).toEqual([0, 0, 0]);
  });
});

describe('findVisibleRange', () => {
  // 500 rows of 50px: total 25000px
  const offsets = computeOffsets(500, () => 50);

  it('returns an empty range for an empty list', () => {
    expect(findVisibleRange([0], 0, 500, 0)).toEqual({ start: 0, end: 0 });
  });

  it('covers the viewport at the top of the list', () => {
    expect(findVisibleRange(offsets, 0, 500, 0)).toEqual({ start: 0, end: 11 });
  });

  it('covers the viewport in the middle of the list, including partial rows', () => {
    expect(findVisibleRange(offsets, 1025, 1525, 0)).toEqual({ start: 20, end: 31 });
  });

  it('extends the range by the overscan on both sides', () => {
    expect(findVisibleRange(offsets, 1000, 1500, 200)).toEqual({ start: 16, end: 35 });
  });

  it('clamps at the end of the list', () => {
    expect(findVisibleRange(offsets, 24800, 25300, 0)).toEqual({ start: 496, end: 500 });
    expect(findVisibleRange(offsets, 99999, 100499, 0)).toEqual({ start: 499, end: 500 });
  });

  it('starts at 0 when the list is below the viewport (negative view top)', () => {
    expect(findVisibleRange(offsets, -300, 200, 0)).toEqual({ start: 0, end: 5 });
  });

  it('handles variable heights', () => {
    const variable = computeOffsets(5, (i) => [100, 10, 10, 10, 100][i]);
    // [0, 100, 110, 120, 130, 230]
    expect(findVisibleRange(variable, 105, 125, 0)).toEqual({ start: 1, end: 4 });
  });
});

describe('gridColumnCount', () => {
  it('matches auto-fill with minmax(min(384px, 100%), 1fr) and a 16px gap', () => {
    expect(gridColumnCount(300, 384, 16)).toBe(1);
    expect(gridColumnCount(783, 384, 16)).toBe(1);
    expect(gridColumnCount(784, 384, 16)).toBe(2);
    expect(gridColumnCount(1184, 384, 16)).toBe(3);
  });

  it('returns 1 for an unmeasured container', () => {
    expect(gridColumnCount(0, 384, 16)).toBe(1);
  });
});

describe('chunkRows', () => {
  it('splits items into rows of the column count', () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkRows([], 3)).toEqual([]);
    expect(chunkRows([1, 2], 0)).toEqual([[1], [2]]);
  });
});

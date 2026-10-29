/**
 * Pure helpers for client-side list windowing (virtual scrolling).
 * Items are laid out top-to-bottom; `offsets[i]` is the top of item `i`
 * and `offsets[count]` the total height.
 */

/** Lists shorter than this render every item (no windowing). */
export const VIRTUAL_LIST_THRESHOLD = 80;

/** Extra pixels rendered above and below the viewport. */
export const VIRTUAL_LIST_OVERSCAN_PX = 800;

export interface VirtualRange {
  /** First rendered index (inclusive). */
  start: number;
  /** Last rendered index (exclusive). */
  end: number;
}

/** Prefix sums of item heights: length `count + 1`, starting at 0. */
export function computeOffsets(count: number, heightAt: (index: number) => number): number[] {
  const offsets = new Array<number>(count + 1);
  offsets[0] = 0;
  for (let i = 0; i < count; i++) {
    offsets[i + 1] = offsets[i] + Math.max(0, heightAt(i));
  }
  return offsets;
}

/** Index of the item containing `y` (clamped to `[0, count - 1]`). */
function indexAt(offsets: number[], y: number): number {
  const count = offsets.length - 1;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

/**
 * Items intersecting `[viewTop - overscan, viewBottom + overscan]`, where both
 * view edges are pixels relative to the top of the first item.
 */
export function findVisibleRange(
  offsets: number[],
  viewTop: number,
  viewBottom: number,
  overscan: number = VIRTUAL_LIST_OVERSCAN_PX
): VirtualRange {
  const count = offsets.length - 1;
  if (count <= 0) {
    return { start: 0, end: 0 };
  }
  const top = Math.max(0, viewTop - overscan);
  const bottom = Math.max(top, viewBottom + overscan);
  const start = indexAt(offsets, top);
  const end = Math.min(count, indexAt(offsets, bottom) + 1);
  return { start, end: Math.max(end, start + 1) };
}

/** Column count produced by `repeat(auto-fill, minmax(min(minColumn, 100%), 1fr))`. */
export function gridColumnCount(
  containerWidth: number,
  minColumnWidth: number,
  gap: number
): number {
  if (containerWidth <= 0) {
    return 1;
  }
  const column = Math.min(minColumnWidth, containerWidth);
  return Math.max(1, Math.floor((containerWidth + gap) / (column + gap)));
}

/** Splits `items` into rows of `columns` items each (last row may be shorter). */
export function chunkRows<T>(items: readonly T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

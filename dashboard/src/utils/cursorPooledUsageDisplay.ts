/**
 * Format Cursor org pooled-usage cents for Settings / session header.
 */

export function formatUsdFromCents(cents: number): string {
  return `US$${(cents / 100).toFixed(2)}`;
}

export function formatPooledUsageBar(opts: {
  usedCents: number;
  limitCents: number;
}): string {
  return `${formatUsdFromCents(opts.usedCents)} / ${formatUsdFromCents(opts.limitCents)}`;
}

export function formatPooledRemainingLabel(remainingCents: number): string {
  return `Remaining: ${formatUsdFromCents(remainingCents)}`;
}

/** Compact rules subtitle: "3+2 rules" instead of "3 workspace rules · 2 global rules". */
export function formatRulesSubtitleLabel(
  workspaceCount: number,
  globalCount: number
): string | null {
  if (workspaceCount <= 0 && globalCount <= 0) return null;
  if (workspaceCount > 0 && globalCount > 0) {
    return `${workspaceCount}+${globalCount} rules`;
  }
  const n = workspaceCount > 0 ? workspaceCount : globalCount;
  return `${n} rule${n === 1 ? '' : 's'}`;
}

export function formatRulesSubtitleTitle(
  workspaceCount: number,
  globalCount: number
): string {
  const parts: string[] = [];
  if (workspaceCount > 0) {
    parts.push(`${workspaceCount} workspace`);
  }
  if (globalCount > 0) {
    parts.push(`${globalCount} global`);
  }
  return parts.join(' · ');
}

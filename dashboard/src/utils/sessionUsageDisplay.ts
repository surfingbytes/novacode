/**
 * Session header cost: persisted turn sum, plus the in-flight turn while streaming.
 */

export function resolveSessionCostAmount(opts: {
  persistedAmount: number | null | undefined;
  liveAmount: number | null | undefined;
  bStreaming: boolean;
}): number | null {
  const persisted = opts.persistedAmount ?? null;
  const live = opts.liveAmount ?? null;
  if (opts.bStreaming && live != null) {
    return (persisted ?? 0) + live;
  }
  if (persisted != null) {
    return persisted;
  }
  return live;
}

export function formatSessionCostLabel(
  amount: number,
  currency?: string | null,
  decimals = 2
): string {
  const bTiny = decimals === 2 && amount > 0 && amount < 0.01;
  const formatted = bTiny ? '<$0.01' : `$${amount.toFixed(decimals)}`;
  if (currency && currency !== 'USD') {
    return `${formatted} ${currency}`;
  }
  return formatted;
}

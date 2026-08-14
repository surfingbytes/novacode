import type { SessionUsageSnapshot } from '../@types/index';

export function serializeSessionUsage(usage: SessionUsageSnapshot): string {
  return JSON.stringify({
    used: usage.used,
    size: usage.size,
    ...(usage.cost ? { cost: usage.cost } : {}),
    at: usage.at ?? new Date().toISOString()
  });
}

export function parseSessionUsageJson(raw: string | null | undefined): SessionUsageSnapshot | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeUsageSnapshot(parsed);
  } catch {
    return null;
  }
}

export function normalizeUsageSnapshot(value: unknown): SessionUsageSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const used = record['used'];
  const size = record['size'];
  if (typeof used !== 'number' || !Number.isFinite(used) || typeof size !== 'number' || !Number.isFinite(size)) {
    return null;
  }
  const snapshot: SessionUsageSnapshot = { used, size };
  const cost = record['cost'];
  if (cost && typeof cost === 'object' && !Array.isArray(cost)) {
    const costRecord = cost as Record<string, unknown>;
    if (typeof costRecord['amount'] === 'number' && Number.isFinite(costRecord['amount'])) {
      snapshot.cost = {
        amount: costRecord['amount'],
        currency: typeof costRecord['currency'] === 'string' ? costRecord['currency'] : 'USD'
      };
    }
  }
  if (typeof record['at'] === 'string' && record['at'].trim()) {
    snapshot.at = record['at'];
  }
  return snapshot;
}

/**
 * Parse an ACP stream line for `usage_update`. Returns null for any other event.
 * Never include the raw line in logs — callers should persist the snapshot only.
 */
export function parseUsageUpdateLine(line: string): SessionUsageSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const update =
    record['update'] && typeof record['update'] === 'object' && !Array.isArray(record['update'])
      ? (record['update'] as Record<string, unknown>)
      : record;
  if (update['sessionUpdate'] !== 'usage_update' && record['type'] !== 'usage_update') {
    return null;
  }
  return normalizeUsageSnapshot({
    used: update['used'],
    size: update['size'],
    cost: update['cost'],
    at: new Date().toISOString()
  });
}

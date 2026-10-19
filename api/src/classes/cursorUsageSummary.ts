// node_modules
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// classes
import { logger } from './logger';

const CURSOR_AUTH_FILE = '.config/cursor/auth.json';
const USAGE_SUMMARY_URL = 'https://cursor.com/api/usage-summary';
/** Usage numbers change slowly; keep dashboard/session polls from hammering Cursor. */
export const CURSOR_USAGE_SUMMARY_TTL_MS = 5 * 60 * 1000;
const FAILURE_CACHE_TTL_MS = 60_000;

export interface CursorUsageBucket {
  enabled: boolean;
  usedCents: number;
  limitCents: number | null;
  remainingCents: number | null;
}

export interface CursorUsageSummaryResult {
  authenticated: boolean;
  available: boolean;
  billingCycleStart?: string;
  billingCycleEnd?: string;
  membershipType?: string;
  limitType?: string;
  isUnlimited?: boolean;
  /** Individual overall allowance (matches dashboard “Your monthly usage”). */
  individual?: CursorUsageBucket;
  /** Team on-demand pool when present. */
  teamOnDemand?: CursorUsageBucket;
  error?: string;
  fetchedAt?: number;
}

interface AuthFile {
  accessToken?: unknown;
}

let memoryCache: { result: CursorUsageSummaryResult; at: number } | null = null;

export function clearCursorUsageSummaryCache(): void {
  memoryCache = null;
}

export function readCursorAccessToken(configDir: string): string | null {
  const path = join(configDir, CURSOR_AUTH_FILE);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as AuthFile;
    const token = typeof parsed.accessToken === 'string' ? parsed.accessToken.trim() : '';
    return token || null;
  } catch {
    return null;
  }
}

/** WorkOS user id from JWT `sub` (`auth0|user_…` → `user_…`). */
export function userIdFromAccessToken(accessToken: string): string | null {
  const parts = accessToken.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4), 'base64url').toString(
        'utf8'
      )
    ) as { sub?: unknown };
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    const sep = payload.sub.indexOf('|');
    return sep >= 0 ? payload.sub.slice(sep + 1) : payload.sub;
  } catch {
    return null;
  }
}

export function buildWorkosSessionCookie(accessToken: string): string | null {
  const userId = userIdFromAccessToken(accessToken);
  if (!userId) return null;
  return `WorkosCursorSessionToken=${userId}::${accessToken}`;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseBucket(raw: unknown): CursorUsageBucket | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const used = asNumber(obj.used);
  if (used == null) return null;
  return {
    enabled: obj.enabled !== false,
    usedCents: used,
    limitCents: asNumber(obj.limit),
    remainingCents: asNumber(obj.remaining)
  };
}

function pickIndividualBucket(individualUsage: unknown): CursorUsageBucket | null {
  if (!individualUsage || typeof individualUsage !== 'object') return null;
  const usage = individualUsage as Record<string, unknown>;
  // Current dashboard shape uses `overall`; older docs used `plan`.
  return parseBucket(usage.overall) ?? parseBucket(usage.plan);
}

function pickTeamOnDemand(teamUsage: unknown): CursorUsageBucket | null {
  if (!teamUsage || typeof teamUsage !== 'object') return null;
  const usage = teamUsage as Record<string, unknown>;
  return parseBucket(usage.onDemand);
}

export function parseUsageSummaryJson(json: unknown): Omit<
  CursorUsageSummaryResult,
  'authenticated' | 'available' | 'fetchedAt' | 'error'
> | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as Record<string, unknown>;
  const individual = pickIndividualBucket(body.individualUsage);
  const teamOnDemand = pickTeamOnDemand(body.teamUsage);
  if (!individual && !teamOnDemand) return null;
  return {
    billingCycleStart:
      typeof body.billingCycleStart === 'string' ? body.billingCycleStart : undefined,
    billingCycleEnd: typeof body.billingCycleEnd === 'string' ? body.billingCycleEnd : undefined,
    membershipType: typeof body.membershipType === 'string' ? body.membershipType : undefined,
    limitType: typeof body.limitType === 'string' ? body.limitType : undefined,
    isUnlimited: typeof body.isUnlimited === 'boolean' ? body.isUnlimited : undefined,
    ...(individual ? { individual } : {}),
    ...(teamOnDemand ? { teamOnDemand } : {})
  };
}

export async function fetchCursorUsageSummaryFresh(
  accessToken: string
): Promise<CursorUsageSummaryResult> {
  const cookie = buildWorkosSessionCookie(accessToken);
  if (!cookie) {
    return {
      authenticated: true,
      available: false,
      error: 'Cursor auth token is missing a user id'
    };
  }

  let response: Response;
  try {
    response = await fetch(USAGE_SUMMARY_URL, {
      method: 'GET',
      headers: {
        Cookie: cookie,
        'User-Agent': 'novacode'
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    logger.warn({ err }, 'Cursor usage-summary request failed');
    return { authenticated: true, available: false, error: message };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      authenticated: true,
      available: false,
      error: 'Cursor session rejected usage-summary (re-login may be required)'
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    logger.warn(
      { status: response.status, body: body.slice(0, 200) },
      'Cursor usage-summary rejected'
    );
    return {
      authenticated: true,
      available: false,
      error: body.trim() || `Cursor usage-summary error ${response.status}`
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return {
      authenticated: true,
      available: false,
      error: 'Invalid JSON from Cursor usage-summary'
    };
  }

  const parsed = parseUsageSummaryJson(json);
  if (!parsed) {
    return {
      authenticated: true,
      available: false,
      error: 'Cursor usage-summary missing usage totals'
    };
  }

  return {
    authenticated: true,
    available: true,
    ...parsed,
    fetchedAt: Date.now()
  };
}

export async function getCursorUsageSummary(configDir: string): Promise<CursorUsageSummaryResult> {
  const token = readCursorAccessToken(configDir);
  if (!token) {
    return { authenticated: false, available: false };
  }

  const now = Date.now();
  if (memoryCache?.result.available && now - memoryCache.at < CURSOR_USAGE_SUMMARY_TTL_MS) {
    return memoryCache.result;
  }
  if (
    memoryCache &&
    !memoryCache.result.available &&
    memoryCache.result.authenticated &&
    now - memoryCache.at < FAILURE_CACHE_TTL_MS
  ) {
    return memoryCache.result;
  }

  const result = await fetchCursorUsageSummaryFresh(token);
  memoryCache = { result, at: Date.now() };
  return result;
}

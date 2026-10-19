// node_modules
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// classes
import { logger } from './logger';

const ORG_API_FILE = '.config/cursor/org-api.json';
const POOLED_USAGE_URL = 'https://api.cursor.com/organizations/pooled-usage';
/** Docs: poll `/organizations/pooled-usage` at most once per hour. */
export const CURSOR_POOLED_USAGE_TTL_MS = 60 * 60 * 1000;

export interface CursorOrgCredentials {
  apiKey: string;
  organizationId: string;
  source: 'env' | 'file';
}

export interface CursorPooledUsagePool {
  limitCents: number;
  usedCents: number;
  remainingCents: number;
  contractStartDate: string | null;
  contractEndDate: string | null;
}

export interface CursorPooledUsageResult {
  configured: boolean;
  available: boolean;
  source?: 'env' | 'file';
  organizationId?: string;
  pool?: CursorPooledUsagePool;
  error?: string;
  fetchedAt?: number;
}

interface StoredOrgApiFile {
  apiKey?: unknown;
  organizationId?: unknown;
}

let memoryCache: { result: CursorPooledUsageResult; at: number } | null = null;

export function clearCursorPooledUsageCache(): void {
  memoryCache = null;
}

function orgApiFilePath(configDir: string): string {
  return join(configDir, ORG_API_FILE);
}

function readFileCredentials(configDir: string): Omit<CursorOrgCredentials, 'source'> | null {
  const path = orgApiFilePath(configDir);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as StoredOrgApiFile;
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    const organizationId =
      typeof parsed.organizationId === 'string' ? parsed.organizationId.trim() : '';
    if (!apiKey || !organizationId) return null;
    return { apiKey, organizationId };
  } catch {
    return null;
  }
}

/** Env wins over the Settings file so deploys can inject credentials. */
export function resolveCursorOrgCredentials(configDir: string): CursorOrgCredentials | null {
  const envKey = (process.env['CURSOR_ORG_API_KEY'] ?? '').trim();
  const envOrg = (process.env['CURSOR_ORG_ID'] ?? '').trim();
  if (envKey && envOrg) {
    return { apiKey: envKey, organizationId: envOrg, source: 'env' };
  }
  const file = readFileCredentials(configDir);
  if (!file) return null;
  return { ...file, source: 'file' };
}

export function getCursorOrgApiStatus(configDir: string): {
  configured: boolean;
  source: 'env' | 'file' | null;
  organizationId: string | null;
} {
  const creds = resolveCursorOrgCredentials(configDir);
  if (!creds) {
    return { configured: false, source: null, organizationId: null };
  }
  return {
    configured: true,
    source: creds.source,
    organizationId: creds.organizationId
  };
}

export function setCursorOrgApiCredentials(
  configDir: string,
  apiKey: string,
  organizationId: string
): void {
  const key = apiKey.trim();
  const orgId = organizationId.trim();
  if (!key || !orgId) {
    throw new Error('apiKey and organizationId are required');
  }
  const path = orgApiFilePath(configDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ apiKey: key, organizationId: orgId }, null, 2)}\n`, 'utf8');
  clearCursorPooledUsageCache();
}

export function clearCursorOrgApiCredentials(configDir: string): void {
  const path = orgApiFilePath(configDir);
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
  clearCursorPooledUsageCache();
}

function parsePool(raw: unknown): CursorPooledUsagePool | null {
  if (!raw || typeof raw !== 'object') return null;
  const pool = raw as Record<string, unknown>;
  const limitCents = typeof pool.limitCents === 'number' ? pool.limitCents : null;
  const usedCents = typeof pool.usedCents === 'number' ? pool.usedCents : null;
  const remainingCents = typeof pool.remainingCents === 'number' ? pool.remainingCents : null;
  if (limitCents == null || usedCents == null || remainingCents == null) return null;
  return {
    limitCents,
    usedCents,
    remainingCents,
    contractStartDate: typeof pool.contractStartDate === 'string' ? pool.contractStartDate : null,
    contractEndDate: typeof pool.contractEndDate === 'string' ? pool.contractEndDate : null
  };
}

export async function fetchCursorPooledUsageFresh(
  creds: CursorOrgCredentials
): Promise<CursorPooledUsageResult> {
  const auth = Buffer.from(`${creds.apiKey}:`, 'utf8').toString('base64');
  let response: Response;
  try {
    response = await fetch(POOLED_USAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ organizationId: creds.organizationId })
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    logger.warn({ err }, 'Cursor org pooled-usage request failed');
    return {
      configured: true,
      available: false,
      source: creds.source,
      organizationId: creds.organizationId,
      error: message
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const message =
      body.trim() ||
      (response.status === 401
        ? 'Invalid Organization API key'
        : response.status === 403
          ? 'Organization API access denied (usage scope / Enterprise required)'
          : `Cursor API error ${response.status}`);
    logger.warn({ status: response.status, body: body.slice(0, 200) }, 'Cursor org pooled-usage rejected');
    return {
      configured: true,
      available: false,
      source: creds.source,
      organizationId: creds.organizationId,
      error: message
    };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return {
      configured: true,
      available: false,
      source: creds.source,
      organizationId: creds.organizationId,
      error: 'Invalid JSON from Cursor pooled-usage API'
    };
  }

  const pool = parsePool(
    json && typeof json === 'object' ? (json as Record<string, unknown>).pool : null
  );
  if (!pool) {
    return {
      configured: true,
      available: false,
      source: creds.source,
      organizationId: creds.organizationId,
      error: 'Cursor pooled-usage response missing pool totals'
    };
  }

  return {
    configured: true,
    available: true,
    source: creds.source,
    organizationId: creds.organizationId,
    pool,
    fetchedAt: Date.now()
  };
}

export async function getCursorPooledUsage(configDir: string): Promise<CursorPooledUsageResult> {
  const creds = resolveCursorOrgCredentials(configDir);
  if (!creds) {
    return { configured: false, available: false };
  }

  const now = Date.now();
  if (
    memoryCache &&
    memoryCache.result.available &&
    memoryCache.result.organizationId === creds.organizationId &&
    now - memoryCache.at < CURSOR_POOLED_USAGE_TTL_MS
  ) {
    return memoryCache.result;
  }

  // Serve a recent failure briefly so a bad key does not hammer the API.
  if (
    memoryCache &&
    !memoryCache.result.available &&
    memoryCache.result.configured &&
    memoryCache.result.organizationId === creds.organizationId &&
    now - memoryCache.at < 60_000
  ) {
    return memoryCache.result;
  }

  const result = await fetchCursorPooledUsageFresh(creds);
  memoryCache = { result, at: Date.now() };
  return result;
}

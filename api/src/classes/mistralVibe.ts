// node_modules
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Extract the Mistral Vibe session id from a `session_*` log directory name.
 * Example: `session_20260330_220714_85007cf6` → `85007cf6` (suffix after the final `_`).
 */
export function extractVibeSessionIdFromFolderName(name: string): string | null {
  if (!name.startsWith('session_')) {
    return null;
  }
  const idx = name.lastIndexOf('_');
  if (idx <= 0 || idx >= name.length - 1) {
    return null;
  }
  const suffix = name.slice(idx + 1);
  if (!suffix.trim()) {
    return null;
  }
  return suffix;
}

/** `session_YYYYMMDD_HHMMSS_<id>` — numeric key for ordering (newest = largest). */
const SESSION_FOLDER_EMBEDDED_TS = /^session_(\d{8})_(\d{6})_(.+)$/;

export function parseVibeSessionFolderEmbeddedTimestampMs(name: string): number | null {
  const m = SESSION_FOLDER_EMBEDDED_TS.exec(name);
  if (!m) {
    return null;
  }
  const ymd = m[1];
  const hms = m[2];
  const y = Number(ymd.slice(0, 4));
  const mo = Number(ymd.slice(4, 6)) - 1;
  const d = Number(ymd.slice(6, 8));
  const hh = Number(hms.slice(0, 2));
  const mm = Number(hms.slice(2, 4));
  const ss = Number(hms.slice(4, 6));
  if (
    [y, mo, d, hh, mm, ss].some((n) => Number.isNaN(n)) ||
    mo < 0 ||
    mo > 11 ||
    d < 1 ||
    d > 31
  ) {
    return null;
  }
  const t = Date.UTC(y, mo, d, hh, mm, ss);
  return Number.isFinite(t) ? t : null;
}

/** Candidate dirs for `session_*` folders (first match wins when resolving). */
export function getCandidateVibeSessionLogDirs(env: Record<string, string>): string[] {
  const out: string[] = [];
  const home = env['HOME'];
  if (home) {
    out.push(join(home, '.vibe', 'logs', 'session'));
  }
  const vibeHome = env['VIBE_HOME'];
  if (vibeHome) {
    const p = join(vibeHome, 'logs', 'session');
    if (!out.includes(p)) {
      out.push(p);
    }
  }
  return out;
}

export type VibeSessionDirRow = {
  name: string;
  mtimeMs: number;
  /** From `session_YYYYMMDD_HHMMSS_*` when the name matches; otherwise null. */
  embeddedTsMs: number | null;
};

/**
 * Lists `session_*` directories under `logDir` with stats. Returns empty array if the path is missing
 * or unreadable (no throw).
 */
export async function listVibeSessionDirsInLogDir(logDir: string): Promise<VibeSessionDirRow[]> {
  let entries;
  try {
    entries = await readdir(logDir, { withFileTypes: true });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : '';
    if (code !== 'ENOENT') {
      console.warn('[mistralVibe] could not read session log dir:', logDir, err);
    }
    return [];
  }

  const rows: VibeSessionDirRow[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) {
      continue;
    }
    if (!e.name.startsWith('session_')) {
      continue;
    }
    try {
      const st = await stat(join(logDir, e.name));
      if (!st.isDirectory()) {
        continue;
      }
      const embeddedTsMs = parseVibeSessionFolderEmbeddedTimestampMs(e.name);
      rows.push({
        name: e.name,
        mtimeMs: st.mtimeMs,
        embeddedTsMs
      });
    } catch {
      // skip unreadable entries
    }
  }
  return rows;
}

/**
 * Pick the latest `session_*` folder deterministically: prefer embedded `YYYYMMDD_HHMMSS` in the
 * name (descending); if none of the folders have that pattern, use filesystem mtime (descending).
 * Tie-break: mtime descending.
 */
export function pickLatestVibeSessionFolder(rows: VibeSessionDirRow[]): VibeSessionDirRow | null {
  if (rows.length === 0) {
    return null;
  }
  const withEmbedded = rows.filter((r) => r.embeddedTsMs != null) as Array<
    VibeSessionDirRow & { embeddedTsMs: number }
  >;
  const pool = withEmbedded.length > 0 ? withEmbedded : rows;
  const sorted = [...pool].sort((a, b) => {
    const ae = a.embeddedTsMs;
    const be = b.embeddedTsMs;
    if (ae != null && be != null && ae !== be) {
      return be - ae;
    }
    return b.mtimeMs - a.mtimeMs;
  });
  return sorted[0] ?? null;
}

/**
 * Dedicated resolver: read one session log root, pick the latest `session_*` folder (see
 * {@link pickLatestVibeSessionFolder}), return the session id token (suffix after final `_`), or null.
 */
export async function resolveVibeSessionIdFromSessionLogDir(logDir: string): Promise<string | null> {
  const rows = await listVibeSessionDirsInLogDir(logDir);
  const parseable = rows.filter((r) => extractVibeSessionIdFromFolderName(r.name) != null);
  const picked = pickLatestVibeSessionFolder(parseable);
  if (!picked) {
    return null;
  }
  return extractVibeSessionIdFromFolderName(picked.name);
}

/**
 * Resolve Mistral Vibe external session id from filesystem logs (not CLI stdout). Tries
 * `~/.vibe/logs/session` then `$VIBE_HOME/logs/session` when set; first directory that yields an id wins.
 */
export async function resolveVibeSessionIdFromFilesystemLogs(
  agentEnv: Record<string, string>
): Promise<string | null> {
  const candidates = getCandidateVibeSessionLogDirs(agentEnv);
  for (const dir of candidates) {
    const id = await resolveVibeSessionIdFromSessionLogDir(dir);
    if (id) {
      return id;
    }
  }
  return null;
}

/** Alias for {@link resolveVibeSessionIdFromFilesystemLogs} (same behavior). */
export async function resolveLatestVibeSessionIdFromLogs(
  agentEnv: Record<string, string>
): Promise<string | null> {
  return resolveVibeSessionIdFromFilesystemLogs(agentEnv);
}

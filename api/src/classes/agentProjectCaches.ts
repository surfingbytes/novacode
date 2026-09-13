// node_modules
import { existsSync, renameSync, readdirSync } from 'node:fs';
import { join, normalize } from 'node:path';

// classes
import { logger } from './logger';

/** `/foo/bar` → `foo-bar` (Cursor `.cursor/projects`). */
export function cursorProjectSlug(absolutePath: string): string {
  return normalizeAbs(absolutePath).replace(/^\//, '').replace(/\//g, '-');
}

/** `/foo/bar` → `-foo-bar` (Claude / some Cursor session caches). */
export function dashedProjectSlug(absolutePath: string): string {
  return normalizeAbs(absolutePath).replace(/\//g, '-');
}

function normalizeAbs(absolutePath: string): string {
  return normalize(absolutePath).replace(/\\/g, '/').replace(/\/+$/, '') || '/';
}

function rewriteSlug(name: string, oldSlug: string, newSlug: string): string | null {
  if (!oldSlug || oldSlug === newSlug) {
    return null;
  }
  if (name === oldSlug) {
    return newSlug;
  }
  if (name.startsWith(oldSlug + '-')) {
    return newSlug + name.slice(oldSlug.length);
  }
  return null;
}

function renameDirIfNeeded(parent: string, fromName: string, toName: string): boolean {
  if (fromName === toName) {
    return false;
  }
  const from = join(parent, fromName);
  const to = join(parent, toName);
  if (!existsSync(from)) {
    return false;
  }
  if (existsSync(to)) {
    logger.warn(
      { from, to },
      'Agent project cache target already exists; leaving old cache in place'
    );
    return false;
  }
  renameSync(from, to);
  logger.info({ from, to }, 'Renamed agent project cache directory');
  return true;
}

type SlugStyle = 'cursor' | 'dashed';

function migrateDirChildren(
  parentDir: string,
  oldAbs: string,
  newAbs: string,
  style: SlugStyle
): number {
  if (!existsSync(parentDir)) {
    return 0;
  }
  const oldSlug = style === 'cursor' ? cursorProjectSlug(oldAbs) : dashedProjectSlug(oldAbs);
  const newSlug = style === 'cursor' ? cursorProjectSlug(newAbs) : dashedProjectSlug(newAbs);
  let count = 0;
  for (const name of readdirSync(parentDir)) {
    const next = rewriteSlug(name, oldSlug, newSlug);
    if (next && renameDirIfNeeded(parentDir, name, next)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Rename agent on-disk project caches keyed by absolute workspace cwd.
 * Covers Cursor, Claude, and related path-slug directories under configDir.
 */
export function migrateAgentProjectCaches(
  configDir: string,
  oldAbsolutePath: string,
  newAbsolutePath: string
): number {
  const oldAbs = normalizeAbs(oldAbsolutePath);
  const newAbs = normalizeAbs(newAbsolutePath);
  if (oldAbs === newAbs) {
    return 0;
  }

  let renamed = 0;
  renamed += migrateDirChildren(join(configDir, '.cursor', 'projects'), oldAbs, newAbs, 'cursor');
  renamed += migrateDirChildren(join(configDir, 'projects'), oldAbs, newAbs, 'dashed');
  renamed += migrateDirChildren(join(configDir, '.claude', 'projects'), oldAbs, newAbs, 'dashed');
  renamed += migrateDirChildren(
    join(configDir, '.cache', 'claude-cli-nodejs'),
    oldAbs,
    newAbs,
    'dashed'
  );
  return renamed;
}

/**
 * Rewrite all agent cache dirs whose slug is under `oldPrefix` to `newPrefix`.
 * E.g. oldPrefix=`${DEFAULT_WORKSPACE_BROWSE_ROOT}/opt`, newPrefix=/opt
 * renames the matching dashed/cursor project cache dirs.
 */
export function migrateAgentProjectCachesByPrefix(
  configDir: string,
  oldPrefix: string,
  newPrefix: string
): number {
  return migrateAgentProjectCaches(configDir, normalizeAbs(oldPrefix), normalizeAbs(newPrefix));
}

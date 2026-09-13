// node_modules
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';

// classes
import { migrateAgentProjectCaches, migrateAgentProjectCachesByPrefix } from './agentProjectCaches';
import { config } from './config';
import { db } from './database';
import { logger } from './logger';
import { relativizeToBrowseRoot, resolveWorkspaceAbsolutePath } from './workspacePaths';
import { DEFAULT_WORKSPACE_BROWSE_ROOT } from '@novacode/shared';

const STATE_FILE = 'workspace-browse-root.json';

type BrowseRootState = {
  root: string;
};

function statePath(configDir: string): string {
  return join(configDir, STATE_FILE);
}

function readPreviousRoot(configDir: string): string | null {
  const file = statePath(configDir);
  if (!existsSync(file)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as BrowseRootState;
    return typeof data.root === 'string' && data.root.trim() ? data.root.trim() : null;
  } catch {
    return null;
  }
}

function writeCurrentRoot(configDir: string, root: string): void {
  const file = statePath(configDir);
  const dir = dirname(file);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(file, JSON.stringify({ root } satisfies BrowseRootState, null, 2) + '\n', 'utf8');
}

function normalizePrefix(prefix: string): string {
  return normalize(prefix).replace(/\\/g, '/').replace(/\/+$/, '') || '/';
}

/** Parse `WORKSPACE_ABS_PREFIX_REWRITE=oldPrefix:newPrefix` (colons only as separator between two abs paths). */
export function parseAbsPrefixRewrite(raw: string | undefined): { oldPrefix: string; newPrefix: string } | null {
  const value = (raw ?? '').trim();
  if (!value) {
    return null;
  }
  // Split on the last colon that separates two absolute paths: /old:/new or /a/b:/c
  const match = value.match(/^(.+?):(\/.+)$/);
  if (!match) {
    logger.warn({ value }, 'Ignoring invalid WORKSPACE_ABS_PREFIX_REWRITE (expected oldPrefix:newPrefix)');
    return null;
  }
  const oldPrefix = normalizePrefix(match[1]!);
  const newPrefix = normalizePrefix(match[2]!);
  if (oldPrefix === newPrefix) {
    return null;
  }
  return { oldPrefix, newPrefix };
}

/**
 * When absolute paths move (browse-root change and/or WORKSPACE_ABS_PREFIX_REWRITE),
 * rewrite workspace.path rows and rename agent project caches.
 */
export async function runWorkspacePathMigrations(configDir: string = config.configDir): Promise<void> {
  const currentRoot = resolve(config.workspaceBrowseRoot);
  const previousRoot = readPreviousRoot(configDir);
  const rewrite = parseAbsPrefixRewrite(process.env['WORKSPACE_ABS_PREFIX_REWRITE']);

  if (rewrite) {
    const { oldPrefix, newPrefix } = rewrite;
    const workspaces = await db.listWorkspaces({ includeArchived: true });
    for (const ws of workspaces) {
      const rel = ws.path.replace(/^\//, '') || '.';
      // Prefer reconstructing the pre-migration absolute path from the previous browse root
      // (or the stock default when unknown), then map via the prefix rewrite.
      const inferredOldRoot = previousRoot
        ? resolve(previousRoot)
        : resolve(DEFAULT_WORKSPACE_BROWSE_ROOT);
      const oldAbs = resolve(inferredOldRoot, rel === '.' ? '.' : rel);
      const oldNorm = normalizePrefix(oldAbs);
      if (oldNorm !== oldPrefix && !oldNorm.startsWith(oldPrefix + '/')) {
        continue;
      }
      const newAbs = normalizePrefix(newPrefix + oldNorm.slice(oldPrefix.length));
      let newRel: string;
      try {
        newRel = relativizeToBrowseRoot(newAbs);
      } catch {
        logger.warn({ workspaceId: ws.id, oldAbs, newAbs }, 'Skip workspace path rewrite; outside new browse root');
        continue;
      }
      if (newRel !== ws.path) {
        await db.updateWorkspace(ws.id, { path: newRel });
        logger.info(
          { workspaceId: ws.id, from: ws.path, to: newRel },
          'Rewrote workspace path after absolute prefix migration'
        );
      }
      migrateAgentProjectCaches(configDir, oldAbs, newAbs);
    }
    // Also rename any leftover caches under the prefix (workspaces may have been deleted)
    migrateAgentProjectCachesByPrefix(configDir, oldPrefix, newPrefix);
  } else if (previousRoot && resolve(previousRoot) !== currentRoot) {
    const workspaces = await db.listWorkspaces({ includeArchived: true });
    for (const ws of workspaces) {
      const oldAbs = resolve(previousRoot, ws.path.replace(/^\//, '') || '.');
      const newAbs = resolveWorkspaceAbsolutePath(ws.path);
      migrateAgentProjectCaches(configDir, oldAbs, newAbs);
    }
    logger.info(
      { previousRoot, currentRoot, workspaces: workspaces.length },
      'Migrated agent project caches after browse-root change'
    );
  }

  writeCurrentRoot(configDir, currentRoot);
}

/** After a single workspace.path change, keep agent caches aligned with the new cwd. */
export function migrateCachesForWorkspacePathChange(
  configDir: string,
  oldRelativePath: string,
  newRelativePath: string
): void {
  const oldAbs = resolve(config.workspaceBrowseRoot, oldRelativePath.replace(/^\//, '') || '.');
  const newAbs = resolve(config.workspaceBrowseRoot, newRelativePath.replace(/^\//, '') || '.');
  migrateAgentProjectCaches(configDir, oldAbs, newAbs);
}

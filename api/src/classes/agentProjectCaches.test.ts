import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_WORKSPACE_BROWSE_ROOT } from '@novacode/shared';

import {
  cursorProjectSlug,
  dashedProjectSlug,
  migrateAgentProjectCaches
} from './agentProjectCaches';

describe('project slugs', () => {
  it('builds Cursor and Claude slugs from absolute paths', () => {
    const underDefault = `${DEFAULT_WORKSPACE_BROWSE_ROOT}/opt/src/foo`;
    const expectedSlug = underDefault
      .replace(/^\//, '')
      .replace(/[^a-zA-Z0-9]/g, '-');
    expect(cursorProjectSlug(underDefault)).toBe(expectedSlug);
    expect(dashedProjectSlug(underDefault)).toBe(`-${expectedSlug}`);
    expect(cursorProjectSlug('/opt')).toBe('opt');
    expect(dashedProjectSlug('/opt')).toBe('-opt');
  });
});

describe('migrateAgentProjectCaches', () => {
  let configDir: string;

  afterEach(() => {
    if (configDir) {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('renames Cursor and Claude cache dirs when the absolute cwd prefix changes', () => {
    configDir = mkdtempSync(join(tmpdir(), 'novacode-cache-'));
    const cursorProjects = join(configDir, '.cursor', 'projects');
    const claudeProjects = join(configDir, '.claude', 'projects');
    const legacyProjects = join(configDir, 'projects');
    mkdirSync(cursorProjects, { recursive: true });
    mkdirSync(claudeProjects, { recursive: true });
    mkdirSync(legacyProjects, { recursive: true });

    const oldPrefix = `${DEFAULT_WORKSPACE_BROWSE_ROOT}/opt`;
    const oldProject = `${oldPrefix}/src/foo`;
    const oldPrefixSlug = cursorProjectSlug(oldPrefix);
    const oldProjectSlug = cursorProjectSlug(oldProject);
    const oldDashedProject = dashedProjectSlug(oldProject);

    mkdirSync(join(cursorProjects, oldPrefixSlug), { recursive: true });
    mkdirSync(join(cursorProjects, oldProjectSlug), { recursive: true });
    writeFileSync(join(cursorProjects, oldProjectSlug, 'marker.txt'), 'ok');
    mkdirSync(join(claudeProjects, oldDashedProject), { recursive: true });
    mkdirSync(join(legacyProjects, oldDashedProject), { recursive: true });

    const renamed = migrateAgentProjectCaches(configDir, oldPrefix, '/opt');
    expect(renamed).toBeGreaterThanOrEqual(4);

    expect(readdirSync(cursorProjects).sort()).toEqual(['opt', 'opt-src-foo'].sort());
    expect(readdirSync(claudeProjects)).toEqual(['-opt-src-foo']);
    expect(readdirSync(legacyProjects)).toEqual(['-opt-src-foo']);
  });

  it('does not overwrite an existing target cache directory', () => {
    configDir = mkdtempSync(join(tmpdir(), 'novacode-cache-'));
    const cursorProjects = join(configDir, '.cursor', 'projects');
    const oldPrefix = `${DEFAULT_WORKSPACE_BROWSE_ROOT}/opt`;
    const oldPrefixSlug = cursorProjectSlug(oldPrefix);
    mkdirSync(join(cursorProjects, oldPrefixSlug), { recursive: true });
    mkdirSync(join(cursorProjects, 'opt'), { recursive: true });
    writeFileSync(join(cursorProjects, 'opt', 'keep.txt'), 'keep');

    migrateAgentProjectCaches(configDir, oldPrefix, '/opt');
    expect(readdirSync(cursorProjects).sort()).toEqual([oldPrefixSlug, 'opt'].sort());
  });
});

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  cursorProjectSlug,
  dashedProjectSlug,
  migrateAgentProjectCaches
} from './agentProjectCaches';

describe('project slugs', () => {
  it('builds Cursor and Claude slugs from absolute paths', () => {
    expect(cursorProjectSlug('/data-root/opt/src/foo')).toBe('data-root-opt-src-foo');
    expect(dashedProjectSlug('/data-root/opt/src/foo')).toBe('-data-root-opt-src-foo');
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

    mkdirSync(join(cursorProjects, 'data-root-opt'), { recursive: true });
    mkdirSync(join(cursorProjects, 'data-root-opt-src-foo'), { recursive: true });
    writeFileSync(join(cursorProjects, 'data-root-opt-src-foo', 'marker.txt'), 'ok');
    mkdirSync(join(claudeProjects, '-data-root-opt-src-foo'), { recursive: true });
    mkdirSync(join(legacyProjects, '-data-root-opt-src-foo'), { recursive: true });

    const renamed = migrateAgentProjectCaches(configDir, '/data-root/opt', '/opt');
    expect(renamed).toBeGreaterThanOrEqual(4);

    expect(readdirSync(cursorProjects).sort()).toEqual(['opt', 'opt-src-foo'].sort());
    expect(readdirSync(claudeProjects)).toEqual(['-opt-src-foo']);
    expect(readdirSync(legacyProjects)).toEqual(['-opt-src-foo']);
  });

  it('does not overwrite an existing target cache directory', () => {
    configDir = mkdtempSync(join(tmpdir(), 'novacode-cache-'));
    const cursorProjects = join(configDir, '.cursor', 'projects');
    mkdirSync(join(cursorProjects, 'data-root-opt'), { recursive: true });
    mkdirSync(join(cursorProjects, 'opt'), { recursive: true });
    writeFileSync(join(cursorProjects, 'opt', 'keep.txt'), 'keep');

    migrateAgentProjectCaches(configDir, '/data-root/opt', '/opt');
    expect(readdirSync(cursorProjects).sort()).toEqual(['data-root-opt', 'opt'].sort());
  });
});

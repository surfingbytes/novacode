import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildAgentRulesPrefix,
  deleteRuleFile,
  isRuleFileHiddenFromUi,
  listRuleFiles,
  readRuleFile,
  renameRuleFile,
  sanitizeRuleFilename,
  writeRuleFile
} from './ruleFiles';

describe('sanitizeRuleFilename', () => {
  it('rejects empty, traversal, and separator names', () => {
    expect(sanitizeRuleFilename('').ok).toBe(false);
    expect(sanitizeRuleFilename('.').ok).toBe(false);
    expect(sanitizeRuleFilename('..').ok).toBe(false);
    expect(sanitizeRuleFilename('a/b.mdc').ok).toBe(false);
    expect(sanitizeRuleFilename('a\\b.mdc').ok).toBe(false);
  });

  it('accepts a simple filename', () => {
    expect(sanitizeRuleFilename(' project-guidelines.mdc ')).toEqual({
      ok: true,
      value: 'project-guidelines.mdc'
    });
  });
});

describe('isRuleFileHiddenFromUi', () => {
  it('hides the reserved defaults filename', () => {
    expect(isRuleFileHiddenFromUi('global-agent-defaults.mdc')).toBe(true);
    expect(isRuleFileHiddenFromUi('Global-Agent-Defaults.mdc')).toBe(true);
    expect(isRuleFileHiddenFromUi('house-style.mdc')).toBe(false);
  });
});

describe('rule file CRUD', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rule-files-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists files, skips hidden names, and treats a missing dir as empty when asked', async () => {
    const missing = await listRuleFiles(join(dir, 'nope'), { missingDir: 'empty' });
    expect(missing).toEqual({ ok: true, value: [] });

    const missingError = await listRuleFiles(join(dir, 'nope'), { missingDir: 'error' });
    expect(missingError.ok).toBe(false);
    if (!missingError.ok) {
      expect(missingError.code).toBe('RULES_DIR_NOT_FOUND');
    }

    writeFileSync(join(dir, 'b.mdc'), 'second');
    writeFileSync(join(dir, 'a.mdc'), 'first');
    writeFileSync(join(dir, 'global-agent-defaults.mdc'), 'hidden');
    mkdirSync(join(dir, 'subdir'));

    const listed = await listRuleFiles(dir);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.value.map((f) => f.filename)).toEqual(['a.mdc', 'b.mdc']);
    }
  });

  it('writes, reads, renames, and deletes a rule file', async () => {
    const nested = join(dir, 'rules');
    const written = await writeRuleFile(nested, 'style.mdc', '# Style\n');
    expect(written).toEqual({ ok: true, value: { filename: 'style.mdc' } });
    expect(existsSync(join(nested, 'style.mdc'))).toBe(true);

    const read = await readRuleFile(nested, 'style.mdc');
    expect(read).toEqual({
      ok: true,
      value: { filename: 'style.mdc', content: '# Style\n' }
    });

    const renamed = await renameRuleFile(nested, 'style.mdc', 'house-style.mdc');
    expect(renamed).toEqual({ ok: true, value: { filename: 'house-style.mdc' } });

    const deleted = await deleteRuleFile(nested, 'house-style.mdc');
    expect(deleted).toEqual({ ok: true, value: { filename: 'house-style.mdc' } });
    expect(existsSync(join(nested, 'house-style.mdc'))).toBe(false);
  });

  it('rejects reserved filenames and path traversal', async () => {
    const hidden = await writeRuleFile(dir, 'global-agent-defaults.mdc', 'nope');
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) {
      expect(hidden.code).toBe('INVALID_FILENAME');
    }

    const traversal = await readRuleFile(dir, '../outside.mdc');
    expect(traversal.ok).toBe(false);
    if (!traversal.ok) {
      expect(traversal.code).toBe('INVALID_FILENAME');
    }
  });

  it('includes symlink targets that are files', async () => {
    const target = join(dir, 'real.mdc');
    writeFileSync(target, 'linked');
    symlinkSync(target, join(dir, 'alias.mdc'));
    const listed = await listRuleFiles(dir);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.value.map((f) => f.filename)).toEqual(['alias.mdc', 'real.mdc']);
    }
  });
});

describe('buildAgentRulesPrefix', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rule-prefix-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty when neither directory has content', async () => {
    const prefix = await buildAgentRulesPrefix({
      globalRulesDir: join(root, 'global'),
      workspacePath: join(root, 'ws')
    });
    expect(prefix).toBe('');
  });

  it('includes only workspace rules when global is empty', async () => {
    const wsRules = join(root, 'ws', '.cursor', 'rules');
    mkdirSync(wsRules, { recursive: true });
    writeFileSync(join(wsRules, 'project.mdc'), 'Use bun.');
    writeFileSync(join(wsRules, 'global-agent-defaults.mdc'), 'ignored');
    writeFileSync(join(wsRules, 'empty.mdc'), '   \n');

    const prefix = await buildAgentRulesPrefix({
      globalRulesDir: join(root, 'global'),
      workspacePath: join(root, 'ws')
    });
    expect(prefix).toContain('Workspace rules (from .cursor/rules) apply to this task as high-priority instructions.');
    expect(prefix).toContain('--- project.mdc ---\nUse bun.');
    expect(prefix).not.toContain('global-agent-defaults');
    expect(prefix).not.toContain('empty.mdc');
    expect(prefix).not.toContain('Global rules apply');
    expect(prefix).not.toContain('override global rules');
  });

  it('includes only global rules when the workspace has none', async () => {
    const globalDir = join(root, 'global');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, 'house.mdc'), 'Always use jq.');

    const prefix = await buildAgentRulesPrefix({
      globalRulesDir: globalDir,
      workspacePath: join(root, 'ws')
    });
    expect(prefix).toContain('Global rules apply to this task across every workspace as high-priority instructions.');
    expect(prefix).toContain('--- house.mdc ---\nAlways use jq.');
    expect(prefix).not.toContain('Workspace rules');
  });

  it('puts global rules first and says workspace rules win on conflict', async () => {
    const globalDir = join(root, 'global');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, 'house.mdc'), 'Prefer Python.');

    const wsRules = join(root, 'ws', '.cursor', 'rules');
    mkdirSync(wsRules, { recursive: true });
    writeFileSync(join(wsRules, 'project.mdc'), 'Prefer TypeScript.');

    const prefix = await buildAgentRulesPrefix({
      globalRulesDir: globalDir,
      workspacePath: join(root, 'ws')
    });
    const globalAt = prefix.indexOf('Global rules apply');
    const workspaceAt = prefix.indexOf('Workspace rules (from .cursor/rules)');
    expect(globalAt).toBeGreaterThanOrEqual(0);
    expect(workspaceAt).toBeGreaterThan(globalAt);
    expect(prefix).toContain('They override global rules on conflict.');
    expect(prefix).toContain('--- house.mdc ---\nPrefer Python.');
    expect(prefix).toContain('--- project.mdc ---\nPrefer TypeScript.');
  });

  it('truncates rule files that exceed the injection cap', async () => {
    const globalDir = join(root, 'global');
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, 'huge.mdc'), 'x'.repeat(20_000));

    const prefix = await buildAgentRulesPrefix({
      globalRulesDir: globalDir,
      workspacePath: join(root, 'ws')
    });
    expect(prefix).toContain('[... truncated: rule file exceeds 10,000 characters]');
    expect(prefix.length).toBeLessThan(11_000);
  });

  it('picks up rule file edits despite the sections cache', async () => {
    const globalDir = join(root, 'global');
    mkdirSync(globalDir, { recursive: true });
    const file = join(globalDir, 'house.mdc');
    writeFileSync(file, 'Version one.');

    const first = await buildAgentRulesPrefix({
      globalRulesDir: globalDir,
      workspacePath: join(root, 'ws')
    });
    expect(first).toContain('Version one.');

    // Rewrite with different size+mtime — the cache must not serve stale content.
    writeFileSync(file, 'Version two — rewritten with more text.');
    const second = await buildAgentRulesPrefix({
      globalRulesDir: globalDir,
      workspacePath: join(root, 'ws')
    });
    expect(second).toContain('Version two — rewritten with more text.');
    expect(second).not.toContain('Version one.');
  });
});

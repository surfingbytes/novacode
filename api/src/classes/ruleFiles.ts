// node_modules
import { readdir, readFile, writeFile, mkdir, unlink, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

// classes
import { logger } from './logger';

export interface RuleFileSummary {
  filename: string;
  label: string | null;
}

export interface RuleFileContent {
  filename: string;
  content: string;
}

export type RuleFileErrorCode =
  | 'RULES_DIR_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'INVALID_FILENAME'
  | 'IO_ERROR';

export type RuleFileResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: RuleFileErrorCode; message: string };

/** Filenames reserved for host / IDE defaults; not shown, edited, or injected. */
const RULE_FILES_HIDDEN_FILENAMES = new Set(['global-agent-defaults.mdc']);

export function isRuleFileHiddenFromUi(filename: string): boolean {
  return RULE_FILES_HIDDEN_FILENAMES.has(filename.trim().toLowerCase());
}

export function sanitizeRuleFilename(raw: string): RuleFileResult<string> {
  const name = raw.trim();
  if (!name) {
    return { ok: false, code: 'INVALID_FILENAME', message: 'Filename is required' };
  }
  if (name === '.' || name === '..') {
    return { ok: false, code: 'INVALID_FILENAME', message: 'Invalid filename' };
  }
  if (name.includes('/') || name.includes('\\')) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'Filename must not contain path separators'
    };
  }
  if (name.includes('\0')) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'Filename contains invalid characters'
    };
  }
  return { ok: true, value: name };
}

function resolveInsideRulesDir(rulesDir: string, filename: string): RuleFileResult<string> {
  const filePath = resolve(rulesDir, filename);
  const dirNorm = normalize(rulesDir).replace(/\\/g, '/').replace(/\/?$/, '');
  const fileNorm = normalize(filePath).replace(/\\/g, '/');
  if (fileNorm === dirNorm || !fileNorm.startsWith(dirNorm + '/')) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'Resolved filename is outside the rules directory'
    };
  }
  return { ok: true, value: filePath };
}

async function isRuleFileEntry(rulesDir: string, name: string, isFile: boolean, isSymbolicLink: boolean): Promise<boolean> {
  if (isFile) {
    return true;
  }
  if (!isSymbolicLink) {
    return false;
  }
  try {
    const st = await stat(resolve(rulesDir, name));
    return st.isFile();
  } catch {
    return false;
  }
}

export async function listRuleFiles(
  rulesDir: string,
  opts?: { missingDir?: 'error' | 'empty' }
): Promise<RuleFileResult<RuleFileSummary[]>> {
  const missingDir = opts?.missingDir ?? 'error';
  if (!existsSync(rulesDir)) {
    if (missingDir === 'empty') {
      return { ok: true, value: [] };
    }
    return {
      ok: false,
      code: 'RULES_DIR_NOT_FOUND',
      message: 'Rules directory does not exist'
    };
  }

  try {
    const entries = await readdir(rulesDir, { withFileTypes: true });
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    const files: RuleFileSummary[] = [];
    for (const d of sorted) {
      if (d.isDirectory()) {
        continue;
      }
      const include = await isRuleFileEntry(rulesDir, d.name, d.isFile(), d.isSymbolicLink());
      if (!include) {
        continue;
      }
      if (isRuleFileHiddenFromUi(d.name)) {
        continue;
      }
      files.push({
        filename: d.name,
        label: d.name.replace(/\.(md|mdc)$/i, '')
      });
    }
    return { ok: true, value: files };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list rules directory';
    return { ok: false, code: 'IO_ERROR', message };
  }
}

export async function readRuleFile(
  rulesDir: string,
  filename: string
): Promise<RuleFileResult<RuleFileContent>> {
  const nameResult = sanitizeRuleFilename(filename);
  if (!nameResult.ok) {
    return nameResult;
  }
  if (isRuleFileHiddenFromUi(nameResult.value)) {
    return { ok: false, code: 'FILE_NOT_FOUND', message: 'Rule file not found' };
  }

  const pathResult = resolveInsideRulesDir(rulesDir, nameResult.value);
  if (!pathResult.ok) {
    return pathResult;
  }

  if (!existsSync(rulesDir)) {
    return {
      ok: false,
      code: 'RULES_DIR_NOT_FOUND',
      message: 'Rules directory does not exist'
    };
  }
  if (!existsSync(pathResult.value)) {
    return { ok: false, code: 'FILE_NOT_FOUND', message: 'Rule file not found' };
  }

  try {
    const content = await readFile(pathResult.value, 'utf8');
    return { ok: true, value: { filename: nameResult.value, content } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read rule file';
    return { ok: false, code: 'IO_ERROR', message };
  }
}

export async function writeRuleFile(
  rulesDir: string,
  filename: string,
  content: string
): Promise<RuleFileResult<{ filename: string }>> {
  const nameResult = sanitizeRuleFilename(filename);
  if (!nameResult.ok) {
    return nameResult;
  }
  if (isRuleFileHiddenFromUi(nameResult.value)) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'That filename is reserved for system defaults and cannot be edited here'
    };
  }

  const pathResult = resolveInsideRulesDir(rulesDir, nameResult.value);
  if (!pathResult.ok) {
    return pathResult;
  }

  try {
    await mkdir(rulesDir, { recursive: true });
    await writeFile(pathResult.value, content, 'utf8');
    return { ok: true, value: { filename: nameResult.value } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to write rule file';
    return { ok: false, code: 'IO_ERROR', message };
  }
}

export async function deleteRuleFile(
  rulesDir: string,
  filename: string
): Promise<RuleFileResult<{ filename: string }>> {
  const nameResult = sanitizeRuleFilename(filename);
  if (!nameResult.ok) {
    return nameResult;
  }
  if (isRuleFileHiddenFromUi(nameResult.value)) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'That filename is reserved for system defaults and cannot be removed here'
    };
  }

  const pathResult = resolveInsideRulesDir(rulesDir, nameResult.value);
  if (!pathResult.ok) {
    return pathResult;
  }

  if (!existsSync(rulesDir)) {
    return {
      ok: false,
      code: 'RULES_DIR_NOT_FOUND',
      message: 'Rules directory does not exist'
    };
  }
  if (!existsSync(pathResult.value)) {
    return { ok: false, code: 'FILE_NOT_FOUND', message: 'Rule file not found' };
  }

  try {
    await unlink(pathResult.value);
    return { ok: true, value: { filename: nameResult.value } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete rule file';
    return { ok: false, code: 'IO_ERROR', message };
  }
}

export async function renameRuleFile(
  rulesDir: string,
  oldFilename: string,
  newFilename: string
): Promise<RuleFileResult<{ filename: string }>> {
  const oldResult = sanitizeRuleFilename(oldFilename);
  if (!oldResult.ok) {
    return oldResult;
  }
  const newResult = sanitizeRuleFilename(newFilename);
  if (!newResult.ok) {
    return newResult;
  }
  if (oldResult.value === newResult.value) {
    return { ok: true, value: { filename: newResult.value } };
  }
  if (isRuleFileHiddenFromUi(oldResult.value) || isRuleFileHiddenFromUi(newResult.value)) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'That filename is reserved for system defaults'
    };
  }

  const oldPath = resolveInsideRulesDir(rulesDir, oldResult.value);
  if (!oldPath.ok) {
    return oldPath;
  }
  const newPath = resolveInsideRulesDir(rulesDir, newResult.value);
  if (!newPath.ok) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'New filename is outside the rules directory'
    };
  }

  if (!existsSync(rulesDir)) {
    return {
      ok: false,
      code: 'RULES_DIR_NOT_FOUND',
      message: 'Rules directory does not exist'
    };
  }
  if (!existsSync(oldPath.value)) {
    return { ok: false, code: 'FILE_NOT_FOUND', message: 'Rule file not found' };
  }
  if (existsSync(newPath.value)) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'A file with that name already exists'
    };
  }

  try {
    await rename(oldPath.value, newPath.value);
    return { ok: true, value: { filename: newResult.value } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to rename rule file';
    return { ok: false, code: 'IO_ERROR', message };
  }
}

export interface RuleFileSection {
  filename: string;
  content: string;
}

/**
 * Per-file injection cap (~2.5k tokens) so one oversized rule file cannot bloat
 * every prompt it is injected into.
 */
const MAX_RULE_FILE_CHARS = 10_000;
const TRUNCATED_MARKER = '\n\n[... truncated: rule file exceeds 10,000 characters]';

/**
 * Sections cache keyed by rules dir, invalidated by a signature of file
 * name+mtime+size — avoids re-reading every rule file on each prompt turn.
 */
const ruleSectionsCache = new Map<string, { signature: string; sections: RuleFileSection[] }>();

async function rulesDirSignature(rulesDir: string, files: RuleFileSummary[]): Promise<string> {
  const parts: string[] = [];
  for (const file of files) {
    try {
      const st = await stat(join(rulesDir, file.filename));
      parts.push(`${file.filename}:${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push(`${file.filename}:gone`);
    }
  }
  return parts.join('|');
}

/** Read injectable rule sections from a directory. Missing dirs and unreadable files are skipped. */
export async function readRuleSections(rulesDir: string): Promise<RuleFileSection[]> {
  const listed = await listRuleFiles(rulesDir, { missingDir: 'empty' });
  if (!listed.ok || listed.value.length === 0) {
    ruleSectionsCache.delete(rulesDir);
    return [];
  }

  const signature = await rulesDirSignature(rulesDir, listed.value);
  const cached = ruleSectionsCache.get(rulesDir);
  if (cached && cached.signature === signature) {
    return cached.sections;
  }

  const sections: RuleFileSection[] = [];
  for (const file of listed.value) {
    try {
      const content = await readFile(join(rulesDir, file.filename), 'utf8');
      let trimmed = content.trim();
      if (!trimmed) {
        continue;
      }
      if (trimmed.length > MAX_RULE_FILE_CHARS) {
        logger.warn(
          { rulesDir, filename: file.filename, chars: trimmed.length },
          'Rule file exceeds injection cap; truncating'
        );
        trimmed = trimmed.slice(0, MAX_RULE_FILE_CHARS) + TRUNCATED_MARKER;
      }
      sections.push({ filename: file.filename, content: trimmed });
    } catch {
      // ignore unreadable single files
    }
  }
  ruleSectionsCache.set(rulesDir, { signature, sections });
  return sections;
}

function formatRuleSections(sections: RuleFileSection[]): string {
  return sections.map((section) => `--- ${section.filename} ---\n${section.content}`).join('\n\n');
}

/**
 * True when the content starts with a YAML frontmatter block containing
 * `alwaysApply: true` — cursor-agent auto-applies such .mdc rules natively
 * (recursively from the workspace/git root), so injecting them would
 * double-deliver the content. Rules without it (e.g. agent-requested) are
 * NOT loaded by cursor and must still be injected.
 */
export function hasAlwaysApplyFrontmatter(content: string): boolean {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) {
    return false;
  }
  return /^alwaysApply\s*:\s*true\s*$/m.test(frontmatter[1] ?? '');
}

/**
 * True for rule sections cursor-agent applies natively: .mdc files (cursor's
 * rules glob only matches .mdc) with `alwaysApply: true` frontmatter.
 */
export function isCursorNativeRule(section: RuleFileSection): boolean {
  return section.filename.toLowerCase().endsWith('.mdc') && hasAlwaysApplyFrontmatter(section.content);
}

export async function buildAgentRulesPrefix(opts: {
  globalRulesDir: string;
  workspacePath: string;
  /**
   * Drop workspace rules cursor-agent applies natively (.mdc with
   * `alwaysApply: true`) — it auto-loads them from the workspace/git root,
   * so injecting them too would double-deliver the content.
   */
  excludeCursorNativeWorkspaceRules?: boolean;
}): Promise<string> {
  const globalSections = await readRuleSections(opts.globalRulesDir);
  let workspaceSections = await readRuleSections(join(opts.workspacePath, '.cursor', 'rules'));
  if (opts.excludeCursorNativeWorkspaceRules) {
    workspaceSections = workspaceSections.filter((section) => !isCursorNativeRule(section));
  }
  const blocks: string[] = [];

  if (globalSections.length > 0) {
    blocks.push(
      [
        'Global rules apply to this task across every workspace as high-priority instructions.',
        '',
        formatRuleSections(globalSections)
      ].join('\n')
    );
  }

  if (workspaceSections.length > 0) {
    const lines = ['Workspace rules (from .cursor/rules) apply to this task as high-priority instructions.'];
    if (globalSections.length > 0) {
      lines.push('They override global rules on conflict.');
    }
    lines.push('', formatRuleSections(workspaceSections));
    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n\n');
}

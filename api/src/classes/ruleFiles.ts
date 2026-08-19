// node_modules
import { readdir, readFile, writeFile, mkdir, unlink, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';

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

/** Read injectable rule sections from a directory. Missing dirs and unreadable files are skipped. */
export async function readRuleSections(rulesDir: string): Promise<RuleFileSection[]> {
  const listed = await listRuleFiles(rulesDir, { missingDir: 'empty' });
  if (!listed.ok || listed.value.length === 0) {
    return [];
  }

  const sections: RuleFileSection[] = [];
  for (const file of listed.value) {
    try {
      const content = await readFile(join(rulesDir, file.filename), 'utf8');
      const trimmed = content.trim();
      if (!trimmed) {
        continue;
      }
      sections.push({ filename: file.filename, content: trimmed });
    } catch {
      // ignore unreadable single files
    }
  }
  return sections;
}

function formatRuleSections(sections: RuleFileSection[]): string {
  return sections.map((section) => `--- ${section.filename} ---\n${section.content}`).join('\n\n');
}

export async function buildAgentRulesPrefix(opts: {
  globalRulesDir: string;
  workspacePath: string;
}): Promise<string> {
  const globalSections = await readRuleSections(opts.globalRulesDir);
  const workspaceSections = await readRuleSections(join(opts.workspacePath, '.cursor', 'rules'));
  const blocks: string[] = [];

  if (globalSections.length > 0) {
    blocks.push(
      [
        'Global rules apply to this task across every workspace.',
        'Follow them as high-priority instructions when generating your response.',
        '',
        formatRuleSections(globalSections)
      ].join('\n')
    );
  }

  if (workspaceSections.length > 0) {
    const lines = [
      'Workspace rules (from .cursor/rules) apply to this task.',
      'Follow them as high-priority instructions when generating your response.'
    ];
    if (globalSections.length > 0) {
      lines.push('When they conflict with global rules, workspace rules take precedence.');
    }
    lines.push('', formatRuleSections(workspaceSections));
    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n\n');
}

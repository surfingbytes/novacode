// node_modules
import { readdir, readFile, writeFile, mkdir, unlink, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, normalize } from 'node:path';

// classes
import { db } from './database';
import { config } from './config';

export interface WorkspaceRuleFileSummary {
  filename: string;
  label: string | null;
}

export interface WorkspaceRuleFileContent {
  filename: string;
  content: string;
}

export type WorkspaceRuleErrorCode =
  | 'WORKSPACE_NOT_FOUND'
  | 'RULES_DIR_NOT_FOUND'
  | 'FILE_NOT_FOUND'
  | 'INVALID_FILENAME'
  | 'INVALID_WORKSPACE_PATH'
  | 'IO_ERROR';

export type WorkspaceRuleResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: WorkspaceRuleErrorCode; message: string };

/** Filenames reserved for host / IDE defaults; not shown or editable in the workspace Rules UI. */
const WORKSPACE_RULES_UI_HIDDEN_FILENAMES = new Set(['global-agent-defaults.mdc']);

export function isWorkspaceRuleHiddenFromUi(filename: string): boolean {
  return WORKSPACE_RULES_UI_HIDDEN_FILENAMES.has(filename.trim().toLowerCase());
}

function workspaceRoot(): string {
  return resolve(config.workspaceBrowseRoot);
}

function sanitizeRuleFilename(raw: string): WorkspaceRuleResult<string> {
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

async function getWorkspaceRulesDir(workspaceId: string): Promise<WorkspaceRuleResult<string>> {
  const workspace = await db.getWorkspace(workspaceId);
  if (!workspace) {
    return { ok: false, code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' };
  }

  // workspace.path is stored relative to config.workspaceBrowseRoot (validated on create/update)
  const workspaceRel = workspace.path.replace(/^\//, '');
  const basePath = resolve(workspaceRoot(), workspaceRel || '.');

  const baseNorm = normalize(basePath).replace(/\\/g, '/');
  const rootNorm = normalize(workspaceRoot()).replace(/\\/g, '/').replace(/\/?$/, '');
  if (baseNorm !== rootNorm && !baseNorm.startsWith(rootNorm + '/')) {
    return {
      ok: false,
      code: 'INVALID_WORKSPACE_PATH',
      message: 'Workspace path is outside the allowed root'
    };
  }

  const rulesDir = resolve(basePath, '.cursor', 'rules');
  return { ok: true, value: rulesDir };
}

export async function listWorkspaceRuleFiles(
  workspaceId: string
): Promise<WorkspaceRuleResult<WorkspaceRuleFileSummary[]>> {
  const dirResult = await getWorkspaceRulesDir(workspaceId);
  if (!dirResult.ok) {
    return dirResult;
  }

  const rulesDir = dirResult.value;
  if (!existsSync(rulesDir)) {
    return {
      ok: false,
      code: 'RULES_DIR_NOT_FOUND',
      message: 'Rules directory does not exist'
    };
  }

  try {
    const entries = await readdir(rulesDir, { withFileTypes: true });
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
    const files: WorkspaceRuleFileSummary[] = [];
    for (const d of sorted) {
      if (d.isDirectory()) {
        continue;
      }
      let isRuleFile = d.isFile();
      if (d.isSymbolicLink()) {
        try {
          const st = await stat(resolve(rulesDir, d.name));
          isRuleFile = st.isFile();
        } catch {
          isRuleFile = false;
        }
      }
      if (!isRuleFile) {
        continue;
      }
      if (isWorkspaceRuleHiddenFromUi(d.name)) {
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

export async function readWorkspaceRuleFile(
  workspaceId: string,
  filename: string
): Promise<WorkspaceRuleResult<WorkspaceRuleFileContent>> {
  const nameResult = sanitizeRuleFilename(filename);
  if (!nameResult.ok) {
    return nameResult;
  }

  if (isWorkspaceRuleHiddenFromUi(nameResult.value)) {
    return {
      ok: false,
      code: 'FILE_NOT_FOUND',
      message: 'Rule file not found'
    };
  }

  const dirResult = await getWorkspaceRulesDir(workspaceId);
  if (!dirResult.ok) {
    return dirResult;
  }

  const rulesDir = dirResult.value;
  const filePath = resolve(rulesDir, nameResult.value);

  const dirNorm = normalize(rulesDir).replace(/\\/g, '/').replace(/\/?$/, '');
  const fileNorm = normalize(filePath).replace(/\\/g, '/');
  if (!fileNorm.startsWith(dirNorm + '/') && fileNorm !== dirNorm) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'Resolved filename is outside the rules directory'
    };
  }

  if (!existsSync(rulesDir)) {
    return {
      ok: false,
      code: 'RULES_DIR_NOT_FOUND',
      message: 'Rules directory does not exist'
    };
  }

  if (!existsSync(filePath)) {
    return {
      ok: false,
      code: 'FILE_NOT_FOUND',
      message: 'Rule file not found'
    };
  }

  try {
    const content = await readFile(filePath, 'utf8');
    return { ok: true, value: { filename: nameResult.value, content } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read rule file';
    return { ok: false, code: 'IO_ERROR', message };
  }
}

export async function writeWorkspaceRuleFile(
  workspaceId: string,
  filename: string,
  content: string
): Promise<WorkspaceRuleResult<{ filename: string }>> {
  const nameResult = sanitizeRuleFilename(filename);
  if (!nameResult.ok) {
    return nameResult;
  }

  if (isWorkspaceRuleHiddenFromUi(nameResult.value)) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'That filename is reserved for system defaults and cannot be edited here'
    };
  }

  const dirResult = await getWorkspaceRulesDir(workspaceId);
  if (!dirResult.ok) {
    return dirResult;
  }

  const rulesDir = dirResult.value;
  const filePath = resolve(rulesDir, nameResult.value);

  const dirNorm = normalize(rulesDir).replace(/\\/g, '/').replace(/\/?$/, '');
  const fileNorm = normalize(filePath).replace(/\\/g, '/');
  if (!fileNorm.startsWith(dirNorm + '/') && fileNorm !== dirNorm) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'Resolved filename is outside the rules directory'
    };
  }

  try {
    await mkdir(rulesDir, { recursive: true });
    await writeFile(filePath, content, 'utf8');
    return { ok: true, value: { filename: nameResult.value } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to write rule file';
    return { ok: false, code: 'IO_ERROR', message };
  }
}

export async function deleteWorkspaceRuleFile(
  workspaceId: string,
  filename: string
): Promise<WorkspaceRuleResult<{ filename: string }>> {
  const nameResult = sanitizeRuleFilename(filename);
  if (!nameResult.ok) {
    return nameResult;
  }

  if (isWorkspaceRuleHiddenFromUi(nameResult.value)) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'That filename is reserved for system defaults and cannot be removed here'
    };
  }

  const dirResult = await getWorkspaceRulesDir(workspaceId);
  if (!dirResult.ok) {
    return dirResult;
  }

  const rulesDir = dirResult.value;
  const filePath = resolve(rulesDir, nameResult.value);

  const dirNorm = normalize(rulesDir).replace(/\\/g, '/').replace(/\/?$/, '');
  const fileNorm = normalize(filePath).replace(/\\/g, '/');
  if (!fileNorm.startsWith(dirNorm + '/') && fileNorm !== dirNorm) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'Resolved filename is outside the rules directory'
    };
  }

  if (!existsSync(rulesDir)) {
    return {
      ok: false,
      code: 'RULES_DIR_NOT_FOUND',
      message: 'Rules directory does not exist'
    };
  }

  if (!existsSync(filePath)) {
    return {
      ok: false,
      code: 'FILE_NOT_FOUND',
      message: 'Rule file not found'
    };
  }

  try {
    await unlink(filePath);
    return { ok: true, value: { filename: nameResult.value } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete rule file';
    return { ok: false, code: 'IO_ERROR', message };
  }
}

export async function renameWorkspaceRuleFile(
  workspaceId: string,
  oldFilename: string,
  newFilename: string
): Promise<WorkspaceRuleResult<{ filename: string }>> {
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

  if (isWorkspaceRuleHiddenFromUi(oldResult.value) || isWorkspaceRuleHiddenFromUi(newResult.value)) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'That filename is reserved for system defaults'
    };
  }

  const dirResult = await getWorkspaceRulesDir(workspaceId);
  if (!dirResult.ok) {
    return dirResult;
  }

  const rulesDir = dirResult.value;
  const oldPath = resolve(rulesDir, oldResult.value);
  const newPath = resolve(rulesDir, newResult.value);

  const dirNorm = normalize(rulesDir).replace(/\\/g, '/').replace(/\/?$/, '');
  const oldNorm = normalize(oldPath).replace(/\\/g, '/');
  const newNorm = normalize(newPath).replace(/\\/g, '/');
  if (!oldNorm.startsWith(dirNorm + '/') && oldNorm !== dirNorm) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'Resolved filename is outside the rules directory'
    };
  }
  if (!newNorm.startsWith(dirNorm + '/') && newNorm !== dirNorm) {
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

  if (!existsSync(oldPath)) {
    return {
      ok: false,
      code: 'FILE_NOT_FOUND',
      message: 'Rule file not found'
    };
  }

  if (existsSync(newPath)) {
    return {
      ok: false,
      code: 'INVALID_FILENAME',
      message: 'A file with that name already exists'
    };
  }

  try {
    await rename(oldPath, newPath);
    return { ok: true, value: { filename: newResult.value } };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to rename rule file';
    return { ok: false, code: 'IO_ERROR', message };
  }
}


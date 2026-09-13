// node_modules
import { resolve } from 'node:path';

// classes
import { db } from './database';
import { isPathUnderBrowseRoot, resolveWorkspaceAbsolutePath } from './workspacePaths';
import {
  deleteRuleFile,
  isRuleFileHiddenFromUi,
  listRuleFiles,
  readRuleFile,
  renameRuleFile,
  writeRuleFile,
  type RuleFileContent,
  type RuleFileErrorCode,
  type RuleFileResult,
  type RuleFileSummary
} from './ruleFiles';

export type WorkspaceRuleFileSummary = RuleFileSummary;
export type WorkspaceRuleFileContent = RuleFileContent;

export type WorkspaceRuleErrorCode =
  | RuleFileErrorCode
  | 'WORKSPACE_NOT_FOUND'
  | 'INVALID_WORKSPACE_PATH';

export type WorkspaceRuleResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: WorkspaceRuleErrorCode; message: string };

export const isWorkspaceRuleHiddenFromUi = isRuleFileHiddenFromUi;

async function getWorkspaceRulesDir(workspaceId: string): Promise<WorkspaceRuleResult<string>> {
  const workspace = await db.getWorkspace(workspaceId);
  if (!workspace) {
    return { ok: false, code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found' };
  }

  // workspace.path is stored relative to config.workspaceBrowseRoot (validated on create/update)
  const basePath = resolveWorkspaceAbsolutePath(workspace.path);
  if (!isPathUnderBrowseRoot(basePath)) {
    return {
      ok: false,
      code: 'INVALID_WORKSPACE_PATH',
      message: 'Workspace path is outside the allowed root'
    };
  }

  return { ok: true, value: resolve(basePath, '.cursor', 'rules') };
}

function mapDirResult<T>(
  dirResult: WorkspaceRuleResult<string>,
  next: (rulesDir: string) => Promise<RuleFileResult<T>>
): Promise<WorkspaceRuleResult<T>> {
  if (!dirResult.ok) {
    return Promise.resolve(dirResult);
  }
  return next(dirResult.value);
}

export async function listWorkspaceRuleFiles(
  workspaceId: string
): Promise<WorkspaceRuleResult<WorkspaceRuleFileSummary[]>> {
  return mapDirResult(await getWorkspaceRulesDir(workspaceId), (dir) =>
    listRuleFiles(dir, { missingDir: 'error' })
  );
}

export async function readWorkspaceRuleFile(
  workspaceId: string,
  filename: string
): Promise<WorkspaceRuleResult<WorkspaceRuleFileContent>> {
  return mapDirResult(await getWorkspaceRulesDir(workspaceId), (dir) => readRuleFile(dir, filename));
}

export async function writeWorkspaceRuleFile(
  workspaceId: string,
  filename: string,
  content: string
): Promise<WorkspaceRuleResult<{ filename: string }>> {
  return mapDirResult(await getWorkspaceRulesDir(workspaceId), (dir) =>
    writeRuleFile(dir, filename, content)
  );
}

export async function deleteWorkspaceRuleFile(
  workspaceId: string,
  filename: string
): Promise<WorkspaceRuleResult<{ filename: string }>> {
  return mapDirResult(await getWorkspaceRulesDir(workspaceId), (dir) => deleteRuleFile(dir, filename));
}

export async function renameWorkspaceRuleFile(
  workspaceId: string,
  oldFilename: string,
  newFilename: string
): Promise<WorkspaceRuleResult<{ filename: string }>> {
  return mapDirResult(await getWorkspaceRulesDir(workspaceId), (dir) =>
    renameRuleFile(dir, oldFilename, newFilename)
  );
}

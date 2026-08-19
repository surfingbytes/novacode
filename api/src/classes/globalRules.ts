// node_modules
import { join } from 'node:path';

// classes
import { config } from './config';
import {
  deleteRuleFile,
  listRuleFiles,
  readRuleFile,
  renameRuleFile,
  writeRuleFile,
  type RuleFileContent,
  type RuleFileResult,
  type RuleFileSummary
} from './ruleFiles';

export function getGlobalRulesDir(): string {
  return join(config.configDir, 'global-rules');
}

export async function listGlobalRuleFiles(): Promise<RuleFileResult<RuleFileSummary[]>> {
  return listRuleFiles(getGlobalRulesDir(), { missingDir: 'empty' });
}

export async function readGlobalRuleFile(
  filename: string
): Promise<RuleFileResult<RuleFileContent>> {
  return readRuleFile(getGlobalRulesDir(), filename);
}

export async function writeGlobalRuleFile(
  filename: string,
  content: string
): Promise<RuleFileResult<{ filename: string }>> {
  return writeRuleFile(getGlobalRulesDir(), filename, content);
}

export async function deleteGlobalRuleFile(
  filename: string
): Promise<RuleFileResult<{ filename: string }>> {
  return deleteRuleFile(getGlobalRulesDir(), filename);
}

export async function renameGlobalRuleFile(
  oldFilename: string,
  newFilename: string
): Promise<RuleFileResult<{ filename: string }>> {
  return renameRuleFile(getGlobalRulesDir(), oldFilename, newFilename);
}

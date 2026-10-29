// node_modules
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';

// classes
import { getGlobalRulesDir } from '../globalRules';
import { buildAgentRulesPrefix } from '../ruleFiles';
import type { AcpPromptAttachment } from '../acpSubprocessRunner';

// types
import type { AgentType } from '../../@types/index';

export async function buildWorkspaceRulesPrefix(workspacePath: string, agentType: AgentType): Promise<string> {
  return buildAgentRulesPrefix({
    globalRulesDir: getGlobalRulesDir(),
    workspacePath,
    // cursor-agent natively auto-applies .mdc rules with `alwaysApply: true`
    // from the workspace/git root — those must not be double-delivered.
    // Rules without that frontmatter are NOT loaded by cursor and are still injected.
    excludeCursorNativeWorkspaceRules: agentType === 'cursor-agent',
  });
}

/**
 * Image attachments are sent to agents as native ACP image blocks (base64 data) —
 * every integrated ACP agent advertises the `image` prompt capability and converts
 * it to real model input. All other file types stay path-in-prompt so agents can
 * read them with their own file tools (ACP `resource`/blob blocks are ignored or
 * unsupported by several agents, and no agent accepts video over ACP).
 */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export async function resolvePromptAttachments(
  imagePaths: string[]
): Promise<{ attachments: AcpPromptAttachment[]; textPaths: string[] }> {
  const attachments: AcpPromptAttachment[] = [];
  const textPaths: string[] = [];
  for (const path of imagePaths) {
    const mimeType = IMAGE_MIME_BY_EXT[extname(path).toLowerCase()];
    if (mimeType) {
      try {
        const data = await readFile(path);
        attachments.push({ mimeType, data: data.toString('base64'), path });
        continue;
      } catch {
        // unreadable (e.g. cleaned up) — fall back to path-in-prompt
      }
    }
    textPaths.push(path);
  }
  return { attachments, textPaths };
}

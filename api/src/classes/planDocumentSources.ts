/**
 * Per-agent plan-document sources.
 *
 * Each agent persists plan files in its own location/convention, made
 * deterministic by the HOME/XDG redirects in config.agentEnv:
 *
 *  - cursor-agent: <configDir>/.cursor/plans/*.plan.md, `<!-- acp-session-uuid -->` header
 *  - open-code:    <XDG_DATA_HOME>/opencode/plans/*.md, `<!-- acp-session-id -->` header
 *                  (written via the plan-mode prompt injection in openCodeAcp.ts)
 *  - claude:       no file source — ACP `plan` session updates cover the plan tab
 *                  (its ~/.claude/plans files carry no session association)
 *  - others:       no plan-file convention
 */

// node_modules
import { join } from 'path';

// classes
import { config } from './config';
import {
  getPlanDocumentById,
  listPlanDocumentsForAcpSession,
  type PlanDocumentFileConvention,
  type PlanDocumentSummary,
} from './planDocuments';

export interface PlanDocumentsSource {
  listForSession(acpSessionId: string | null | undefined): Promise<PlanDocumentSummary[]>;
  getById(planId: string, acpSessionId: string | null | undefined): Promise<PlanDocumentSummary | null>;
}

function cursorPlansDir(): string {
  return join(config.configDir, '.cursor', 'plans');
}

/**
 * OpenCode resolves its data home from XDG_DATA_HOME, which agentEnv defaults
 * to <configDir>/.local/share for spawned agent processes.
 */
export function openCodePlansDir(): string {
  const xdgDataHome = process.env['XDG_DATA_HOME'] || join(config.configDir, '.local', 'share');
  return join(xdgDataHome, 'opencode', 'plans');
}

function cursorConvention(): PlanDocumentFileConvention {
  return {
    dir: cursorPlansDir(),
    matches: (fileName) => fileName.endsWith('.plan.md'),
    isSafeId: (id) => /^[^/\\]+\.plan\.md$/.test(id),
  };
}

function openCodeConvention(): PlanDocumentFileConvention {
  return {
    dir: openCodePlansDir(),
    matches: (fileName) => fileName.endsWith('.md'),
    isSafeId: (id) => /^[^/\\]+\.md$/.test(id),
  };
}

function sourceFromConvention(convention: () => PlanDocumentFileConvention): PlanDocumentsSource {
  return {
    listForSession: (acpSessionId) => listPlanDocumentsForAcpSession(convention(), acpSessionId),
    getById: (planId, acpSessionId) =>
      getPlanDocumentById(convention(), planId, { sessionId: acpSessionId || null }),
  };
}

const noopSource: PlanDocumentsSource = {
  listForSession: async () => [],
  getById: async () => null,
};

const cursorSource = sourceFromConvention(cursorConvention);
const openCodeSource = sourceFromConvention(openCodeConvention);

export function getPlanDocumentsSource(agentType: string | null | undefined): PlanDocumentsSource {
  switch (agentType) {
    case 'cursor-agent':
      return cursorSource;
    case 'open-code':
      return openCodeSource;
    default:
      return noopSource;
  }
}

/**
 * Plan-mode prompt addendum for OpenCode ACP sessions. OpenCode's built-in
 * plan workflow (plan-file reminder + plan_exit tool) only activates in its
 * TUI — ACP clients get neither — so Nova Code instructs the agent to persist
 * the plan itself, using the same `<!-- session-id -->` convention as Cursor
 * plans, which makes the file visible to openCodePlansDir() above.
 * The plan agent's static permissions allow writes under its data plans dir,
 * so no experimental flags are required.
 */
export function buildOpenCodePlanModeInstruction(acpSessionId: string): string {
  const dir = openCodePlansDir();
  return [
    '---',
    'Nova Code plan-mode instructions:',
    `- Before ending your turn, write your final plan as a markdown file inside \`${dir}\` (name it \`<kebab-case-title>.md\`).`,
    `- The file's FIRST line must be exactly this HTML comment: \`<!-- ${acpSessionId} -->\``,
    '- Follow it with a `# <title>` heading and the plan itself (context, proposed changes, verification).',
    '- Do not implement anything until the user approves the plan.',
  ].join('\n');
}

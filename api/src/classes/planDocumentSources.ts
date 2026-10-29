/**
 * Per-agent plan-document sources.
 *
 * Each agent persists plan files in its own location/convention, made
 * deterministic by the HOME/XDG redirects in config.agentEnv:
 *
 *  - cursor-agent: <configDir>/.cursor/plans/*.plan.md, `<!-- acp-session-uuid -->` header
 *  - open-code:    <workspace>/.opencode/plans/*.md (preferred; matches OpenCode edit allowlist)
 *                  and <XDG_DATA_HOME>/opencode/plans/*.md (legacy / fallback),
 *                  `<!-- acp-session-id -->` header (written via plan-mode prompt
 *                  injection in agents/openCode.ts)
 *  - claude:       <configDir>/.claude/plans/*.md — Claude Code plan mode writes these
 *                  without a session comment; Nova stamps `<!-- acp-session-id -->` on
 *                  claim / Write-to-plans / mark-as-done so the file is source of truth
 *  - others:       no plan-file convention
 */

// node_modules
import { basename, join } from 'path';

// classes
import { config } from './config';
import {
  claimPlanDocumentForSession,
  deletePlanDocumentById,
  ensurePlanSessionTag,
  getPlanDocumentById,
  listPlanDocumentsForAcpSession,
  updatePlanDocumentById,
  type PlanDocumentFileConvention,
  type PlanDocumentSummary,
} from './planDocuments';

export interface PlanDocumentsSource {
  listForSession(acpSessionId: string | null | undefined): Promise<PlanDocumentSummary[]>;
  getById(planId: string, acpSessionId: string | null | undefined): Promise<PlanDocumentSummary | null>;
  deleteById(planId: string, acpSessionId: string | null | undefined): Promise<boolean>;
  updateById(
    planId: string,
    acpSessionId: string | null | undefined,
    markdown: string
  ): Promise<PlanDocumentSummary | null>;
}

export interface PlanDocumentsSourceOptions {
  /** Absolute workspace path; required to discover OpenCode's `.opencode/plans` files. */
  workspacePath?: string | null;
}

function cursorPlansDir(): string {
  return join(config.configDir, '.cursor', 'plans');
}

/** Claude Code plan-mode files (HOME/CLAUDE_CONFIG_DIR → configDir). */
export function claudePlansDir(): string {
  return join(config.configDir, '.claude', 'plans');
}

/**
 * OpenCode resolves its data home from XDG_DATA_HOME, which agentEnv defaults
 * to <configDir>/.local/share for spawned agent processes.
 */
export function openCodePlansDir(): string {
  const xdgDataHome = process.env['XDG_DATA_HOME'] || join(config.configDir, '.local', 'share');
  return join(xdgDataHome, 'opencode', 'plans');
}

/** Workspace-relative OpenCode plans dir — matches the built-in plan-agent edit allowlist. */
export function openCodeWorkspacePlansDir(workspacePath: string): string {
  return join(workspacePath, '.opencode', 'plans');
}

function cursorConvention(): PlanDocumentFileConvention {
  return {
    dir: cursorPlansDir(),
    matches: (fileName) => fileName.endsWith('.plan.md'),
    isSafeId: (id) => /^[^/\\]+\.plan\.md$/.test(id),
  };
}

function openCodeMdConvention(dir: string): PlanDocumentFileConvention {
  return {
    dir,
    matches: (fileName) => fileName.endsWith('.md'),
    isSafeId: (id) => /^[^/\\]+\.md$/.test(id),
  };
}

function claudeConvention(): PlanDocumentFileConvention {
  return {
    dir: claudePlansDir(),
    matches: (fileName) => fileName.endsWith('.md'),
    isSafeId: (id) => /^[^/\\]+\.md$/.test(id),
  };
}

function sourceFromConvention(convention: () => PlanDocumentFileConvention): PlanDocumentsSource {
  return {
    listForSession: (acpSessionId) => listPlanDocumentsForAcpSession(convention(), acpSessionId),
    getById: (planId, acpSessionId) =>
      getPlanDocumentById(convention(), planId, { sessionId: acpSessionId || null }),
    deleteById: (planId, acpSessionId) => deletePlanDocumentById(convention(), planId, acpSessionId),
    updateById: (planId, acpSessionId, markdown) =>
      updatePlanDocumentById(convention(), planId, acpSessionId, markdown),
  };
}

/** Prefer first convention on id collisions (workspace before XDG for open-code). */
function sourceFromConventions(conventions: () => PlanDocumentFileConvention[]): PlanDocumentsSource {
  return {
    listForSession: async (acpSessionId) => {
      const seen = new Set<string>();
      const docs: PlanDocumentSummary[] = [];
      for (const convention of conventions()) {
        for (const doc of await listPlanDocumentsForAcpSession(convention, acpSessionId)) {
          if (seen.has(doc.id)) continue;
          seen.add(doc.id);
          docs.push(doc);
        }
      }
      return docs;
    },
    getById: async (planId, acpSessionId) => {
      for (const convention of conventions()) {
        const doc = await getPlanDocumentById(convention, planId, {
          sessionId: acpSessionId || null,
        });
        if (doc) return doc;
      }
      return null;
    },
    deleteById: async (planId, acpSessionId) => {
      for (const convention of conventions()) {
        if (await deletePlanDocumentById(convention, planId, acpSessionId)) return true;
      }
      return false;
    },
    updateById: async (planId, acpSessionId, markdown) => {
      for (const convention of conventions()) {
        const updated = await updatePlanDocumentById(convention, planId, acpSessionId, markdown);
        if (updated) return updated;
      }
      return null;
    },
  };
}

const noopSource: PlanDocumentsSource = {
  listForSession: async () => [],
  getById: async () => null,
  deleteById: async () => false,
  updateById: async () => null,
};

const cursorSource = sourceFromConvention(cursorConvention);
const claudeSource = sourceFromConvention(claudeConvention);

function openCodeSource(opts?: PlanDocumentsSourceOptions): PlanDocumentsSource {
  return sourceFromConventions(() => {
    const dirs: PlanDocumentFileConvention[] = [];
    const workspacePath = opts?.workspacePath?.trim();
    if (workspacePath) {
      dirs.push(openCodeMdConvention(openCodeWorkspacePlansDir(workspacePath)));
    }
    dirs.push(openCodeMdConvention(openCodePlansDir()));
    return dirs;
  });
}

export function getPlanDocumentsSource(
  agentType: string | null | undefined,
  opts?: PlanDocumentsSourceOptions
): PlanDocumentsSource {
  switch (agentType) {
    case 'cursor-agent':
      return cursorSource;
    case 'open-code':
      return openCodeSource(opts);
    case 'claude':
      return claudeSource;
    default:
      return noopSource;
  }
}

/** Stamp/claim a Claude plan file path mentioned in a tool call. */
export async function tagClaudePlanFileForSession(
  acpSessionId: string | null | undefined,
  planFileId: string
): Promise<PlanDocumentSummary | null> {
  return ensurePlanSessionTag(claudeConvention(), planFileId, acpSessionId);
}

/** Claim the best-matching Claude plan file for this session from markdown. */
export async function claimClaudePlanForSession(
  acpSessionId: string | null | undefined,
  hintMarkdown: string
): Promise<PlanDocumentSummary | null> {
  return claimPlanDocumentForSession(claudeConvention(), acpSessionId, hintMarkdown);
}

/**
 * Associate Claude disk plans with this ACP session using markdown hints and/or
 * explicit plan file ids, then return the tagged docs (disk = source of truth).
 */
export async function syncClaudePlanDocumentsForSession(
  acpSessionId: string | null | undefined,
  opts?: { markdownHints?: string[]; planFileIds?: string[] }
): Promise<PlanDocumentSummary[]> {
  if (!acpSessionId) return [];

  for (const planFileId of opts?.planFileIds ?? []) {
    await tagClaudePlanFileForSession(acpSessionId, planFileId);
  }
  for (const hint of opts?.markdownHints ?? []) {
    if (hint.trim()) await claimClaudePlanForSession(acpSessionId, hint);
  }
  return listPlanDocumentsForAcpSession(claudeConvention(), acpSessionId);
}

/** Basename of a `.claude/plans/*.md` path, or null if not a Claude plan file. */
export function claudePlanFileIdFromPath(filePath: string | null | undefined): string | null {
  if (!filePath || typeof filePath !== 'string') return null;
  const normalized = filePath.replace(/\\/g, '/');
  const marker = '/.claude/plans/';
  const idx = normalized.lastIndexOf(marker);
  if (idx < 0) return null;
  const id = basename(normalized.slice(idx + marker.length));
  return claudeConvention().isSafeId(id) ? id : null;
}

/**
 * Extract Claude plan file basenames from ACP stream/event JSON lines
 * (Write/Edit tool_call rawInput.file_path).
 */
export function claudePlanFileIdsFromEventLines(lines: string[]): string[] {
  const ids = new Set<string>();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as {
        update?: {
          sessionUpdate?: string;
          rawInput?: unknown;
          path?: unknown;
          filePath?: unknown;
        };
      };
      const update = parsed.update;
      if (!update) continue;
      const raw =
        update.rawInput && typeof update.rawInput === 'object' && !Array.isArray(update.rawInput)
          ? (update.rawInput as Record<string, unknown>)
          : null;
      const candidates = [
        typeof raw?.file_path === 'string' ? raw.file_path : '',
        typeof raw?.filePath === 'string' ? raw.filePath : '',
        typeof raw?.path === 'string' ? raw.path : '',
        typeof update.path === 'string' ? update.path : '',
        typeof update.filePath === 'string' ? update.filePath : '',
      ];
      for (const candidate of candidates) {
        const id = claudePlanFileIdFromPath(candidate);
        if (id) ids.add(id);
      }
    } catch {
      // ignore non-JSON lines
    }
  }
  return [...ids];
}

/** Latest plan markdown bodies from ACP `sessionUpdate: plan` event lines (newest first). */
export function planMarkdownHintsFromEventLines(lines: string[]): string[] {
  const hints: string[] = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]!) as {
        update?: { sessionUpdate?: string; markdown?: unknown };
      };
      if (parsed.update?.sessionUpdate !== 'plan') continue;
      const markdown = typeof parsed.update.markdown === 'string' ? parsed.update.markdown.trim() : '';
      if (markdown) hints.push(markdown);
    } catch {
      // ignore
    }
  }
  return hints;
}

/**
 * Plan-mode prompt addendum for OpenCode ACP sessions. OpenCode's built-in
 * plan workflow (plan-file reminder + plan_exit tool) only activates in its
 * TUI — ACP clients get neither — so Nova Code instructs the agent to persist
 * the plan itself. Prefer `.opencode/plans/` (OpenCode's edit allowlist) over
 * the XDG data path, and explicitly override the plan agent's "read-only"
 * system wording so obedient models (e.g. ChatGPT) still write the plan file.
 */
export function buildOpenCodePlanModeInstruction(acpSessionId: string): string {
  const workspaceRelDir = '.opencode/plans';
  const xdgDir = openCodePlansDir();
  return [
    '---',
    'Nova Code plan-mode instructions:',
    'IMPORTANT: Plan mode is read-only for the project, with ONE required exception —',
    'you MUST write the plan markdown file itself. That exception overrides any',
    '"read-only", "ZERO exceptions", or "do not edit files" wording in your system prompt.',
    `This is not implementation: only create/update a plan file under \`${workspaceRelDir}/\`.`,
    `- Before ending your turn, write your final plan to \`${workspaceRelDir}/<kebab-case-title>.md\` (create the directory if needed).`,
    `- Prefer that relative path (OpenCode permissions allow it). Fallback absolute path: \`${xdgDir}/<kebab-case-title>.md\`.`,
    `- The file's FIRST line must be exactly this HTML comment: \`<!-- ${acpSessionId} -->\``,
    '- Follow it with a `# <title>` heading and the plan itself (context, proposed changes, verification).',
    '- Do not implement, refactor, or edit any other files until the user approves the plan.',
  ].join('\n');
}

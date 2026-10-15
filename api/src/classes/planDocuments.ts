/**
 * Agent-agnostic plan-file engine — scans a plans directory for markdown files
 * tagged with an ACP session id and turns them into PlanDocumentSummaries.
 *
 * Per-agent directory/filename conventions live in planDocumentSources.ts;
 * this module only knows the shared file format:
 *
 *     <!-- <acp-session-id> -->
 *     # Plan title
 *     ...
 *
 * Claude's native plan files often lack the session comment until Nova stamps
 * it (claim / first mark-as-done / Write-to-plans). Untagged files are ignored
 * by listForSession until claimed.
 */

// node_modules
import type { Dirent } from 'fs';
import { readdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

export interface PlanDocumentSummary {
  id: string;
  sessionId: string;
  title: string;
  markdown: string;
}

/** File-location convention for one agent's plan documents. */
export interface PlanDocumentFileConvention {
  /** Plans directory (already resolved for the declaring agent). */
  dir: string;
  /** Accepted plan file names (e.g. Cursor's `*.plan.md`, OpenCode's `*.md`). */
  matches: (fileName: string) => boolean;
  /** Validates a requested plan id before reading (path-traversal guard). */
  isSafeId: (id: string) => boolean;
}

/** Parsed plan file; sessionId is empty when the leading comment is missing. */
interface ParsedPlanFile {
  id: string;
  sessionId: string;
  title: string;
  markdown: string;
  raw: string;
}

// Session ids are agent-specific: Cursor uses UUIDs, OpenCode uses `ses_…`.
// Accept any non-whitespace token inside the leading HTML comment.
const PLAN_SESSION_ID_RE = /^<!--\s*(\S+)\s*-->\s*/;

function stripPlanMetadata(content: string): string {
  let body = content.replace(PLAN_SESSION_ID_RE, '').trimStart();
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3);
    if (end >= 0) {
      const afterEnd = body.indexOf('\n', end + 4);
      body = afterEnd >= 0 ? body.slice(afterEnd + 1) : '';
    }
  }
  return body.trim();
}

function firstMarkdownHeading(markdown: string): string {
  return markdown.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() ?? 'Plan';
}

function normalizePlanMatchText(markdown: string): string {
  return markdown
    .toLowerCase()
    .replace(/(?:\s*-\s*done\b)/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parsePlanFile(id: string, content: string): ParsedPlanFile | null {
  const markdown = stripPlanMetadata(content);
  if (!markdown) return null;
  return {
    id,
    sessionId: content.match(PLAN_SESSION_ID_RE)?.[1] ?? '',
    title: firstMarkdownHeading(markdown),
    markdown,
    raw: content,
  };
}

function toSummary(parsed: ParsedPlanFile): PlanDocumentSummary | null {
  if (!parsed.sessionId) return null;
  return {
    id: parsed.id,
    sessionId: parsed.sessionId,
    title: parsed.title,
    markdown: parsed.markdown,
  };
}

function planDocumentFromContent(id: string, content: string): PlanDocumentSummary | null {
  const parsed = parsePlanFile(id, content);
  return parsed ? toSummary(parsed) : null;
}

/** Score how well a disk plan matches a hint (title + shared tokens). Higher is better. */
export function scorePlanMarkdownMatch(hintMarkdown: string, candidateMarkdown: string): number {
  const hint = hintMarkdown.trim();
  const candidate = candidateMarkdown.trim();
  if (!hint || !candidate) return 0;

  const hintTitle = normalizePlanMatchText(firstMarkdownHeading(hint));
  const candidateTitle = normalizePlanMatchText(firstMarkdownHeading(candidate));
  let score = 0;
  if (hintTitle && candidateTitle && hintTitle === candidateTitle) score += 10_000;

  const hintNorm = normalizePlanMatchText(hint);
  const candidateNorm = normalizePlanMatchText(candidate);
  if (!hintNorm || !candidateNorm) return score;
  if (hintNorm === candidateNorm) return score + 5_000;
  if (candidateNorm.includes(hintNorm.slice(0, Math.min(80, hintNorm.length)))) score += 500;
  if (hintNorm.includes(candidateNorm.slice(0, Math.min(80, candidateNorm.length)))) score += 300;

  const hintTokens = new Set(hintNorm.split(' ').filter((t) => t.length >= 4).slice(0, 40));
  let shared = 0;
  for (const token of candidateNorm.split(' ')) {
    if (hintTokens.has(token)) shared += 1;
  }
  score += shared * 10;
  return score;
}

async function readParsedPlanFile(
  convention: PlanDocumentFileConvention,
  id: string
): Promise<ParsedPlanFile | null> {
  if (!convention.isSafeId(id)) return null;
  try {
    const content = await readFile(join(convention.dir, id), 'utf8');
    return parsePlanFile(id, content);
  } catch {
    return null;
  }
}

async function listParsedPlanFiles(
  convention: PlanDocumentFileConvention
): Promise<ParsedPlanFile[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(convention.dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const docs: ParsedPlanFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !convention.matches(entry.name)) continue;
    const parsed = await readParsedPlanFile(convention, entry.name);
    if (parsed) docs.push(parsed);
  }
  return docs;
}

/**
 * Ensures the plan file is tagged with this ACP session id (stamps the leading
 * comment when missing). Rejects files owned by another session.
 */
export async function ensurePlanSessionTag(
  convention: PlanDocumentFileConvention,
  id: string,
  acpSessionId: string | null | undefined
): Promise<PlanDocumentSummary | null> {
  if (!acpSessionId || !convention.isSafeId(id)) return null;

  const parsed = await readParsedPlanFile(convention, id);
  if (!parsed) return null;
  if (parsed.sessionId && parsed.sessionId !== acpSessionId) return null;
  if (parsed.sessionId === acpSessionId) return toSummary(parsed);

  const nextContent = `<!-- ${acpSessionId} -->\n${parsed.markdown}\n`;
  try {
    await writeFile(join(convention.dir, id), nextContent, 'utf8');
  } catch {
    return null;
  }
  return planDocumentFromContent(id, nextContent);
}

/**
 * Finds the best-matching untagged (or already-ours) plan file for this session
 * and stamps the session comment. Does not overwrite the plan body.
 */
export async function claimPlanDocumentForSession(
  convention: PlanDocumentFileConvention,
  acpSessionId: string | null | undefined,
  hintMarkdown: string
): Promise<PlanDocumentSummary | null> {
  if (!acpSessionId || !hintMarkdown.trim()) return null;

  const files = await listParsedPlanFiles(convention);
  const candidates = files.filter((file) => !file.sessionId || file.sessionId === acpSessionId);
  let best: ParsedPlanFile | null = null;
  let bestScore = 0;
  for (const file of candidates) {
    const score = scorePlanMarkdownMatch(hintMarkdown, file.markdown);
    // Already-tagged-for-us files need only a weak match; untagged need a real signal.
    const minScore = file.sessionId === acpSessionId ? 1 : 500;
    if (score < minScore) continue;
    if (score > bestScore) {
      best = file;
      bestScore = score;
    }
  }
  // Single untagged plan in the dir + any hint from this session → claim it.
  if (!best) {
    const untagged = candidates.filter((file) => !file.sessionId);
    if (untagged.length === 1) best = untagged[0]!;
  }
  if (!best) return null;
  return ensurePlanSessionTag(convention, best.id, acpSessionId);
}

export async function getPlanDocumentById(
  convention: PlanDocumentFileConvention,
  id: string,
  opts?: { sessionId?: string | null }
): Promise<PlanDocumentSummary | null> {
  const parsed = await readParsedPlanFile(convention, id);
  if (!parsed?.sessionId) return null;
  if (opts?.sessionId && parsed.sessionId !== opts.sessionId) return null;
  return toSummary(parsed);
}

/**
 * Deletes a plan file after verifying it belongs to the given ACP session.
 * Returns true when the file was removed, false when it was missing/unsafe/
 * owned by another session.
 */
export async function deletePlanDocumentById(
  convention: PlanDocumentFileConvention,
  id: string,
  acpSessionId: string | null | undefined
): Promise<boolean> {
  if (!acpSessionId || !convention.isSafeId(id)) return false;

  const existing = await getPlanDocumentById(convention, id, { sessionId: acpSessionId });
  if (!existing) return false;

  try {
    await unlink(join(convention.dir, id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Rewrites a plan file's markdown body while preserving the session-id comment
 * (and any YAML frontmatter that precedes the body). Untagged Claude plan files
 * are claimed (session comment stamped) on first update.
 */
export async function updatePlanDocumentById(
  convention: PlanDocumentFileConvention,
  id: string,
  acpSessionId: string | null | undefined,
  markdown: string
): Promise<PlanDocumentSummary | null> {
  if (!acpSessionId || !convention.isSafeId(id)) return null;

  const path = join(convention.dir, id);
  const parsed = await readParsedPlanFile(convention, id);
  if (!parsed) return null;
  if (parsed.sessionId && parsed.sessionId !== acpSessionId) return null;

  const body = markdown.trim();
  if (!body) return null;

  let nextContent: string;
  if (parsed.sessionId) {
    const bodyIdx = parsed.raw.indexOf(parsed.markdown);
    nextContent =
      bodyIdx >= 0 ? `${parsed.raw.slice(0, bodyIdx)}${body}\n` : `<!-- ${acpSessionId} -->\n${body}\n`;
  } else {
    nextContent = `<!-- ${acpSessionId} -->\n${body}\n`;
  }

  try {
    await writeFile(path, nextContent, 'utf8');
  } catch {
    return null;
  }

  return planDocumentFromContent(id, nextContent);
}

export async function listPlanDocumentsForAcpSession(
  convention: PlanDocumentFileConvention,
  acpSessionId: string | null | undefined
): Promise<PlanDocumentSummary[]> {
  if (!acpSessionId) return [];

  const docs: PlanDocumentSummary[] = [];
  for (const parsed of await listParsedPlanFiles(convention)) {
    if (parsed.sessionId !== acpSessionId) continue;
    const summary = toSummary(parsed);
    if (summary) docs.push(summary);
  }
  return docs;
}

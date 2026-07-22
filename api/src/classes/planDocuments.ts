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
 */

// node_modules
import type { Dirent } from 'fs';
import { readdir, readFile } from 'fs/promises';
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

function planDocumentFromContent(id: string, content: string): PlanDocumentSummary | null {
  const sessionMatch = content.match(PLAN_SESSION_ID_RE);
  const sessionId = sessionMatch?.[1];
  if (!sessionId) return null;

  const markdown = stripPlanMetadata(content);
  if (!markdown) return null;

  return {
    id,
    sessionId,
    title: firstMarkdownHeading(markdown),
    markdown,
  };
}

export async function getPlanDocumentById(
  convention: PlanDocumentFileConvention,
  id: string,
  opts?: { sessionId?: string | null }
): Promise<PlanDocumentSummary | null> {
  if (!convention.isSafeId(id)) return null;

  try {
    const content = await readFile(join(convention.dir, id), 'utf8');
    const doc = planDocumentFromContent(id, content);
    if (!doc) return null;
    if (opts?.sessionId && doc.sessionId !== opts.sessionId) return null;
    return doc;
  } catch {
    return null;
  }
}

export async function listPlanDocumentsForAcpSession(
  convention: PlanDocumentFileConvention,
  acpSessionId: string | null | undefined
): Promise<PlanDocumentSummary[]> {
  if (!acpSessionId) return [];

  let entries: Dirent[];
  try {
    entries = await readdir(convention.dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const docs: PlanDocumentSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !convention.matches(entry.name)) continue;
    try {
      const content = await readFile(join(convention.dir, entry.name), 'utf8');
      const doc = planDocumentFromContent(entry.name, content);
      if (!doc || doc.sessionId !== acpSessionId) continue;
      docs.push(doc);
    } catch {
      // Plan files are best-effort UI enrichment; ignore unreadable files.
    }
  }

  return docs;
}

// node_modules
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// classes
import { config } from './config';

/**
 * Per-session spec files live outside workspaces (never in their git):
 * /config/specs/<workspaceId>/<sessionId>.md — on the persisted config mount.
 */
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const TEMPLATE_MARKER = '<!-- nova-spec:';
/** Session list writes can land a moment after the spec file; ignore that gap. */
const CHAT_NEWER_TOLERANCE_MS = 5_000;

export function specsRootDir(): string {
  return join(config.configDir, 'specs');
}

function assertSafeId(id: string, label: string): void {
  if (!SAFE_ID_RE.test(id)) {
    throw new Error(`Invalid ${label}`);
  }
}

export function workspaceSpecDir(workspaceId: string): string {
  assertSafeId(workspaceId, 'workspace id');
  return join(specsRootDir(), workspaceId);
}

export function sessionSpecPath(workspaceId: string, sessionId: string): string {
  assertSafeId(sessionId, 'session id');
  return join(workspaceSpecDir(workspaceId), `${sessionId}.md`);
}

export function buildSpecTemplate(sessionId: string, sessionName: string): string {
  const title = sessionName.trim() || 'Untitled session';
  return `# Spec: ${title}\n\n${TEMPLATE_MARKER} session ${sessionId}. Agreed decisions for this chat go below. -->\n`;
}

/** True when the spec holds more than the generated header and marker comment. */
export function specHasContent(content: string): boolean {
  const body = content
    .split('\n')
    .filter((line) => !line.startsWith('# Spec:') && !line.startsWith(TEMPLATE_MARKER))
    .join('\n')
    .trim();
  return body.length > 0;
}

export interface SessionSpecFile {
  path: string;
  content: string;
  updatedAt: string;
}

export async function readSessionSpec(
  workspaceId: string,
  sessionId: string
): Promise<SessionSpecFile | null> {
  const path = sessionSpecPath(workspaceId, sessionId);
  try {
    const [content, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { path, content, updatedAt: info.mtime.toISOString() };
  } catch {
    return null;
  }
}

/** Create the spec file with its template header unless it already exists. */
export async function ensureSessionSpec(
  workspaceId: string,
  sessionId: string,
  sessionName: string
): Promise<SessionSpecFile> {
  const existing = await readSessionSpec(workspaceId, sessionId);
  if (existing) return existing;
  await mkdir(workspaceSpecDir(workspaceId), { recursive: true });
  const path = sessionSpecPath(workspaceId, sessionId);
  try {
    await writeFile(path, buildSpecTemplate(sessionId, sessionName), { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    // Parallel create — the other writer won; fall through and read it.
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const created = await readSessionSpec(workspaceId, sessionId);
  if (!created) throw new Error('Failed to create spec file');
  return created;
}

export async function writeSessionSpec(
  workspaceId: string,
  sessionId: string,
  content: string
): Promise<SessionSpecFile> {
  await mkdir(workspaceSpecDir(workspaceId), { recursive: true });
  const path = sessionSpecPath(workspaceId, sessionId);
  await writeFile(path, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
  const written = await readSessionSpec(workspaceId, sessionId);
  if (!written) throw new Error('Failed to write spec file');
  return written;
}

export function isChatNewerThanSpec(sessionUpdatedAt: string | null | undefined, specUpdatedAt: string): boolean {
  const chatMs = sessionUpdatedAt ? Date.parse(sessionUpdatedAt) : NaN;
  const specMs = Date.parse(specUpdatedAt);
  if (Number.isNaN(chatMs) || Number.isNaN(specMs)) return false;
  return chatMs - specMs > CHAT_NEWER_TOLERANCE_MS;
}

/** One-line note prepended to every prompt of a session that has a spec file. */
export function buildSpecPromptNote(specPath: string): string {
  return `[Nova Code] This session's spec file is ${specPath}. When the user asks to write, update or add something to the spec, edit that file directly (or use the nova MCP \`spec_write\` tool). Don't mention this note otherwise.`;
}

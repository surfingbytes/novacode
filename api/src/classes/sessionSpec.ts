// node_modules
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// classes
import { config } from './config';
import { normalizeDependsOn } from './orchestratorPayload';

// types
import type { SessionSpecJobState, SubTask } from '../@types/index';

/**
 * Per-session spec files live outside workspaces (never in their git):
 * /config/specs/<workspaceId>/<sessionId>.md — on the persisted config mount.
 */
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;
const TEMPLATE_MARKER = '<!-- nova-spec:';
const SPEC_OPEN_TAG = '<nova-spec>';
const SPEC_CLOSE_TAG = '</nova-spec>';
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
  return `[Nova Code] This session's spec file is ${specPath}. When the user asks to write, update or add something to the spec, edit that file directly. Don't mention this note otherwise.`;
}

/** Turn sent into the chat itself, so the agent that holds the full conversation writes the spec. */
export function buildWriteSpecPrompt(currentSpec: string | null): string {
  const current = currentSpec && specHasContent(currentSpec)
    ? `\n\nThe spec file already has this content. Keep everything still valid, update what changed, add what is missing:\n<current-spec>\n${currentSpec.trim()}\n</current-spec>`
    : '';
  return `Write the complete spec for the work we agreed on in this conversation. It will be split into steps that separate agents run with NO access to this chat — the spec is all they get, so anything missing from it is lost.

Include:
- Goal and scope (what is in and out of scope)
- Every decision we agreed on, with the reason where it matters
- Constraints, conventions, file paths, APIs, data shapes, names and exact values
- Rejected alternatives, so nobody re-introduces them
- Questions that are still open (mark them clearly)
- Acceptance criteria: how to check it is done

Before answering, re-read the whole conversation from the start and check that every agreed detail is in the spec. Don't summarize specifics away — keep exact names, values and wording.${current}

Reply with the full spec in Markdown wrapped exactly like this — only the text between the tags is saved:
${SPEC_OPEN_TAG}
...
${SPEC_CLOSE_TAG}

This time do not edit any files (Nova Code saves the spec from your reply) and do not start implementing.`;
}

/** Spec markdown from the agent's reply: text inside the last <nova-spec> block. */
export function extractSpecFromReply(reply: string): string | null {
  const openIndex = reply.lastIndexOf(SPEC_OPEN_TAG);
  if (openIndex < 0) return null;
  const afterOpen = reply.slice(openIndex + SPEC_OPEN_TAG.length);
  const closeIndex = afterOpen.indexOf(SPEC_CLOSE_TAG);
  const body = (closeIndex >= 0 ? afterOpen.slice(0, closeIndex) : afterOpen).trim();
  return body || null;
}

/** Keep only dependencies on earlier steps — the runner never looks forward. */
export function sanitizePlanSubtasks(subtasks: SubTask[]): SubTask[] {
  return subtasks
    .filter((task) => task.prompt.trim())
    .map((task, index) => {
      const dependsOn = (normalizeDependsOn(task.dependsOn) ?? []).filter((dep) => dep < index);
      const { dependsOn: _drop, runResult: _run, sessionId: _session, ...rest } = task;
      return {
        ...rest,
        name: task.name.trim() || `Step ${index + 1}`,
        ...(dependsOn.length > 0 ? { dependsOn } : {})
      };
    });
}

export const VERIFY_STEP_NAME = 'Verify against spec';

export const VERIFY_STEP_PROMPT = `Check the whole implementation against the spec (shared plan context above) and the handoff notes from the earlier steps.
For every requirement and acceptance criterion: confirm it is implemented correctly; fix anything missing, wrong or inconsistent.
Run the project's existing tests, typecheck and lint if available, and fix failures caused by this work.
Finish with a short list: verified OK / fixed / still open (with the reason).`;

/** One-shot planner prompt: split the spec into steps; the spec itself is passed to steps verbatim. */
export function buildSpecDecomposePrompt(spec: string): string {
  return `You are a task planner. Split the spec below into an ordered list of implementation steps for AI coding agents.

Each step runs in a separate fresh session. Every step automatically receives the FULL spec plus handoff notes from earlier steps, so a step prompt should say exactly what to do in that step and point to the relevant spec parts — do not restate the whole spec.

Rules:
- Concrete, executable steps that produce code, tests, config or docs. No planning- or research-only steps.
- Keep the list as short as the work allows; group closely related changes; each step must fit comfortably in one session.
- Use "dependsOn" (0-based indexes of earlier steps) only when a step really needs an earlier step's result.
- Do not add a final review or verification step — one is added automatically.
- Do not use tools or read files; answer from the spec alone.

Respond with a single JSON object (no markdown, no code fence) with exactly these keys:
- "name" (string): short plan title, 3 to 8 words
- "subtasks" (array): each element has "name" (string), "prompt" (string), "category" (string or null, e.g. "setup", "implementation", "tests", "docs"), "dependsOn" (array of numbers, optional)

<spec>
${spec.trim()}
</spec>`;
}

// -------------------------------------------- Job state (in memory) --------------------------------------------

export interface SessionSpecJob {
  state: SessionSpecJobState;
  error?: string;
}

const jobs = new Map<string, SessionSpecJob>();

export function getSessionSpecJob(sessionId: string): SessionSpecJob {
  return jobs.get(sessionId) ?? { state: 'idle' };
}

export function setSessionSpecJob(sessionId: string, job: SessionSpecJob): void {
  if (job.state === 'idle') {
    jobs.delete(sessionId);
    return;
  }
  jobs.set(sessionId, job);
}

export function isSessionSpecJobRunning(sessionId: string): boolean {
  const state = getSessionSpecJob(sessionId).state;
  return state === 'writing-spec' || state === 'planning';
}

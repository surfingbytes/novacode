// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { getAgentModels } from './agentModels';
import { closeClaudeAcpForNovaSession } from './claudeAcp';
import { getAgentAdapter } from './agents';
import type { AcpPermissionHandler } from './acpSubprocessRunner';
import { appendAssistantText, assistantTextFromEvents } from './assistantText';

// types
import { pickInexpensiveModel } from '@novacode/shared';
import type { AgentType, ChatMessage } from '../@types';

export { appendAssistantText } from './assistantText';

const denyAllPermission: AcpPermissionHandler = () => ({
  outcome: { outcome: 'cancelled' }
});

const SESSION_TITLE_MAX_LENGTH = 60;
const SESSION_TITLE_PROMPT_MAX_CHARS = 1500;
const COMMIT_MESSAGE_SUBJECT_MAX_LENGTH = 72;
const COMMIT_MESSAGE_BODY_MAX_CHARS = 400;
/** Hard cap so reverse proxies (often ~60s) return an app error instead of a dropped connection. */
const ONE_SHOT_AGENT_TIMEOUT_MS = 45_000;
const RULES_PREAMBLE_RE =
  /\b(?:i(?:'ve| have)? loaded|rules? (?:are |were )?loaded|the following rules|workspace rules\b.*\bapply|i will follow|follow them as)\b/i;
const PAYWALL_TEXT_RE =
  /upgrade your plan|plan to continue|usage (?:limit|quota)|out of (?:extra )?requests|limit reached/i;

export async function resolveOneShotModel(
  configured: string | null | undefined,
  agentType: AgentType
): Promise<string> {
  const trimmed = configured?.trim();
  if (trimmed) {
    return trimmed;
  }
  try {
    return pickInexpensiveModel((await getAgentModels(agentType)).models);
  } catch {
    return 'auto';
  }
}

export function cleanGeneratedAgentText(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:text)?/i, '')
    .replace(/```$/i, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();
}

function truncateOnWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const sliced = text.slice(0, maxLength);
  const lastSpace = sliced.lastIndexOf(' ');
  const cut = lastSpace >= 18 ? sliced.slice(0, lastSpace) : sliced;
  return cut.trimEnd();
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z])/);
}

function isRulesPreamble(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }
  return /\brules?\b/i.test(trimmed) && RULES_PREAMBLE_RE.test(trimmed);
}

function isEntirelyRulesPreamble(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }
  const sentences = splitSentences(trimmed);
  return sentences.every((sentence) => isRulesPreamble(sentence));
}

function stripRulesPreamble(text: string): string {
  const paragraphs = text.split(/\n\s*\n/);
  while (paragraphs.length > 0 && isEntirelyRulesPreamble(paragraphs[0] ?? '')) {
    paragraphs.shift();
  }
  let remaining = paragraphs.join('\n\n').trim();
  const lines = remaining.split('\n');
  while (lines.length > 0 && isEntirelyRulesPreamble(lines[0] ?? '')) {
    lines.shift();
  }
  remaining = lines.join('\n').trim();
  const sentences = splitSentences(remaining);
  while (sentences.length > 1 && isRulesPreamble(sentences[0] ?? '')) {
    sentences.shift();
  }
  return sentences.join(' ').trim();
}

export function cleanSessionTitle(raw: string): string {
  const firstLine = cleanGeneratedAgentText(raw).split('\n')[0]?.trim() ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').replace(/[.]+$/g, '').trim();
  if (!collapsed || PAYWALL_TEXT_RE.test(collapsed)) {
    return '';
  }
  return truncateOnWordBoundary(collapsed, SESSION_TITLE_MAX_LENGTH);
}

/** Agent replied with a plan/quota notice instead of the requested text. */
export function isPaywallText(raw: string): boolean {
  return PAYWALL_TEXT_RE.test(raw);
}

export function cleanCommitMessage(raw: string): string {
  const text = stripRulesPreamble(cleanGeneratedAgentText(raw));
  if (!text || PAYWALL_TEXT_RE.test(text)) {
    return '';
  }
  const [firstLine, ...rest] = text.split('\n');
  const subject = truncateOnWordBoundary(firstLine.replace(/\s+/g, ' ').trim(), COMMIT_MESSAGE_SUBJECT_MAX_LENGTH);
  if (!subject) {
    return '';
  }
  const body = stripRulesPreamble(rest.join('\n').trim());
  if (!body) {
    return subject;
  }
  return `${subject}\n\n${truncateOnWordBoundary(body, COMMIT_MESSAGE_BODY_MAX_CHARS)}`;
}

export function buildCommitMessagePrompt(diff: string): string {
  return `Write the git commit message for these changes. Your entire reply is used as the commit message.

Rules:
- Return only the commit message text.
- Do not mention rules, tools, files, or your process.
- Do not use tools or read files.
- Use an imperative subject line.
- Keep the subject under 72 characters.
- Add a short body only if it helps explain why.
- Do not wrap the answer in quotes or markdown fences.

Diff:
${diff}`;
}

export function buildSessionTitlePrompt(text: string, imageCount: number): string {
  const clipped = text.trim().slice(0, SESSION_TITLE_PROMPT_MAX_CHARS);
  const attachmentLine =
    imageCount > 0
      ? `\nThe user also attached ${imageCount} image${imageCount === 1 ? '' : 's'}.`
      : '';
  return `Generate a short title for a coding chat session from the user's first message.

Rules:
- Return only the title text.
- 3 to 8 words that capture the user's intent.
- Do not quote or truncate the message.
- No quotes, markdown, or trailing punctuation.
- Do not use tools or read files.

User message:
${clipped || '(no text)'}${attachmentLine}`;
}

export function buildSessionTitlePromptFromAssistant(assistantText: string): string {
  const clipped = assistantText.trim().slice(0, SESSION_TITLE_PROMPT_MAX_CHARS);
  return `Generate a short title for a coding chat session from the assistant's first reply. The user sent only an image, so this reply is the best description of the topic.

Rules:
- Return only the title text.
- 3 to 8 words that capture the topic.
- Do not quote or truncate the reply.
- No quotes, markdown, or trailing punctuation.
- Do not use tools or read files.

Assistant reply:
${clipped || '(no text)'}`;
}

/** Plain assistant prose from the first assistant turn that has text. */
export function extractFirstAssistantText(messages: ChatMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    if (message.content?.trim()) {
      return message.content.trim();
    }
    if (!message.events?.length) {
      continue;
    }
    const text = assistantTextFromEvents(message.events).trim();
    if (text) {
      return text;
    }
  }
  return '';
}

/** One-shot runs have no Nova session row: the embedded Claude agent is disposed by run id. */
async function cancelOneShotRun(agentType: AgentType, runId: string): Promise<void> {
  if (agentType === 'claude') {
    await closeClaudeAcpForNovaSession(runId);
    return;
  }
  await getAgentAdapter(agentType).cancel(runId);
}

export async function runOneShotAgentText(params: {
  agentType: AgentType;
  cwd: string;
  promptText: string;
  model: string;
  claudeToken?: string | null;
  runIdPrefix?: string;
  /** Cancel tool-permission requests so the agent only returns text. */
  denyTools?: boolean;
  /** Override the default one-shot wall-clock timeout (ms). */
  timeoutMs?: number;
}): Promise<string> {
  const chunks: string[] = [];
  const onEvent = (line: string): void => appendAssistantText(line, chunks);
  const runId = `${params.runIdPrefix ?? 'one-shot'}-${randomUUID()}`;
  const permission = params.denyTools ? denyAllPermission : undefined;
  const timeoutMs = params.timeoutMs ?? ONE_SHOT_AGENT_TIMEOUT_MS;

  const runAgent = async (): Promise<string> => {
    let result: { error?: string };
    try {
      result = await getAgentAdapter(params.agentType).run({
        novaSessionId: runId,
        acpSessionId: null,
        cwd: params.cwd,
        promptText: params.promptText,
        model: params.model,
        claudeToken: params.claudeToken,
        onEvent,
        onRequestPermission: permission
      });
    } finally {
      if (params.agentType === 'claude') await closeClaudeAcpForNovaSession(runId);
    }

    if (result.error) {
      throw new Error(result.error);
    }
    const message = cleanGeneratedAgentText(chunks.join(''));
    if (!message) {
      throw new Error('AI did not return text');
    }
    return message;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void cancelOneShotRun(params.agentType, runId);
      reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s generating text`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([runAgent(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

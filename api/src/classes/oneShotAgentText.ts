// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { runClaudeAcp } from './claudeAcp';
import { runCodexAcp } from './codexAcp';
import { runCursorAcp } from './cursorAcp';
import { runOpenCodeAcp } from './openCodeAcp';
import { runVibeAcp } from './vibeAcp';
import type { AcpPermissionHandler } from './acpSubprocessRunner';

// types
import type { AgentType, ChatMessage } from '../@types';

const denyAllPermission: AcpPermissionHandler = () => ({
  outcome: { outcome: 'cancelled' }
});

const SESSION_TITLE_MAX_LENGTH = 60;
const SESSION_TITLE_PROMPT_MAX_CHARS = 1500;

export const ONE_SHOT_AGENT_TYPES: AgentType[] = [
  'cursor-agent',
  'claude',
  'mistral-vibe',
  'open-code',
  'codex'
];

export function appendAssistantText(line: string, chunks: string[]): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return;
  }

  if (typeof event.sessionId === 'string' && event.update && typeof event.update === 'object') {
    const update = event.update as Record<string, unknown>;
    const content = update.content as { type?: string; text?: string } | undefined;
    if (update.sessionUpdate === 'agent_message_chunk' && content?.type === 'text' && content.text) {
      chunks.push(content.text);
    }
    return;
  }

  if (event.type === 'stream' && typeof event.data === 'string') {
    appendAssistantText(event.data, chunks);
    return;
  }

  if (event.type === 'assistant' && Array.isArray((event.message as Record<string, unknown>)?.content)) {
    const content = (event.message as Record<string, unknown>).content as Array<{
      type?: string;
      text?: string;
    }>;
    for (const block of content) {
      if (block.type === 'text' && block.text) {
        chunks.push(block.text);
      }
    }
    return;
  }

  if ((event.role === 'assistant' || event.type === 'assistant') && typeof event.content === 'string') {
    chunks.push(event.content);
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

export function cleanSessionTitle(raw: string): string {
  const firstLine = cleanGeneratedAgentText(raw).split('\n')[0]?.trim() ?? '';
  const collapsed = firstLine.replace(/\s+/g, ' ').replace(/[.]+$/g, '').trim();
  if (!collapsed) {
    return '';
  }
  if (collapsed.length <= SESSION_TITLE_MAX_LENGTH) {
    return collapsed;
  }
  const sliced = collapsed.slice(0, SESSION_TITLE_MAX_LENGTH);
  const lastSpace = sliced.lastIndexOf(' ');
  const cut = lastSpace >= 18 ? sliced.slice(0, lastSpace) : sliced;
  return cut.trimEnd();
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
    const chunks: string[] = [];
    for (const line of message.events) {
      appendAssistantText(line, chunks);
    }
    const text = chunks.join('').trim();
    if (text) {
      return text;
    }
  }
  return '';
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
}): Promise<string> {
  const chunks: string[] = [];
  const onEvent = (line: string): void => appendAssistantText(line, chunks);
  const runId = `${params.runIdPrefix ?? 'one-shot'}-${randomUUID()}`;
  const permission = params.denyTools ? denyAllPermission : undefined;
  let result: { error?: string };

  if (params.agentType === 'open-code') {
    result = await runOpenCodeAcp(
      { acpSessionId: null, cwd: params.cwd, promptText: params.promptText, model: params.model },
      onEvent,
      runId,
      undefined,
      permission
    );
  } else if (params.agentType === 'codex') {
    result = await runCodexAcp(
      { acpSessionId: null, cwd: params.cwd, promptText: params.promptText, model: params.model },
      onEvent,
      runId,
      undefined,
      permission
    );
  } else if (params.agentType === 'mistral-vibe') {
    result = await runVibeAcp(
      { acpSessionId: null, cwd: params.cwd, promptText: params.promptText },
      onEvent,
      runId,
      undefined,
      permission
    );
  } else if (params.agentType === 'claude') {
    result = await runClaudeAcp(
      {
        acpSessionId: null,
        cwd: params.cwd,
        promptText: params.promptText,
        model: params.model,
        claudeToken: params.claudeToken
      },
      onEvent,
      undefined,
      permission
    );
  } else {
    result = await runCursorAcp(
      { acpSessionId: null, cwd: params.cwd, promptText: params.promptText, model: params.model },
      onEvent,
      runId,
      undefined,
      permission
    );
  }

  if (result.error) {
    throw new Error(result.error);
  }
  const message = cleanGeneratedAgentText(chunks.join(''));
  if (!message) {
    throw new Error('AI did not return text');
  }
  return message;
}

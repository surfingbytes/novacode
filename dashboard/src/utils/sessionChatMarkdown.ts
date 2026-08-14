// types
import type { ChatMessage } from '@/@types/index';

// utils
import { parseHistoryEventsCached, prepareDisplayItem, type DisplayItem } from '@/utils/chatDisplayItems';

function displayItemToMarkdown(item: DisplayItem): string {
  if (item.kind === 'text' && item.text?.trim()) {
    return item.text.trim();
  }
  if (item.kind === 'tool') {
    const title = item.toolName?.trim() || 'tool';
    const summary = item.toolSummary?.trim();
    const lines = [`- **${title}**${summary ? ` — ${summary}` : ''}`];
    const output = item.toolOutput?.trim();
    if (output && output.length <= 4000) {
      lines.push(`\`\`\`\n${output}\n\`\`\``);
    }
    return lines.join('\n\n');
  }
  if (item.kind === 'todos' && item.todoItems?.length) {
    return item.todoItems
      .map((todo) => {
        const checked = todo.status === 'TODO_STATUS_COMPLETED' ? 'x' : ' ';
        return `- [${checked}] ${todo.content}`;
      })
      .join('\n');
  }
  if (item.kind === 'plan') {
    const markdown = item.planMarkdown?.trim();
    if (markdown) {
      return markdown;
    }
    if (item.planEntries?.length) {
      return item.planEntries.map((entry) => `- ${entry.content}`).join('\n');
    }
  }
  if (item.kind === 'notice' && item.text?.trim()) {
    return `*${item.text.trim()}*`;
  }
  return '';
}

function assistantToMarkdown(message: ChatMessage): string {
  const items = (message.events ?? []).length
    ? parseHistoryEventsCached(message.events ?? []).map(prepareDisplayItem)
    : [];
  const fromItems = items.map(displayItemToMarkdown).filter((part) => part.length > 0);
  if (fromItems.length > 0) {
    return fromItems.join('\n\n');
  }
  return message.content?.trim() ?? '';
}

function userToMarkdown(message: ChatMessage): string {
  const parts: string[] = [];
  if (message.content?.trim()) {
    parts.push(message.content.trim());
  }
  if (message.imagePaths?.length) {
    parts.push(
      `*(${message.imagePaths.length} attachment${message.imagePaths.length === 1 ? '' : 's'})*`
    );
  }
  return parts.join('\n\n');
}

export function sessionChatToMarkdown(
  messages: ChatMessage[],
  options?: { title?: string; workspaceName?: string }
): string {
  const title = options?.title?.trim() || 'Untitled session';
  const lines = [`# ${title}`];
  if (options?.workspaceName?.trim()) {
    lines.push(`*${options.workspaceName.trim()}*`);
  }
  lines.push('');

  for (const message of messages) {
    const heading = message.role === 'user' ? 'You' : 'Assistant';
    const body = message.role === 'user' ? userToMarkdown(message) : assistantToMarkdown(message);
    if (!body) {
      continue;
    }
    lines.push(`## ${heading}`, '', body, '');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export function sessionExportFilename(sessionName: string): string {
  const slug = sessionName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'session'}.md`;
}

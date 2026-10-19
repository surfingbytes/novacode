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

/** Assistant prose rebuilt from raw agent events. */
export function assistantTextFromEvents(events: string[] | undefined): string {
  const chunks: string[] = [];
  for (const line of events ?? []) appendAssistantText(line, chunks);
  return chunks.join('');
}

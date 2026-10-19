import { describe, expect, it } from 'vitest';

import {
  chatMessageToRowData,
  escapeIlikeContains,
  messageSearchText,
  planUpdateTargetIndex,
  sessionMessageRowToChat
} from './sessionMessages';

describe('sessionMessageRowToChat', () => {
  it('round-trips role, content, events, and image paths', () => {
    const row = chatMessageToRowData(
      'sess-1',
      2,
      {
        role: 'assistant',
        content: 'hello',
        events: ['{"type":"text"}'],
        imagePaths: ['/prompt-images/a.png'],
        createdAt: '2026-08-14T00:00:00.000Z'
      },
      'msg-1'
    );
    expect(row.position).toBe(2);
    expect(row.eventsJson).toBe('["{\\"type\\":\\"text\\"}"]');

    const message = sessionMessageRowToChat(row);
    expect(message.role).toBe('assistant');
    expect(message.content).toBe('hello');
    expect(message.events).toEqual(['{"type":"text"}']);
    expect(message.imagePaths).toEqual(['/prompt-images/a.png']);
  });

  it('treats unknown roles as assistant and drops invalid JSON', () => {
    const message = sessionMessageRowToChat({
      role: 'system',
      content: '',
      eventsJson: '{not-json',
      imagePathsJson: '[1,2]',
      createdAt: 't'
    });
    expect(message.role).toBe('assistant');
    expect(message.content).toBeUndefined();
    expect(message.events).toBeUndefined();
    expect(message.imagePaths).toBeUndefined();
  });
});

describe('messageSearchText', () => {
  const chunk = (text: string): string =>
    JSON.stringify({
      sessionId: 's1',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }
    });

  it('joins assistant prose split across event chunks', () => {
    const events = [chunk('Use the `{'), chunk('invoice}` placeholder'), '{"type":"session_config_sync"}'];
    expect(messageSearchText({ role: 'assistant', events })).toBe('Use the `{invoice}` placeholder');
  });

  it('uses content only for user messages', () => {
    expect(messageSearchText({ role: 'user', content: 'hi', events: [chunk('x')] })).toBe('hi');
  });
});

describe('escapeIlikeContains', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeIlikeContains('100%_done\\x')).toBe('100\\%\\_done\\\\x');
  });
});

describe('planUpdateTargetIndex', () => {
  const plan = JSON.stringify({ update: { sessionUpdate: 'plan', entries: [] } });
  const text = JSON.stringify({ update: { sessionUpdate: 'agent_message_chunk' } });

  it('prefers the latest assistant message carrying a plan update', () => {
    expect(
      planUpdateTargetIndex([
        { role: 'assistant', events: [plan] },
        { role: 'user' },
        { role: 'assistant', events: [text] }
      ])
    ).toBe(0);
  });

  it('falls back to the latest assistant message, else -1', () => {
    expect(planUpdateTargetIndex([{ role: 'assistant', events: [text] }, { role: 'user' }])).toBe(0);
    expect(planUpdateTargetIndex([{ role: 'user' }])).toBe(-1);
  });
});

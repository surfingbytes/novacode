import { describe, expect, it } from 'vitest';

import {
  chatMessageToRowData,
  escapeIlikeContains,
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
      id: 'x',
      sessionId: 's',
      position: 0,
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

describe('escapeIlikeContains', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeIlikeContains('100%_done\\x')).toBe('100\\%\\_done\\\\x');
  });
});

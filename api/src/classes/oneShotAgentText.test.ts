import { describe, expect, it } from 'vitest';

import {
  appendAssistantText,
  buildSessionTitlePrompt,
  buildSessionTitlePromptFromAssistant,
  cleanGeneratedAgentText,
  cleanSessionTitle,
  extractFirstAssistantText
} from './oneShotAgentText';

describe('cleanGeneratedAgentText', () => {
  it('strips fences and wrapping quotes', () => {
    expect(cleanGeneratedAgentText('```text\nFix login timeout\n```')).toBe('Fix login timeout');
    expect(cleanGeneratedAgentText('"Fix login timeout"')).toBe('Fix login timeout');
  });
});

describe('cleanSessionTitle', () => {
  it('keeps a short title and drops a trailing period', () => {
    expect(cleanSessionTitle('Rewrite auth middleware.')).toBe('Rewrite auth middleware');
  });

  it('uses only the first line', () => {
    expect(cleanSessionTitle('Fix the login bug\nHere is more explanation')).toBe(
      'Fix the login bug'
    );
  });

  it('cuts a long title on a word boundary', () => {
    expect(
      cleanSessionTitle(
        'Rewrite the authentication middleware so every request uses the new session store'
      )
    ).toBe('Rewrite the authentication middleware so every request uses');
  });
});

describe('buildSessionTitlePrompt', () => {
  it('asks for an intent title rather than a quote', () => {
    const prompt = buildSessionTitlePrompt('please do the thing', 0);
    expect(prompt).toContain('capture the user\'s intent');
    expect(prompt).toContain('please do the thing');
    expect(prompt).not.toContain('image');
  });

  it('mentions attachments', () => {
    expect(buildSessionTitlePrompt('look at this', 2)).toContain('2 images');
  });
});

describe('buildSessionTitlePromptFromAssistant', () => {
  it('asks for a topic title from the assistant reply', () => {
    const prompt = buildSessionTitlePromptFromAssistant(
      'This screenshot shows a TypeError in the login form.'
    );
    expect(prompt).toContain('assistant\'s first reply');
    expect(prompt).toContain('TypeError in the login form');
    expect(prompt).toContain('only an image');
  });
});

describe('extractFirstAssistantText', () => {
  it('uses content when present', () => {
    expect(
      extractFirstAssistantText([
        { role: 'user', content: '', imagePaths: ['/img.png'], createdAt: '1' },
        { role: 'assistant', content: 'Login form TypeError', createdAt: '2' }
      ])
    ).toBe('Login form TypeError');
  });

  it('collects ACP agent_message_chunk text from the first assistant turn', () => {
    expect(
      extractFirstAssistantText([
        { role: 'user', imagePaths: ['/img.png'], createdAt: '1' },
        {
          role: 'assistant',
          events: [
            JSON.stringify({
              sessionId: 's1',
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'Broken ' }
              }
            }),
            JSON.stringify({
              sessionId: 's1',
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'nav button' }
              }
            })
          ],
          createdAt: '2'
        },
        { role: 'assistant', content: 'later turn', createdAt: '3' }
      ])
    ).toBe('Broken nav button');
  });

  it('returns empty when the assistant has not replied yet', () => {
    expect(
      extractFirstAssistantText([
        { role: 'user', imagePaths: ['/img.png'], createdAt: '1' }
      ])
    ).toBe('');
  });

  it('skips a tool-only assistant turn and uses the next text reply', () => {
    expect(
      extractFirstAssistantText([
        { role: 'user', imagePaths: ['/img.png'], createdAt: '1' },
        { role: 'assistant', events: [], createdAt: '2' },
        { role: 'assistant', content: 'The screenshot is a 404 page', createdAt: '3' }
      ])
    ).toBe('The screenshot is a 404 page');
  });
});

describe('appendAssistantText', () => {
  it('collects ACP agent_message_chunk text', () => {
    const chunks: string[] = [];
    appendAssistantText(
      JSON.stringify({
        sessionId: 's1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello' }
        }
      }),
      chunks
    );
    expect(chunks.join('')).toBe('Hello');
  });
});

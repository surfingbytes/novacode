import { describe, expect, it } from 'vitest';

import {
  appendAssistantText,
  buildCommitMessagePrompt,
  buildSessionTitlePrompt,
  buildSessionTitlePromptFromAssistant,
  cleanCommitMessage,
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

  it('rejects Cursor paywall text', () => {
    expect(cleanSessionTitle('Upgrade your plan to continue.')).toBe('');
  });
});

describe('cleanCommitMessage', () => {
  it('keeps a short subject and optional body', () => {
    expect(cleanCommitMessage('Add session usage display\n\nShow token counts in the header.')).toBe(
      'Add session usage display\n\nShow token counts in the header.'
    );
  });

  it('strips a rules-loaded preamble and keeps the commit text', () => {
    expect(
      cleanCommitMessage(
        "I've loaded the workspace rules from .cursor/rules.\n\nAdd session usage display\n\nShow token counts in the header."
      )
    ).toBe('Add session usage display\n\nShow token counts in the header.');
  });

  it('strips a same-paragraph rules preamble', () => {
    expect(
      cleanCommitMessage(
        'Workspace rules (from .cursor/rules) apply to this task. Add session usage display.'
      )
    ).toBe('Add session usage display.');
  });

  it('does not strip a commit that is actually about rules', () => {
    expect(cleanCommitMessage('Add workspace rules injection for chat prompts')).toBe(
      'Add workspace rules injection for chat prompts'
    );
  });

  it('rejects Cursor paywall text', () => {
    expect(cleanCommitMessage('Upgrade your plan to continue.')).toBe('');
  });

  it('truncates a long subject on a word boundary', () => {
    expect(
      cleanCommitMessage(
        'Rewrite the authentication middleware so every request uses the new session store and retries'
      )
    ).toBe('Rewrite the authentication middleware so every request uses the new');
  });
});

describe('buildCommitMessagePrompt', () => {
  it('says the reply is used as the commit message', () => {
    const prompt = buildCommitMessagePrompt('diff --git a/app.ts');
    expect(prompt).toContain('Your entire reply is used as the commit message');
    expect(prompt).toContain('Do not mention rules, tools, files, or your process');
    expect(prompt).toContain('Do not use tools or read files');
    expect(prompt).toContain('diff --git a/app.ts');
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

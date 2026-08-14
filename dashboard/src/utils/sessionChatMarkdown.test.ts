// @vitest-environment node

// node_modules
import { describe, it, expect } from 'vitest';

// utils
import { sessionChatToMarkdown, sessionExportFilename } from '@/utils/sessionChatMarkdown';

describe('sessionChatToMarkdown', () => {
  it('exports user and assistant text as markdown headings', () => {
    const markdown = sessionChatToMarkdown(
      [
        { role: 'user', content: 'Fix the login bug', createdAt: '1' },
        { role: 'assistant', content: 'I will look at `auth.ts`.', createdAt: '2' }
      ],
      { title: 'Login bug', workspaceName: 'acme' }
    );
    expect(markdown).toContain('# Login bug');
    expect(markdown).toContain('*acme*');
    expect(markdown).toContain('## You');
    expect(markdown).toContain('Fix the login bug');
    expect(markdown).toContain('## Assistant');
    expect(markdown).toContain('I will look at `auth.ts`.');
  });

  it('builds a safe download filename', () => {
    expect(sessionExportFilename('Fix the login bug!')).toBe('fix-the-login-bug.md');
    expect(sessionExportFilename('   ')).toBe('session.md');
  });
});

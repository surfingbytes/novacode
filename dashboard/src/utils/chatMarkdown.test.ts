// node_modules
import { describe, it, expect } from 'vitest';

// utils
import { renderMd } from '@/utils/chatMarkdown';

// ---------------------------------- Links ----------------------------------

describe('renderMd links', () => {
  it('opens http(s) links in a new browsing context', () => {
    const html = renderMd('See [docs](https://example.com/path) please');
    expect(html).toContain('href="https://example.com/path"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('leaves relative links in-app', () => {
    const html = renderMd('Go [home](/sessions)');
    expect(html).toContain('href="/sessions"');
    expect(html).not.toContain('target="_blank"');
  });
});

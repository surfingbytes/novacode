// @vitest-environment jsdom
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

// ---------------------------------- Sanitizing ----------------------------------

const CODE_HEADER = (lang: string) =>
  '<div class="code-block-card my-2.5 rounded-xl border border-fg/10 bg-fg/[0.03] overflow-hidden">' +
  '<div class="code-block-header flex items-center gap-2 px-2 py-1 border-b border-fg/10 bg-fg/[0.02]">' +
  `<span class="code-block-lang mr-auto text-[10px] font-mono uppercase tracking-wide text-text-muted/70">${lang}</span>` +
  '<button type="button" class="code-copy-btn ml-auto shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded text-text-muted/70 hover:text-text-primary transition-colors" aria-label="Copy code" title="Copy">Copy</button>' +
  '</div>';

describe('renderMd sanitizing', () => {
  it('drops event handler attributes from raw HTML', () => {
    const html = renderMd('<img src=x onerror=alert(1)>');
    expect(html).toContain('<img src="x">');
    expect(html).not.toContain('onerror');
  });

  it('drops javascript: and data: link hrefs', () => {
    expect(renderMd('[x](javascript:alert(1))')).not.toContain('javascript:');
    expect(renderMd('<a href="JavaScript:alert(1)">x</a>')).not.toMatch(/javascript:/i);
    expect(renderMd('<a href="data:text/html,<script>alert(1)</script>">x</a>')).not.toContain('data:');
  });

  it('removes script tags', () => {
    const html = renderMd('hi <script>alert(1)</script> there');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
  });

  it('keeps target/rel on external raw HTML links and drops them on others', () => {
    expect(renderMd('<a href="https://e.com">e</a>')).toContain(
      '<a href="https://e.com" target="_blank" rel="noopener noreferrer">e</a>'
    );
    expect(renderMd('<a href="/x" target="_top">x</a>')).toContain('<a href="/x">x</a>');
  });

  it('keeps mailto links', () => {
    expect(renderMd('[mail](mailto:a@b.c)')).toBe('<p><a href="mailto:a@b.c">mail</a></p>\n');
  });

  it('leaves the mermaid fence output unchanged', () => {
    expect(renderMd('```mermaid\ngraph TD\n  A-->B\n```')).toBe(
      CODE_HEADER('mermaid') + '<pre><code class="language-mermaid">graph TD\n  A--&gt;B</code></pre></div>'
    );
  });

  it('leaves the code fence output unchanged', () => {
    expect(renderMd('```ts\nconst a = 1 < 2;\n```')).toBe(
      CODE_HEADER('ts') + '<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre></div>'
    );
  });

  it('leaves normal markdown unchanged', () => {
    const src =
      '# Title\n\n**bold** _it_ `code`\n\n- a\n- b\n\n| h | i |\n|---|---|\n| 1 | 2 |\n\n' +
      '![alt](/img.png "t")\n\n> quote\nline2\n\n- [x] done';
    expect(renderMd(src)).toBe(
      '<h1>Title</h1>\n<p><strong>bold</strong> <em>it</em> <code>code</code></p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n' +
        '<table>\n<thead>\n<tr>\n<th>h</th>\n<th>i</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody></table>\n' +
        '<p><img src="/img.png" alt="alt" title="t"></p>\n<blockquote>\n<p>quote<br>line2</p>\n</blockquote>\n' +
        '<ul>\n<li><input checked="" disabled="" type="checkbox"> done</li>\n</ul>\n'
    );
  });
});

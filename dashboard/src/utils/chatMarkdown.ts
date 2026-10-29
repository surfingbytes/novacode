/**
 * Markdown rendering for chat bubbles and plan documents (marked config,
 * fence repair, HTML sanitizing, render cache).
 */

// node_modules
import DOMPurify, { type DOMPurify as DOMPurifyInstance } from 'dompurify';
import { marked, type Tokens } from 'marked';

// ---------------------------------- Markdown ----------------------------------

marked.setOptions({ breaks: true, gfm: true });

function escapeHtmlForMd(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isExternalHttpUrl(href: string): boolean {
  return /^https?:\/\//i.test(href) || href.startsWith('//');
}

marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      const langAttr = lang ? ` class="language-${escapeHtmlForMd(lang)}"` : '';
      const langLabel = lang
        ? `<span class="code-block-lang mr-auto text-[10px] font-mono uppercase tracking-wide text-text-muted/70">${escapeHtmlForMd(lang)}</span>`
        : '';
      return (
        `<div class="code-block-card my-2.5 rounded-xl border border-fg/10 bg-fg/[0.03] overflow-hidden">` +
        `<div class="code-block-header flex items-center gap-2 px-2 py-1 border-b border-fg/10 bg-fg/[0.02]">` +
        langLabel +
        `<button type="button" class="code-copy-btn ml-auto shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded text-text-muted/70 hover:text-text-primary transition-colors" aria-label="Copy code" title="Copy">Copy</button>` +
        `</div>` +
        `<pre><code${langAttr}>${escapeHtmlForMd(text)}</code></pre>` +
        `</div>`
      );
    },
    link({ href, title, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      if (!href) return text;
      const titleAttr = title ? ` title="${escapeHtmlForMd(title)}"` : '';
      const externalAttrs = isExternalHttpUrl(href)
        ? ' target="_blank" rel="noopener noreferrer"'
        : '';
      return `<a href="${escapeHtmlForMd(href)}"${titleAttr}${externalAttrs}>${text}</a>`;
    }
  }
});

// ---------------------------------- Sanitizing ----------------------------------

// http(s), mailto, or relative URLs (no scheme); everything else (javascript:, data:, ...) is dropped.
const SAFE_URI = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

let purifier: DOMPurifyInstance | null = null;

/** Own DOMPurify instance so the link hook does not leak into mermaid's shared default one. */
function getPurifier(): DOMPurifyInstance {
  if (purifier) return purifier;
  purifier = DOMPurify(window);
  // Only external http(s) links open in a new tab; DOMPurify strips `target` by default.
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'A') return;
    const href = node.getAttribute('href');
    if (href && isExternalHttpUrl(href)) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    } else {
      node.removeAttribute('target');
    }
  });
  return purifier;
}

/** Sanitize rendered markdown HTML before it is bound with `v-html`. */
function sanitizeHtml(html: string): string {
  return getPurifier().sanitize(html, {
    ALLOWED_URI_REGEXP: SAFE_URI,
    USE_PROFILES: { html: true }
  });
}

function normalizeMarkdownForRendering(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let openFence: { marker: '`' | '~'; length: number } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const marker = fence[0] as '`' | '~';
      if (!openFence) {
        openFence = { marker, length: fence.length };
      } else if (marker === openFence.marker && fence.length >= openFence.length) {
        openFence = null;
      }
      continue;
    }

    if (!openFence) continue;

    const partialClose = line.match(/^ {0,3}(`{1,2}|~{1,2})\s*$/);
    if (partialClose?.[1]?.[0] === openFence.marker) {
      lines[i] = openFence.marker.repeat(Math.max(3, openFence.length));
      openFence = null;
    }
  }

  if (openFence) {
    lines.push(openFence.marker.repeat(Math.max(3, openFence.length)));
  }

  return lines.join('\n');
}

export function renderMd(src: string | undefined): string {
  if (!src) {
    return '';
  }
  return sanitizeHtml(marked.parse(normalizeMarkdownForRendering(src), { async: false }));
}

const markdownRenderCache = new Map<string, string>();

export function renderMdCached(src: string | undefined): string {
  if (!src) return '';
  const cached = markdownRenderCache.get(src);
  if (cached !== undefined) return cached;
  const rendered = renderMd(src);
  if (markdownRenderCache.size > 500) markdownRenderCache.clear();
  markdownRenderCache.set(src, rendered);
  return rendered;
}

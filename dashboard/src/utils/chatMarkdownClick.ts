/**
 * Click handling for chat markdown bubbles: copy code blocks, open http(s)
 * links outside the PWA and open images in the lightbox.
 * Extracted from ChatMessageList.vue.
 */

/** Copy the code block whose copy button was clicked. */
async function copyCodeBlockFromEvent(e: MouseEvent): Promise<void> {
  const btn = (e.target as HTMLElement | null)?.closest('.code-copy-btn') as HTMLButtonElement | null;
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const code = btn.closest('.code-block-card')?.querySelector('code');
  const text = code?.textContent ?? '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    btn.setAttribute('aria-label', 'Copied');
    btn.setAttribute('title', 'Copied');
    btn.dataset.copied = '1';
    window.setTimeout(() => {
      btn.textContent = prev ?? 'Copy';
      btn.setAttribute('aria-label', 'Copy code');
      btn.setAttribute('title', 'Copy');
      delete btn.dataset.copied;
    }, 2000);
  } catch {
    // Clipboard may be unavailable; leave button unchanged.
  }
}

/** Copy code blocks and open images in the lightbox (chat markdown bubbles). */
export function handleChatMarkdownClick(e: MouseEvent, onImage: (src: string) => void): void {
  const target = e.target as HTMLElement | null;
  if (!target) return;
  if (target.closest('.code-copy-btn')) {
    void copyCodeBlockFromEvent(e);
    return;
  }

  // Open http(s) links outside the PWA (standalone often keeps target=_blank in-app).
  const anchor = target.closest('a');
  if (
    anchor instanceof HTMLAnchorElement &&
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey
  ) {
    const href = anchor.href;
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault();
      e.stopPropagation();
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
  }

  if (!(target instanceof HTMLImageElement)) return;
  e.preventDefault();
  e.stopPropagation();
  const src = target.currentSrc || target.src;
  if (src) onImage(src);
}

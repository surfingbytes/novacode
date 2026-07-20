type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

let mermaidApi: MermaidApi | null = null;
let initializedTheme: 'dark' | 'light' | null = null;
let renderSeq = 0;

function currentColorMode(): 'dark' | 'light' {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

async function ensureMermaid(): Promise<MermaidApi> {
  if (!mermaidApi) {
    const mod = await import('mermaid');
    mermaidApi = mod.default as MermaidApi;
  }

  const theme = currentColorMode();
  if (initializedTheme !== theme) {
    mermaidApi.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'inherit'
    });
    initializedTheme = theme;
  }

  return mermaidApi;
}

/**
 * Replace `language-mermaid` code blocks under `root` with rendered SVG diagrams.
 * Invalid / incomplete diagrams (e.g. while streaming) are left as code blocks.
 */
export async function renderMermaidDiagrams(root: ParentNode | null | undefined): Promise<void> {
  if (!root) return;

  const blocks = root.querySelectorAll('pre > code.language-mermaid');
  if (!blocks.length) return;

  const api = await ensureMermaid();

  for (const code of Array.from(blocks)) {
    const pre = code.parentElement;
    if (!pre || !(pre instanceof HTMLElement)) continue;

    const source = code.textContent?.trim() ?? '';
    if (!source) continue;

    try {
      const id = `nc-mermaid-${++renderSeq}`;
      const { svg } = await api.render(id, source);
      const wrapper = document.createElement('div');
      wrapper.className = 'mermaid-diagram';
      wrapper.setAttribute('role', 'img');
      wrapper.setAttribute('aria-label', 'Diagram');
      wrapper.innerHTML = svg;
      pre.replaceWith(wrapper);
    } catch {
      // Keep the fenced code visible until the diagram parses (streaming / typo).
    }
  }
}

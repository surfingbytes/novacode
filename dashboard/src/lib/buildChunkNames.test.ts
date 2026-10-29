import { describe, expect, it } from 'vitest';

import { chunkFileName, HEAVY_CHUNK_GLOB_IGNORES, heavyChunkPrefix } from './buildChunkNames';

const nm = (path: string): string => `/repo/node_modules/${path}`;

describe('heavyChunkPrefix', () => {
  it('prefixes vendor-only chunks of heavy libraries', () => {
    expect(heavyChunkPrefix([nm('monaco-editor/esm/vs/editor/editor.api.js')])).toBe('monaco');
    expect(heavyChunkPrefix([nm('mermaid/dist/chunks/ganttDiagram.mjs'), nm('d3-scale/src/linear.js')])).toBe(
      'mermaid'
    );
    expect(heavyChunkPrefix([nm('cytoscape/dist/cytoscape.esm.mjs')])).toBe('mermaid');
    expect(heavyChunkPrefix([nm('elkjs/lib/elk.bundled.js')])).toBe('mermaid');
    expect(heavyChunkPrefix([nm('katex/dist/katex.mjs')])).toBe('mermaid');
    expect(heavyChunkPrefix([nm('@codemirror/legacy-modes/mode/z80.js')])).toBe('mdeditor');
    expect(heavyChunkPrefix([nm('md-editor-v3/lib/es/index.mjs')])).toBe('mdeditor');
  });

  it('ignores virtual modules and windows separators', () => {
    expect(heavyChunkPrefix(['\0vite/preload-helper', 'C:\\repo\\node_modules\\katex\\dist\\katex.mjs'])).toBe(
      'mermaid'
    );
  });

  it('keeps chunks with app code or other vendors unprefixed', () => {
    expect(heavyChunkPrefix(['/repo/dashboard/src/views/SessionView.vue', nm('mermaid/dist/mermaid.core.mjs')])).toBe(
      null
    );
    expect(heavyChunkPrefix([nm('vue/dist/vue.runtime.esm-bundler.js')])).toBe(null);
    expect(heavyChunkPrefix([nm('mermaid-like/index.js')])).toBe(null);
    expect(heavyChunkPrefix([])).toBe(null);
  });
});

describe('chunkFileName', () => {
  it('builds names matched by the precache glob ignores', () => {
    expect(chunkFileName({ moduleIds: [nm('monaco-editor/esm/x.js')] })).toBe('assets/monaco-[name]-[hash].js');
    expect(chunkFileName({ moduleIds: ['/repo/dashboard/src/main.ts'] })).toBe('assets/[name]-[hash].js');
    expect(HEAVY_CHUNK_GLOB_IGNORES).toEqual(
      expect.arrayContaining(['**/*.worker*', '**/editor.api*', 'assets/monaco-*', 'assets/mermaid-*', 'assets/mdeditor-*'])
    );
  });
});

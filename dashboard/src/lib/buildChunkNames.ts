// Build-time helper (used by vite.config.ts): gives lazy vendor-only chunks of heavy
// libraries a stable filename prefix so the service worker can keep them out of the precache.

export type HeavyChunkPrefix = 'monaco' | 'mermaid' | 'mdeditor';

const HEAVY_LIBS: ReadonlyArray<[HeavyChunkPrefix, RegExp]> = [
  ['monaco', /\/node_modules\/monaco-editor\//],
  [
    'mermaid',
    /\/node_modules\/(mermaid|@mermaid-js\/[^/]+|cytoscape[^/]*|elkjs|katex|dagre-d3-es|khroma|langium|chevrotain[^/]*|roughjs|d3(-[^/]+)?)\//
  ],
  ['mdeditor', /\/node_modules\/(md-editor-v3|codemirror|@codemirror\/[^/]+|@lezer\/[^/]+|@vavt\/[^/]+)\//]
];

/** Glob patterns (relative to dist) for prefixed heavy chunks and Monaco workers. */
export const HEAVY_CHUNK_GLOB_IGNORES = [
  '**/*.worker*',
  '**/editor.api*',
  ...HEAVY_LIBS.map(([prefix]) => `assets/${prefix}-*`)
];

/**
 * Returns the heavy-library prefix for a chunk made only of node_modules code, or null
 * when the chunk contains app code (those stay unprefixed so the app shell is precached).
 */
export function heavyChunkPrefix(moduleIds: readonly string[]): HeavyChunkPrefix | null {
  const ids = moduleIds.filter((id) => !id.startsWith('\0')).map((id) => id.replace(/\\/g, '/'));
  if (ids.length === 0 || ids.some((id) => !id.includes('/node_modules/'))) return null;
  for (const [prefix, pattern] of HEAVY_LIBS) {
    if (ids.some((id) => pattern.test(id))) return prefix;
  }
  return null;
}

/** `output.chunkFileNames` implementation that applies {@link heavyChunkPrefix}. */
export function chunkFileName(chunk: { moduleIds: readonly string[] }): string {
  const prefix = heavyChunkPrefix(chunk.moduleIds);
  return prefix ? `assets/${prefix}-[name]-[hash].js` : 'assets/[name]-[hash].js';
}

/**
 * Build a sandboxed HTML preview document whose relative asset URLs resolve.
 *
 * Blob URLs have no directory base, so sibling CSS/JS/images break. This
 * fetches those workspace files, rewrites references to blob: URLs (and turns
 * inline scripts into blob scripts so inherited CSP without unsafe-inline
 * still allows them), then returns a document blob URL.
 */

export type PreviewAsset = {
  content: string;
  encoding: 'utf8' | 'base64';
};

export type FetchPreviewAsset = (workspacePath: string) => Promise<PreviewAsset | null>;

export type HtmlPreviewBuildResult = {
  documentUrl: string;
  objectUrls: string[];
};

const ASSET_MIME: Record<string, string> = {
  css: 'text/css;charset=utf-8',
  js: 'text/javascript;charset=utf-8',
  mjs: 'text/javascript;charset=utf-8',
  json: 'application/json;charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  html: 'text/html;charset=utf-8',
  htm: 'text/html;charset=utf-8',
  wasm: 'application/wasm',
  map: 'application/json'
};

const MAX_CSS_IMPORT_DEPTH = 8;

/** True when the URL should be left untouched (absolute, data, hash-only, …). */
export function shouldLeavePreviewUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return true;
  }
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed);
}

/** Resolve a document-relative or workspace-root URL to a workspace path. */
export function resolvePreviewAssetPath(htmlPath: string, rawUrl: string): string | null {
  if (shouldLeavePreviewUrl(rawUrl)) {
    return null;
  }
  const pathPart = stripUrlMeta(rawUrl);
  if (!pathPart) {
    return null;
  }

  if (pathPart.startsWith('/')) {
    return normalizeWorkspacePath(pathPart.replace(/^\/+/, ''));
  }

  const slash = htmlPath.lastIndexOf('/');
  const baseDir = slash >= 0 ? htmlPath.slice(0, slash) : '';
  const joined = baseDir ? `${baseDir}/${pathPart}` : pathPart;
  return normalizeWorkspacePath(joined);
}

function stripUrlMeta(url: string): string {
  const noHash = url.trim().split('#')[0] ?? '';
  return (noHash.split('?')[0] ?? '').trim();
}

/** Collapse `.` / `..` segments; null if the path escapes the workspace root. */
export function normalizeWorkspacePath(path: string): string | null {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (parts.length === 0) {
        return null;
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function mimeForAssetPath(path: string): string {
  return ASSET_MIME[extensionOf(path)] ?? 'application/octet-stream';
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index++) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
}

function assetToBlobParts(asset: PreviewAsset): BlobPart {
  if (asset.encoding === 'base64') {
    return base64ToBytes(asset.content);
  }
  return asset.content;
}

/** Rewrite url(...) and @import in CSS, resolving against the CSS file path. */
export async function rewriteCssUrls(
  cssText: string,
  cssPath: string,
  fetchAsset: FetchPreviewAsset,
  objectUrls: string[],
  blobCache: Map<string, string>,
  depth = 0
): Promise<string> {
  if (depth > MAX_CSS_IMPORT_DEPTH) {
    return cssText;
  }

  let rewritten = cssText;

  // @import "…" / @import url(…) — fetch and inline so nested urls resolve.
  const importPattern =
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*;?/gi;
  const imports: { full: string; ref: string }[] = [];
  for (const match of cssText.matchAll(importPattern)) {
    const ref = match[2] ?? match[4];
    if (ref) {
      imports.push({ full: match[0], ref });
    }
  }
  for (const item of imports) {
    const resolved = resolvePreviewAssetPath(cssPath, item.ref);
    if (!resolved) {
      continue;
    }
    const asset = await fetchAsset(resolved);
    if (!asset || asset.encoding !== 'utf8') {
      continue;
    }
    const nested = await rewriteCssUrls(
      asset.content,
      resolved,
      fetchAsset,
      objectUrls,
      blobCache,
      depth + 1
    );
    rewritten = rewritten.replace(item.full, nested);
  }

  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  const urlRefs = new Set<string>();
  for (const match of rewritten.matchAll(urlPattern)) {
    const ref = match[2];
    if (ref) {
      urlRefs.add(ref);
    }
  }
  for (const ref of urlRefs) {
    const blobUrl = await ensureAssetBlobUrl(
      resolvePreviewAssetPath(cssPath, ref),
      fetchAsset,
      objectUrls,
      blobCache
    );
    if (!blobUrl) {
      continue;
    }
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rewritten = rewritten.replace(
      new RegExp(`url\\(\\s*(['"]?)${escaped}\\1\\s*\\)`, 'gi'),
      `url("${blobUrl}")`
    );
  }

  return rewritten;
}

async function ensureAssetBlobUrl(
  workspacePath: string | null,
  fetchAsset: FetchPreviewAsset,
  objectUrls: string[],
  blobCache: Map<string, string>,
  overrideMime?: string
): Promise<string | null> {
  if (!workspacePath) {
    return null;
  }
  const cached = blobCache.get(workspacePath);
  if (cached) {
    return cached;
  }
  const asset = await fetchAsset(workspacePath);
  if (!asset) {
    return null;
  }
  let parts: BlobPart = assetToBlobParts(asset);
  const mime = overrideMime ?? mimeForAssetPath(workspacePath);
  if (extensionOf(workspacePath) === 'css' && asset.encoding === 'utf8') {
    const rewrittenCss = await rewriteCssUrls(
      asset.content,
      workspacePath,
      fetchAsset,
      objectUrls,
      blobCache
    );
    parts = rewrittenCss;
  }
  const blobUrl = URL.createObjectURL(new Blob([parts], { type: mime }));
  objectUrls.push(blobUrl);
  blobCache.set(workspacePath, blobUrl);
  return blobUrl;
}

function rewriteSrcsetValue(
  srcset: string,
  replaceUrl: (ref: string) => Promise<string | null>
): Promise<string> {
  const entries = srcset.split(',').map((part) => part.trim()).filter(Boolean);
  return Promise.all(
    entries.map(async (entry) => {
      const space = entry.search(/\s/);
      const url = space >= 0 ? entry.slice(0, space) : entry;
      const descriptor = space >= 0 ? entry.slice(space) : '';
      const blobUrl = await replaceUrl(url);
      return blobUrl ? `${blobUrl}${descriptor}` : entry;
    })
  ).then((parts) => parts.join(', '));
}

/**
 * Rewrite relative asset references in HTML and return a blob: document URL.
 * Caller must revoke every entry in `objectUrls` when done.
 */
export async function buildHtmlPreviewDocument(
  html: string,
  htmlPath: string,
  fetchAsset: FetchPreviewAsset
): Promise<HtmlPreviewBuildResult> {
  const objectUrls: string[] = [];
  const blobCache = new Map<string, string>();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const replaceRef = (ref: string): Promise<string | null> =>
    ensureAssetBlobUrl(resolvePreviewAssetPath(htmlPath, ref), fetchAsset, objectUrls, blobCache);

  // Stylesheets (and icons): link[href]
  for (const link of Array.from(doc.querySelectorAll('link[href]'))) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase();
    const href = link.getAttribute('href');
    if (!href) {
      continue;
    }
    const isStylesheet = rel.split(/\s+/).includes('stylesheet');
    const isIcon = rel.includes('icon');
    if (!isStylesheet && !isIcon) {
      continue;
    }
    const blobUrl = await replaceRef(href);
    if (blobUrl) {
      link.setAttribute('href', blobUrl);
    }
  }

  // Scripts with src
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const src = script.getAttribute('src');
    if (!src) {
      continue;
    }
    const blobUrl = await replaceRef(src);
    if (blobUrl) {
      script.setAttribute('src', blobUrl);
    }
  }

  // Inline scripts → blob src (inherited app CSP blocks unsafe-inline scripts)
  for (const script of Array.from(doc.querySelectorAll('script:not([src])'))) {
    const text = script.textContent ?? '';
    if (!text.trim()) {
      continue;
    }
    const blobUrl = URL.createObjectURL(
      new Blob([text], { type: 'text/javascript;charset=utf-8' })
    );
    objectUrls.push(blobUrl);
    script.textContent = '';
    script.setAttribute('src', blobUrl);
  }

  // Inline style blocks with relative url(...)
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    const text = style.textContent ?? '';
    if (!text.trim()) {
      continue;
    }
    style.textContent = await rewriteCssUrls(
      text,
      htmlPath,
      fetchAsset,
      objectUrls,
      blobCache
    );
  }

  const mediaSelectors = [
    'img[src]',
    'video[src]',
    'video[poster]',
    'audio[src]',
    'source[src]',
    'embed[src]',
    'object[data]',
    'input[src]',
    'image[href]',
    'use[href]'
  ];
  for (const node of Array.from(doc.querySelectorAll(mediaSelectors.join(',')))) {
    for (const attr of ['src', 'poster', 'data', 'href'] as const) {
      if (!node.hasAttribute(attr)) {
        continue;
      }
      const value = node.getAttribute(attr);
      if (!value) {
        continue;
      }
      const blobUrl = await replaceRef(value);
      if (blobUrl) {
        node.setAttribute(attr, blobUrl);
      }
    }
  }

  for (const node of Array.from(doc.querySelectorAll('[srcset]'))) {
    const srcset = node.getAttribute('srcset');
    if (!srcset) {
      continue;
    }
    node.setAttribute('srcset', await rewriteSrcsetValue(srcset, replaceRef));
  }

  // Serialize: prefer full html when present.
  const serialized =
    doc.documentElement?.outerHTML != null
      ? `<!DOCTYPE html>${doc.documentElement.outerHTML}`
      : html;

  const documentUrl = URL.createObjectURL(
    new Blob([serialized], { type: 'text/html;charset=utf-8' })
  );
  objectUrls.push(documentUrl);

  return { documentUrl, objectUrls };
}

/**
 * Build a sandboxed HTML preview whose relative assets resolve.
 *
 * The preview iframe uses sandbox="allow-scripts" without allow-same-origin
 * (opaque origin). Sibling blob: URLs created by the parent are not loadable
 * from that document, so CSS/JS must be inlined and binary assets become
 * data: URIs — one self-contained HTML blob.
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
  heic: 'image/heic',
  heif: 'image/heif',
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
}

function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

function assetToDataUri(asset: PreviewAsset, mime: string): string {
  if (asset.encoding === 'base64') {
    return `data:${mime};base64,${asset.content}`;
  }
  // data: URLs need base64 (or percent-encoding); base64 is safer for CSS/binary-ish text.
  return `data:${mime};base64,${utf8ToBase64(asset.content)}`;
}

/** Rewrite url(...) and @import in CSS; binary/text refs become data: URIs. */
export async function rewriteCssUrls(
  cssText: string,
  cssPath: string,
  fetchAsset: FetchPreviewAsset,
  dataUriCache: Map<string, string>,
  depth = 0
): Promise<string> {
  if (depth > MAX_CSS_IMPORT_DEPTH) {
    return cssText;
  }

  let rewritten = cssText;

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
      dataUriCache,
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
    const dataUri = await ensureDataUri(
      resolvePreviewAssetPath(cssPath, ref),
      fetchAsset,
      dataUriCache
    );
    if (!dataUri) {
      continue;
    }
    const escaped = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rewritten = rewritten.replace(
      new RegExp(`url\\(\\s*(['"]?)${escaped}\\1\\s*\\)`, 'gi'),
      `url("${dataUri}")`
    );
  }

  return rewritten;
}

async function ensureDataUri(
  workspacePath: string | null,
  fetchAsset: FetchPreviewAsset,
  dataUriCache: Map<string, string>
): Promise<string | null> {
  if (!workspacePath) {
    return null;
  }
  const cached = dataUriCache.get(workspacePath);
  if (cached) {
    return cached;
  }
  const asset = await fetchAsset(workspacePath);
  if (!asset) {
    return null;
  }
  const mime = mimeForAssetPath(workspacePath).split(';')[0] ?? 'application/octet-stream';
  const dataUri = assetToDataUri(asset, mime);
  dataUriCache.set(workspacePath, dataUri);
  return dataUri;
}

async function loadTextAsset(
  workspacePath: string | null,
  fetchAsset: FetchPreviewAsset
): Promise<string | null> {
  if (!workspacePath) {
    return null;
  }
  const asset = await fetchAsset(workspacePath);
  if (!asset || asset.encoding !== 'utf8') {
    return null;
  }
  return asset.content;
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
      const dataUri = await replaceUrl(url);
      return dataUri ? `${dataUri}${descriptor}` : entry;
    })
  ).then((parts) => parts.join(', '));
}

/**
 * Inline relative CSS/JS and data-URI binary refs, then return a document blob URL.
 * Caller must revoke every entry in `objectUrls` when done.
 */
export async function buildHtmlPreviewDocument(
  html: string,
  htmlPath: string,
  fetchAsset: FetchPreviewAsset
): Promise<HtmlPreviewBuildResult> {
  const objectUrls: string[] = [];
  const dataUriCache = new Map<string, string>();
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const replaceRef = (ref: string): Promise<string | null> =>
    ensureDataUri(resolvePreviewAssetPath(htmlPath, ref), fetchAsset, dataUriCache);

  // Stylesheets → <style>…</style> (opaque iframe cannot load sibling blob: URLs)
  for (const link of Array.from(doc.querySelectorAll('link[href]'))) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase();
    const href = link.getAttribute('href');
    if (!href || !rel.split(/\s+/).includes('stylesheet')) {
      continue;
    }
    if (shouldLeavePreviewUrl(href)) {
      continue;
    }
    const cssPath = resolvePreviewAssetPath(htmlPath, href);
    const cssText = await loadTextAsset(cssPath, fetchAsset);
    if (cssText == null || !cssPath) {
      continue;
    }
    const rewritten = await rewriteCssUrls(cssText, cssPath, fetchAsset, dataUriCache);
    const style = doc.createElement('style');
    style.textContent = rewritten;
    link.replaceWith(style);
  }

  // Icons and other link[href] resources → data:
  for (const link of Array.from(doc.querySelectorAll('link[href]'))) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase();
    const href = link.getAttribute('href');
    if (!href || !rel.includes('icon')) {
      continue;
    }
    const dataUri = await replaceRef(href);
    if (dataUri) {
      link.setAttribute('href', dataUri);
    }
  }

  // External scripts → inline <script> (keeps order; no sibling blob fetch)
  for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
    const src = script.getAttribute('src');
    if (!src || shouldLeavePreviewUrl(src)) {
      continue;
    }
    const jsPath = resolvePreviewAssetPath(htmlPath, src);
    const jsText = await loadTextAsset(jsPath, fetchAsset);
    if (jsText == null) {
      continue;
    }
    script.removeAttribute('src');
    // Prevent premature script end if source contains a literal </script>.
    script.textContent = jsText.replace(/<\/script/gi, '<\\/script');
  }

  // Leave existing inline scripts as-is (requires script-src 'unsafe-inline' on the app CSP).

  // Inline style blocks with relative url(...)
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    const text = style.textContent ?? '';
    if (!text.trim()) {
      continue;
    }
    style.textContent = await rewriteCssUrls(text, htmlPath, fetchAsset, dataUriCache);
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
      const dataUri = await replaceRef(value);
      if (dataUri) {
        node.setAttribute(attr, dataUri);
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

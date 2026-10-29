// Extension to Monaco language id
const EXT_LANG: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  jsx: 'javascript',
  tsx: 'typescript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'shell',
  bash: 'shell',
  py: 'python',
  vue: 'html',
  sql: 'sql',
  xml: 'xml'
};

export function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG[extension] ?? 'plaintext';
}

// Extension to image MIME type (files rendered as pictures instead of text)
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif'
};

export function extensionForPath(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

export function isImagePath(path: string): boolean {
  return extensionForPath(path) in IMAGE_MIME;
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index++) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
}

/** Raw bytes of a file's content, decoded according to its encoding. */
export function fileContentBytes(content: string, encoding: 'utf8' | 'base64'): Uint8Array<ArrayBuffer> {
  if (encoding === 'base64') {
    return base64ToBytes(content);
  }
  // Copy into a fresh ArrayBuffer-backed array so the result is a valid BlobPart.
  return new Uint8Array(new TextEncoder().encode(content));
}

export function mimeForPath(path: string): string {
  return IMAGE_MIME[extensionForPath(path)] ?? 'application/octet-stream';
}

export function parentPath(path: string): string {
  const slashIndex = path.lastIndexOf('/');
  return slashIndex >= 0 ? path.slice(0, slashIndex) : '';
}

export function normalizeNewFilePath(path: string): string {
  return path.trim().replace(/^\/+/, '').replace(/\/+/g, '/');
}

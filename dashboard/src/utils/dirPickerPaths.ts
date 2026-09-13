/**
 * Path helpers for the workspace folder browser.
 * The UI shows paths relative to the browse root (`/` = root).
 * The browse API accepts relative paths (or absolute under the root).
 */

/** Convert a UI/current/entry path into a browse API path (relative, no leading slash). */
export function toApiBrowsePath(path: string, browseRoot: string): string {
  const trimmed = (path ?? '').trim();
  if (!trimmed || trimmed === '/' || trimmed === '.') {
    return '';
  }
  const root = browseRoot.replace(/\/+$/, '');
  if (root && (trimmed === root || trimmed.startsWith(root + '/'))) {
    return trimmed.slice(root.length).replace(/^\/+/, '');
  }
  return trimmed.replace(/^\/+/, '');
}

/** Convert an absolute (or already-relative) server path into a UI path under the browse root. */
export function toDisplayBrowsePath(absolutePath: string, browseRoot: string): string {
  const root = browseRoot.replace(/\/+$/, '');
  const abs = (absolutePath ?? '').replace(/\/+$/, '') || '/';
  if (!root) {
    return abs.startsWith('/') ? abs : '/' + abs;
  }
  if (abs === root) {
    return '/';
  }
  if (abs.startsWith(root + '/')) {
    return abs.slice(root.length) || '/';
  }
  // Already a UI-relative path
  if (!abs.startsWith('/')) {
    return '/' + abs;
  }
  return abs;
}

/** Value stored on the workspace when the user confirms the current folder. */
export function toWorkspacePathFromDisplay(displayPath: string): string {
  if (!displayPath || displayPath === '/') {
    return '.';
  }
  return displayPath.replace(/^\//, '');
}

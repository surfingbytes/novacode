/**
 * Platform-aware keyboard modifier labels (⌘ on Apple devices, Ctrl elsewhere).
 */

const MAC_LIKE_PATTERN = /Mac|iPhone|iPad|iPod/;

function isMacLike(): boolean {
  return typeof navigator !== 'undefined' && MAC_LIKE_PATTERN.test(navigator.userAgent);
}

export function modKeyLabel(): '⌘' | 'Ctrl' {
  return isMacLike() ? '⌘' : 'Ctrl';
}

/** Mod + key label, e.g. `'⌘K'` or `'Ctrl+K'`. */
export function shortcutLabel(key: string): string {
  return isMacLike() ? `⌘${key}` : `Ctrl+${key}`;
}

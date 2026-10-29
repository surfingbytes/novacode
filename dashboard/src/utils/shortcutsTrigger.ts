/**
 * Decides whether a keydown should open the keyboard-shortcuts cheat sheet.
 */

const EDITABLE_TAG_NAMES = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  if (EDITABLE_TAG_NAMES.has(target.tagName)) {
    return true;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

export function shouldOpenShortcuts(event: KeyboardEvent): boolean {
  if (event.key !== '?') {
    return false;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) {
    return false;
  }
  return !isEditableTarget(event.target);
}

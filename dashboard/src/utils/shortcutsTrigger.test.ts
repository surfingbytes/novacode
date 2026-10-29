// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach } from 'vitest';

// utils
import { shouldOpenShortcuts } from '@/utils/shortcutsTrigger';

function keydownOn(target: Element, init: KeyboardEventInit): KeyboardEvent {
  let captured: KeyboardEvent | null = null;
  target.addEventListener('keydown', (event) => { captured = event as KeyboardEvent; }, { once: true });
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
  if (!captured) {
    throw new Error('keydown not dispatched');
  }
  return captured;
}

describe('shouldOpenShortcuts', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="plain"></div>
      <input id="input" />
      <textarea id="textarea"></textarea>
      <select id="select"></select>
      <div contenteditable="true"><span id="editable-child"></span></div>
      <div contenteditable="false"><span id="non-editable-child"></span></div>
    `;
  });

  it('opens on ? from a non-editable element', () => {
    expect(shouldOpenShortcuts(keydownOn(document.getElementById('plain')!, { key: '?', shiftKey: true }))).toBe(true);
    expect(shouldOpenShortcuts(keydownOn(document.getElementById('non-editable-child')!, { key: '?' }))).toBe(true);
  });

  it('ignores other keys', () => {
    expect(shouldOpenShortcuts(keydownOn(document.getElementById('plain')!, { key: '/' }))).toBe(false);
  });

  it('ignores ? with Ctrl, Meta or Alt', () => {
    const plain = document.getElementById('plain')!;
    expect(shouldOpenShortcuts(keydownOn(plain, { key: '?', ctrlKey: true }))).toBe(false);
    expect(shouldOpenShortcuts(keydownOn(plain, { key: '?', metaKey: true }))).toBe(false);
    expect(shouldOpenShortcuts(keydownOn(plain, { key: '?', altKey: true }))).toBe(false);
  });

  it('ignores ? typed into editable targets', () => {
    for (const id of ['input', 'textarea', 'select', 'editable-child']) {
      expect(shouldOpenShortcuts(keydownOn(document.getElementById(id)!, { key: '?' }))).toBe(false);
    }
  });
});

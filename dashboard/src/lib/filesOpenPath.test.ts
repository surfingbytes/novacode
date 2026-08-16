// @vitest-environment jsdom

// node_modules
import { describe, it, expect, beforeEach } from 'vitest';

// lib
import {
  filesOpenPathStorageKey,
  readFilesOpenPath,
  writeFilesOpenPath
} from '@/lib/filesOpenPath';

describe('filesOpenPath', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a workspace file path', () => {
    writeFilesOpenPath('ws-1', 'src/app.ts');
    expect(readFilesOpenPath('ws-1')).toBe('src/app.ts');
    expect(localStorage.getItem(filesOpenPathStorageKey('ws-1'))).toBe('src/app.ts');
  });

  it('keeps paths isolated per workspace', () => {
    writeFilesOpenPath('ws-1', 'a.ts');
    writeFilesOpenPath('ws-2', 'b.ts');
    expect(readFilesOpenPath('ws-1')).toBe('a.ts');
    expect(readFilesOpenPath('ws-2')).toBe('b.ts');
  });

  it('clears the stored path when writing null or blank', () => {
    writeFilesOpenPath('ws-1', 'a.ts');
    writeFilesOpenPath('ws-1', null);
    expect(readFilesOpenPath('ws-1')).toBeNull();

    writeFilesOpenPath('ws-1', 'a.ts');
    writeFilesOpenPath('ws-1', '   ');
    expect(readFilesOpenPath('ws-1')).toBeNull();
  });

  it('returns null for missing or blank stored values', () => {
    expect(readFilesOpenPath('missing')).toBeNull();
    localStorage.setItem(filesOpenPathStorageKey('ws-1'), '   ');
    expect(readFilesOpenPath('ws-1')).toBeNull();
  });
});

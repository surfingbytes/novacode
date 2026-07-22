// node_modules
import { describe, it, expect } from 'vitest';

// classes
import {
  appendHandoff,
  buildStepPrompt,
  collectStepSessionIdsFromSubtasksJson,
  mergeSubtasksJsonPatch,
  normalizeSubtasksPayload,
  parseSubtasksPayloadString,
  serializeSubtasksPayload,
  subtasksFromStoredJson
} from './orchestratorPayload.js';

describe('normalizeSubtasksPayload', () => {
  it('wraps legacy raw arrays', () => {
    expect(normalizeSubtasksPayload([{ name: 'a', prompt: 'b' }])).toEqual({
      sharedContext: '',
      handoffLog: '',
      subtasks: [{ name: 'a', prompt: 'b' }]
    });
  });

  it('returns null for garbage', () => {
    expect(normalizeSubtasksPayload('nope')).toBeNull();
    expect(normalizeSubtasksPayload({ foo: 1 })).toBeNull();
  });
});

describe('parse/serialize round-trip', () => {
  it('round-trips a full payload', () => {
    const payload = {
      sharedContext: 'ctx',
      handoffLog: 'log',
      subtasks: [{ name: 'a', prompt: 'b', sessionId: 's1' }]
    };
    expect(parseSubtasksPayloadString(serializeSubtasksPayload(payload))).toEqual(payload);
  });

  it('returns null for empty/invalid json', () => {
    expect(parseSubtasksPayloadString('')).toBeNull();
    expect(parseSubtasksPayloadString('{broken')).toBeNull();
  });

  it('subtasksFromStoredJson returns [] for invalid json', () => {
    expect(subtasksFromStoredJson(undefined)).toEqual([]);
  });
});

describe('collectStepSessionIdsFromSubtasksJson', () => {
  it('dedupes and skips blanks', () => {
    const json = serializeSubtasksPayload({
      sharedContext: '',
      handoffLog: '',
      subtasks: [
        { name: 'a', prompt: 'p', sessionId: 's1' },
        { name: 'b', prompt: 'p', sessionId: 's1' },
        { name: 'c', prompt: 'p', sessionId: ' ' },
        { name: 'd', prompt: 'p', sessionId: 's2' }
      ]
    });
    expect(collectStepSessionIdsFromSubtasksJson(json)).toEqual(['s1', 's2']);
  });
});

describe('mergeSubtasksJsonPatch', () => {
  it('keeps context when given a legacy array', () => {
    const existing = serializeSubtasksPayload({
      sharedContext: 'keep',
      handoffLog: 'me',
      subtasks: []
    });
    const merged = mergeSubtasksJsonPatch(JSON.stringify([{ name: 'x', prompt: 'y' }]), existing);
    expect(parseSubtasksPayloadString(merged)).toEqual({
      sharedContext: 'keep',
      handoffLog: 'me',
      subtasks: [{ name: 'x', prompt: 'y' }]
    });
  });

  it('passes through undefined/null', () => {
    expect(mergeSubtasksJsonPatch(undefined, 'x')).toBeUndefined();
    expect(mergeSubtasksJsonPatch(null, 'x')).toBeNull();
  });
});

describe('buildStepPrompt', () => {
  it('returns the bare prompt without context', () => {
    expect(buildStepPrompt({ name: 'a', prompt: ' do it ' }, { sharedContext: '', handoffLog: '', subtasks: [] })).toBe('do it');
  });

  it('includes shared context and handoff sections', () => {
    const out = buildStepPrompt(
      { name: 'a', prompt: 'do it' },
      { sharedContext: 'ctx', handoffLog: 'log', subtasks: [] }
    );
    expect(out).toContain('## Shared plan context');
    expect(out).toContain('## Completed steps');
    expect(out).toContain('## This step');
    expect(out.endsWith('do it')).toBe(true);
  });
});

describe('appendHandoff', () => {
  it('appends numbered blocks', () => {
    expect(appendHandoff('', 1, 'Setup', 'done')).toBe('### Step 1: Setup\n\ndone');
    expect(appendHandoff('### Step 1: A\n\nx', 2, 'B', 'y')).toContain('### Step 2: B');
  });
});

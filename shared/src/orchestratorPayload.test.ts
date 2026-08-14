// node_modules
import { describe, it, expect } from 'vitest';

// classes
import {
  appendHandoff,
  buildStepPrompt,
  cloneSubtasksForNewPlan,
  collectStepSessionIdsFromSubtasksJson,
  mergeSubtasksJsonPatch,
  normalizeSubtasksPayload,
  parseSubtasksPayloadString,
  remapDependsOnAfterDelete,
  serializeSubtasksPayload,
  shouldSkipOrchestratorStep,
  subtasksFromStoredJson
} from './orchestratorPayload.js';
import type { SubTask } from './types.js';

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

describe('shouldSkipOrchestratorStep', () => {
  it('skips when a dependency failed or was skipped', () => {
    const subtasks: SubTask[] = [
      { name: 'a', prompt: 'a', runResult: 'failed' },
      { name: 'b', prompt: 'b', dependsOn: [0] },
      { name: 'c', prompt: 'c', dependsOn: [1] }
    ];
    expect(shouldSkipOrchestratorStep(1, subtasks)).toBe(true);
    subtasks[1].runResult = 'skipped';
    expect(shouldSkipOrchestratorStep(2, subtasks)).toBe(true);
  });

  it('does not skip when dependencies succeeded', () => {
    const subtasks: SubTask[] = [
      { name: 'a', prompt: 'a', runResult: 'done' },
      { name: 'b', prompt: 'b', dependsOn: [0] }
    ];
    expect(shouldSkipOrchestratorStep(1, subtasks)).toBe(false);
  });
});

describe('cloneSubtasksForNewPlan', () => {
  it('strips session ids, run results, and handoff', () => {
    const cloned = cloneSubtasksForNewPlan(
      JSON.stringify({
        sharedContext: 'ctx',
        handoffLog: 'old notes',
        subtasks: [
          { name: 'a', prompt: 'do a', sessionId: 'sess-1', runResult: 'done' },
          { name: 'b', prompt: 'do b', category: 'tests', dependsOn: [0] }
        ]
      })
    );
    expect(cloned.sharedContext).toBe('ctx');
    expect(cloned.handoffLog).toBe('');
    expect(cloned.subtasks).toEqual([
      { name: 'a', prompt: 'do a', category: null },
      { name: 'b', prompt: 'do b', category: 'tests', dependsOn: [0] }
    ]);
  });
});

describe('remapDependsOnAfterDelete', () => {
  it('drops the deleted step and shifts later indexes', () => {
    const remapped = remapDependsOnAfterDelete(
      [
        { name: 'b', prompt: 'b', dependsOn: [0] },
        { name: 'c', prompt: 'c', dependsOn: [0, 1] }
      ],
      0
    );
    expect(remapped[0]?.dependsOn).toBeUndefined();
    expect(remapped[1]?.dependsOn).toEqual([0]);
  });
});

// node_modules
import { describe, it, expect } from 'vitest';

// classes
import {
  summarizeStepHandoff,
  appendHandoff,
  buildStepPrompt,
  cloneSubtasksForNewPlan,
  collectStepSessionIdsFromSubtasksJson,
  handoffNoteForStep,
  insertSubtask,
  mergeSubtasksJsonPatch,
  moveSubtask,
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

  const log = '### Step 1: A\n\nnotes a\n\n### Step 2: B\n\nnotes b\n\n### Step 3: C\n\nnotes c';
  const payload = { sharedContext: '', handoffLog: log, subtasks: [] };

  it('gives work steps no spec and only their dependencies\' handoff notes', () => {
    const out = buildStepPrompt({ name: 'd', prompt: 'do it', dependsOn: [0, 2] }, payload, 'SPEC', 3);
    expect(out).not.toContain('SPEC');
    expect(out).toContain('notes a');
    expect(out).not.toContain('notes b');
    expect(out).toContain('notes c');
  });

  it('drops the handoff section for steps without dependencies', () => {
    expect(buildStepPrompt({ name: 'd', prompt: 'do it' }, payload, 'SPEC', 3)).toBe('do it');
  });

  it('gives the verify step the spec and every handoff note', () => {
    const out = buildStepPrompt({ name: 'v', prompt: 'check', kind: 'verify', dependsOn: [0] }, payload, 'SPEC', 3);
    expect(out).toContain('## Spec\n\nSPEC');
    expect(out).toContain('notes b');
  });
});

describe('summarizeStepHandoff', () => {
  const chunk = (text: string) =>
    JSON.stringify({ sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });
  const toolCall = JSON.stringify({ sessionId: 's', update: { sessionUpdate: 'tool_call', title: 'Terminal' } });

  it('keeps the ACP text after the last tool call', () => {
    const events = [chunk('Looking around. '), toolCall, chunk('Step done: '), chunk('added the schema.')];
    expect(summarizeStepHandoff([{ role: 'assistant', content: '', events, createdAt: '' }])).toBe('Step done: added the schema.');
  });
});

describe('appendHandoff', () => {
  it('appends numbered blocks', () => {
    expect(appendHandoff('', 1, 'Setup', 'done')).toBe('### Step 1: Setup\n\ndone');
    expect(appendHandoff('### Step 1: A\n\nx', 2, 'B', 'y')).toContain('### Step 2: B');
  });
});

describe('handoffNoteForStep', () => {
  const log = [
    '### Step 1: Setup',
    '',
    'Installed deps.',
    'Second line.',
    '',
    '### Step 2: Backend',
    '',
    'Added routes.',
    '',
    '### Step 10: Verify',
    '',
    'All green.'
  ].join('\n');

  it('returns the trimmed body without the heading line', () => {
    expect(handoffNoteForStep(log, 0)).toBe('Installed deps.\nSecond line.');
    expect(handoffNoteForStep(log, 1)).toBe('Added routes.');
  });

  it('matches the whole step number, not a prefix', () => {
    expect(handoffNoteForStep(log, 9)).toBe('All green.');
    expect(handoffNoteForStep(log, 0)).not.toContain('All green.');
  });

  it('returns null when the step has no block', () => {
    expect(handoffNoteForStep(log, 2)).toBeNull();
    expect(handoffNoteForStep('', 0)).toBeNull();
    expect(handoffNoteForStep('…(earlier handoff truncated)', 0)).toBeNull();
  });

  it('returns an empty string for a heading without a body', () => {
    expect(handoffNoteForStep('### Step 1: Empty', 0)).toBe('');
  });

  it('prefers the latest block when a step reported more than once', () => {
    const rerun = '### Step 1: A\n\nfirst try\n\n### Step 2: B\n\nb\n\n### Step 1: A\n\nsecond try';
    expect(handoffNoteForStep(rerun, 0)).toBe('second try');
    expect(handoffNoteForStep(rerun, 1)).toBe('b');
  });

  it('keeps "### Step" text inside a body', () => {
    const nested = '### Step 1: A\n\nSee ### Step 2: later inline\n\n### Step 2: B\n\nbody';
    expect(handoffNoteForStep(nested, 0)).toBe('See ### Step 2: later inline');
    expect(handoffNoteForStep(nested, 1)).toBe('body');
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

describe('moveSubtask', () => {
  const plan: SubTask[] = [
    { name: 'a', prompt: 'a' },
    { name: 'b', prompt: 'b', dependsOn: [0] },
    { name: 'c', prompt: 'c', dependsOn: [0] },
    { name: 'd', prompt: 'd', dependsOn: [1, 2] },
    { name: 'verify', prompt: 'v', kind: 'verify', dependsOn: [0, 1, 2, 3] }
  ];

  it('swaps the two steps and keeps their own dependencies pointing at the same steps', () => {
    const moved = moveSubtask(plan, 1, 2);
    expect(moved.map((task) => task.name)).toEqual(['a', 'c', 'b', 'd', 'verify']);
    expect(moved[1]?.dependsOn).toEqual([0]);
    expect(moved[2]?.dependsOn).toEqual([0]);
  });

  it('remaps dependencies of later steps onto the moved pair', () => {
    const moved = moveSubtask(plan, 1, 2);
    // d depended on b (1) and c (2); after the swap b is 2 and c is 1.
    expect(moved[3]?.dependsOn).toEqual([1, 2]);
    expect(moved[4]?.dependsOn).toEqual([0, 1, 2, 3]);

    const later: SubTask[] = [
      { name: 'a', prompt: 'a' },
      { name: 'b', prompt: 'b' },
      { name: 'c', prompt: 'c', dependsOn: [1] }
    ];
    const movedUp = moveSubtask(later, 1, 0);
    expect(movedUp.map((task) => task.name)).toEqual(['b', 'a', 'c']);
    expect(movedUp[2]?.dependsOn).toEqual([0]);
  });

  it('drops a dependency between the two swapped steps', () => {
    const moved = moveSubtask(plan, 0, 1);
    expect(moved.map((task) => task.name)).toEqual(['b', 'a', 'c', 'd', 'verify']);
    expect(moved[0]?.dependsOn).toBeUndefined();
    expect(moved[1]?.dependsOn).toBeUndefined();
    expect(moved[2]?.dependsOn).toEqual([1]);
  });

  it('ignores non-adjacent or out-of-range moves and leaves the input untouched', () => {
    expect(moveSubtask(plan, 0, 2)).toBe(plan);
    expect(moveSubtask(plan, 4, 5)).toBe(plan);
    expect(moveSubtask(plan, 0, -1)).toBe(plan);
    expect(moveSubtask(plan, 1, 1)).toBe(plan);
    moveSubtask(plan, 1, 2);
    expect(plan[1]?.name).toBe('b');
    expect(plan[3]?.dependsOn).toEqual([1, 2]);
  });
});

describe('insertSubtask', () => {
  const plan: SubTask[] = [
    { name: 'a', prompt: 'a' },
    { name: 'b', prompt: 'b', dependsOn: [0] },
    { name: 'merge', prompt: 'm', kind: 'merge' },
    { name: 'verify', prompt: 'v', kind: 'verify', dependsOn: [0, 1, 2] }
  ];

  it('inserts before the automatic steps and shifts dependencies past the insert point', () => {
    const next = insertSubtask(plan, 2, { name: 'c', prompt: 'c', dependsOn: [1] });
    expect(next.map((task) => task.name)).toEqual(['a', 'b', 'c', 'merge', 'verify']);
    expect(next[2]?.dependsOn).toEqual([1]);
    expect(next[3]?.dependsOn).toBeUndefined();
    // verify keeps depending on every other step, including the new one
    expect(next[4]?.dependsOn).toEqual([0, 1, 2, 3]);
  });

  it('drops dependencies of the new step on steps at or after its position', () => {
    const next = insertSubtask(plan, 1, { name: 'x', prompt: 'x', dependsOn: [0, 1, 3] });
    expect(next[1]?.dependsOn).toEqual([0]);
    expect(next[2]?.dependsOn).toEqual([0]);
    expect(next[4]?.dependsOn).toEqual([0, 1, 2, 3]);
  });

  it('appends at the end when the index is past the last step', () => {
    const next = insertSubtask([{ name: 'a', prompt: 'a' }], 5, { name: 'b', prompt: 'b' });
    expect(next.map((task) => task.name)).toEqual(['a', 'b']);
    expect(next[1]?.dependsOn).toBeUndefined();
  });
});

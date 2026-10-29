import { describe, expect, it } from 'vitest';

import { buildPlanSubtasks, ensureMergeStep, MERGE_STEP_NAME, validatePlanSteps, VERIFY_STEP_NAME } from './orchestratorPlan';

// types
import type { SubTask } from '../@types/index';

describe('validatePlanSteps', () => {
  it('accepts steps and normalizes optional fields', () => {
    expect(
      validatePlanSteps([
        { name: ' A ', prompt: 'do a' },
        { name: 'B', prompt: 'do b', category: 'tests', dependsOn: [0, 0] }
      ])
    ).toEqual({
      steps: [
        { name: 'A', prompt: 'do a', category: null, dependsOn: [] },
        { name: 'B', prompt: 'do b', category: 'tests', dependsOn: [0] }
      ]
    });
  });

  it('reports missing fields and forward or self dependencies', () => {
    const result = validatePlanSteps([
      { name: 'A', prompt: '', dependsOn: [1] },
      { name: '', prompt: 'b', dependsOn: [1] }
    ]);
    expect('error' in result && result.error).toContain('Step 0: "prompt" is required.');
    expect('error' in result && result.error).toContain('Step 0: "dependsOn" may only reference earlier steps');
    expect('error' in result && result.error).toContain('Step 1: "name" is required.');
    expect('error' in result && result.error).toContain('Step 1: "dependsOn" may only reference earlier steps');
  });

  it('drops merge and verify steps copied back from orchestrator_get', () => {
    const result = validatePlanSteps([
      { name: 'A', prompt: 'a' },
      { name: MERGE_STEP_NAME, prompt: 'merge', kind: 'merge' },
      { name: VERIFY_STEP_NAME, prompt: 'check', kind: 'verify' }
    ]);
    expect('steps' in result && result.steps).toHaveLength(1);
    expect(validatePlanSteps([{ name: VERIFY_STEP_NAME, prompt: 'x' }])).toHaveProperty('error');
    expect(validatePlanSteps([{ name: MERGE_STEP_NAME, prompt: 'x' }])).toHaveProperty('error');
    expect(validatePlanSteps('nope')).toHaveProperty('error');
  });
});

describe('buildPlanSubtasks', () => {
  it('appends a merge step and a verify step depending on every step', () => {
    const subtasks = buildPlanSubtasks([
      { name: 'A', prompt: 'a', category: null, dependsOn: [] },
      { name: 'B', prompt: 'b', category: null, dependsOn: [0] }
    ]);
    expect(subtasks).toHaveLength(4);
    expect(subtasks[1].dependsOn).toEqual([0]);
    expect(subtasks[2]).toMatchObject({ name: MERGE_STEP_NAME, kind: 'merge' });
    expect(subtasks[2].dependsOn).toBeUndefined();
    expect(subtasks[3]).toMatchObject({ name: VERIFY_STEP_NAME, kind: 'verify', dependsOn: [0, 1, 2] });
  });

  it('keeps done results only for unchanged steps', () => {
    const subtasks = buildPlanSubtasks(
      [
        { name: 'A', prompt: 'a', category: null, dependsOn: [] },
        { name: 'B', prompt: 'b changed', category: null, dependsOn: [] }
      ],
      [
        { name: 'A', prompt: 'a', runResult: 'done', sessionId: 's1' },
        { name: 'B', prompt: 'b', runResult: 'done', sessionId: 's2' },
        { name: VERIFY_STEP_NAME, prompt: 'v', kind: 'verify', runResult: 'done' }
      ]
    );
    expect(subtasks[0]).toMatchObject({ runResult: 'done', sessionId: 's1' });
    expect(subtasks[1].runResult).toBeUndefined();
    expect(subtasks[2].runResult).toBeUndefined();
    expect(subtasks[3].runResult).toBeUndefined();
  });
});

describe('ensureMergeStep', () => {
  it('inserts the merge step before the verify step, which then depends on it', () => {
    const subtasks: SubTask[] = [
      { name: 'A', prompt: 'a', runResult: 'done' },
      { name: 'B', prompt: 'b', dependsOn: [0] },
      { name: VERIFY_STEP_NAME, prompt: 'v', kind: 'verify', dependsOn: [0, 1] }
    ];
    expect(ensureMergeStep(subtasks)).toBe(true);
    expect(subtasks.map((task) => task.name)).toEqual(['A', 'B', MERGE_STEP_NAME, VERIFY_STEP_NAME]);
    expect(subtasks[1].dependsOn).toEqual([0]);
    expect(subtasks[2]).toMatchObject({ kind: 'merge' });
    expect(subtasks[3].dependsOn).toEqual([0, 1, 2]);
    expect(ensureMergeStep(subtasks)).toBe(false);
    expect(subtasks).toHaveLength(4);
  });

  it('appends the merge step to a plan without a verify step', () => {
    const subtasks: SubTask[] = [{ name: 'A', prompt: 'a' }];
    expect(ensureMergeStep(subtasks)).toBe(true);
    expect(subtasks[1]).toMatchObject({ name: MERGE_STEP_NAME, kind: 'merge' });
  });
});

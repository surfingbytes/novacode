import { describe, expect, it } from 'vitest';

import { buildPlanSubtasks, validatePlanSteps, VERIFY_STEP_NAME } from './orchestratorPlan';

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

  it('drops a verify step copied back from orchestrator_get', () => {
    const result = validatePlanSteps([
      { name: 'A', prompt: 'a' },
      { name: VERIFY_STEP_NAME, prompt: 'check', kind: 'verify' }
    ]);
    expect('steps' in result && result.steps).toHaveLength(1);
    expect(validatePlanSteps([{ name: VERIFY_STEP_NAME, prompt: 'x' }])).toHaveProperty('error');
    expect(validatePlanSteps('nope')).toHaveProperty('error');
  });
});

describe('buildPlanSubtasks', () => {
  it('appends a verify step depending on every step', () => {
    const subtasks = buildPlanSubtasks([
      { name: 'A', prompt: 'a', category: null, dependsOn: [] },
      { name: 'B', prompt: 'b', category: null, dependsOn: [0] }
    ]);
    expect(subtasks).toHaveLength(3);
    expect(subtasks[1].dependsOn).toEqual([0]);
    expect(subtasks[2]).toMatchObject({ name: VERIFY_STEP_NAME, kind: 'verify', dependsOn: [0, 1] });
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
  });
});

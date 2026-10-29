// classes
import { normalizeDependsOn } from './orchestratorPayload';

// types
import type { SubTask } from '../@types/index';

/**
 * Plan steps as the planning agent sends them through `orchestrator_save_plan`,
 * validated strictly so mistakes come back to the agent instead of being guessed.
 */

export const VERIFY_STEP_NAME = 'Verify against spec';

const VERIFY_STEP_PROMPT = `Check the whole implementation against the spec above and the handoff notes from the earlier steps.
For every requirement and acceptance criterion: confirm it is implemented correctly; fix anything missing, wrong or inconsistent.
Run the project's existing tests, typecheck and lint if available, and fix failures caused by this work.
Finish with a short list: verified OK / fixed / still open (with the reason).`;

export const MERGE_STEP_NAME = 'Merge into workspace';

const MERGE_STEP_PROMPT = `Automatic step of parallel runs: applies the combined result of the steps (their integration branch) to the workspace as uncommitted changes.
When the changes don't apply cleanly, an agent resolves the conflicts in the workspace; the step fails if conflict markers remain, and can be run again.
In one-by-one runs the steps already work in the workspace, so there is nothing to merge.`;

const MAX_STEPS = 40;

export interface PlanStepInput {
  name: string;
  prompt: string;
  category: string | null;
  dependsOn: number[];
}

function isVerifyStep(step: { name?: unknown; kind?: unknown }): boolean {
  return step.kind === 'verify' || (typeof step.name === 'string' && step.name.trim() === VERIFY_STEP_NAME);
}

function isMergeStep(step: { name?: unknown; kind?: unknown }): boolean {
  return step.kind === 'merge' || (typeof step.name === 'string' && step.name.trim() === MERGE_STEP_NAME);
}

/** The merge and verify steps are added by the plan, not by the agent. */
function isAutoStep(step: { name?: unknown; kind?: unknown }): boolean {
  return isVerifyStep(step) || isMergeStep(step);
}

/** Validate raw tool input. Merge and verify steps the agent copied back from `orchestrator_get` are dropped. */
export function validatePlanSteps(raw: unknown): { steps: PlanStepInput[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: '"steps" must be an array of steps.' };
  const items = raw.filter((item) => !(item && typeof item === 'object' && isAutoStep(item as Record<string, unknown>)));
  if (items.length === 0) return { error: 'The plan needs at least one step (the merge and verify steps are added automatically).' };
  if (items.length > MAX_STEPS) return { error: `Too many steps (${items.length}); keep it to ${MAX_STEPS} or fewer.` };

  const errors: string[] = [];
  const steps: PlanStepInput[] = items.map((item, index) => {
    const step = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const label = `Step ${index}`;
    const name = typeof step.name === 'string' ? step.name.trim() : '';
    const prompt = typeof step.prompt === 'string' ? step.prompt.trim() : '';
    if (!name) errors.push(`${label}: "name" is required.`);
    if (!prompt) errors.push(`${label}: "prompt" is required.`);
    const category = typeof step.category === 'string' && step.category.trim() ? step.category.trim() : null;
    const rawDeps = step.dependsOn ?? [];
    if (!Array.isArray(rawDeps) || rawDeps.some((dep) => typeof dep !== 'number' || !Number.isInteger(dep))) {
      errors.push(`${label}: "dependsOn" must be an array of 0-based step indexes.`);
    }
    const dependsOn = normalizeDependsOn(rawDeps);
    const bad = dependsOn.filter((dep) => dep >= index);
    if (bad.length > 0) {
      errors.push(`${label}: "dependsOn" may only reference earlier steps (got ${bad.join(', ')}); reorder the steps.`);
    }
    return { name, prompt, category, dependsOn: dependsOn.filter((dep) => dep < index) };
  });
  return errors.length > 0 ? { error: errors.join('\n') } : { steps };
}

function mergeStep(): SubTask {
  return { name: MERGE_STEP_NAME, prompt: MERGE_STEP_PROMPT, category: 'merge', kind: 'merge' };
}

/**
 * Give a plan saved before merge steps existed its merge step, placed before the
 * verify step (which then depends on it too). Returns true when a step was added.
 */
export function ensureMergeStep(subtasks: SubTask[]): boolean {
  if (subtasks.some((task) => task.kind === 'merge')) return false;
  const verifyIndex = subtasks.findIndex((task) => task.kind === 'verify');
  const at = verifyIndex === -1 ? subtasks.length : verifyIndex;
  for (const task of subtasks) {
    const deps = normalizeDependsOn(task.dependsOn);
    if (deps.some((dep) => dep >= at)) task.dependsOn = deps.map((dep) => (dep >= at ? dep + 1 : dep));
  }
  subtasks.splice(at, 0, mergeStep());
  for (const task of subtasks) {
    if (task.kind === 'verify') task.dependsOn = [...new Set([...normalizeDependsOn(task.dependsOn), at])].sort((a, b) => a - b);
  }
  return true;
}

/**
 * Stored subtasks for a saved plan: the agent's steps plus the merge step and
 * the verify step (depends on every other step). Steps whose name and prompt are
 * unchanged keep their earlier "done" result and session, so re-planning doesn't redo work.
 */
export function buildPlanSubtasks(steps: PlanStepInput[], previous: SubTask[] = []): SubTask[] {
  const finished = new Map<string, SubTask>();
  for (const task of previous) {
    if (task.runResult === 'done' && !isAutoStep(task)) {
      finished.set(`${task.name}\u0000${task.prompt}`, task);
    }
  }
  const subtasks: SubTask[] = steps.map((step) => {
    const kept = finished.get(`${step.name}\u0000${step.prompt}`);
    return {
      name: step.name,
      prompt: step.prompt,
      category: step.category,
      ...(step.dependsOn.length > 0 ? { dependsOn: step.dependsOn } : {}),
      ...(kept ? { runResult: 'done' as const, ...(kept.sessionId ? { sessionId: kept.sessionId } : {}) } : {})
    };
  });
  subtasks.push(mergeStep());
  subtasks.push({
    name: VERIFY_STEP_NAME,
    prompt: VERIFY_STEP_PROMPT,
    category: 'review',
    kind: 'verify',
    dependsOn: subtasks.map((_, index) => index)
  });
  return subtasks;
}

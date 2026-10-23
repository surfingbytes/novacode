// node_modules
import { join } from 'node:path';

// classes
import { db, normalizeTagStringList } from '../classes/database';
import { config } from '../classes/config';
import { createSessionWithAgent } from '../classes/sessionService';
import { dispatchPromptAndWait, isSessionBusy, subscribeBusy, unsubscribeBusy } from '../classes/chatEngine';
import { isNovaMcpEnabled } from '../classes/novaMcp';
import { readSessionSpec, specHasContent } from '../classes/sessionSpec';
import { resolveWorkspaceAbsolutePath } from '../classes/workspacePaths';
import { sendPushToAll } from '../classes/push';
import { logger } from '../classes/logger';
import {
  appendHandoff,
  buildStepPrompt,
  findRunnableSteps,
  serializeSubtasksPayload,
  shouldSkipOrchestratorStep,
  summarizeStepHandoff
} from '../classes/orchestratorPayload';
import {
  abortMerge,
  addWorktree,
  applyCommitRangeToWorkingTree,
  commitAll,
  concludeMerge,
  createSnapshotCommit,
  deleteBranch,
  headCommit,
  linkIgnoredEntries,
  mergeBranch,
  removeWorktree,
  resolveRepo,
  unmergedFiles,
  worktreesRootDir
} from '../classes/gitWorktrees';
import { updateOrchestratorAndBroadcast } from './orchestrator';

// types
import type { AgentType, ApprovalPolicy, ChatMessage, OrchestratorRunMode, OrchestratorSubtasksPayload, SubTask } from '../@types/index';
import type { RepoInfo } from '../classes/gitWorktrees';

const STEP_TIMEOUT_MS = 60000_000;
const STOP_POLL_MS = 5000;

const STEP_NEEDS_INPUT_PROMPT = `## If you need the user

You run as one step of an automated plan; later steps start as soon as your turn ends. If you cannot finish this step without an answer from the user, call the nova \`step_needs_input\` tool with your question, then end your turn with the question. The plan waits until the user replies here. Do not use it for questions you can decide yourself.`;

/** Plans of runs still in flight, by orchestrator id (a stopped run lives on until its running steps end). */
const activeRuns = new Map<string, OrchestratorSubtasksPayload>();

/** Names of the steps a still-finishing earlier run works on, or null when no run is in flight. */
export function inFlightRunSteps(orchestratorId: string): string[] | null {
  const payload = activeRuns.get(orchestratorId);
  return payload ? payload.subtasks.filter((task) => task.runResult === 'running').map((task) => task.name) : null;
}

/** Sessions of steps that are running now (only these may call step_needs_input). */
const runningStepSessions = new Set<string>();
/** Question a running step's agent asked during its current turn. */
const stepQuestions = new Map<string, string>();

/** Called by the nova `step_needs_input` tool; false when the session isn't a running step. */
export function markStepNeedsInput(sessionId: string, question: string): boolean {
  if (!runningStepSessions.has(sessionId)) return false;
  stepQuestions.set(sessionId, question);
  return true;
}

/**
 * Wait until the user's reply turn in the step session finishes; resolves with
 * the session's messages, or null when the run was stopped first.
 */
function waitForReplyTurn(
  sessionId: string,
  isStopped: () => Promise<boolean>
): Promise<{ messages: ChatMessage[] } | null> {
  return new Promise((resolve) => {
    let bSawBusy = isSessionBusy(sessionId);
    let bSettled = false;
    const finish = (result: { messages: ChatMessage[] } | null): void => {
      if (bSettled) return;
      bSettled = true;
      unsubscribeBusy(onBusy);
      clearInterval(poll);
      resolve(result);
    };
    const onBusy = (busySessionId: string, _workspaceId: string, bBusy: boolean): void => {
      if (busySessionId !== sessionId) return;
      if (bBusy) {
        bSawBusy = true;
      } else if (bSawBusy) {
        void db.listSessionMessages(sessionId).then(
          (messages) => finish({ messages }),
          () => finish({ messages: [] })
        );
      }
    };
    const poll = setInterval(() => {
      void isStopped().then((bStopped) => bStopped && !isSessionBusy(sessionId) && finish(null));
    }, STOP_POLL_MS);
    subscribeBusy(onBusy);
  });
}

export interface OrchestratorRunOptions {
  mode: OrchestratorRunMode;
  /** Sequential only: first step to run (earlier results are kept). */
  startIndex?: number;
  /** Run just this one step (in the workspace), keeping every other result. */
  onlyIndex?: number;
}

interface StepContext {
  workspaceId: string;
  orchestratorId: string;
  planName: string;
  payload: OrchestratorSubtasksPayload;
  workerAgentType: AgentType;
  workerModel: string | undefined;
  verifyAgentType: AgentType;
  verifyModel: string | undefined;
  approvalPolicy: string | undefined;
  plannerSessionId: string | null;
  gitEnv: Record<string, string>;
  persist: () => Promise<void>;
  isStopped: () => Promise<boolean>;
}

/** Validate a run request before the background run starts; returns an error message or null. */
export async function checkRunPreconditions(
  workspacePath: string,
  options: OrchestratorRunOptions
): Promise<string | null> {
  if (options.mode !== 'parallel' || options.onlyIndex !== undefined) return null;
  const repo = await resolveRepo(workspacePath);
  return 'error' in repo ? repo.error : null;
}

function finishedCount(subtasks: SubTask[]): number {
  return subtasks.filter((task) => task.runResult && task.runResult !== 'running').length;
}

async function readLiveSpec(workspaceId: string, plannerSessionId: string | null): Promise<string | null> {
  if (!plannerSessionId) return null;
  const spec = await readSessionSpec(workspaceId, plannerSessionId).catch(() => null);
  return spec && specHasContent(spec.content) ? spec.content : null;
}

/** Create the step's session and run its prompt to completion. */
async function runStep(ctx: StepContext, index: number, worktreeCwd: string | null): Promise<void> {
  const task = ctx.payload.subtasks[index];
  task.runResult = 'running';
  task.runNote = null;
  task.waitingQuestion = null;
  const bVerify = task.kind === 'verify';
  const agentType = bVerify ? ctx.verifyAgentType : ctx.workerAgentType;
  const model = bVerify ? ctx.verifyModel : ctx.workerModel;
  const created = await createSessionWithAgent({
    workspaceId: ctx.workspaceId,
    agentType,
    ...(model ? { modelSelection: model } : {}),
    ...(ctx.approvalPolicy ? { approvalPolicy: ctx.approvalPolicy as ApprovalPolicy } : {}),
    name: task.name,
    tags: task.category && String(task.category).trim() ? normalizeTagStringList([task.category]) : null
  });
  if (created.error || !created.session) {
    task.runResult = 'failed';
    task.runNote = created.error ?? 'Could not create the step session';
    await ctx.persist();
    return;
  }
  const session = created.session;
  task.sessionId = session.id;
  if (worktreeCwd) await db.setSessionWorktreePath(session.id, worktreeCwd);
  await ctx.persist();

  const spec = await readLiveSpec(ctx.workspaceId, ctx.plannerSessionId);
  const stepPrompt = buildStepPrompt(task, ctx.payload, spec);
  runningStepSessions.add(session.id);
  let result: { error?: string; messages?: ChatMessage[] };
  try {
    result = await dispatchPromptAndWait({
      sessionId: session.id,
      text: isNovaMcpEnabled() ? `${stepPrompt}\n\n---\n\n${STEP_NEEDS_INPUT_PROMPT}` : stepPrompt,
      model: session.modelSelection,
      mode: session.sessionMode,
      timeoutMs: STEP_TIMEOUT_MS
    });
    // The agent asked the user: hold the step (and its dependents) until a reply turn ends without a new question.
    for (let question = stepQuestions.get(session.id); !result.error && question !== undefined; question = stepQuestions.get(session.id)) {
      stepQuestions.delete(session.id);
      task.waitingQuestion = question;
      await ctx.persist();
      void sendPushToAll({
        title: `Input needed: ${ctx.planName}`,
        body: `Step ${index + 1} "${task.name}": ${question}`,
        tag: `orchestrator-step-${session.id}`,
        url: `/workspace/${ctx.workspaceId}/session/${session.id}`
      }).catch(() => {});
      const reply = await waitForReplyTurn(session.id, ctx.isStopped);
      task.waitingQuestion = null;
      if (!reply) {
        result = { error: 'Stopped while waiting for your answer' };
        break;
      }
      result = reply;
    }
  } finally {
    runningStepSessions.delete(session.id);
    stepQuestions.delete(session.id);
  }
  if (result.error) {
    task.runResult = 'failed';
    task.runNote = result.error;
  } else {
    task.runResult = 'done';
    ctx.payload.handoffLog = appendHandoff(ctx.payload.handoffLog, index + 1, task.name, summarizeStepHandoff(result.messages));
  }
  await ctx.persist();
}

/** Mark not-yet-run steps whose dependency failed or was skipped. */
function skipBlockedSteps(subtasks: SubTask[]): boolean {
  let bChanged = false;
  let bAgain = true;
  while (bAgain) {
    bAgain = false;
    subtasks.forEach((task, index) => {
      if (!task.runResult && shouldSkipOrchestratorStep(index, subtasks)) {
        task.runResult = 'skipped';
        bChanged = true;
        bAgain = true;
      }
    });
  }
  return bChanged;
}

async function runSequential(ctx: StepContext, startIndex: number): Promise<void> {
  const subtasks = ctx.payload.subtasks;
  for (let index = startIndex; index < subtasks.length; index++) {
    if (await ctx.isStopped()) return;
    if (shouldSkipOrchestratorStep(index, subtasks)) {
      subtasks[index].runResult = 'skipped';
      await ctx.persist();
      continue;
    }
    await runStep(ctx, index, null);
  }
}

function stepBranch(orchestratorId: string, label: string): string {
  return `nova/${orchestratorId.slice(0, 8)}/${label}`;
}

const RESOLVE_CONFLICTS_PROMPT = (stepName: string, files: string[]) => `You are resolving git merge conflicts in this repository (an integration worktree of a Nova orchestrator run).
The orchestrator step "${stepName}" was merged and these files conflict:
${files.map((file) => `- ${file}`).join('\n')}

Resolve every conflict so the result keeps the intent of BOTH sides (use the spec and handoff notes above), remove all conflict markers, then stage the files and finish the merge with \`git commit --no-edit\`. Do not change anything unrelated to the conflicts.`;

/**
 * Parallel run: each step in its own worktree from the integration branch's
 * current head (so dependents see their dependencies' work), merged back as it
 * finishes; afterwards the combined diff is applied to the workspace and the
 * verify step runs there.
 */
async function runParallel(ctx: StepContext, repo: RepoInfo, maxParallel: number): Promise<void> {
  const subtasks = ctx.payload.subtasks;
  const runRoot = join(worktreesRootDir(), ctx.orchestratorId);
  const integrationDir = join(runRoot, 'integration');
  const integrationBranch = stepBranch(ctx.orchestratorId, 'integration');
  const verifyIndexes = new Set(subtasks.flatMap((task, index) => (task.kind === 'verify' ? [index] : [])));

  const base = await createSnapshotCommit(repo.root, ctx.gitEnv);
  await addWorktree(repo.root, integrationDir, integrationBranch, base);

  let mergeChain: Promise<void> = Promise.resolve();
  const withMergeLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = mergeChain.then(fn);
    mergeChain = next.then(() => undefined, () => undefined);
    return next;
  };

  const resolveConflicts = async (stepName: string, files: string[]): Promise<boolean> => {
    const created = await createSessionWithAgent({
      workspaceId: ctx.workspaceId,
      agentType: ctx.workerAgentType,
      ...(ctx.workerModel ? { modelSelection: ctx.workerModel } : {}),
      ...(ctx.approvalPolicy ? { approvalPolicy: ctx.approvalPolicy as ApprovalPolicy } : {}),
      name: `Resolve merge: ${stepName}`,
      tags: normalizeTagStringList(['merge'])
    });
    if (created.error || !created.session) return false;
    await db.setSessionWorktreePath(created.session.id, join(integrationDir, repo.subdir));
    const spec = await readLiveSpec(ctx.workspaceId, ctx.plannerSessionId);
    const prompt = buildStepPrompt({ name: stepName, prompt: RESOLVE_CONFLICTS_PROMPT(stepName, files) }, ctx.payload, spec);
    await dispatchPromptAndWait({
      sessionId: created.session.id,
      text: prompt,
      model: created.session.modelSelection,
      mode: created.session.sessionMode,
      timeoutMs: STEP_TIMEOUT_MS
    });
    await db.setSessionWorktreePath(created.session.id, null);
    return concludeMerge(integrationDir, ctx.gitEnv);
  };

  const runWorktreeStep = async (index: number): Promise<void> => {
    const task = subtasks[index];
    const branch = stepBranch(ctx.orchestratorId, `step-${index + 1}`);
    const dir = join(runRoot, `step-${index + 1}`);
    const stepBase = await withMergeLock(() => headCommit(integrationDir));
    await addWorktree(repo.root, dir, branch, stepBase);
    const linked = await linkIgnoredEntries(repo.root, dir);
    await runStep(ctx, index, join(dir, repo.subdir));
    await commitAll(dir, `Orchestrator step ${index + 1}: ${task.name}`, ctx.gitEnv, linked);
    if (task.sessionId) await db.setSessionWorktreePath(task.sessionId, null);

    if (task.runResult !== 'done') {
      await removeWorktree(repo.root, dir);
      task.runNote = `${task.runNote ?? 'Step failed'} — its changes are kept on branch ${branch}.`;
      await ctx.persist();
      return;
    }
    await withMergeLock(async () => {
      const merged = await mergeBranch(integrationDir, branch, `Merge orchestrator step ${index + 1}: ${task.name}`, ctx.gitEnv);
      if (!merged.ok) {
        const bResolved = merged.conflicts.length > 0 && (await resolveConflicts(task.name, merged.conflicts));
        if (!bResolved) {
          if ((await unmergedFiles(integrationDir)).length > 0 || merged.conflicts.length === 0) {
            await abortMerge(integrationDir);
          }
          await removeWorktree(repo.root, dir);
          task.runResult = 'failed';
          task.runNote = `Merging failed (${merged.conflicts.join(', ') || merged.error}); changes are kept on branch ${branch}.`;
          await ctx.persist();
          return;
        }
      }
      await removeWorktree(repo.root, dir);
      await deleteBranch(repo.root, branch);
    });
  };

  const running = new Map<number, Promise<void>>();
  for (;;) {
    if (skipBlockedSteps(subtasks)) await ctx.persist();
    if (!(await ctx.isStopped())) {
      const ready = findRunnableSteps(subtasks).filter((index) => !running.has(index) && !verifyIndexes.has(index));
      for (const index of ready.slice(0, Math.max(0, maxParallel - running.size))) {
        const promise = runWorktreeStep(index)
          .catch(async (err) => {
            logger.warn({ err, orchestratorId: ctx.orchestratorId, index }, 'Orchestrator step failed');
            subtasks[index].runResult = 'failed';
            subtasks[index].runNote = err instanceof Error ? err.message : String(err);
            await ctx.persist();
          })
          .finally(() => running.delete(index));
        running.set(index, promise);
      }
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }

  // Apply whatever was merged, even after a stop, so finished work isn't stranded.
  const head = await headCommit(integrationDir);
  const applied = await applyCommitRangeToWorkingTree(repo.root, base, head);
  await removeWorktree(repo.root, integrationDir);
  if (!applied.ok) {
    const note = `Could not apply the merged result to the workspace (${applied.error}). It is kept on branch ${integrationBranch} — merge it manually.`;
    for (const index of verifyIndexes) {
      if (!subtasks[index].runResult) {
        subtasks[index].runResult = 'skipped';
        subtasks[index].runNote = note;
      }
    }
    await ctx.persist();
    return;
  }
  await deleteBranch(repo.root, integrationBranch);

  for (const index of verifyIndexes) {
    if (await ctx.isStopped()) return;
    if (subtasks[index].runResult) continue;
    if (shouldSkipOrchestratorStep(index, subtasks)) {
      subtasks[index].runResult = 'skipped';
      await ctx.persist();
      continue;
    }
    await runStep(ctx, index, null);
  }
}

/** Run an orchestrator in the background; run state is persisted and broadcast as it goes. */
export async function runOrchestrator(
  workspaceId: string,
  orchestratorId: string,
  payload: OrchestratorSubtasksPayload,
  options: OrchestratorRunOptions
): Promise<void> {
  // Set before the first await so the run route sees it right away.
  activeRuns.set(orchestratorId, payload);
  try {
    await runOrchestratorSteps(workspaceId, orchestratorId, payload, options);
  } finally {
    activeRuns.delete(orchestratorId);
  }
}

async function runOrchestratorSteps(
  workspaceId: string,
  orchestratorId: string,
  payload: OrchestratorSubtasksPayload,
  options: OrchestratorRunOptions
): Promise<void> {
  const subtasks = payload.subtasks;
  const total = subtasks.length;
  const orchestrator = await db.getOrchestrator(orchestratorId);
  const workspace = await db.getWorkspace(workspaceId);
  if (!orchestrator || !workspace) return;

  const planner = orchestrator.sourceSessionId ? await db.getSession(orchestrator.sourceSessionId) : undefined;
  // The planning chat's model only fits when the session uses the same agent.
  const plannerModelFor = (agentType: AgentType): string | undefined =>
    (planner && planner.agentType === agentType ? planner.modelSelection : undefined) || undefined;
  const workerAgentType = orchestrator.agentType as AgentType;
  const workerModel = orchestrator.workerModel?.trim() || plannerModelFor(workerAgentType);
  // Verification defaults to the planning chat's agent and model.
  const verifyAgentType = (orchestrator.verifyAgentType || planner?.agentType || workerAgentType) as AgentType;
  const verifyModel = orchestrator.verifyModel?.trim() || plannerModelFor(verifyAgentType);

  let persistChain: Promise<unknown> = Promise.resolve();
  const ctx: StepContext = {
    workspaceId,
    orchestratorId,
    planName: orchestrator.name || 'task plan',
    payload,
    workerAgentType,
    workerModel,
    verifyAgentType,
    verifyModel,
    approvalPolicy: planner?.approvalPolicy,
    plannerSessionId: planner?.id ?? null,
    gitEnv: config.agentEnv({
      name: workspace.gitUserName ?? undefined,
      email: workspace.gitUserEmail ?? undefined
    }),
    persist: () => {
      persistChain = persistChain.then(() =>
        updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
          runCurrentStep: finishedCount(subtasks),
          runTotalSteps: total,
          subtasksJson: serializeSubtasksPayload(payload)
        })
      );
      return persistChain.then(() => undefined);
    },
    isStopped: async () => (await db.getOrchestrator(orchestratorId))?.runStatus !== 'running'
  };

  try {
    if (options.onlyIndex !== undefined) {
      await runStep(ctx, options.onlyIndex, null);
    } else if (options.mode === 'parallel') {
      const repo = await resolveRepo(resolveWorkspaceAbsolutePath(workspace.path));
      if ('error' in repo) throw new Error(repo.error);
      await runParallel(ctx, repo, Math.max(1, orchestrator.maxParallel ?? 3));
    } else {
      await runSequential(ctx, options.startIndex ?? 0);
    }
    await persistChain;

    if (await ctx.isStopped()) {
      await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
        runCurrentStep: finishedCount(subtasks),
        subtasksJson: serializeSubtasksPayload(payload)
      });
      return;
    }
    const anyFailed = subtasks.some((task) => task.runResult === 'failed');
    const bAllFinished = subtasks.every((task) => task.runResult && task.runResult !== 'running');
    const runStatus = anyFailed ? 'failed' : bAllFinished ? 'completed' : null;
    await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
      runStatus,
      // Full runs only: "Done" until the plan is opened (single-step reruns are watched).
      ...(options.onlyIndex === undefined && runStatus !== null && { unread: true }),
      runCurrentStep: finishedCount(subtasks),
      runTotalSteps: total,
      subtasksJson: serializeSubtasksPayload(payload)
    });
    if (options.onlyIndex !== undefined) return;
    void sendPushToAll({
      title: anyFailed ? `Plan failed: ${orchestrator.name || 'task plan'}` : `Plan completed: ${orchestrator.name || 'task plan'}`,
      body: anyFailed
        ? `${subtasks.filter((task) => task.runResult === 'failed').length} step(s) failed`
        : `${total} step${total === 1 ? '' : 's'} completed`,
      tag: `orchestrator-${orchestratorId}`,
      url: `/workspace/${workspaceId}/orchestrator/${orchestratorId}`
    }).catch(() => {});
  } catch (error) {
    logger.error({ err: error, orchestratorId }, 'Orchestrator run failed');
    for (const task of subtasks) {
      if (task.runResult === 'running') task.runResult = 'failed';
      task.waitingQuestion = null;
    }
    const message = error instanceof Error ? error.message : String(error);
    const firstOpen = subtasks.find((task) => !task.runResult || task.runResult === 'failed');
    if (firstOpen && !firstOpen.runNote) firstOpen.runNote = `Run stopped: ${message}`;
    await persistChain.catch(() => {});
    await updateOrchestratorAndBroadcast(workspaceId, orchestratorId, {
      runStatus: 'failed',
      unread: true,
      runCurrentStep: finishedCount(subtasks),
      runTotalSteps: total,
      subtasksJson: serializeSubtasksPayload(payload)
    });
    void sendPushToAll({
      title: `Plan failed: ${orchestrator.name || 'task plan'}`,
      body: 'The run stopped because of an unexpected error',
      tag: `orchestrator-${orchestratorId}`,
      url: `/workspace/${workspaceId}/orchestrator/${orchestratorId}`
    }).catch(() => {});
  }
}

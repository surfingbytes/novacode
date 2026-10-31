// node_modules
import { existsSync } from 'node:fs';

// classes
import { db } from '../database';
import { isPathUnderBrowseRoot, resolveWorkspaceAbsolutePath } from '../workspacePaths';
import { isUnderWorktreesRoot } from '../gitWorktrees';
import { getAgentAdapter } from '../agents';
import { sendTaskDonePush } from '../push';
import { normalizeSessionMode } from '../sessionMode';
import { normalizeApprovalPolicy } from '../approvalPolicy';
import { stripInlineImagesFromEventLine } from '../chatEventImages';
import type { SessionConfigSyncHandler } from '../acpSubprocessRunner';
import { computeLastListPreview } from '../chatPreview';
import { extractStreamNotificationPreview } from '../chatStreamPreviewFromEvents';
import { broadcastSessionListUpsert } from '../sessionListBroadcast';
import { classifyAgentError, type AgentErrorCode } from '../agentError';
import {
  buildLinkedPlanContextPrefix,
  extractLinkedPlanContextFromConfig,
  mergeInternalSessionConfig,
} from '../linkedPlanContext';
import { buildHandoffContextPrefix, extractHandoffLinksFromConfig } from '../sessionHandoffConfig';
import { claimClaudePlanForSession, claudePlanFileIdsFromEventLines, tagClaudePlanFileForSession } from '../planDocumentSources';
import { logger, truncateLogText } from '../logger';
import { parseUsageUpdateLine } from '../sessionUsage';
import { parseClaudePlanUsageLine, recordClaudePlanUsage } from '../claudePlanUsage';
import { buildSpecPromptNote, readSessionSpec, workspaceSpecDir } from '../sessionSpec';
import { activeRuns, emitBusy, runCompletions } from './state';
import { cancelPendingApprovals, requestAcpPermissionForSession } from './approvals';
import { cancelPendingQuestions, requestAcpAskQuestionForSession } from './questions';
import { buildWorkspaceRulesPrefix, resolvePromptAttachments } from './promptInput';
import { parseBackgroundTasksLine, parseClaudeRateLimitError } from './streamEvents';

// types
import type { ActiveRun, ChatSubscriber, DispatchPromptOpts } from './types';
import type { ChatMessage, AgentType } from '../../@types/index';

const CANCEL_ALL_RUNS_WAIT_MS = 10_000;

export function cancelRun(sessionId: string): void {
  const run = activeRuns.get(sessionId);
  if (!run) return;
  try {
    logger.info({ sessionId }, 'cancelling active run');
    cancelPendingApprovals(run);
    cancelPendingQuestions(run);
    run.cancel();
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to cancel run');
  }
}

export async function dispatchPrompt(
  opts: DispatchPromptOpts
): Promise<{ error?: string; errorCode?: AgentErrorCode; requeue?: boolean }> {
  const { sessionId, text, model, mode, imagePaths = [], subscriber } = opts;

  if (activeRuns.has(sessionId)) {
    return { error: 'Agent is busy', requeue: true };
  }

  const session = await db.getSession(sessionId);
  if (!session) {
    return { error: 'Session not found', requeue: true };
  }

  const agentType: AgentType = (session.agentType as AgentType | null) ?? 'claude';
  const sessionMode = normalizeSessionMode(mode ?? session.sessionMode);
  const { linkedPlanContext, agentConfig: sessionConfig } =
    extractLinkedPlanContextFromConfig(session.sessionConfigJson);

  if (agentType !== 'claude' && agentType !== 'mistral-vibe' && agentType !== 'cursor-agent' && agentType !== 'open-code' && agentType !== 'codex') {
    return {
      error: `Agent type '${agentType}' is not yet supported via ACP. Coming soon.`,
      requeue: true
    };
  }

  const workspace = await db.getWorkspace(session.workspaceId);
  if (!workspace) {
    return { error: 'Workspace not found', requeue: true };
  }

  // Never fall back to an empty history: saving from position 0 would delete
  // every stored message of the session.
  let currentMessages: ChatMessage[];
  let userPosition: number;
  try {
    currentMessages = await db.listSessionMessages(sessionId);
    userPosition = await db.countSessionMessages(sessionId);
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to load chat history');
    return { error: 'Failed to load chat history', requeue: true };
  }
  // Saves slice `currentMessages` from `userPosition`, so both must agree.
  if (userPosition !== currentMessages.length) {
    logger.error({ sessionId, userPosition, loaded: currentMessages.length }, 'Chat history changed while loading');
    return { error: 'Failed to load chat history', requeue: true };
  }

  const userMessage: ChatMessage = {
    role: 'user',
    content: text,
    imagePaths: imagePaths.length > 0 ? imagePaths : undefined,
    createdAt: new Date().toISOString(),
  };
  // Earlier rows are already in the DB — saves only rewrite this turn's rows.
  currentMessages.push(userMessage);

  const previewAfterUser = computeLastListPreview(currentMessages);
  try {
    const fresh = await db.persistSessionMessages(sessionId, currentMessages, {
      ...(previewAfterUser
        ? {
            lastPreviewText: previewAfterUser.lastPreviewText,
            lastPreviewRole: previewAfterUser.lastPreviewRole,
          }
        : {}),
    }, { fromPosition: userPosition });
    if (fresh) broadcastSessionListUpsert(fresh.workspaceId, fresh);
  } catch (err) {
    currentMessages.pop();
    logger.error({ err, sessionId }, 'Failed to persist user message / preview');
    return { error: 'Failed to save message', requeue: true };
  }

  const { attachments, textPaths } = await resolvePromptAttachments(imagePaths);
  const effectiveText = textPaths.length > 0 ? `${text}\n\n${textPaths.join('\n')}` : text;
  // Parallel orchestrator steps run in their own git worktree (under /config/worktrees).
  const worktreePath = session.worktreePath && isUnderWorktreesRoot(session.worktreePath) && existsSync(session.worktreePath)
    ? session.worktreePath
    : null;
  const workspacePath = worktreePath ?? resolveWorkspaceAbsolutePath(workspace.path);
  if (!worktreePath && !isPathUnderBrowseRoot(workspacePath)) {
    // User message is already persisted — do not put the queue item back.
    return { error: 'Invalid workspace path', requeue: false };
  }

  const assistantEvents: string[] = [];

  // Rules, the handoff note and linked-plan context are NOT prepended here: the
  // ACP runner injects them only when a fresh ACP session is created (first
  // turn, a turn after one that never saved its ACP session, or fallback after
  // a failed resume). On resumed sessions they are already in the conversation
  // history — re-sending them every turn would duplicate tokens. Lazy callback
  // so resumed turns never touch the disk for them.
  const getFreshSessionPrefix = async (): Promise<string> => {
    let linkedPlanWorkspacePath: string | null = workspacePath;
    if (linkedPlanContext) {
      const sourceSession = await db.getSession(linkedPlanContext.sourceSessionId);
      if (sourceSession) {
        const sourceWorkspace = await db.getWorkspace(sourceSession.workspaceId);
        if (sourceWorkspace) {
          linkedPlanWorkspacePath = resolveWorkspaceAbsolutePath(sourceWorkspace.path);
        }
      }
    }
    return [
      await buildWorkspaceRulesPrefix(workspacePath, agentType),
      buildHandoffContextPrefix(extractHandoffLinksFromConfig(session.sessionConfigJson).continuedFrom),
      await buildLinkedPlanContextPrefix(linkedPlanContext, {
        workspacePath: linkedPlanWorkspacePath,
      }),
    ].filter((part) => part.trim()).join('\n\n');
  };
  // Sessions with a spec file get its path every turn (it may be created mid-chat)
  // and the spec folder as an extra allowed directory, so edits need no approval.
  const spec = await readSessionSpec(session.workspaceId, sessionId).catch(() => null);
  const additionalDirectories = spec ? [workspaceSpecDir(session.workspaceId)] : undefined;
  const agentPrompt = spec ? `${buildSpecPromptNote(spec.path)}\n\n${effectiveText}` : effectiveText;

  // Get Claude OAuth token (only needed for claude agent type)
  const user = await db.getFirstUser();
  const claudeToken = user?.claudeToken ?? null;

  let cancelled = false;
  let currentAcpSessionId = session.sessionId ?? null;
  const adapter = getAgentAdapter(agentType);

  const run: ActiveRun = {
    cancel: () => {
      cancelled = true;
      void adapter.cancel(sessionId);
    },
    workspaceId: session.workspaceId,
    agentType,
    acpSessionId: currentAcpSessionId,
    messages: currentMessages,
    assistantEvents,
    bufferedLines: [],
    subscribers: new Set([subscriber]),
    pendingApprovals: new Map(),
    pendingQuestions: new Map(),
    approvalPolicy: normalizeApprovalPolicy(session.approvalPolicy),
    lastUsage: null,
    backgroundTasks: null,
  };
  activeRuns.set(sessionId, run);
  emitBusy(sessionId, session.workspaceId, true, null);

  const broadcast = (fn: (sub: ChatSubscriber) => void): void => {
    for (const sub of run.subscribers) fn(sub);
  };

  const onEvent = (rawLine: string) => {
    const line = stripInlineImagesFromEventLine(rawLine);
    const usage = parseUsageUpdateLine(line);
    if (usage) {
      run.lastUsage = usage;
    }
    const backgroundTasks = parseBackgroundTasksLine(line);
    if (backgroundTasks) {
      run.backgroundTasks = backgroundTasks.total > 0 ? backgroundTasks : null;
      emitBusy(sessionId, session.workspaceId, true, run.backgroundTasks);
    }
    if (agentType === 'claude') {
      const planUsage = parseClaudePlanUsageLine(line);
      if (planUsage) recordClaudePlanUsage(planUsage);
    }
    if (agentType === 'claude' && run.acpSessionId) {
      for (const planFileId of claudePlanFileIdsFromEventLines([line])) {
        void tagClaudePlanFileForSession(run.acpSessionId, planFileId);
      }
      try {
        const parsed = JSON.parse(line) as {
          update?: { sessionUpdate?: string; markdown?: unknown };
        };
        const md =
          parsed.update?.sessionUpdate === 'plan' && typeof parsed.update.markdown === 'string'
            ? parsed.update.markdown.trim()
            : '';
        if (md) void claimClaudePlanForSession(run.acpSessionId, md);
      } catch {
        // non-JSON stream lines
      }
    }
    assistantEvents.push(line);
    run.bufferedLines.push(line);
    broadcast((sub) => sub.onStream(line));
  };

  const onConfigSync: SessionConfigSyncHandler = (sync) => {
    emitSessionConfigSync(onEvent, sync);
    void (async () => {
      const patch: {
        sessionMode?: string;
        modelSelection?: string;
        sessionConfigJson?: string | null;
      } = {};
      if (sync.modeId && sync.modeId !== sessionMode) {
        patch.sessionMode = sync.modeId;
      }
      // Do NOT persist the agent-reported model: the user's selection is authoritative and Cursor
      // only echoes its startup default (it can't switch models at runtime), so persisting it would
      // silently overwrite the user's choice (e.g. turn "auto" into "composer-2.5-fast").
      if (sync.config && Object.keys(sync.config).length > 0) {
        // Keep internal __nova* keys (linked plan, handoff links) the agent never reports.
        const mergedJson = mergeInternalSessionConfig(session.sessionConfigJson, { ...sessionConfig, ...sync.config });
        if (mergedJson !== session.sessionConfigJson) {
          patch.sessionConfigJson = mergedJson;
        }
      }
      if (Object.keys(patch).length === 0) return;
      try {
        await db.updateSession(sessionId, patch);
        const fresh = await db.getSession(sessionId);
        if (fresh) broadcastSessionListUpsert(fresh.workspaceId, fresh);
      } catch (err) {
        logger.warn({ err, sessionId }, 'Failed to persist ACP config sync');
      }
    })();
  };

  function emitSessionConfigSync(
    emit: (line: string) => void,
    sync: { modeId?: string; modelId?: string; config?: Record<string, string> }
  ): void {
    if (!sync.modeId && !sync.modelId && !sync.config) return;
    emit(JSON.stringify({ type: 'session_config_sync', ...sync }));
  }

  const runTurn = async (): Promise<void> => {
    logger.info({ agentType, sessionId, acpSessionId: currentAcpSessionId }, 'dispatching to agent via ACP');

    const result = await adapter.run({
      novaSessionId: sessionId,
      acpSessionId: currentAcpSessionId,
      cwd: workspacePath,
      promptText: agentPrompt,
      attachments,
      claudeToken,
      model,
      mode: sessionMode,
      configJson: sessionConfig,
      getFreshSessionPrefix,
      additionalDirectories,
      onSessionId: (id) => {
        if (id !== currentAcpSessionId) {
          // Saved now, not only with the turn's messages: an interrupted first
          // turn would otherwise leave no session to resume.
          db.setSessionAcpId(sessionId, id).catch((err) => {
            logger.warn({ err, sessionId }, 'Failed to save ACP session ID early');
          });
        }
        currentAcpSessionId = id;
        run.acpSessionId = id;
        // Stop pressed during session startup (before the ACP session id was
        // known) — honour it as soon as the id arrives instead of dropping it.
        if (cancelled) void adapter.cancel(sessionId);
      },
      onEvent,
      onConfigSync,
      onRequestPermission: (permission) => requestAcpPermissionForSession(sessionId, permission),
      onAskQuestion: (question) => requestAcpAskQuestionForSession(sessionId, question),
    });

    if (result.error && !cancelled) {
      logger.error({ sessionId, agentType, error: truncateLogText(result.error) }, 'ACP error');
      const parsedClaudeLimit = agentType === 'claude' ? parseClaudeRateLimitError(result.error) : null;
      const classifiedError = classifyAgentError(result.error, {
        agentLabel: agentType === 'cursor-agent' ? 'Cursor' : 'Agent',
        fallbackMessage: 'Agent run failed',
        detail: result.errorDetail,
      });
      const resetAtIso = parsedClaudeLimit?.resetAtIso ?? null;
      const resetAtReadable = parsedClaudeLimit?.resetAtReadable;
      if (parsedClaudeLimit) {
        try {
          await db.updateSession(sessionId, { claudeLimitResetAt: resetAtIso });
          const fresh = await db.getSession(sessionId);
          if (fresh) broadcastSessionListUpsert(fresh.workspaceId, fresh);
        } catch (err) {
          logger.error({ err, sessionId }, 'Failed to persist Claude limit reset time');
        }
      }
      const stderrEvent = JSON.stringify({ type: 'stderr', text: result.error });
      assistantEvents.push(stderrEvent);
      run.bufferedLines.push(stderrEvent);
      broadcast((sub) => sub.onStream(stderrEvent));
      if (parsedClaudeLimit) {
        const limitEvent = JSON.stringify({
          type: 'claude_limit_detected',
          resetTime: resetAtIso ?? undefined,
          resetTimeReadable: resetAtReadable ?? undefined,
        });
        assistantEvents.push(limitEvent);
        run.bufferedLines.push(limitEvent);
        broadcast((sub) => sub.onStream(limitEvent));
      }
      broadcast((sub) => sub.onError(classifiedError.message, classifiedError.code));
    }

    logger.info({ agentType, sessionId, stopReason: result.stopReason, eventCount: assistantEvents.length }, 'agent ACP finished');

    // Persist ACP session ID together with chat rows so a separate session
    // update cannot race the message write.
    const newAcpSessionId =
      result.acpSessionId && result.acpSessionId !== session.sessionId
        ? result.acpSessionId
        : null;
    if (newAcpSessionId) {
      currentAcpSessionId = newAcpSessionId;
      run.acpSessionId = newAcpSessionId;
    }

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      events: assistantEvents,
      createdAt: new Date().toISOString(),
    };
    currentMessages.push(assistantMessage);

    const previewDone = computeLastListPreview(currentMessages);
    try {
      const fresh = await db.persistSessionMessages(sessionId, currentMessages, {
        ...(newAcpSessionId ? { sessionId: newAcpSessionId } : {}),
        ...(previewDone
          ? { lastPreviewText: previewDone.lastPreviewText, lastPreviewRole: previewDone.lastPreviewRole }
          : { lastPreviewText: null, lastPreviewRole: null }),
      }, { fromPosition: userPosition });
      if (newAcpSessionId) {
        logger.debug({ sessionId, acpSessionId: newAcpSessionId }, 'ACP session ID saved');
      }
      if (fresh) broadcastSessionListUpsert(fresh.workspaceId, fresh);
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to save messages');
    }

    if (run.lastUsage) {
      try {
        await db.recordSessionUsage(sessionId, session.workspaceId, run.lastUsage);
        const withUsage = await db.getSession(sessionId);
        if (withUsage) broadcastSessionListUpsert(withUsage.workspaceId, withUsage);
      } catch (err) {
        logger.error({ err, sessionId }, 'Failed to persist session usage');
      }
    }

    try {
      const lastAssistantMessage = extractStreamNotificationPreview(assistantEvents);
      await sendTaskDonePush(session.name, workspace.name, lastAssistantMessage, {
        url: `/workspace/${session.workspaceId}/session/${session.id}`,
        tag: `session-${session.id}`
      });
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to send task completion push');
    }
  };

  /** Save the crash as a stderr event on this turn's assistant message so the chat shows it. */
  const recordRunFailure = async (err: unknown): Promise<{ message: string; code?: AgentErrorCode }> => {
    const rawMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, sessionId, agentType }, 'Agent run crashed');
    const classifiedError = classifyAgentError(rawMessage, { agentLabel: 'Agent', fallbackMessage: 'Agent run failed' });
    const stderrEvent = JSON.stringify({ type: 'stderr', text: rawMessage || classifiedError.message });
    assistantEvents.push(stderrEvent);
    run.bufferedLines.push(stderrEvent);
    broadcastSafely((sub) => sub.onStream(stderrEvent));
    if (currentMessages.length === userPosition + 1) {
      currentMessages.push({ role: 'assistant', events: assistantEvents, createdAt: new Date().toISOString() });
    }
    try {
      const preview = computeLastListPreview(currentMessages);
      const fresh = await db.persistSessionMessages(sessionId, currentMessages, {
        ...(preview
          ? { lastPreviewText: preview.lastPreviewText, lastPreviewRole: preview.lastPreviewRole }
          : { lastPreviewText: null, lastPreviewRole: null }),
      }, { fromPosition: userPosition });
      if (fresh) broadcastSessionListUpsert(fresh.workspaceId, fresh);
    } catch (persistErr) {
      logger.error({ err: persistErr, sessionId }, 'Failed to save agent run error');
    }
    return { message: classifiedError.message, code: classifiedError.code };
  };

  const broadcastSafely = (fn: (sub: ChatSubscriber) => void): void => {
    for (const sub of run.subscribers) {
      try {
        fn(sub);
      } catch (err) {
        logger.warn({ err, sessionId }, 'Chat subscriber threw');
      }
    }
  };

  // Run agent via ACP in background (non-blocking). Cleanup and exactly one terminal
  // broadcast happen even when the adapter throws.
  const completion = (async (): Promise<void> => {
    let failure: { message: string; code?: AgentErrorCode } | null = null;
    try {
      await runTurn();
    } catch (err) {
      failure = await recordRunFailure(err).catch(() => ({ message: 'Agent run failed' }));
    } finally {
      cancelPendingApprovalsSafely(run, sessionId);
      if (activeRuns.get(sessionId) === run) {
        activeRuns.delete(sessionId);
        runCompletions.delete(sessionId);
      }
      emitBusy(sessionId, session.workspaceId, false, null);
      if (failure) {
        const { message, code } = failure;
        broadcastSafely((sub) => sub.onError(message, code));
      } else {
        broadcastSafely((sub) => sub.onDone(currentMessages));
      }
    }
  })();
  runCompletions.set(sessionId, completion);

  return {};
}

function cancelPendingApprovalsSafely(run: ActiveRun, sessionId: string): void {
  try {
    cancelPendingApprovals(run);
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to cancel pending approvals');
  }
  try {
    cancelPendingQuestions(run);
  } catch (err) {
    logger.warn({ err, sessionId }, 'Failed to cancel pending questions');
  }
}

/** Cancel every active run and wait (bounded) for them to finish their cleanup. */
export async function cancelAllRuns(reason: string): Promise<void> {
  const sessionIds = [...activeRuns.keys()];
  if (sessionIds.length === 0) return;
  logger.info({ reason, count: sessionIds.length }, 'cancelling all active runs');
  const completions = sessionIds.map((id) => runCompletions.get(id)).filter((p): p is Promise<void> => !!p);
  for (const id of sessionIds) cancelRun(id);
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.allSettled(completions),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        logger.warn({ reason }, 'cancelAllRuns timed out waiting for runs to finish');
        resolve();
      }, CANCEL_ALL_RUNS_WAIT_MS);
      timer.unref?.();
    }),
  ]);
  clearTimeout(timer);
}

// dispatch a prompt and block until the run completes — used by orchestrator to sequence subtasks
export function dispatchPromptAndWait(opts: {
  sessionId: string;
  text: string;
  model?: string;
  mode?: string;
  timeoutMs?: number;
}): Promise<{ error?: string; errorCode?: AgentErrorCode; messages?: ChatMessage[] }> {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? 600_000; // 10 min default
    let settled = false;
    const finish = (result: { error?: string; errorCode?: AgentErrorCode; messages?: ChatMessage[] }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      cancelRun(opts.sessionId);
      const classifiedError = classifyAgentError('Run timed out', { agentLabel: 'Agent' });
      finish({ error: classifiedError.message, errorCode: classifiedError.code });
    }, timeoutMs);

    const subscriber: ChatSubscriber = {
      onStream: () => {},
      onDone: (messages) => {
        finish({ messages });
      },
      onError: (message, code) => {
        finish({ error: message, errorCode: code });
      },
      onHistory: () => {},
    };

    dispatchPrompt({
      sessionId: opts.sessionId,
      text: opts.text,
      model: opts.model ?? 'auto',
      mode: opts.mode ?? 'default',
      subscriber,
    }).then((result) => {
      if (result.error) {
        const classifiedError = classifyAgentError(result.error, { agentLabel: 'Agent' });
        finish({ error: classifiedError.message, errorCode: classifiedError.code });
      }
    });
  });
}

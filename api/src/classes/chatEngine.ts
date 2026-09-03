// node_modules
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';

// classes
import { db } from './database';
import { config } from './config';
import { getGlobalRulesDir } from './globalRules';
import { buildAgentRulesPrefix } from './ruleFiles';
import { runClaudeAcp, cancelClaudeAcp } from './claudeAcp';
import { runVibeAcp, cancelVibeAcp } from './vibeAcp';
import { runCursorAcp, cancelCursorAcp } from './cursorAcp';
import { runOpenCodeAcp, cancelOpenCodeAcp } from './openCodeAcp';
import { runCodexAcp, cancelCodexAcp } from './codexAcp';
import { sendTaskDonePush } from './push';
import { normalizeSessionMode } from './sessionMode';
import { normalizeApprovalPolicy } from './approvalPolicy';
import type {
  AcpAskQuestionParams,
  AcpAskQuestionResponse,
  AcpPromptAttachment,
  SessionConfigSyncHandler,
} from './acpSubprocessRunner';
import { computeLastListPreview } from './chatPreview';
import { extractStreamNotificationPreview } from './chatStreamPreviewFromEvents';
import { broadcastSessionListUpsert } from './sessionListBroadcast';
import { classifyAgentError, type AgentErrorCode, type AgentErrorDetail } from './agentError';
import {
  buildLinkedPlanContextPrefix,
  extractLinkedPlanContextFromConfig,
} from './linkedPlanContext';
import { logger, truncateLogText } from './logger';
import { parseUsageUpdateLine } from './sessionUsage';

// types
import type { ChatMessage, AgentType, ApprovalPolicy } from '../@types/index';
import type {
  ChatApprovalOption,
  ChatApprovalOptionKind,
  ChatApprovalRequest,
  ChatQuestionAnswer,
  ChatQuestionRequest,
  SessionUsageSnapshot,
} from '../@types/index';

export interface ActiveRun {
  cancel: () => void;
  workspaceId: string;
  messages: ChatMessage[];
  assistantEvents: string[];
  bufferedLines: string[];
  subscribers: Set<ChatSubscriber>;
  pendingApprovals: Map<string, PendingApproval>;
  pendingQuestions: Map<string, PendingQuestion>;
  approvalPolicy: ApprovalPolicy;
  lastUsage: SessionUsageSnapshot | null;
}

export interface ChatSubscriber {
  onStream(line: string): void;
  onDone(messages: ChatMessage[]): void;
  onError(message: string, code?: AgentErrorCode): void;
  onHistory(messages: ChatMessage[], streaming: boolean): void;
  onApprovalRequested?(approval: ChatApprovalRequest): void;
  onApprovalResolved?(approvalRequestId: string): void;
  onQuestionRequested?(question: ChatQuestionRequest): void;
  onQuestionResolved?(questionRequestId: string): void;
}

interface PendingApproval {
  approval: ChatApprovalRequest;
  resolve: (response: RequestPermissionResponse) => void;
}

interface PendingQuestion {
  question: ChatQuestionRequest;
  resolve: (response: AcpAskQuestionResponse) => void;
}

// --------------------------------------------- State ---------------------------------------------

const activeRuns = new Map<string, ActiveRun>();
const busySubscribers = new Set<(sessionId: string, workspaceId: string, busy: boolean) => void>();

// --------------------------------------------- Functions ---------------------------------------------

export function getActiveSessionIds(): Set<string> {
  return new Set(activeRuns.keys());
}

export function getActiveRun(sessionId: string): ActiveRun | undefined {
  return activeRuns.get(sessionId);
}

export function isSessionBusy(sessionId: string): boolean {
  return activeRuns.has(sessionId);
}

export function subscribeBusy(
  handler: (sessionId: string, workspaceId: string, busy: boolean) => void
): void {
  busySubscribers.add(handler);
}

export function unsubscribeBusy(
  handler: (sessionId: string, workspaceId: string, busy: boolean) => void
): void {
  busySubscribers.delete(handler);
}

function emitBusy(sessionId: string, workspaceId: string, busy: boolean): void {
  for (const h of busySubscribers) {
    try {
      h(sessionId, workspaceId, busy);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function addSubscriber(sessionId: string, subscriber: ChatSubscriber): void {
  activeRuns.get(sessionId)?.subscribers.add(subscriber);
}

export function removeSubscriber(sessionId: string, subscriber: ChatSubscriber): void {
  activeRuns.get(sessionId)?.subscribers.delete(subscriber);
}

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

export interface DispatchPromptOpts {
  sessionId: string;
  text: string;
  model?: string;
  mode?: string;
  imagePaths?: string[];
  subscriber: ChatSubscriber;
}

function cancelledPermissionResponse(): RequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } };
}

function selectedPermissionResponse(optionId: string): RequestPermissionResponse {
  return { outcome: { outcome: 'selected', optionId } };
}

function isApprovalOptionKind(value: unknown): value is ChatApprovalOptionKind {
  return (
    value === 'allow_once' ||
    value === 'allow_always' ||
    value === 'reject_once' ||
    value === 'reject_always'
  );
}

function approvalOptionsFromRequest(params: RequestPermissionRequest): ChatApprovalOption[] {
  return params.options
    .filter((option) => isApprovalOptionKind(option.kind))
    .map((option) => ({
      optionId: option.optionId,
      name: option.name,
      kind: option.kind,
    }));
}

function stringifyCommand(command: string, args: unknown): string {
  if (!Array.isArray(args) || args.length === 0) return command;
  const renderedArgs = args
    .filter((arg): arg is string => typeof arg === 'string')
    .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg));
  return [command, ...renderedArgs].join(' ');
}

function commandFromRawInput(rawInput: unknown): { command?: string; cwd?: string } {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return {};
  }
  const obj = rawInput as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'shellCommand']) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) {
      return {
        command: stringifyCommand(value.trim(), obj.args),
        cwd: typeof obj.cwd === 'string' && obj.cwd.trim() ? obj.cwd.trim() : undefined,
      };
    }
  }
  return {
    cwd: typeof obj.cwd === 'string' && obj.cwd.trim() ? obj.cwd.trim() : undefined,
  };
}

function approvalRequestFromAcp(params: RequestPermissionRequest): ChatApprovalRequest | null {
  const options = approvalOptionsFromRequest(params);
  if (options.length === 0) return null;

  const raw = params as RequestPermissionRequest & { title?: unknown };
  const toolCall = params.toolCall as {
    toolCallId?: unknown;
    title?: unknown;
    name?: unknown;
    kind?: unknown;
    rawInput?: unknown;
  };
  const { command, cwd } = commandFromRawInput(toolCall.rawInput);
  const toolTitle =
    (typeof raw.title === 'string' && raw.title.trim()) ||
    (typeof toolCall.title === 'string' && toolCall.title.trim()) ||
    (typeof toolCall.name === 'string' && toolCall.name.trim()) ||
    'Approve tool action';

  return {
    id: randomUUID(),
    sessionId: params.sessionId,
    title: toolTitle,
    toolCallId: typeof toolCall.toolCallId === 'string' ? toolCall.toolCallId : undefined,
    toolName: typeof toolCall.name === 'string' ? toolCall.name : undefined,
    toolKind: typeof toolCall.kind === 'string' ? toolCall.kind : undefined,
    command,
    cwd,
    rawInput: toolCall.rawInput,
    options,
  };
}

function broadcastApprovalRequested(run: ActiveRun, approval: ChatApprovalRequest): void {
  for (const sub of run.subscribers) {
    sub.onApprovalRequested?.(approval);
  }
}

function broadcastApprovalResolved(run: ActiveRun, approvalRequestId: string): void {
  for (const sub of run.subscribers) {
    sub.onApprovalResolved?.(approvalRequestId);
  }
}

function resolvePendingApproval(
  run: ActiveRun,
  pending: PendingApproval,
  response: RequestPermissionResponse
): void {
  if (!run.pendingApprovals.delete(pending.approval.id)) return;
  pending.resolve(response);
  broadcastApprovalResolved(run, pending.approval.id);
}

function cancelPendingApprovals(run: ActiveRun): void {
  for (const pending of [...run.pendingApprovals.values()]) {
    resolvePendingApproval(run, pending, cancelledPermissionResponse());
  }
}

function allowOptionId(options: ChatApprovalOption[]): string | null {
  const allowOnce = options.find((option) => option.kind === 'allow_once');
  if (allowOnce) return allowOnce.optionId;
  const allowAlways = options.find((option) => option.kind === 'allow_always');
  return allowAlways?.optionId ?? null;
}

function autoAllowPermissionResponse(
  params: RequestPermissionRequest
): RequestPermissionResponse | null {
  const options = approvalOptionsFromRequest(params);
  const optionId = allowOptionId(options);
  if (!optionId) return null;
  return selectedPermissionResponse(optionId);
}

function resolvePendingApprovalsWithAllowAll(run: ActiveRun): void {
  for (const pending of [...run.pendingApprovals.values()]) {
    const optionId = allowOptionId(pending.approval.options);
    if (!optionId) {
      resolvePendingApproval(run, pending, cancelledPermissionResponse());
      continue;
    }
    resolvePendingApproval(run, pending, selectedPermissionResponse(optionId));
  }
}

/** Update live-run approval policy; allow_all flushes any waiting prompts. */
export function setActiveRunApprovalPolicy(
  sessionId: string,
  policy: string | null | undefined
): void {
  const run = activeRuns.get(sessionId);
  if (!run) return;
  run.approvalPolicy = normalizeApprovalPolicy(policy);
  if (run.approvalPolicy === 'allow_all') {
    resolvePendingApprovalsWithAllowAll(run);
  }
}

export function requestAcpPermissionForSession(
  sessionId: string,
  params: RequestPermissionRequest
): Promise<RequestPermissionResponse> {
  const run = activeRuns.get(sessionId);
  const approval = approvalRequestFromAcp(params);
  if (!run || !approval) {
    return Promise.resolve(cancelledPermissionResponse());
  }

  if (run.approvalPolicy === 'allow_all') {
    const auto = autoAllowPermissionResponse(params);
    if (auto) return Promise.resolve(auto);
    return Promise.resolve(cancelledPermissionResponse());
  }

  return new Promise((resolve) => {
    const pending: PendingApproval = { approval, resolve };
    run.pendingApprovals.set(approval.id, pending);
    broadcastApprovalRequested(run, approval);
  });
}

export function respondToAcpPermission(
  sessionId: string,
  approvalRequestId: string,
  optionId: string
): boolean {
  const run = activeRuns.get(sessionId);
  const pending = run?.pendingApprovals.get(approvalRequestId);
  if (!run || !pending) return false;
  if (!pending.approval.options.some((option) => option.optionId === optionId)) return false;
  resolvePendingApproval(run, pending, selectedPermissionResponse(optionId));
  return true;
}

function cancelledAskQuestionResponse(): AcpAskQuestionResponse {
  return { outcome: { outcome: 'cancelled' } };
}

function skippedAskQuestionResponse(reason?: string): AcpAskQuestionResponse {
  return { outcome: { outcome: 'skipped', reason } };
}

function questionRequestFromAcp(
  sessionId: string,
  params: AcpAskQuestionParams
): ChatQuestionRequest {
  return {
    id: randomUUID(),
    sessionId,
    toolCallId: params.toolCallId,
    title: params.title,
    questions: params.questions.map((question) => ({
      id: question.id,
      prompt: question.prompt,
      allowMultiple: question.allowMultiple === true,
      options: question.options.map((option) => ({
        id: option.id,
        label: option.label,
      })),
    })),
  };
}

function broadcastQuestionRequested(run: ActiveRun, question: ChatQuestionRequest): void {
  for (const sub of run.subscribers) {
    sub.onQuestionRequested?.(question);
  }
}

function broadcastQuestionResolved(run: ActiveRun, questionRequestId: string): void {
  for (const sub of run.subscribers) {
    sub.onQuestionResolved?.(questionRequestId);
  }
}

function resolvePendingQuestion(
  run: ActiveRun,
  pending: PendingQuestion,
  response: AcpAskQuestionResponse
): void {
  if (!run.pendingQuestions.delete(pending.question.id)) return;
  pending.resolve(response);
  broadcastQuestionResolved(run, pending.question.id);
}

function cancelPendingQuestions(run: ActiveRun): void {
  for (const pending of [...run.pendingQuestions.values()]) {
    resolvePendingQuestion(run, pending, cancelledAskQuestionResponse());
  }
}

function validateQuestionAnswers(
  question: ChatQuestionRequest,
  answers: ChatQuestionAnswer[]
): ChatQuestionAnswer[] | null {
  if (!Array.isArray(answers) || answers.length === 0) return null;

  const byId = new Map(question.questions.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const normalized: ChatQuestionAnswer[] = [];

  for (const answer of answers) {
    if (!answer || typeof answer.questionId !== 'string') return null;
    if (seen.has(answer.questionId)) return null;
    const item = byId.get(answer.questionId);
    if (!item) return null;
    if (!Array.isArray(answer.selectedOptionIds) || answer.selectedOptionIds.length === 0) {
      return null;
    }
    if (!item.allowMultiple && answer.selectedOptionIds.length !== 1) return null;

    const optionIds = new Set(item.options.map((option) => option.id));
    const selected: string[] = [];
    const selectedSeen = new Set<string>();
    for (const optionId of answer.selectedOptionIds) {
      if (typeof optionId !== 'string' || !optionIds.has(optionId) || selectedSeen.has(optionId)) {
        return null;
      }
      selectedSeen.add(optionId);
      selected.push(optionId);
    }

    seen.add(answer.questionId);
    normalized.push({ questionId: answer.questionId, selectedOptionIds: selected });
  }

  // Require an answer for every question in the request.
  if (normalized.length !== question.questions.length) return null;
  return normalized;
}

export function requestAcpAskQuestionForSession(
  sessionId: string,
  params: AcpAskQuestionParams
): Promise<AcpAskQuestionResponse> {
  const run = activeRuns.get(sessionId);
  if (!run) {
    return Promise.resolve(cancelledAskQuestionResponse());
  }

  const question = questionRequestFromAcp(sessionId, params);
  return new Promise((resolve) => {
    const pending: PendingQuestion = { question, resolve };
    run.pendingQuestions.set(question.id, pending);
    broadcastQuestionRequested(run, question);
  });
}

export function respondToAcpAskQuestion(
  sessionId: string,
  questionRequestId: string,
  response:
    | { skipped: true; reason?: string }
    | { skipped?: false; answers: ChatQuestionAnswer[] }
): boolean {
  const run = activeRuns.get(sessionId);
  const pending = run?.pendingQuestions.get(questionRequestId);
  if (!run || !pending) return false;

  if (response.skipped) {
    resolvePendingQuestion(run, pending, skippedAskQuestionResponse(response.reason));
    return true;
  }

  const answers = validateQuestionAnswers(pending.question, response.answers);
  if (!answers) return false;

  resolvePendingQuestion(run, pending, {
    outcome: { outcome: 'answered', answers },
  });
  return true;
}

function parseClaudeRateLimitError(rawError: string): { resetAtIso?: string; resetAtReadable?: string } | null {
  const text = rawError.trim();
  if (!/hit your limit/i.test(text) && !/rate limit/i.test(text)) {
    return null;
  }

  const resetMatch = text.match(/resets?\s+([0-9]{1,2}:[0-9]{2}\s*[ap]m(?:\s*\(utc\))?)/i);
  if (!resetMatch) {
    return {};
  }

  const resetAtReadable = resetMatch[1].trim();
  const timeMatch = resetAtReadable.match(/([0-9]{1,2}):([0-9]{2})\s*([ap]m)/i);
  if (!timeMatch) {
    return { resetAtReadable };
  }

  const hour12 = Number.parseInt(timeMatch[1] ?? '0', 10);
  const minute = Number.parseInt(timeMatch[2] ?? '0', 10);
  const ampm = (timeMatch[3] ?? '').toLowerCase();
  if (Number.isNaN(hour12) || Number.isNaN(minute) || hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) {
    return { resetAtReadable };
  }

  let hour24 = hour12 % 12;
  if (ampm === 'pm') hour24 += 12;

  const now = new Date();
  const resetDateUtc = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour24,
      minute,
      0,
      0
    )
  );
  if (resetDateUtc.getTime() <= now.getTime()) {
    resetDateUtc.setUTCDate(resetDateUtc.getUTCDate() + 1);
  }
  return { resetAtIso: resetDateUtc.toISOString(), resetAtReadable };
}

async function buildWorkspaceRulesPrefix(workspacePath: string, agentType: AgentType): Promise<string> {
  return buildAgentRulesPrefix({
    globalRulesDir: getGlobalRulesDir(),
    workspacePath,
    // cursor-agent natively auto-applies .mdc rules with `alwaysApply: true`
    // from the workspace/git root — those must not be double-delivered.
    // Rules without that frontmatter are NOT loaded by cursor and are still injected.
    excludeCursorNativeWorkspaceRules: agentType === 'cursor-agent',
  });
}

/**
 * Image attachments are sent to agents as native ACP image blocks (base64 data) —
 * every integrated ACP agent advertises the `image` prompt capability and converts
 * it to real model input. All other file types stay path-in-prompt so agents can
 * read them with their own file tools (ACP `resource`/blob blocks are ignored or
 * unsupported by several agents, and no agent accepts video over ACP).
 */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

async function resolvePromptAttachments(
  imagePaths: string[]
): Promise<{ attachments: AcpPromptAttachment[]; textPaths: string[] }> {
  const attachments: AcpPromptAttachment[] = [];
  const textPaths: string[] = [];
  for (const path of imagePaths) {
    const mimeType = IMAGE_MIME_BY_EXT[extname(path).toLowerCase()];
    if (mimeType) {
      try {
        const data = await readFile(path);
        attachments.push({ mimeType, data: data.toString('base64'), path });
        continue;
      } catch {
        // unreadable (e.g. cleaned up) — fall back to path-in-prompt
      }
    }
    textPaths.push(path);
  }
  return { attachments, textPaths };
}

export async function dispatchPrompt(
  opts: DispatchPromptOpts
): Promise<{ error?: string; errorCode?: AgentErrorCode }> {
  const { sessionId, text, model, mode, imagePaths = [], subscriber } = opts;

  if (activeRuns.has(sessionId)) {
    return { error: 'Agent is busy' };
  }

  const session = await db.getSession(sessionId);
  if (!session) {
    return { error: 'Session not found' };
  }

  const agentType: AgentType = (session.agentType as AgentType | null) ?? 'claude';
  const sessionMode = normalizeSessionMode(mode ?? session.sessionMode);
  const { linkedPlanContext, agentConfig: sessionConfig } =
    extractLinkedPlanContextFromConfig(session.sessionConfigJson);

  if (agentType !== 'claude' && agentType !== 'mistral-vibe' && agentType !== 'cursor-agent' && agentType !== 'open-code' && agentType !== 'codex') {
    return { error: `Agent type '${agentType}' is not yet supported via ACP. Coming soon.` };
  }

  const workspace = await db.getWorkspace(session.workspaceId);
  if (!workspace) {
    return { error: 'Workspace not found' };
  }

  let currentMessages: ChatMessage[] = [];
  try {
    currentMessages = await db.listSessionMessages(sessionId);
  } catch {
    currentMessages = [];
  }

  const userMessage: ChatMessage = {
    role: 'user',
    content: text,
    imagePaths: imagePaths.length > 0 ? imagePaths : undefined,
    createdAt: new Date().toISOString(),
  };
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
    });
    if (fresh) broadcastSessionListUpsert(fresh.workspaceId, fresh);
  } catch (err) {
    currentMessages.pop();
    logger.error({ err, sessionId }, 'Failed to persist user message / preview');
    return { error: 'Failed to save message' };
  }

  const { attachments, textPaths } = await resolvePromptAttachments(imagePaths);
  const effectiveText = textPaths.length > 0 ? `${text}\n\n${textPaths.join('\n')}` : text;
  const workspacePath = join('/data-root', workspace.path);
  if (!workspacePath.startsWith('/data-root/') && workspacePath !== '/data-root') {
    return { error: 'Invalid workspace path' };
  }

  const assistantEvents: string[] = [];

  // Rules are NOT prepended here: they are injected by the ACP runner only when
  // a fresh ACP session is created (first turn or fallback after a failed
  // resume). On resumed sessions the rules are already in the conversation
  // history — re-sending them every turn would duplicate tokens. Lazy callback
  // so resumed turns never touch the disk for rules.
  const getRulesPrefix = () => buildWorkspaceRulesPrefix(workspacePath, agentType);
  const linkedPlanPrefix = currentMessages.length === 1
    ? await buildLinkedPlanContextPrefix(linkedPlanContext)
    : '';
  const agentPrompt = linkedPlanPrefix.trim()
    ? `${linkedPlanPrefix}\n\n---\n\nUser request:\n${effectiveText}`
    : effectiveText;

  // Get Claude OAuth token (only needed for claude agent type)
  const user = await db.getFirstUser();
  const claudeToken = user?.claudeToken ?? null;

  let cancelled = false;
  let currentAcpSessionId = session.sessionId ?? null;

  const run: ActiveRun = {
    cancel: () => {
      cancelled = true;
      if (agentType === 'mistral-vibe') {
        cancelVibeAcp(sessionId);
      } else if (agentType === 'cursor-agent') {
        cancelCursorAcp(sessionId);
      } else if (agentType === 'open-code') {
        cancelOpenCodeAcp(sessionId);
      } else if (agentType === 'codex') {
        cancelCodexAcp(sessionId);
      } else if (currentAcpSessionId) {
        cancelClaudeAcp(currentAcpSessionId);
      }
    },
    workspaceId: session.workspaceId,
    messages: currentMessages,
    assistantEvents,
    bufferedLines: [],
    subscribers: new Set([subscriber]),
    pendingApprovals: new Map(),
    pendingQuestions: new Map(),
    approvalPolicy: normalizeApprovalPolicy(session.approvalPolicy),
    lastUsage: null,
  };
  activeRuns.set(sessionId, run);
  emitBusy(sessionId, session.workspaceId, true);

  const broadcast = (fn: (sub: ChatSubscriber) => void): void => {
    for (const sub of run.subscribers) fn(sub);
  };

  const onEvent = (line: string) => {
    const usage = parseUsageUpdateLine(line);
    if (usage) {
      run.lastUsage = usage;
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
        sessionConfigJson?: string;
      } = {};
      if (sync.modeId && sync.modeId !== sessionMode) {
        patch.sessionMode = sync.modeId;
      }
      // Do NOT persist the agent-reported model: the user's selection is authoritative and Cursor
      // only echoes its startup default (it can't switch models at runtime), so persisting it would
      // silently overwrite the user's choice (e.g. turn "auto" into "composer-2.5-fast").
      if (sync.config && Object.keys(sync.config).length > 0) {
        const merged = { ...sessionConfig, ...sync.config };
        const mergedJson = JSON.stringify(merged);
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

  // Run agent via ACP in background (non-blocking)
  void (async () => {
    logger.info({ agentType, sessionId, acpSessionId: currentAcpSessionId }, 'dispatching to agent via ACP');

    let result: {
      acpSessionId: string;
      stopReason?: string;
      error?: string;
      errorDetail?: AgentErrorDetail;
    };

    if (agentType === 'mistral-vibe') {
      result = await runVibeAcp(
        { acpSessionId: currentAcpSessionId, cwd: workspacePath, promptText: agentPrompt, attachments, mode: sessionMode, getRulesPrefix },
        onEvent,
        sessionId,
        onConfigSync,
        (permission) => requestAcpPermissionForSession(sessionId, permission)
      );
    } else if (agentType === 'cursor-agent') {
      result = await runCursorAcp(
        {
          acpSessionId: currentAcpSessionId,
          cwd: workspacePath,
          promptText: agentPrompt,
          attachments,
          model,
          mode: sessionMode,
          configJson: sessionConfig,
          getRulesPrefix,
        },
        onEvent,
        sessionId,
        onConfigSync,
        (permission) => requestAcpPermissionForSession(sessionId, permission),
        (question) => requestAcpAskQuestionForSession(sessionId, question)
      );
    } else if (agentType === 'open-code') {
      result = await runOpenCodeAcp(
        {
          acpSessionId: currentAcpSessionId,
          cwd: workspacePath,
          promptText: agentPrompt,
          attachments,
          model,
          mode: sessionMode,
          configJson: sessionConfig,
          getRulesPrefix,
        },
        onEvent,
        sessionId,
        onConfigSync,
        (permission) => requestAcpPermissionForSession(sessionId, permission)
      );
    } else if (agentType === 'codex') {
      result = await runCodexAcp(
        {
          acpSessionId: currentAcpSessionId,
          cwd: workspacePath,
          promptText: agentPrompt,
          attachments,
          model,
          mode: sessionMode,
          configJson: sessionConfig,
          getRulesPrefix,
        },
        onEvent,
        sessionId,
        onConfigSync,
        (permission) => requestAcpPermissionForSession(sessionId, permission)
      );
    } else {
      result = await runClaudeAcp(
        {
          acpSessionId: currentAcpSessionId,
          cwd: workspacePath,
          promptText: agentPrompt,
          attachments,
          claudeToken,
          model,
          mode: sessionMode,
          configJson: sessionConfig,
          getRulesPrefix,
          onSessionId: (id) => {
            currentAcpSessionId = id;
            // Stop pressed during session startup (before the ACP session id was
            // known) — honour it as soon as the id arrives instead of dropping it.
            if (cancelled) cancelClaudeAcp(id);
          },
        },
        onEvent,
        onConfigSync,
        (permission) => requestAcpPermissionForSession(sessionId, permission)
      );
    }

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
      });
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

    cancelPendingApprovals(run);
    cancelPendingQuestions(run);
    activeRuns.delete(sessionId);
    emitBusy(sessionId, session.workspaceId, false);
    broadcast((sub) => sub.onDone(currentMessages));
  })();

  return {};
}

// dispatch a prompt and block until the run completes — used by orchestrator to sequence subtasks
export function dispatchPromptAndWait(opts: {
  sessionId: string;
  text: string;
  model?: string;
  timeoutMs?: number;
}): Promise<{ error?: string; errorCode?: AgentErrorCode; messages?: ChatMessage[] }> {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? 600_000; // 10 min default
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const finish = (result: { error?: string; errorCode?: AgentErrorCode; messages?: ChatMessage[] }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    timeout = setTimeout(() => {
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
      mode: 'default',
      subscriber,
    }).then((result) => {
      if (result.error) {
        const classifiedError = classifyAgentError(result.error, { agentLabel: 'Agent' });
        finish({ error: classifiedError.message, errorCode: classifiedError.code });
      }
    });
  });
}

// ------------------------------------------ Claude Auto-Continue Scheduler ------------------------------------------

export async function checkClaudeAutoContinue(): Promise<void> {
  logger.debug('Checking for Claude sessions to auto-continue');

  try {
    const users = await db.listUsers();
    const autoContinueUsers = users.filter((user) => user.claudeAutoContinue);

    if (autoContinueUsers.length === 0) {
      return;
    }

    const now = new Date();
    const sessions = await db.listSessions();

    for (const session of sessions) {
      if (!session.claudeLimitResetAt) continue;

      const resetTime = new Date(session.claudeLimitResetAt);
      const continueTime = new Date(resetTime);
      continueTime.setMinutes(continueTime.getMinutes() + 1);

      if (now >= continueTime) {
        logger.info({ sessionId: session.id }, 'Auto-continuing session after Claude limit reset');

        const mockSubscriber: ChatSubscriber = {
          onStream: () => {},
          onDone: () => logger.info({ sessionId: session.id }, 'Auto-continue completed'),
          onError: (message) => logger.error({ sessionId: session.id, message }, 'Auto-continue failed'),
          onHistory: () => {},
        };

        await dispatchPrompt({
          sessionId: session.id,
          text: 'continue',
          model: 'auto',
          mode: session.sessionMode,
          subscriber: mockSubscriber,
        });

        await db.updateSession(session.id, { claudeLimitResetAt: null });
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error in auto-continue checker');
  }
}

const AUTO_CONTINUE_INTERVAL_MS = 60 * 1000;
setInterval(checkClaudeAutoContinue, AUTO_CONTINUE_INTERVAL_MS);
checkClaudeAutoContinue().catch((err) => logger.error({ err }, 'Auto-continue checker failed to start'));

// node_modules
import { randomUUID } from 'node:crypto';
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';

// classes
import { normalizeApprovalPolicy } from '../approvalPolicy';
import { isPlanApprovalRequest, planMarkdownFromPermission } from '../planApproval';
import { claimClaudePlanForSession } from '../planDocumentSources';
import { resolvePlanDisplayTitle } from '@novacode/shared';
import { activeRuns } from './state';

// types
import type { ActiveRun, PendingApproval } from './types';
import type {
  ChatApprovalOption,
  ChatApprovalOptionKind,
  ChatApprovalRequest,
} from '../../@types/index';

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
  const planMarkdown = isPlanApprovalRequest(params)
    ? planMarkdownFromPermission(params)
    : undefined;

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
    planMarkdown,
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

export function cancelPendingApprovals(run: ActiveRun): void {
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

/** Push plan markdown into the live stream so the Plan tab can show it. */
function emitPlanUpdateToRun(run: ActiveRun, planMarkdown: string, title?: string): void {
  const line = JSON.stringify({
    sessionId: 'plan-surface',
    update: {
      sessionUpdate: 'plan',
      title: title?.trim() || 'Plan',
      markdown: planMarkdown,
      entries: [],
    },
  });
  run.assistantEvents.push(line);
  run.bufferedLines.push(line);
  for (const sub of run.subscribers) {
    sub.onStream(line);
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

  // Surface the plan into the stream/Plan tab even when allow_all auto-accepts
  // (no approval UI is shown in that case).
  if (approval.planMarkdown) {
    emitPlanUpdateToRun(
      run,
      approval.planMarkdown,
      resolvePlanDisplayTitle(approval.title, approval.planMarkdown)
    );
    if (run.agentType === 'claude' && run.acpSessionId) {
      void claimClaudePlanForSession(run.acpSessionId, approval.planMarkdown);
    }
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

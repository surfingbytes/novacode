// node_modules
import { join } from 'node:path';
import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';

// classes
import { db } from './database';
import { config } from './config';
import { isWorkspaceRuleHiddenFromUi } from './workspaceRules';
import { runClaudeAcp, cancelClaudeAcp } from './claudeAcp';
import { runVibeAcp, cancelVibeAcp } from './vibeAcp';
import { runCursorAcp, cancelCursorAcp } from './cursorAcp';
import { runOpenCodeAcp, cancelOpenCodeAcp } from './openCodeAcp';
import { runCodexAcp, cancelCodexAcp } from './codexAcp';
import { sendTaskDonePush } from './push';
import { computeLastListPreview } from './chatPreview';
import { extractStreamNotificationPreview } from './chatStreamPreviewFromEvents';
import { broadcastSessionListUpsert } from './sessionListBroadcast';

// types
import type { ChatMessage, AgentType } from '../@types/index';

export interface ActiveRun {
  cancel: () => void;
  workspaceId: string;
  messages: ChatMessage[];
  assistantEvents: string[];
  bufferedLines: string[];
  subscribers: Set<ChatSubscriber>;
}

export interface ChatSubscriber {
  onStream(line: string): void;
  onDone(messages: ChatMessage[]): void;
  onError(message: string): void;
  onHistory(messages: ChatMessage[], streaming: boolean): void;
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
    console.log('[chatEngine] cancelling active run for session', sessionId);
    run.cancel();
  } catch (err) {
    console.error('[chatEngine] Failed to cancel run:', err);
  }
}

export interface DispatchPromptOpts {
  sessionId: string;
  text: string;
  model?: string;
  imagePaths?: string[];
  subscriber: ChatSubscriber;
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

async function buildWorkspaceRulesPrefix(workspacePath: string): Promise<string> {
  const rulesDir = join(workspacePath, '.cursor', 'rules');
  let entries: Dirent[];
  try {
    entries = await readdir(rulesDir, { withFileTypes: true });
  } catch {
    return '';
  }

  const ruleFiles: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    let include = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const st = await stat(join(rulesDir, entry.name));
        include = st.isFile();
      } catch {
        include = false;
      }
    }
    if (!include) continue;
    if (isWorkspaceRuleHiddenFromUi(entry.name)) continue;
    ruleFiles.push(entry.name);
  }
  ruleFiles.sort();
  if (ruleFiles.length === 0) return '';

  const sections: string[] = [];
  for (const filename of ruleFiles) {
    try {
      const content = await readFile(join(rulesDir, filename), 'utf8');
      const trimmed = content.trim();
      if (!trimmed) continue;
      sections.push(`--- ${filename} ---\n${trimmed}`);
    } catch {
      // ignore unreadable single files
    }
  }

  if (sections.length === 0) return '';

  return [
    'Workspace rules (from .cursor/rules) apply to this task.',
    'Follow them as high-priority instructions when generating your response.',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

export async function dispatchPrompt(opts: DispatchPromptOpts): Promise<{ error?: string }> {
  const { sessionId, text, model, imagePaths = [], subscriber } = opts;

  if (activeRuns.has(sessionId)) {
    return { error: 'Agent is busy' };
  }

  const session = await db.getSession(sessionId);
  if (!session) {
    return { error: 'Session not found' };
  }

  const agentType: AgentType = (session.agentType as AgentType | null) ?? 'claude';

  if (agentType !== 'claude' && agentType !== 'mistral-vibe' && agentType !== 'cursor-agent' && agentType !== 'open-code' && agentType !== 'codex') {
    return { error: `Agent type '${agentType}' is not yet supported via ACP. Coming soon.` };
  }

  const workspace = await db.getWorkspace(session.workspaceId);
  if (!workspace) {
    return { error: 'Workspace not found' };
  }

  let currentMessages: ChatMessage[] = [];
  try {
    currentMessages = JSON.parse(session.messageJson ?? '[]');
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
    await db.updateSession(sessionId, {
      messageJson: JSON.stringify(currentMessages),
      ...(previewAfterUser
        ? {
            lastPreviewText: previewAfterUser.lastPreviewText,
            lastPreviewRole: previewAfterUser.lastPreviewRole,
          }
        : {}),
    });
    const fresh = await db.getSession(sessionId);
    if (fresh) broadcastSessionListUpsert(fresh.workspaceId, fresh);
  } catch (err) {
    currentMessages.pop();
    console.error('[chatEngine] Failed to persist user message / preview:', err);
    return { error: 'Failed to save message' };
  }

  const effectiveText = imagePaths.length > 0 ? `${text}\n\n${imagePaths.join('\n')}` : text;
  const workspacePath = join('/data-root', workspace.path);
  if (!workspacePath.startsWith('/data-root/') && workspacePath !== '/data-root') {
    return { error: 'Invalid workspace path' };
  }

  const assistantEvents: string[] = [];

  // Resolve workspace rules prefix
  const rulesPrefix = await buildWorkspaceRulesPrefix(workspacePath);
  const agentPrompt = rulesPrefix ? `${rulesPrefix}\n\nUser request:\n${effectiveText}` : effectiveText;

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
  };
  activeRuns.set(sessionId, run);
  emitBusy(sessionId, session.workspaceId, true);

  const broadcast = (fn: (sub: ChatSubscriber) => void): void => {
    for (const sub of run.subscribers) fn(sub);
  };

  const onEvent = (line: string) => {
    console.log('[chatEngine] onStream', line);
    assistantEvents.push(line);
    run.bufferedLines.push(line);
    broadcast((sub) => sub.onStream(line));
  };

  // Run agent via ACP in background (non-blocking)
  void (async () => {
    console.log('[chatEngine] dispatching to agent via ACP', {
      agentType,
      sessionId,
      acpSessionId: currentAcpSessionId,
      cwd: workspacePath,
    });

    let result: { acpSessionId: string; stopReason?: string; error?: string };

    if (agentType === 'mistral-vibe') {
      result = await runVibeAcp(
        { acpSessionId: currentAcpSessionId, cwd: workspacePath, promptText: agentPrompt },
        onEvent,
        sessionId
      );
    } else if (agentType === 'cursor-agent') {
      result = await runCursorAcp(
        { acpSessionId: currentAcpSessionId, cwd: workspacePath, promptText: agentPrompt },
        onEvent,
        sessionId
      );
    } else if (agentType === 'open-code') {
      result = await runOpenCodeAcp(
        { acpSessionId: currentAcpSessionId, cwd: workspacePath, promptText: agentPrompt, model },
        onEvent,
        sessionId
      );
    } else if (agentType === 'codex') {
      result = await runCodexAcp(
        { acpSessionId: currentAcpSessionId, cwd: workspacePath, promptText: agentPrompt, model },
        onEvent,
        sessionId
      );
    } else {
      result = await runClaudeAcp(
        {
          acpSessionId: currentAcpSessionId,
          cwd: workspacePath,
          promptText: agentPrompt,
          claudeToken,
          onSessionId: (id) => { currentAcpSessionId = id; },
        },
        onEvent
      );
    }

    if (result.error && !cancelled) {
      console.error('[chatEngine] ACP error:', result.error);
      const parsedClaudeLimit = agentType === 'claude' ? parseClaudeRateLimitError(result.error) : null;
      const resetAtIso = parsedClaudeLimit?.resetAtIso ?? null;
      const resetAtReadable = parsedClaudeLimit?.resetAtReadable;
      if (parsedClaudeLimit) {
        try {
          await db.updateSession(sessionId, { claudeLimitResetAt: resetAtIso } as any);
          const fresh = await db.getSession(sessionId);
          if (fresh) broadcastSessionListUpsert(fresh.workspaceId, fresh);
        } catch (err) {
          console.error('[chatEngine] Failed to persist Claude limit reset time:', err);
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
      broadcast((sub) => sub.onError(result.error ?? 'Agent run failed'));
    }

    console.log('[chatEngine] agent ACP finished', {
      agentType,
      stopReason: result.stopReason,
      eventCount: assistantEvents.length,
    });

    // Track ACP session ID changes (new session on first turn, or if Claude rotates it).
    // Folded into the same awaited DB write below to avoid a race where the fire-and-forget
    // save races the messageJson write — the messageJson write would win and clobber the sessionId.
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
      await db.updateSession(sessionId, {
        messageJson: JSON.stringify(currentMessages),
        ...(newAcpSessionId ? { sessionId: newAcpSessionId } : {}),
        ...(previewDone
          ? { lastPreviewText: previewDone.lastPreviewText, lastPreviewRole: previewDone.lastPreviewRole }
          : { lastPreviewText: null, lastPreviewRole: null }),
      });
      if (newAcpSessionId) {
        console.log('[chatEngine] ACP session ID saved:', newAcpSessionId);
      }
      const fresh = await db.getSession(sessionId);
      if (fresh) broadcastSessionListUpsert(fresh.workspaceId, fresh);
    } catch (err) {
      console.error('[chatEngine] Failed to save messages:', err);
    }

    try {
      const lastAssistantMessage = extractStreamNotificationPreview(assistantEvents);
      await sendTaskDonePush(session.name, workspace.name, lastAssistantMessage);
    } catch (err) {
      console.error('[chatEngine] Failed to send task completion push:', err);
    }

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
}): Promise<{ error?: string; messages?: ChatMessage[] }> {
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? 600_000; // 10 min default
    const timeout = setTimeout(() => {
      resolve({ error: 'Run timed out' });
    }, timeoutMs);

    const subscriber: ChatSubscriber = {
      onStream: () => {},
      onDone: (messages) => {
        clearTimeout(timeout);
        resolve({ messages });
      },
      onError: (message) => {
        clearTimeout(timeout);
        resolve({ error: message });
      },
      onHistory: () => {},
    };

    dispatchPrompt({
      sessionId: opts.sessionId,
      text: opts.text,
      model: opts.model ?? 'auto',
      subscriber,
    }).then((result) => {
      if (result.error) {
        clearTimeout(timeout);
        resolve({ error: result.error });
      }
    });
  });
}

// ------------------------------------------ Claude Auto-Continue Scheduler ------------------------------------------

export async function checkClaudeAutoContinue(): Promise<void> {
  console.log('[chatEngine] Checking for Claude sessions to auto-continue...');

  try {
    const users = await db.listUsers();
    const autoContinueUsers = users.filter((user) => user.claudeAutoContinue);

    if (autoContinueUsers.length === 0) {
      console.log('[chatEngine] No users with auto-continue enabled');
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
        console.log('[chatEngine] Auto-continuing session after Claude limit reset:', session.id);

        const mockSubscriber: ChatSubscriber = {
          onStream: (line) => console.log('[chatEngine] Auto-continue stream:', line),
          onDone: () => console.log('[chatEngine] Auto-continue completed for session:', session.id),
          onError: (message) =>
            console.error('[chatEngine] Auto-continue failed for session', session.id, ':', message),
          onHistory: () => {},
        };

        await dispatchPrompt({
          sessionId: session.id,
          text: 'continue',
          model: 'auto',
          subscriber: mockSubscriber,
        });

        await db.updateSession(session.id, { claudeLimitResetAt: null } as any);
      }
    }
  } catch (err) {
    console.error('[chatEngine] Error in auto-continue checker:', err);
  }
}

const AUTO_CONTINUE_INTERVAL_MS = 60 * 1000;
setInterval(checkClaudeAutoContinue, AUTO_CONTINUE_INTERVAL_MS);
checkClaudeAutoContinue().catch(console.error);

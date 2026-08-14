// node_modules
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir } from 'node:fs/promises';

// classes
import { db, normalizeTagStringList } from './database';
import { config } from './config';
import { createSessionWithAgent } from './sessionService';
import { dispatchPromptAndWait } from './chatEngine';
import { sendPushToAll } from './push';

// types
import type { AgentType, ChatMessage } from '../@types/index';

const execFileAsync = promisify(execFile);

// --------------------------------------------- Helpers ---------------------------------------------

function extractAssistantText(messages: ChatMessage[] | undefined): string {
  if (!messages?.length) {
    return '';
  }
  let text = '';
  for (const msg of messages) {
    if (msg.role !== 'assistant') {
      continue;
    }
    if (msg.content) {
      text += msg.content;
    }
    if (msg.events?.length) {
      for (const line of msg.events) {
        try {
          const event = JSON.parse(line) as {
            type?: string;
            message?: { content?: Array<{ type?: string; text?: string }> };
          };
          if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
            for (const block of event.message.content) {
              if (block.type === 'text' && typeof block.text === 'string') {
                text += block.text;
              }
            }
          }
        } catch {
          // skip malformed
        }
      }
    }
  }
  return text;
}

async function getGitStatus(
  workspacePath: string
): Promise<Array<{ status: string; file: string }>> {
  const rel = workspacePath.replace(/^\//, '');
  const baseCwd = config.workspaceBrowseRoot + '/' + (rel || '.');
  const skipDirs = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.cache']);
  const files: Array<{ status: string; file: string }> = [];

  const readPorcelain = async (cwd: string, prefix: string): Promise<void> => {
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-u'], {
        cwd,
        env: { ...process.env, HOME: config.configDir } as Record<string, string>
      });
      for (const line of stdout.split('\n')) {
        if (!line.trim()) {
          continue;
        }
        const statusCode = line.slice(0, 2).trim();
        const file = line.slice(3).trim();
        if (file) {
          files.push({ status: statusCode, file: prefix ? `${prefix}/${file}` : file });
        }
      }
    } catch {
      // not a git repo or git unavailable
    }
  };

  await readPorcelain(baseCwd, '');

  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = (await readdir(baseCwd, { withFileTypes: true })) as Array<{
      name: string;
      isDirectory: () => boolean;
    }>;
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || skipDirs.has(entry.name)) {
      continue;
    }
    const child = `${baseCwd}/${entry.name}`;
    try {
      const childEntries = await readdir(child, { withFileTypes: true });
      if (!childEntries.some((item) => item.name === '.git')) {
        continue;
      }
    } catch {
      continue;
    }
    await readPorcelain(child, entry.name);
  }

  return files;
}

// --------------------------------------------- Scheduler ---------------------------------------------

const runningAutomationIds = new Set<string>();

function compactPushBody(input: string, maxLen = 280): string {
  const normalized = input.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen - 1)}…`;
}

async function notifyAutomationFinished(opts: {
  automationName: string;
  workspaceId: string;
  sessionId?: string | null;
  bFailed: boolean;
  body: string;
}): Promise<void> {
  try {
    await sendPushToAll({
      title: opts.bFailed
        ? `Automation failed: ${opts.automationName}`
        : `Automation finished: ${opts.automationName}`,
      body: compactPushBody(opts.body || (opts.bFailed ? 'Run failed' : 'Run completed')),
      tag: `automation-${opts.workspaceId}`,
      url: opts.sessionId
        ? `/workspace/${opts.workspaceId}/session/${opts.sessionId}`
        : '/automations'
    });
  } catch (err) {
    console.error('[automations] Failed to send push:', err);
  }
}

async function runAutomation(automationId: string): Promise<void> {
  if (runningAutomationIds.has(automationId)) {
    return;
  }
  runningAutomationIds.add(automationId);

  const automation = await db.getAutomation(automationId);
  if (!automation) {
    runningAutomationIds.delete(automationId);
    return;
  }

  const workspace = await db.getWorkspace(automation.workspaceId);
  if (!workspace) {
    console.error(
      `[automations] workspace ${automation.workspaceId} not found for automation ${automationId}`
    );
    runningAutomationIds.delete(automationId);
    return;
  }

  const run = await db.createAutomationRun(automationId);

  const nextRunAt = new Date(Date.now() + automation.intervalMinutes * 60_000).toISOString();
  const lastRunAt = new Date().toISOString();
  await db.updateAutomation(automationId, {
    nextRunAt,
    lastRunAt,
    lastRunStatus: 'running',
    lastRunError: null
  });

  let sessionId: string | null = null;
  try {
    const beforeFiles = await getGitStatus(workspace.path);

    const sessionResult = await createSessionWithAgent({
      workspaceId: automation.workspaceId,
      name: `Automation: ${automation.name}`,
      agentType: automation.agentType as AgentType,
      tags: normalizeTagStringList(['automation'])
    });

    if (sessionResult.error || !sessionResult.session) {
      const error = sessionResult.error ?? 'Failed to create session';
      await db.updateAutomationRun(run.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error
      });
      await db.updateAutomation(automationId, { lastRunStatus: 'failed', lastRunError: error });
      await notifyAutomationFinished({
        automationName: automation.name,
        workspaceId: automation.workspaceId,
        bFailed: true,
        body: error
      });
      return;
    }

    sessionId = sessionResult.session.id;
    await db.updateAutomationRun(run.id, { sessionId });

    const result = await dispatchPromptAndWait({
      sessionId: sessionResult.session.id,
      text: automation.prompt,
      timeoutMs: 1000 * 60 * 120 // 120 minutes
    });

    const afterFiles = await getGitStatus(workspace.path);

    const beforeSet = new Set(beforeFiles.map((f) => f.file));
    const changedFiles = afterFiles.filter((f) => {
      const prev = beforeFiles.find((b) => b.file === f.file);
      return !prev || prev.status !== f.status;
    });
    for (const f of afterFiles) {
      if (!beforeSet.has(f.file)) {
        changedFiles.push(f);
      }
    }
    const seen = new Set<string>();
    const uniqueChanged = changedFiles.filter((f) => {
      if (seen.has(f.file)) {
        return false;
      }
      seen.add(f.file);
      return true;
    });

    const agentResponse = extractAssistantText(result.messages);
    const bFailed = Boolean(result.error);
    await db.updateAutomationRun(run.id, {
      status: bFailed ? 'failed' : 'completed',
      finishedAt: new Date().toISOString(),
      agentResponse,
      changedFiles: JSON.stringify(uniqueChanged),
      error: result.error ?? null,
      sessionId
    });
    await db.updateAutomation(automationId, {
      lastRunStatus: bFailed ? 'failed' : 'completed',
      lastRunError: result.error ?? null
    });
    await notifyAutomationFinished({
      automationName: automation.name,
      workspaceId: automation.workspaceId,
      sessionId,
      bFailed,
      body: result.error || agentResponse || (bFailed ? 'Run failed' : 'Run completed')
    });
    await db.pruneAutomationRuns(automationId, 50);
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[automations] run ${run.id} failed:`, error);
    await db.updateAutomationRun(run.id, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error,
      sessionId
    });
    await db.updateAutomation(automationId, { lastRunStatus: 'failed', lastRunError: error });
    await notifyAutomationFinished({
      automationName: automation.name,
      workspaceId: automation.workspaceId,
      sessionId,
      bFailed: true,
      body: error
    });
  } finally {
    runningAutomationIds.delete(automationId);
  }
}

// --------------------------------------------- Export ---------------------------------------------

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startAutomationScheduler(): void {
  if (intervalHandle) {
    return;
  }

  void db.failStaleAutomationRuns().catch((err) => {
    console.error('[automations] failed to clear stale runs:', err);
  });

  const tick = async (): Promise<void> => {
    try {
      const due = await db.listEnabledAutomationsDue();
      for (const automation of due) {
        // fire and forget; errors are caught inside runAutomation
        runAutomation(automation.id).catch((err) => {
          console.error(`[automations] unhandled error for ${automation.id}:`, err);
        });
      }
    } catch (err) {
      console.error('[automations] scheduler tick error:', err);
    }
  };

  // check every minute
  intervalHandle = setInterval(() => void tick(), 60_000);
  // run once immediately on start to catch any overdue automations
  void tick();
}

export function stopAutomationScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export { runAutomation };

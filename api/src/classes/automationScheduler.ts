// node_modules
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// classes
import { db } from './database';
import { config } from './config';
import { createSessionWithAgent } from './sessionService';
import { dispatchPromptAndWait } from './chatEngine';

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
  try {
    const rel = workspacePath.replace(/^\//, '');
    const cwd = config.workspaceBrowseRoot + '/' + (rel || '.');
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '-u'], {
      cwd,
      env: { ...process.env, HOME: config.configDir } as Record<string, string>
    });
    const files: Array<{ status: string; file: string }> = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      const statusCode = line.slice(0, 2).trim();
      const file = line.slice(3).trim();
      if (file) {
        files.push({ status: statusCode, file });
      }
    }
    return files;
  } catch {
    return [];
  }
}

// --------------------------------------------- Scheduler ---------------------------------------------

async function runAutomation(automationId: string): Promise<void> {
  const automation = await db.getAutomation(automationId);
  if (!automation) {
    return;
  }

  const workspace = await db.getWorkspace(automation.workspaceId);
  if (!workspace) {
    console.error(
      `[automations] workspace ${automation.workspaceId} not found for automation ${automationId}`
    );
    return;
  }

  const run = await db.createAutomationRun(automationId);

  // update nextRunAt and lastRunAt immediately so the scheduler doesn't re-trigger
  const nextRunAt = new Date(Date.now() + automation.intervalMinutes * 60_000).toISOString();
  const lastRunAt = new Date().toISOString();
  await db.updateAutomation(automationId, { nextRunAt, lastRunAt });

  try {
    const beforeFiles = await getGitStatus(workspace.path);

    const sessionResult = await createSessionWithAgent({
      workspaceId: automation.workspaceId,
      name: `Automation: ${automation.name}`,
      agentType: automation.agentType as AgentType
    });

    if (sessionResult.error || !sessionResult.session) {
      await db.updateAutomationRun(run.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: sessionResult.error ?? 'Failed to create session'
      });
      return;
    }

    const result = await dispatchPromptAndWait({
      sessionId: sessionResult.session.id,
      text: automation.prompt,
      timeoutMs: 1000 * 60 * 120 // 120 minutes
    });

    const afterFiles = await getGitStatus(workspace.path);

    // diff: files that changed between before and after
    const beforeSet = new Set(beforeFiles.map((f) => f.file));
    const changedFiles = afterFiles.filter((f) => {
      const prev = beforeFiles.find((b) => b.file === f.file);
      return !prev || prev.status !== f.status;
    });
    // also include new files not in before
    for (const f of afterFiles) {
      if (!beforeSet.has(f.file)) {
        changedFiles.push(f);
      }
    }
    // deduplicate
    const seen = new Set<string>();
    const uniqueChanged = changedFiles.filter((f) => {
      if (seen.has(f.file)) {
        return false;
      }
      seen.add(f.file);
      return true;
    });

    const agentResponse = extractAssistantText(result.messages);

    if (result.error) {
      await db.updateAutomationRun(run.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        agentResponse,
        changedFiles: JSON.stringify(uniqueChanged),
        error: result.error
      });
    } else {
      await db.updateAutomationRun(run.id, {
        status: 'completed',
        finishedAt: new Date().toISOString(),
        agentResponse,
        changedFiles: JSON.stringify(uniqueChanged)
      });
    }

    // clean up temp session
    await db.deleteSession(sessionResult.session.id);
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[automations] run ${run.id} failed:`, error);
    await db.updateAutomationRun(run.id, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error
    });
  }
}

// --------------------------------------------- Export ---------------------------------------------

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startAutomationScheduler(): void {
  if (intervalHandle) {
    return;
  }

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

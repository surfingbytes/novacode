// node_modules
import { join } from 'node:path';

// classes
import { db } from './database';
import { config } from './config';
import { PtyProcess } from './ptyProcess';
import { classifyAgentError, type AgentErrorCode } from './agentError';

// types
import type { SessionModel as Session } from '../generated/client/models/Session';
import type { AgentType } from '../@types/index';

export interface CreateSessionWithAgentParams {
  workspaceId: string;
  name: string;
  /** Optional tags for this session (same shape as workspace tags). */
  tags?: string[] | null;
  /** Which backend agent to use for this session (defaults to workspace.defaultAgentType or cursor-agent). */
  agentType?: AgentType;
}

export interface CreateSessionWithAgentResult {
  session?: Session;
  error?: string;
  errorCode?: AgentErrorCode;
  errorDetails?: string;
}

// shared by HTTP route (POST /api/workspaces/:id/sessions)
export async function createSessionWithAgent(
  params: CreateSessionWithAgentParams
): Promise<CreateSessionWithAgentResult> {
  const { workspaceId, name, tags = null } = params;

  const workspace = await db.getWorkspace(workspaceId);
  if (!workspace) {
    return { error: 'Workspace not found' };
  }

  const agentType: AgentType =
    params.agentType ??
    ((workspace.defaultAgentType as AgentType | null) ?? 'cursor-agent');

  const session = await db.createSession({
    name,
    tags,
    workspaceId,
    agentType
  });

  // claude / mistral-vibe: no create-chat bootstrap; cursor-agent runs create-chat for an external session id
  let sessionId: string | null = null;
  if (agentType === 'cursor-agent') {
    try {
      const rawOutput = await new Promise<string>((resolve, reject) => {
        const pty = new PtyProcess(
          config.cursorCommand,
          ['-f', 'create-chat'],
          join('/data-root', workspace.path),
          config.agentEnv()
        );
        const timeout = setTimeout(() => {
          pty.kill();
          reject(new Error('cursor-agent timed out'));
        }, 30_000);
        pty.onExit((code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            reject(new Error(`cursor-agent exited with code ${code}`));
            return;
          }
          resolve(pty.history);
        });
      });

      const output = rawOutput
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\r\n/g, '')
        .trim()
        .split('\x1B')
        .shift();

      if (!output || !output.trim()) {
        throw new Error('No output from cursor-agent');
      }

      sessionId = output.trim();
    } catch (err) {
      await db.deleteSession(session.id);
      const classified = classifyAgentError(err, {
        agentLabel: 'Cursor',
        fallbackMessage: 'Failed to create chat'
      });
      return {
        error: classified.message,
        errorCode: classified.code,
        errorDetails: classified.rawMessage
      };
    }
  }

  const updatedSession = await db.updateSession(session.id, { sessionId });
  if (!updatedSession) {
    return { error: 'Failed to update session' };
  }

  return { session: updatedSession };
}

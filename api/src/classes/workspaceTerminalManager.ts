// node_modules
import { existsSync } from 'node:fs';
import { normalize, resolve } from 'node:path';

// classes
import { config } from './config';
import { PtyProcess } from './ptyProcess';

// types
import type { SessionStatus } from '../@types/index';

interface WorkspaceTerminalWorkspace {
  id: string;
  path: string;
  gitUserName?: string | null;
  gitUserEmail?: string | null;
}

interface LiveWorkspaceTerminal {
  sessionId: string;
  status: SessionStatus;
  pty: PtyProcess;
  statusSubscribers: Set<(status: SessionStatus) => void>;
}

function normalizeWithSlash(path: string): string {
  return normalize(path).replace(/\\/g, '/');
}

function resolveWorkspaceCwd(workspace: WorkspaceTerminalWorkspace): string {
  const rootPath = resolve(config.workspaceBrowseRoot);
  const rootNorm = normalizeWithSlash(rootPath).replace(/\/?$/, '/');
  const workspaceRel = workspace.path.replace(/^\//, '');
  const cwd = resolve(rootPath, workspaceRel || '.');
  const cwdNorm = normalizeWithSlash(cwd);
  const isUnderRoot = cwdNorm === rootNorm.slice(0, -1) || (cwdNorm + '/').startsWith(rootNorm);

  if (!isUnderRoot) {
    throw new Error('Workspace path is outside the allowed root');
  }
  if (!existsSync(cwd)) {
    throw new Error('Workspace path does not exist');
  }

  return cwd;
}

class WorkspaceTerminalManager {
  private readonly terminals = new Map<string, LiveWorkspaceTerminal>();

  getOrCreate(sessionId: string, workspace: WorkspaceTerminalWorkspace): LiveWorkspaceTerminal {
    const existing = this.terminals.get(sessionId);
    if (existing && !existing.pty.exited) {
      return existing;
    }
    if (existing) {
      this.terminals.delete(sessionId);
    }

    const cwd = resolveWorkspaceCwd(workspace);
    const shell = process.env['SHELL'] || '/bin/bash';
    const env = config.agentEnv({
      name: workspace.gitUserName ?? undefined,
      email: workspace.gitUserEmail ?? undefined
    });
    env['NOVA_WORKSPACE_ID'] = workspace.id;
    env['NOVA_SESSION_ID'] = sessionId;

    const pty = new PtyProcess(shell, [], cwd, env);
    const live: LiveWorkspaceTerminal = {
      sessionId,
      status: 'running',
      pty,
      statusSubscribers: new Set()
    };

    pty.onExit((exitCode) => {
      const current = this.terminals.get(sessionId);
      if (!current || current !== live) {
        return;
      }
      current.status = exitCode === 0 || exitCode === undefined ? 'stopped' : 'failed';
      for (const subscriber of current.statusSubscribers) {
        subscriber(current.status);
      }
    });

    this.terminals.set(sessionId, live);
    return live;
  }

  subscribeStatus(sessionId: string, handler: (status: SessionStatus) => void): void {
    this.terminals.get(sessionId)?.statusSubscribers.add(handler);
  }

  unsubscribeStatus(sessionId: string, handler: (status: SessionStatus) => void): void {
    this.terminals.get(sessionId)?.statusSubscribers.delete(handler);
  }

  stop(sessionId: string): void {
    const live = this.terminals.get(sessionId);
    if (!live) {
      return;
    }
    if (!live.pty.exited) {
      live.pty.kill();
    }
    this.terminals.delete(sessionId);
  }

  stopMany(sessionIds: string[]): void {
    for (const sessionId of sessionIds) {
      this.stop(sessionId);
    }
  }

  stopAll(): void {
    for (const sessionId of this.terminals.keys()) {
      this.stop(sessionId);
    }
  }
}

export const workspaceTerminalManager = new WorkspaceTerminalManager();

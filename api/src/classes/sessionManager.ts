// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { config } from './config';
import { PtyProcess } from './ptyProcess';

// types
import type { SessionStatus } from '../@types/index';

// in-memory auth session (e.g. Cursor login PTY) — not persisted to DB
export interface AuthSessionMeta {
  id: string;
  title: string;
  status: SessionStatus;
}

interface LiveAuthSession {
  meta: AuthSessionMeta;
  pty: PtyProcess;
  statusSubscribers: Set<(status: SessionStatus) => void>;
}

class SessionManager {
  private readonly sessions = new Map<string, LiveAuthSession>();

  // creates a short-lived auth session (e.g. cursor-agent login) for agent auth flows only
  createAuthSession(command: string, args: string[]): AuthSessionMeta {
    const id = randomUUID();
    const displayCommand = [command, ...args].join(' ');
    const meta: AuthSessionMeta = {
      id,
      title: `Auth — ${displayCommand}`,
      status: 'running'
    };

    const pty = new PtyProcess(command, args, config.configDir, config.agentEnv());

    pty.onExit((exitCode) => {
      const live = this.sessions.get(id);
      if (!live) {
        return;
      }
      // exit code 0 = stopped normally; non-zero = failed
      live.meta.status = exitCode === 0 || exitCode === undefined ? 'stopped' : 'failed';
      for (const sub of live.statusSubscribers) {
        sub(live.meta.status);
      }
    });

    this.sessions.set(id, { meta, pty, statusSubscribers: new Set() });
    return { ...meta };
  }

  get(id: string): LiveAuthSession | undefined {
    return this.sessions.get(id);
  }

  subscribeStatus(id: string, handler: (status: SessionStatus) => void): void {
    this.sessions.get(id)?.statusSubscribers.add(handler);
  }

  unsubscribeStatus(id: string, handler: (status: SessionStatus) => void): void {
    this.sessions.get(id)?.statusSubscribers.delete(handler);
  }

  // stop all auth session PTYs on shutdown
  stopAll(): void {
    for (const live of this.sessions.values()) {
      if (!live.pty.exited) {
        live.pty.kill();
      }
    }
  }
}

export const sessionManager = new SessionManager();

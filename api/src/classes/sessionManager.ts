// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { config } from './config';
import { PtyProcess } from './ptyProcess';

// types
import type { SessionStatus } from '../@types/index';

// in-memory auth session (e.g. Cursor login PTY) — not persisted to DB
interface AuthSessionMeta {
  id: string;
  title: string;
  status: SessionStatus;
}

/** Idle auth PTYs (512 KB history each) are killed and dropped after this long. */
export const AUTH_SESSION_IDLE_TTL_MS = 10 * 60 * 1000;
/** Exited sessions stay readable briefly so a late viewer still sees the final output. */
export const AUTH_SESSION_EXIT_RETENTION_MS = 60 * 1000;

interface LiveAuthSession {
  meta: AuthSessionMeta;
  pty: PtyProcess;
  statusSubscribers: Set<(status: SessionStatus) => void>;
  idleTimer?: ReturnType<typeof setTimeout>;
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
      this.schedule(id, AUTH_SESSION_EXIT_RETENTION_MS);
    });
    pty.subscribe(() => this.touch(id));

    this.sessions.set(id, { meta, pty, statusSubscribers: new Set() });
    this.touch(id);
    return { ...meta };
  }

  /** Reset the idle TTL (PTY output, client input, a new viewer). */
  touch(id: string): void {
    const live = this.sessions.get(id);
    if (live && !live.pty.exited) {
      this.schedule(id, AUTH_SESSION_IDLE_TTL_MS);
    }
  }

  // kill the PTY (if still running) and forget the session
  remove(id: string): void {
    const live = this.sessions.get(id);
    if (!live) {
      return;
    }
    clearTimeout(live.idleTimer);
    this.sessions.delete(id);
    if (!live.pty.exited) {
      live.pty.kill();
    }
  }

  private schedule(id: string, delayMs: number): void {
    const live = this.sessions.get(id);
    if (!live) {
      return;
    }
    clearTimeout(live.idleTimer);
    live.idleTimer = setTimeout(() => this.remove(id), delayMs);
    live.idleTimer.unref?.();
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
    for (const id of [...this.sessions.keys()]) {
      this.remove(id);
    }
  }
}

export const sessionManager = new SessionManager();

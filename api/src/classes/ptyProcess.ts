// node_modules
import * as nodePty from 'node-pty';

const MAX_BUFFER_BYTES = 512 * 1024; // 512 KB ring buffer

export type OutputHandler = (data: string) => void;

export class PtyProcess {
  private readonly pty: nodePty.IPty;
  private outputBuffer = '';
  private readonly subscribers = new Set<OutputHandler>();
  private _exitCode: number | undefined;
  private _exited = false;
  private readonly exitHandlers = new Set<(code: number | undefined) => void>();

  constructor(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    cols = 220,
    rows = 50
  ) {
    this.pty = nodePty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env
    });

    this.pty.onData((data: string) => {
      // trim the ring buffer to stay within the byte limit
      if (this.outputBuffer.length + data.length > MAX_BUFFER_BYTES) {
        this.outputBuffer = this.outputBuffer.slice(
          this.outputBuffer.length + data.length - MAX_BUFFER_BYTES
        );
      }
      this.outputBuffer += data;
      for (const handler of this.subscribers) {
        handler(data);
      }
    });

    this.pty.onExit(({ exitCode }) => {
      this._exited = true;
      this._exitCode = exitCode ?? undefined;
      for (const handler of this.exitHandlers) {
        handler(this._exitCode);
      }
    });
  }

  write(data: string): void {
    if (!this._exited) {
      this.pty.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (!this._exited) {
      this.pty.resize(cols, rows);
    }
  }

  kill(signal = 'SIGTERM'): void {
    if (!this._exited) {
      this.pty.kill(signal);
    }
  }

  subscribe(handler: OutputHandler): void {
    this.subscribers.add(handler);
  }

  unsubscribe(handler: OutputHandler): void {
    this.subscribers.delete(handler);
  }

  onExit(handler: (code: number | undefined) => void): void {
    this.exitHandlers.add(handler);
  }

  get history(): string {
    return this.outputBuffer;
  }

  get exited(): boolean {
    return this._exited;
  }

  get exitCode(): number | undefined {
    return this._exitCode;
  }
}

/**
 * In-memory WebSocket stand-in for tests. Stub it with
 * `vi.stubGlobal('WebSocket', FakeWebSocket)` and drive the server side via
 * `serverOpen` / `serverMessage` / `serverClose`.
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    public url: string,
    public protocols?: string | string[]
  ) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  /** Starts the close handshake; the test decides when it finishes. */
  close(): void {
    if (this.readyState !== FakeWebSocket.CLOSED) {
      this.readyState = FakeWebSocket.CLOSING;
    }
  }

  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  serverMessage(data: string): void {
    this.onmessage?.({ data });
  }

  serverClose(code = 1006): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

/** Sockets that are open or still connecting. */
export const liveFakeSockets = (): FakeWebSocket[] =>
  FakeWebSocket.instances.filter(
    (ws) => ws.readyState === FakeWebSocket.OPEN || ws.readyState === FakeWebSocket.CONNECTING
  );

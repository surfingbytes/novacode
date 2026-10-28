/**
 * Node.js stream to Web stream adapters for ACP ndJsonStream transports.
 */

export function nodeReadableToWeb(readable: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // A killed subprocess races socket 'error'/'end' events against the consumer
      // (ACP SDK) cancelling the stream — the controller throws on any transition
      // after the first, so every controller call is best-effort.
      readable.on('data', (chunk: Buffer | string) => {
        try {
          controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : new Uint8Array(chunk));
        } catch {
          // stream already closed/cancelled
        }
      });
      readable.on('end', () => {
        try {
          controller.close();
        } catch {
          // stream already closed/cancelled
        }
      });
      readable.on('error', (err) => {
        try {
          controller.error(err);
        } catch {
          // stream already closed/cancelled
        }
      });
    },
  });
}

export function nodeWritableToWeb(writable: NodeJS.WritableStream): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        writable.write(chunk, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        writable.end(resolve);
      });
    },
  });
}

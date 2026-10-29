/**
 * Errors routes throw to answer with a status code. The app error handler in `app.ts`
 * sends `{ error: message }` when `expose` is true, otherwise a generic message.
 */
export class HttpError extends Error {
  statusCode: number;
  /** Whether the message is safe to send to the client. Defaults to true below 500. */
  expose: boolean;

  constructor(statusCode: number, message: string, opts: { expose?: boolean; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.expose = opts.expose ?? statusCode < 500;
  }
}

type HttpErrorOptions = { expose?: boolean; cause?: unknown };

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request', opts?: HttpErrorOptions) {
    super(400, message, opts);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden', opts?: HttpErrorOptions) {
    super(403, message, opts);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found', opts?: HttpErrorOptions) {
    super(404, message, opts);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict', opts?: HttpErrorOptions) {
    super(409, message, opts);
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(message = 'Payload too large', opts?: HttpErrorOptions) {
    super(413, message, opts);
  }
}

/** A dependency (git remote, forge API, agent) failed. Pass `expose: true` for curated messages. */
export class UpstreamError extends HttpError {
  constructor(message = 'Upstream request failed', opts?: HttpErrorOptions) {
    super(502, message, opts);
  }
}

/** Generic client message for a status whose real message is not exposed. */
export function genericErrorMessage(statusCode: number): string {
  if (statusCode === 502) return 'Upstream request failed';
  if (statusCode >= 500) return 'Internal server error';
  return 'Request failed';
}

/**
 * Maps a Node fs error to an HttpError without leaking the absolute path in its message.
 * Errors without a known errno code are returned unchanged (→ 500).
 */
export function fsHttpError(err: unknown): unknown {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  switch (code) {
    case 'ENOENT':
      return new NotFoundError('Path not found', { cause: err });
    case 'EACCES':
    case 'EPERM':
      return new ForbiddenError('Permission denied', { cause: err });
    case 'EEXIST':
    case 'ENOTEMPTY':
      return new ConflictError('A file or folder already exists at that path', { cause: err });
    case 'ENOTDIR':
      return new BadRequestError('Path is not a directory', { cause: err });
    case 'EISDIR':
      return new BadRequestError('Path is a directory', { cause: err });
    case 'ENAMETOOLONG':
      return new BadRequestError('Path is too long', { cause: err });
    default:
      return err;
  }
}

import { describe, expect, it } from 'vitest';

import { ForbiddenError, fsHttpError, HttpError, NotFoundError, UpstreamError } from './httpErrors';

describe('HttpError', () => {
  it('exposes 4xx messages and hides 5xx ones by default', () => {
    expect(new NotFoundError('x')).toMatchObject({ statusCode: 404, expose: true, name: 'NotFoundError' });
    expect(new UpstreamError('x')).toMatchObject({ statusCode: 502, expose: false });
    expect(new UpstreamError('x', { expose: true }).expose).toBe(true);
    expect(new NotFoundError()).toBeInstanceOf(HttpError);
  });
});

describe('fsHttpError', () => {
  const errno = (code: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`${code}: open '/srv/secret/file'`), { code });

  it('maps errno codes to typed errors without the absolute path', () => {
    const notFound = fsHttpError(errno('ENOENT'));
    expect(notFound).toBeInstanceOf(NotFoundError);
    expect((notFound as Error).message).not.toContain('/srv');
    expect(fsHttpError(errno('EACCES'))).toBeInstanceOf(ForbiddenError);
  });

  it('returns unknown errors unchanged', () => {
    const err = errno('EIO');
    expect(fsHttpError(err)).toBe(err);
  });
});

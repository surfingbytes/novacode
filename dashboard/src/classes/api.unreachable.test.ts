// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

import { isApiUnreachableError } from '@/classes/api';

function axiosErrorWithStatus(status: number): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = {
    status,
    data: {},
    statusText: 'Error',
    headers: {},
    config: {} as InternalAxiosRequestConfig
  } as AxiosResponse;
  return error;
}

describe('isApiUnreachableError', () => {
  it('treats dropped connections as unreachable', () => {
    expect(isApiUnreachableError(new AxiosError('Network Error'))).toBe(true);
  });

  it('treats gateway statuses as unreachable so the banner can show', () => {
    expect(isApiUnreachableError(axiosErrorWithStatus(502))).toBe(true);
    expect(isApiUnreachableError(axiosErrorWithStatus(503))).toBe(true);
    expect(isApiUnreachableError(axiosErrorWithStatus(504))).toBe(true);
  });

  it('does not treat application errors as the API being down', () => {
    expect(isApiUnreachableError(axiosErrorWithStatus(401))).toBe(false);
    expect(isApiUnreachableError(axiosErrorWithStatus(404))).toBe(false);
    expect(isApiUnreachableError(axiosErrorWithStatus(500))).toBe(false);
    expect(isApiUnreachableError(new Error('boom'))).toBe(false);
  });
});

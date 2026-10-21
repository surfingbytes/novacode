// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

import { isApiUnreachableError, networkRetryDelayMs } from '@/classes/api';

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

  it('does not treat canceled requests as the API being down', () => {
    const canceled = new AxiosError('canceled', 'ERR_CANCELED');
    canceled.name = 'CanceledError';
    expect(isApiUnreachableError(canceled)).toBe(false);
  });

  it('does not treat application errors as the API being down', () => {
    expect(isApiUnreachableError(axiosErrorWithStatus(401))).toBe(false);
    expect(isApiUnreachableError(axiosErrorWithStatus(404))).toBe(false);
    expect(isApiUnreachableError(axiosErrorWithStatus(500))).toBe(false);
    expect(isApiUnreachableError(new Error('boom'))).toBe(false);
  });
});

function droppedError(config: Partial<InternalAxiosRequestConfig>, code?: string): AxiosError {
  return new AxiosError('Network Error', code ?? 'ERR_NETWORK', config as InternalAxiosRequestConfig);
}

describe('networkRetryDelayMs', () => {
  it('retries dropped GETs with backoff, then gives up', () => {
    expect(networkRetryDelayMs(droppedError({ method: 'get' }))).toBe(400);
    expect(networkRetryDelayMs(droppedError({ method: 'get', networkRetryCount: 1 }))).toBe(1500);
    expect(networkRetryDelayMs(droppedError({ method: 'get', networkRetryCount: 2 }))).toBeNull();
  });

  it('retries POSTs only when they opt in', () => {
    expect(networkRetryDelayMs(droppedError({ method: 'post' }))).toBeNull();
    expect(networkRetryDelayMs(droppedError({ method: 'post', retryOnNetworkError: true }))).toBe(400);
  });

  it('does not retry timeouts, cancels or HTTP error responses', () => {
    expect(networkRetryDelayMs(droppedError({ method: 'get' }, 'ECONNABORTED'))).toBeNull();
    expect(networkRetryDelayMs(droppedError({ method: 'get' }, 'ERR_CANCELED'))).toBeNull();
    const withStatus = axiosErrorWithStatus(502);
    withStatus.config = { method: 'get' } as InternalAxiosRequestConfig;
    expect(networkRetryDelayMs(withStatus)).toBeNull();
  });
});

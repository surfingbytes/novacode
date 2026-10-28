// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { createPinia, setActivePinia } from 'pinia';

import { apiErrorToastMessage, http } from '@/classes/api';
import { useToastStore } from '@/stores/toasts';

function axiosErrorWithStatus(status: number, data: unknown = {}): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = {
    status,
    data,
    statusText: 'Error',
    headers: {},
    config: {} as InternalAxiosRequestConfig
  } as AxiosResponse;
  return error;
}

describe('apiErrorToastMessage', () => {
  it('describes 403 and 5xx responses', () => {
    expect(apiErrorToastMessage(axiosErrorWithStatus(403))).toBe('Forbidden');
    expect(apiErrorToastMessage(axiosErrorWithStatus(500))).toBe('Server error (500)');
    expect(apiErrorToastMessage(axiosErrorWithStatus(507))).toBe('Server error (507)');
  });

  it('appends a string error field from the body', () => {
    expect(apiErrorToastMessage(axiosErrorWithStatus(403, { error: 'Not your workspace' }))).toBe('Forbidden: Not your workspace');
    expect(apiErrorToastMessage(axiosErrorWithStatus(500, { error: 'boom' }))).toBe('Server error (500): boom');
    expect(apiErrorToastMessage(axiosErrorWithStatus(500, { error: { code: 1 } }))).toBe('Server error (500)');
    expect(apiErrorToastMessage(axiosErrorWithStatus(500, 'plain text'))).toBe('Server error (500)');
  });

  it('skips statuses callers or the unreachable banner handle', () => {
    expect(apiErrorToastMessage(axiosErrorWithStatus(400))).toBeNull();
    expect(apiErrorToastMessage(axiosErrorWithStatus(401))).toBeNull();
    expect(apiErrorToastMessage(axiosErrorWithStatus(404))).toBeNull();
    expect(apiErrorToastMessage(axiosErrorWithStatus(409))).toBeNull();
    expect(apiErrorToastMessage(axiosErrorWithStatus(502))).toBeNull();
    expect(apiErrorToastMessage(new AxiosError('Network Error'))).toBeNull();
    expect(apiErrorToastMessage(new Error('boom'))).toBeNull();
  });
});

describe('response interceptor toasts', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function respondWith(status: number, data: unknown): (config: InternalAxiosRequestConfig) => Promise<AxiosResponse> {
    return (config) => {
      const response = { status, data, statusText: 'Error', headers: {}, config } as AxiosResponse;
      return Promise.reject(new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, response));
    };
  }

  it('pushes an error toast and still rejects', async () => {
    const request = http.get('/things', { adapter: respondWith(500, { error: 'db down' }) });
    await expect(request).rejects.toBeInstanceOf(AxiosError);
    expect(useToastStore().toasts.map((toast) => toast.text)).toEqual(['Server error (500): db down']);
  });

  it('leaves 4xx validation errors to the caller', async () => {
    const request = http.post('/things', {}, { adapter: respondWith(400, { error: 'name required' }) });
    await expect(request).rejects.toBeInstanceOf(AxiosError);
    expect(useToastStore().toasts).toEqual([]);
  });
});

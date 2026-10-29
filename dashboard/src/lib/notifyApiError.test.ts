// @vitest-environment jsdom

// node_modules
import { beforeEach, describe, expect, it } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { createPinia, setActivePinia } from 'pinia';

// lib
import { notifyApiError } from '@/lib/notifyApiError';

// stores
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

function toastTexts(): string[] {
  return useToastStore().toasts.map((t) => t.text);
}

describe('notifyApiError', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('does not toast errors the interceptor already toasted', () => {
    notifyApiError(axiosErrorWithStatus(500, { error: 'boom' }), 'Failed');
    notifyApiError(axiosErrorWithStatus(403), 'Failed');
    expect(toastTexts()).toEqual([]);
  });

  it('uses the server error text for a 400', () => {
    notifyApiError(axiosErrorWithStatus(400, { error: 'Name is required' }), 'Failed to save');
    expect(toastTexts()).toEqual(['Name is required']);
  });

  it('uses the detail message of a Fastify validation error', () => {
    notifyApiError(
      axiosErrorWithStatus(400, { statusCode: 400, code: 'FST_ERR_VALIDATION', error: 'Bad Request', message: 'body/name must NOT have fewer than 1 characters' }),
      'Failed to save'
    );
    expect(toastTexts()).toEqual(['body/name must NOT have fewer than 1 characters']);
  });

  it('falls back when the response carries no error text', () => {
    notifyApiError(axiosErrorWithStatus(409, { error: { code: 1 } }), 'Failed to save');
    expect(toastTexts()).toEqual(['Failed to save']);
  });

  it('uses the fallback for a network error', () => {
    const err = new AxiosError('Network Error', AxiosError.ERR_NETWORK);
    notifyApiError(err, 'Failed to save');
    expect(toastTexts()).toEqual(['Failed to save']);
  });

  it('uses the message of a plain Error', () => {
    notifyApiError(new Error('Clipboard denied'), 'Failed');
    notifyApiError('nope', 'Failed');
    expect(toastTexts()).toEqual(['Clipboard denied', 'Failed']);
  });
});

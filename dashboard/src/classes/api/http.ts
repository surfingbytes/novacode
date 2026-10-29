// node_modules
import axios, { isAxiosError } from 'axios';
import { getActivePinia } from 'pinia';

// stores
import { useApiHealthStore } from '@/stores/apiHealth';
import { useToastStore } from '@/stores/toasts';

// ---------------------------------- HTTP ----------------------------------
export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL || location.origin + '/api',
  withCredentials: true
});

function touchApiReachability(ok: boolean): void {
  const pinia = getActivePinia();
  if (!pinia) return;
  const health = useApiHealthStore(pinia);
  if (ok) {
    health.markReachable();
  } else {
    health.markUnreachable();
  }
}

/** Proxy/gateway failures and dropped connections — not application 4xx/500. */
const GATEWAY_UNREACHABLE_STATUSES = new Set([502, 503, 504]);

export function isApiUnreachableError(error: unknown): boolean {
  if (!isAxiosError(error)) {
    return false;
  }
  // Navigation/unmount aborts are not an outage.
  if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') {
    return false;
  }
  if (error.response === undefined) {
    return true;
  }
  return GATEWAY_UNREACHABLE_STATUSES.has(error.response.status);
}

declare module 'axios' {
  interface AxiosRequestConfig {
    /** Retry a non-GET request after a dropped connection (only for side-effect-free calls). */
    retryOnNetworkError?: boolean;
    /** Internal: retries already spent on dropped connections. */
    networkRetryCount?: number;
  }
}

/** Backoff for requests whose connection dropped before any response (browser/proxy blips). */
const NETWORK_RETRY_DELAYS_MS = [400, 1500];

/** Dropped connection with no response — not a timeout, cancel, or HTTP error status. */
function isDroppedConnectionError(error: unknown): boolean {
  if (!isAxiosError(error) || error.response !== undefined) {
    return false;
  }
  if (
    error.code === 'ERR_CANCELED' ||
    error.code === 'ECONNABORTED' ||
    error.code === 'ETIMEDOUT'
  ) {
    return false;
  }
  return true;
}

export function networkRetryDelayMs(error: unknown): number | null {
  if (!isDroppedConnectionError(error) || !isAxiosError(error) || !error.config) {
    return null;
  }
  const method = (error.config.method ?? 'get').toLowerCase();
  const retryable =
    method === 'get' || method === 'head' || error.config.retryOnNetworkError === true;
  if (!retryable) {
    return null;
  }
  return NETWORK_RETRY_DELAYS_MS[error.config.networkRetryCount ?? 0] ?? null;
}

/** Confirm outages via /health so one slow request does not flash the banner. */
let unreachableConfirmInFlight = false;

function confirmApiUnreachable(): void {
  const pinia = getActivePinia();
  if (!pinia || unreachableConfirmInFlight) {
    return;
  }
  unreachableConfirmInFlight = true;
  void useApiHealthStore(pinia)
    .ping()
    .finally(() => {
      unreachableConfirmInFlight = false;
    });
}

/**
 * Called when any non-auth endpoint answers 401 (expired/invalid token
 * mid-session). Registered by App.vue to log out and redirect to /login —
 * kept injectable to avoid a classes/api ⇄ stores/auth import cycle.
 */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** Auth-flow endpoints are allowed to 401 without triggering a global logout. */
function isAuthFlowUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  return (
    url.includes('/auth/login') ||
    url.includes('/auth/setup') ||
    url.includes('/auth/validate') ||
    url.includes('/auth/logout') ||
    url.includes('/auth/login-options') ||
    url.includes('/auth/needs-setup') ||
    url.includes('/auth/oidc/')
  );
}

/**
 * Toast text for responses every caller should surface: 403 and 5xx. Gateway
 * failures (502/503/504) are left to the unreachable banner. Returns null when
 * the error needs no global toast.
 */
export function apiErrorToastMessage(error: unknown): string | null {
  if (!isAxiosError(error) || !error.response || isApiUnreachableError(error)) {
    return null;
  }
  const status = error.response.status;
  if (status !== 403 && status < 500) {
    return null;
  }
  const base = status === 403 ? 'Forbidden' : `Server error (${status})`;
  const body: unknown = error.response.data;
  const detail = body && typeof body === 'object' && 'error' in body ? body.error : undefined;
  return typeof detail === 'string' && detail ? `${base}: ${detail}` : base;
}

/** True when the response interceptor already toasted this error — callers skip their own toast. */
export function isGloballyToasted(error: unknown): boolean {
  return apiErrorToastMessage(error) !== null;
}

function toastApiError(error: unknown): void {
  const message = apiErrorToastMessage(error);
  // Store resolved lazily via the active Pinia — requests can fire before the app mounts.
  const pinia = getActivePinia();
  if (message && pinia) {
    useToastStore(pinia).error(message);
  }
}

http.interceptors.response.use(
  (response) => {
    touchApiReachability(true);
    return response;
  },
  async (error: unknown) => {
    if (isAxiosError(error)) {
      // A dropped connection on an idempotent call is usually a momentary blip:
      // retry quietly before surfacing "Could not reach the server".
      const retryDelayMs = networkRetryDelayMs(error);
      if (retryDelayMs !== null && error.config) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        return http.request({
          ...error.config,
          networkRetryCount: (error.config.networkRetryCount ?? 0) + 1
        });
      }
      if (isApiUnreachableError(error)) {
        // Do not flip the banner from a single timed-out call — confirm with /health.
        confirmApiUnreachable();
      } else if (error.response?.status === 401 && !isAuthFlowUrl(error.config?.url)) {
        onUnauthorized?.();
      } else {
        toastApiError(error);
      }
    }
    // Async handler: throwing rejects with the original error, whatever axios handed us.
    throw error;
  }
);

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!isAxiosError(error)) return fallback;
  const data = error.response?.data;
  if (!data || typeof data !== 'object') return fallback;
  const record = data as Record<string, unknown>;
  for (const key of ['message', 'details', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return fallback;
}

// node_modules
import { isAxiosError } from 'axios';

// classes
import { isGloballyToasted } from '@/classes/api';

// stores
import { useToastStore } from '@/stores/toasts';

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Server-provided error text: `response.data.error` for axios errors, `message` for other errors. */
function extractMessage(err: unknown): string | null {
  if (isAxiosError(err)) {
    const data: unknown = err.response?.data;
    if (!data || typeof data !== 'object') {
      return null;
    }
    const record = data as Record<string, unknown>;
    // Fastify's built-in errors (schema validation etc.) put the HTTP reason in `error` ("Bad Request")
    // and the useful detail in `message`; route handlers send `{ error }` only.
    if (typeof record.statusCode === 'number') {
      return nonEmptyString(record.message) ?? nonEmptyString(record.error);
    }
    return nonEmptyString(record.error);
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return null;
}

/**
 * Toast an API failure unless the response interceptor already did (403/5xx).
 * Uses the server's error text when present, otherwise `fallback`.
 */
export function notifyApiError(err: unknown, fallback: string): void {
  if (isGloballyToasted(err)) {
    return;
  }
  useToastStore().error(extractMessage(err) ?? fallback);
}

export type AgentErrorCode = 'auth_required' | 'rate_limited' | 'timeout' | 'unknown';
export type CursorAuthStatus = 'authenticated' | 'unauthenticated' | 'timeout' | 'error';

export interface ClassifiedAgentError {
  code: AgentErrorCode;
  message: string;
  rawMessage: string;
}

/**
 * Structured JSON-RPC error fields from an ACP `RequestError`. Preferred over message
 * text when present, since the transport code and payload are machine-generated.
 */
export interface AgentErrorDetail {
  message: string;
  /** JSON-RPC error code — see `RequestError` in the ACP SDK. */
  rpcCode?: number;
  /** Structured payload the agent attached to the error. */
  data?: unknown;
}

export interface CursorAuthCheck {
  authenticated: boolean;
  status: CursorAuthStatus;
  message?: string;
}

/** `RequestError.authRequired()` in the ACP SDK. */
const JSON_RPC_AUTH_REQUIRED = -32000;

/**
 * Cursor's backend surfaces capacity/rate-limit failures as the Connect status
 * `resource_exhausted`, wrapped in its own `RetriableError`. Both are generated
 * identifiers rather than prose, so matching them is stable across wording changes.
 * Deliberately narrow: Claude's usage limits have their own reset-time handling and
 * must not be funnelled into the immediate-retry path.
 */
const RESOURCE_EXHAUSTED_TOKEN = /\bresource[_\s-]?exhausted\b/i;
const RETRIABLE_ERROR_NAME = /\bretriableerror\b/i;

function errorParts(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return [value];
  if (value instanceof Error) {
    const parts = [value.name, value.message];
    const maybeCode = (value as Error & { code?: unknown }).code;
    if (typeof maybeCode === 'string') parts.push(maybeCode);
    return parts.filter(Boolean);
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return ['name', 'message', 'code', 'errno', 'syscall']
      .map((key) => record[key])
      .filter((part): part is string => typeof part === 'string' && part.length > 0);
  }
  return [String(value)];
}

export function errorText(value: unknown): string {
  return errorParts(value).join('\n').trim();
}

/**
 * Pull machine-readable fields off an ACP `RequestError` (or anything shaped like one)
 * before callers flatten the error to a string.
 */
export function extractAgentErrorDetail(value: unknown): AgentErrorDetail {
  if (value == null) {
    return { message: 'Agent run failed' };
  }

  if (typeof value === 'string') {
    return { message: value };
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const rpcCode = typeof record.code === 'number' ? record.code : undefined;
    const data = 'data' in record ? record.data : undefined;
    const message = errorText(value) || 'Agent run failed';
    return { message, rpcCode, data };
  }

  return { message: String(value) };
}

function detailText(detail: AgentErrorDetail | undefined, fallback: unknown): string {
  if (detail?.message?.trim()) return detail.message.trim();
  return errorText(fallback);
}

function collectStatusTokens(value: unknown, into: Set<string>, depth = 0): void {
  if (value == null || depth > 4) return;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) into.add(trimmed);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    into.add(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStatusTokens(item, into, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['code', 'status', 'statusCode', 'error', 'name', 'type', 'reason']) {
      if (key in record) collectStatusTokens(record[key], into, depth + 1);
    }
  }
}

export function isTimeoutError(value: unknown): boolean {
  const text = errorText(value).toLowerCase();
  return (
    /\betimedout\b/.test(text) ||
    /\btimed?\s+out\b/.test(text) ||
    /\btimeout\b/.test(text) ||
    /\btimeouterror\b/.test(text) ||
    /\baborterror\b/.test(text) ||
    /\brun timed out\b/.test(text)
  );
}

export function isAuthRequiredError(
  value: unknown,
  detail?: AgentErrorDetail
): boolean {
  if (detail?.rpcCode === JSON_RPC_AUTH_REQUIRED) return true;

  const text = detailText(detail, value).toLowerCase();
  return (
    /\bnot authenticated\b/.test(text) ||
    /\bnot logged in\b/.test(text) ||
    /\blogin required\b/.test(text) ||
    /\bauthentication required\b/.test(text) ||
    /\bunauthenticated\b/.test(text)
  );
}

/**
 * Detect Cursor capacity/rate-limit failures from structured fields first, then
 * from machine status tokens (`resource_exhausted`, `RetriableError`) in the payload.
 */
export function isRateLimitedError(
  value: unknown,
  detail?: AgentErrorDetail
): boolean {
  const tokens = new Set<string>();
  collectStatusTokens(detail?.data, tokens);
  if (detail?.rpcCode != null) tokens.add(String(detail.rpcCode));

  for (const token of tokens) {
    if (RESOURCE_EXHAUSTED_TOKEN.test(token) || RETRIABLE_ERROR_NAME.test(token)) {
      return true;
    }
  }

  const text = detailText(detail, value);
  return RESOURCE_EXHAUSTED_TOKEN.test(text) || RETRIABLE_ERROR_NAME.test(text);
}

export function classifyAgentError(
  value: unknown,
  opts?: {
    fallbackMessage?: string;
    agentLabel?: string;
    detail?: AgentErrorDetail;
  }
): ClassifiedAgentError {
  const detail = opts?.detail ?? (typeof value === 'object' && value != null
    ? extractAgentErrorDetail(value)
    : undefined);
  const rawMessage =
    detailText(detail, value) || opts?.fallbackMessage || 'Agent run failed';
  const agentLabel = opts?.agentLabel ?? 'Agent';

  if (isTimeoutError(rawMessage) || isTimeoutError(value)) {
    return {
      code: 'timeout',
      rawMessage,
      message: `${agentLabel} did not respond before the timeout. The run was stopped; try again when ${agentLabel} is responsive.`
    };
  }

  if (isAuthRequiredError(value, detail)) {
    return {
      code: 'auth_required',
      rawMessage,
      message: `${agentLabel} CLI is not authenticated. Log in, then try again.`
    };
  }

  if (isRateLimitedError(value, detail)) {
    return {
      code: 'rate_limited',
      rawMessage,
      message: `${agentLabel} is temporarily rate-limited or out of capacity. Wait a moment, then try again.`
    };
  }

  return {
    code: 'unknown',
    rawMessage,
    message: rawMessage
  };
}

export function cursorAuthTimeoutCheck(): CursorAuthCheck {
  return {
    authenticated: false,
    status: 'timeout',
    message: 'Cursor CLI did not respond in time. It may be busy; check again in a moment.'
  };
}

export function cursorAuthErrorCheck(message = 'Could not verify Cursor CLI authentication.'): CursorAuthCheck {
  return {
    authenticated: false,
    status: 'error',
    message
  };
}

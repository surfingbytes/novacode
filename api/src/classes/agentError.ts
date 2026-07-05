export type AgentErrorCode = 'auth_required' | 'timeout' | 'unknown';
export type CursorAuthStatus = 'authenticated' | 'unauthenticated' | 'timeout' | 'error';

export interface ClassifiedAgentError {
  code: AgentErrorCode;
  message: string;
  rawMessage: string;
}

export interface CursorAuthCheck {
  authenticated: boolean;
  status: CursorAuthStatus;
  message?: string;
}

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

export function isAuthRequiredError(value: unknown): boolean {
  const text = errorText(value).toLowerCase();
  return (
    /\bnot authenticated\b/.test(text) ||
    /\bnot logged in\b/.test(text) ||
    /\blogin required\b/.test(text) ||
    /\bauthentication required\b/.test(text) ||
    /\bunauthenticated\b/.test(text)
  );
}

export function classifyAgentError(
  value: unknown,
  opts?: { fallbackMessage?: string; agentLabel?: string }
): ClassifiedAgentError {
  const rawMessage = errorText(value) || opts?.fallbackMessage || 'Agent run failed';
  const agentLabel = opts?.agentLabel ?? 'Agent';

  if (isTimeoutError(value)) {
    return {
      code: 'timeout',
      rawMessage,
      message: `${agentLabel} did not respond before the timeout. The run was stopped; try again when ${agentLabel} is responsive.`
    };
  }

  if (isAuthRequiredError(value)) {
    return {
      code: 'auth_required',
      rawMessage,
      message: `${agentLabel} CLI is not authenticated. Log in, then try again.`
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

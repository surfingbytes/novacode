import { resolveCorsOrigin } from './corsOrigin';

/** Close code sent when a WebSocket upgrade comes from a disallowed Origin. */
export const WS_CLOSE_ORIGIN_NOT_ALLOWED = 4003;

function headerValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * Cross-site WebSocket hijacking guard. Browsers always send `Origin` on WS
 * upgrades; non-browser clients (CLI, API keys) usually don't.
 * Allowed: no Origin, origin in the `resolveCorsOrigin()` allowlist (or CORS
 * reflects any origin), or origin host equal to the request's own host.
 */
export function isAllowedWsOrigin(
  request: { headers?: Record<string, unknown> },
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const origin = headerValue(request.headers?.['origin'])?.trim();
  if (!origin) {
    return true;
  }
  const allowed = resolveCorsOrigin(env);
  if (allowed === true) {
    return true;
  }
  if (Array.isArray(allowed) && allowed.includes(origin)) {
    return true;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const ownHosts = [request.headers?.['host'], request.headers?.['x-forwarded-host']]
    .map(headerValue)
    .flatMap((value) => (value ? value.split(',') : []))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return ownHosts.includes(originHost);
}

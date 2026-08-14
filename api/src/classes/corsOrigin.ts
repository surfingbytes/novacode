/**
 * CORS origin for @fastify/cors.
 * - unset + production: false (same-origin only; API serves the dashboard)
 * - unset + non-production: true (reflect request origin for Vite dev)
 * - `*`: reflect any origin
 * - comma-separated list: allow those origins
 */
export function resolveCorsOrigin(
  env: NodeJS.ProcessEnv = process.env
): boolean | string[] {
  const raw = env['CORS_ORIGIN']?.trim();
  if (!raw) {
    return env['NODE_ENV'] === 'production' ? false : true;
  }
  if (raw === '*') {
    return true;
  }
  return raw.split(',').map((origin) => origin.trim()).filter(Boolean);
}

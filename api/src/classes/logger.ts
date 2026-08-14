import pino from 'pino';

const DEFAULT_LEVEL =
  process.env['VITEST'] || process.env['NODE_ENV'] === 'test'
    ? 'warn'
    : process.env['NODE_ENV'] === 'production'
      ? 'info'
      : 'debug';

export const logger = pino({
  level: process.env['LOG_LEVEL']?.trim() || DEFAULT_LEVEL,
  base: { service: 'novacode-api' }
});

/** Truncate agent stderr / error strings so logs never dump full stream bodies. */
export function truncateLogText(text: string, max = 240): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max)}…`;
}

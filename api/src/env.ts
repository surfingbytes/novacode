/**
 * Resolves PostgreSQL connection URL from `DATABASE_URL` or from `POSTGRES_*` parts.
 * User/password are URL-encoded for special characters in passwords.
 */
export function resolveDatabaseUrl(): string {
  const explicit = process.env['DATABASE_URL']?.trim();
  if (explicit) return explicit;

  const user = process.env['POSTGRES_USER'];
  const password = process.env['POSTGRES_PASSWORD'];
  const db = process.env['POSTGRES_DB'];
  const host = process.env['POSTGRES_HOST'] ?? 'localhost';
  const port = process.env['POSTGRES_PORT'] ?? '5432';

  if (!user || !password || !db) {
    throw new Error(
      'Set DATABASE_URL, or POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB (and optionally POSTGRES_HOST, POSTGRES_PORT)'
    );
  }

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
}

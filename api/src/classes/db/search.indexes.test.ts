import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// searchCatalog runs ILIKE '%q%' on these columns; the trgm GIN indexes keep it off sequential scans.
const PRISMA_DIR = resolve(__dirname, '../../../prisma');
const MIGRATION = resolve(PRISMA_DIR, 'migrations/20261029100000_search_trgm_indexes/migration.sql');

const INDEXES: Array<{ name: string; table: string; column: string; field: string }> = [
  { name: 'idx_session_messages_content_trgm', table: 'session_messages', column: 'content', field: 'content' },
  { name: 'idx_session_messages_search_text_trgm', table: 'session_messages', column: 'search_text', field: 'searchText' },
  { name: 'idx_sessions_name_trgm', table: 'sessions', column: 'name', field: 'name' },
  { name: 'idx_sessions_last_preview_trgm', table: 'sessions', column: 'last_preview_text', field: 'lastPreviewText' },
  { name: 'idx_orchestrators_name_trgm', table: 'orchestrators', column: 'name', field: 'name' },
  { name: 'idx_workspaces_name_trgm', table: 'workspaces', column: 'name', field: 'name' }
];

describe('search trigram indexes', () => {
  const sql = readFileSync(MIGRATION, 'utf8');
  const schema = readFileSync(resolve(PRISMA_DIR, 'schema.prisma'), 'utf8');

  it('migration enables pg_trgm', () => {
    expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  });

  it.each(INDEXES)('migration creates $name', ({ name, table, column }) => {
    expect(sql).toContain(
      `CREATE INDEX IF NOT EXISTS "${name}" ON "${table}" USING GIN ("${column}" gin_trgm_ops);`
    );
  });

  it.each(INDEXES)('schema.prisma mirrors $name', ({ name, field }) => {
    expect(schema).toContain(`@@index([${field}(ops: raw("gin_trgm_ops"))], type: Gin, map: "${name}")`);
  });
});

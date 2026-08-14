import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    testTimeout: 10_000,
    // CI has no Postgres env; unit tests that import database.ts need a URL at module load.
    env: {
      DATABASE_URL:
        process.env['DATABASE_URL']?.trim() ||
        'postgresql://postgres:postgres@127.0.0.1:5432/novacode'
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
});

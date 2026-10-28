// node_modules
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// classes
import { ensureDatabaseUrl } from '../../env';
import { PrismaClient } from '../../generated/client/client';

ensureDatabaseUrl();

// --------------------------------------------- Setup ---------------------------------------------

function getDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('DATABASE_URL is not set (ensureDatabaseUrl should run first)');
  }
  return url;
}

const pool = new Pool({ connectionString: getDatabaseUrl() });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

// --------------------------------------------- Health ---------------------------------------------

export async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export const healthDb = {
  pingDatabase
};

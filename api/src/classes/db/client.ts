// node_modules
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// classes
import { config } from '../config';
import { PrismaClient } from '../../generated/client/client';

// --------------------------------------------- Setup ---------------------------------------------

// The URL is passed straight to pg; it is never written to process.env.
const pool = new Pool({ connectionString: config.databaseUrl });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter });

// --------------------------------------------- Health ---------------------------------------------

async function pingDatabase(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export const healthDb = {
  pingDatabase
};

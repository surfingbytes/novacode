// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { hashApiToken, MAX_API_TOKENS_PER_USER } from '../apiTokens';
import { logger } from '../logger';
import { prisma } from './client';

// types
import type { UserModel } from '../../generated/client/models';

// --------------------------------------------- Users & API tokens ---------------------------------------------

const API_TOKEN_TOUCH_INTERVAL_MS = 60_000;
const apiTokenTouchedAt = new Map<string, number>();

export async function hasAnyUser(): Promise<boolean> {
  const count = await prisma.user.count();
  return count > 0;
}

export async function getUserByUsername(username: string): Promise<UserModel | null> {
  return prisma.user.findUnique({ where: { username } });
}

export async function getUserById(id: string): Promise<UserModel | null> {
  return prisma.user.findUnique({ where: { id } });
}

export async function getFirstUser(): Promise<UserModel | null> {
  return prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
}

export async function listUsers(): Promise<UserModel[]> {
  return prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
}

export async function createUser(username: string, passwordHash: string): Promise<UserModel> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  return prisma.user.create({ data: { id, username, passwordHash, createdAt } });
}

export async function updateUser(
  id: string,
  patch: {
    username?: string;
    passwordHash?: string;
    gitUserName?: string | null;
    gitUserEmail?: string | null;
    theme?: string;
    autoTheme?: boolean;
    darkTheme?: string;
    lightTheme?: string;
    modelSelection?: string;
    claudeToken?: string | null;
    utilityAgentType?: string | null;
    utilityModelSelection?: string;
  }
): Promise<UserModel | undefined> {
  const existingUser = await prisma.user.findUnique({ where: { id } });
  if (!existingUser) {
    return undefined;
  }
  return prisma.user.update({ where: { id }, data: patch });
}

export async function getUserByApiToken(token: string): Promise<UserModel | null> {
  const tokenHash = hashApiToken(token);
  const row = await prisma.apiToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });
  if (!row) {
    return null;
  }
  const now = Date.now();
  const previous = apiTokenTouchedAt.get(row.id) ?? 0;
  if (now - previous >= API_TOKEN_TOUCH_INTERVAL_MS) {
    apiTokenTouchedAt.set(row.id, now);
    void prisma.apiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date().toISOString() } })
      .catch((err) => logger.warn({ err, tokenId: row.id }, 'Failed to update API token lastUsedAt'));
  }
  return row.user;
}

export async function listApiTokens(userId: string): Promise<
  Array<{ id: string; name: string; tokenPrefix: string; createdAt: string; lastUsedAt: string | null }>
> {
  return prisma.apiToken.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, tokenPrefix: true, createdAt: true, lastUsedAt: true }
  });
}

export async function countApiTokens(userId: string): Promise<number> {
  return prisma.apiToken.count({ where: { userId } });
}

export async function createApiToken(data: {
  userId: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
}): Promise<{ id: string; name: string; tokenPrefix: string; createdAt: string; lastUsedAt: string | null }> {
  const count = await prisma.apiToken.count({ where: { userId: data.userId } });
  if (count >= MAX_API_TOKENS_PER_USER) {
    throw new Error(`At most ${MAX_API_TOKENS_PER_USER} API keys are allowed`);
  }
  const createdAt = new Date().toISOString();
  return prisma.apiToken.create({
    data: {
      id: randomUUID(),
      userId: data.userId,
      name: data.name,
      tokenHash: data.tokenHash,
      tokenPrefix: data.tokenPrefix,
      createdAt
    },
    select: { id: true, name: true, tokenPrefix: true, createdAt: true, lastUsedAt: true }
  });
}

export async function deleteApiToken(userId: string, tokenId: string): Promise<boolean> {
  const result = await prisma.apiToken.deleteMany({ where: { id: tokenId, userId } });
  return result.count > 0;
}

export const userDb = {
  hasAnyUser,
  getUserByUsername,
  getUserById,
  getFirstUser,
  listUsers,
  createUser,
  updateUser,
  getUserByApiToken,
  listApiTokens,
  countApiTokens,
  createApiToken,
  deleteApiToken
};

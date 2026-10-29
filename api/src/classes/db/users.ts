// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { hashApiToken, MAX_API_TOKENS_PER_USER } from '../apiTokens';
import { decrypt, encrypt } from '../encryption';
import { logger } from '../logger';
import { prisma } from './client';

// types
import type { UserModel } from '../../generated/client/models';

// --------------------------------------------- Users & API tokens ---------------------------------------------

const API_TOKEN_TOUCH_INTERVAL_MS = 60_000;
const apiTokenTouchedAt = new Map<string, number>();

/** Marks an encrypted `claude_token`; rows without it are legacy plaintext. */
const ENCRYPTED_TOKEN_PREFIX = 'enc:v1:';

function isEncryptedToken(stored: string): boolean {
  return stored.startsWith(ENCRYPTED_TOKEN_PREFIX);
}

async function encryptClaudeToken(token: string | null): Promise<string | null> {
  return token ? ENCRYPTED_TOKEN_PREFIX + (await encrypt(token)) : token;
}

/**
 * Plaintext Claude token for callers. Legacy rows hold plaintext and are returned as-is
 * (re-encrypted on the next `updateUser`). An encrypted value that no longer decrypts
 * (key changed) yields null so the user is asked to log in again.
 */
async function decryptClaudeToken(stored: string | null, userId: string): Promise<string | null> {
  if (!stored || !isEncryptedToken(stored)) {
    return stored;
  }
  try {
    return await decrypt(stored.slice(ENCRYPTED_TOKEN_PREFIX.length));
  } catch (err) {
    logger.warn({ err, userId }, 'Failed to decrypt stored Claude token; treating it as absent');
    return null;
  }
}

async function withPlainClaudeToken<T extends UserModel | null>(user: T): Promise<T> {
  if (!user?.claudeToken) {
    return user;
  }
  return { ...user, claudeToken: await decryptClaudeToken(user.claudeToken, user.id) };
}

async function hasAnyUser(): Promise<boolean> {
  const count = await prisma.user.count();
  return count > 0;
}

async function getUserByUsername(username: string): Promise<UserModel | null> {
  return withPlainClaudeToken(await prisma.user.findUnique({ where: { username } }));
}

export async function getUserById(id: string): Promise<UserModel | null> {
  return withPlainClaudeToken(await prisma.user.findUnique({ where: { id } }));
}

export async function getFirstUser(): Promise<UserModel | null> {
  return withPlainClaudeToken(await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } }));
}

export async function listUsers(): Promise<UserModel[]> {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  return Promise.all(users.map((user) => withPlainClaudeToken(user)));
}

async function createUser(username: string, passwordHash: string): Promise<UserModel> {
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
  const data = { ...patch };
  if (patch.claudeToken !== undefined) {
    data.claudeToken = await encryptClaudeToken(patch.claudeToken);
  } else if (existingUser.claudeToken && !isEncryptedToken(existingUser.claudeToken)) {
    // Legacy plaintext row: encrypt it on this write.
    data.claudeToken = await encryptClaudeToken(existingUser.claudeToken);
  }
  return withPlainClaudeToken(await prisma.user.update({ where: { id }, data }));
}

async function getUserByApiToken(token: string): Promise<UserModel | null> {
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
  return withPlainClaudeToken(row.user);
}

async function listApiTokens(userId: string): Promise<
  Array<{ id: string; name: string; tokenPrefix: string; createdAt: string; lastUsedAt: string | null }>
> {
  return prisma.apiToken.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, tokenPrefix: true, createdAt: true, lastUsedAt: true }
  });
}

async function countApiTokens(userId: string): Promise<number> {
  return prisma.apiToken.count({ where: { userId } });
}

async function createApiToken(data: {
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

async function deleteApiToken(userId: string, tokenId: string): Promise<boolean> {
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

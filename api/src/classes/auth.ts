// node_modules
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { timingSafeEqual, scryptSync, randomBytes } from 'node:crypto';

// classes
import { config } from './config';
import { db } from './database';
import { extractWsToken } from './wsToken';
import { isApiKeyToken } from './apiTokens';

// types
import type { UserModel } from '../generated/client/models';

export { extractWsToken };

interface JwtPayload {
  username: string;
  id: string;
  iat: number;
  exp: number;
}

// --------------------------------------------- Functions ---------------------------------------------

async function getJwtSecret(): Promise<string> {
  if (!config.jwtSecret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return config.jwtSecret;
}

export async function signToken(username: string, id: string): Promise<string> {
  const secret = await getJwtSecret();
  return jwt.sign({ username, id }, secret, { expiresIn: '30d' });
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const secret = await getJwtSecret();
  return jwt.verify(token, secret) as JwtPayload;
}

export async function authenticateToken(
  token: string
): Promise<{ id: string; username: string } | null> {
  if (!token) {
    return null;
  }
  if (isApiKeyToken(token)) {
    const user = await db.getUserByApiToken(token);
    return user ? { id: user.id, username: user.username } : null;
  }
  try {
    const payload = await verifyToken(token);
    let user = await db.getUserById(payload.id);
    if (!user) {
      user = await db.getUserByUsername(payload.username);
    }
    if (!user) {
      return null;
    }
    return { id: user.id, username: user.username };
  } catch {
    return null;
  }
}

/** Close a WebSocket with 4001 when the bearer subprotocol is missing or invalid. */
export async function rejectUnauthorizedWebSocket(
  socket: { close: (code?: number, reason?: string) => void },
  request: { headers?: Record<string, unknown> }
): Promise<boolean> {
  const token = extractWsToken(request);
  if (!token) {
    socket.close(4001, 'Missing token');
    return true;
  }
  const user = await authenticateToken(token);
  if (!user) {
    socket.close(4001, 'Invalid token');
    return true;
  }
  return false;
}

// constant-time string comparison to prevent timing attacks
function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) {
      return false;
    }
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, 'hex');
  const hash = scryptSync(password, salt, 64);
  return timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

export async function checkCredentials(
  username: string,
  password: string
): Promise<UserModel | null> {
  const user = await db.getUserByUsername(username);
  if (!user) {
    return null;
  }
  if (!safeEqual(username, user.username)) {
    return null;
  }
  if (!verifyPassword(password, user.passwordHash)) {
    return null;
  }
  return user;
}

export async function createAuthUser(username: string, password: string): Promise<UserModel> {
  const passwordHash = hashPassword(password);
  return db.createUser(username, passwordHash);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const user = await db.getUserById(userId);
  if (!user || !verifyPassword(currentPassword, user.passwordHash)) {
    return false;
  }
  const passwordHash = hashPassword(newPassword);
  const updated = await db.updateUser(userId, { passwordHash });
  return !!updated;
}

export async function changeUsername(
  userId: string,
  newUsername: string
): Promise<UserModel | null> {
  const user = await db.getUserById(userId);
  if (!user) {
    return null;
  }
  const trimmed = newUsername.trim();
  if (!trimmed) {
    return null;
  }
  const existing = await db.getUserByUsername(trimmed);
  if (existing && existing.id !== userId) {
    return null;
  }
  const updated = await db.updateUser(userId, { username: trimmed });
  if (!updated) {
    return null;
  }
  return updated;
}

export function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers['authorization'];
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice(7);
}

// validates JWT or API key and attaches user info to the request
export async function jwtPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractBearerToken(request);
  if (!token) {
    await reply.code(401).send({ error: 'Missing authorization token' });
    return;
  }
  const user = await authenticateToken(token);
  if (!user) {
    await reply.code(401).send({ error: 'Invalid or expired token' });
    return;
  }
  request.jwtUser = { id: user.id, username: user.username };
}

export function registerAuth(fastify: FastifyInstance): void {
  // T is nullable so `null` satisfies the initial value constraint in Fastify v5
  fastify.decorateRequest<{ username: string } | null>('jwtUser', null);
  fastify.decorate('verifyJwt', jwtPreHandler);
}

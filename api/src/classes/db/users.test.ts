// node_modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      create: vi.fn()
    },
    $executeRaw: vi.fn(),
    $transaction: vi.fn()
  }
}));

vi.mock('./client', () => ({ prisma: prismaMock }));

// classes
import { encrypt } from '../encryption';
import { getFirstUser, getUserById, listUsers, updateUser, userDb } from './users';

const KEY_HEX = 'a'.repeat(64);

function userRow(claudeToken: string | null): Record<string, unknown> {
  return { id: 'user-1', username: 'admin', claudeToken };
}

beforeEach(() => {
  process.env['ENCRYPTION_KEY'] = KEY_HEX;
});

afterEach(() => {
  delete process.env['ENCRYPTION_KEY'];
  vi.clearAllMocks();
});

describe('claude token encryption at rest', () => {
  it('encrypts the token on write and returns plaintext to the caller', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow(null));
    prismaMock.user.update.mockImplementation(async ({ data }: { data: { claudeToken: string } }) =>
      userRow(data.claudeToken)
    );

    const updated = await updateUser('user-1', { claudeToken: 'sk-ant-oat-secret' });

    const stored = prismaMock.user.update.mock.calls[0]![0].data.claudeToken as string;
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain('sk-ant-oat-secret');
    expect(updated?.claudeToken).toBe('sk-ant-oat-secret');
  });

  it('decrypts the stored token on read', async () => {
    const stored = `enc:v1:${await encrypt('sk-ant-oat-secret')}`;
    prismaMock.user.findUnique.mockResolvedValue(userRow(stored));
    prismaMock.user.findFirst.mockResolvedValue(userRow(stored));
    prismaMock.user.findMany.mockResolvedValue([userRow(stored), userRow(null)]);

    expect((await getUserById('user-1'))?.claudeToken).toBe('sk-ant-oat-secret');
    expect((await getFirstUser())?.claudeToken).toBe('sk-ant-oat-secret');
    expect((await listUsers()).map((user) => user.claudeToken)).toEqual(['sk-ant-oat-secret', null]);
  });

  it('returns a legacy plaintext token as-is', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow('sk-ant-legacy'));

    expect((await getUserById('user-1'))?.claudeToken).toBe('sk-ant-legacy');
  });

  it('re-encrypts a legacy plaintext token on the next write', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow('sk-ant-legacy'));
    prismaMock.user.update.mockImplementation(async ({ data }: { data: { claudeToken: string } }) =>
      userRow(data.claudeToken)
    );

    const updated = await updateUser('user-1', { theme: 'dark' });

    const data = prismaMock.user.update.mock.calls[0]![0].data as { theme: string; claudeToken: string };
    expect(data.theme).toBe('dark');
    expect(data.claudeToken).toMatch(/^enc:v1:/);
    expect(updated?.claudeToken).toBe('sk-ant-legacy');
  });

  it('stores null when the token is cleared', async () => {
    prismaMock.user.findUnique.mockResolvedValue(userRow('enc:v1:whatever'));
    prismaMock.user.update.mockResolvedValue(userRow(null));

    await updateUser('user-1', { claudeToken: null });

    expect(prismaMock.user.update.mock.calls[0]![0].data.claudeToken).toBeNull();
  });

  it('treats an encrypted token that no longer decrypts as absent', async () => {
    const stored = `enc:v1:${await encrypt('sk-ant-oat-secret')}`;
    process.env['ENCRYPTION_KEY'] = 'b'.repeat(64);
    prismaMock.user.findUnique.mockResolvedValue(userRow(stored));

    expect((await getUserById('user-1'))?.claudeToken).toBeNull();
  });
});

describe('createFirstUser', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock));
    prismaMock.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
  });

  it('takes the setup lock before checking for users, then creates the account', async () => {
    prismaMock.user.count.mockResolvedValue(0);

    const user = await userDb.createFirstUser('admin', 'hash');

    expect(user).toMatchObject({ username: 'admin', passwordHash: 'hash' });
    const lockOrder = prismaMock.$executeRaw.mock.invocationCallOrder[0]!;
    expect(lockOrder).toBeLessThan(prismaMock.user.count.mock.invocationCallOrder[0]!);
    expect(String(prismaMock.$executeRaw.mock.calls[0]![0])).toContain('pg_advisory_xact_lock');
  });

  it('returns null without creating when an account already exists', async () => {
    prismaMock.user.count.mockResolvedValue(1);

    expect(await userDb.createFirstUser('second', 'hash')).toBeNull();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

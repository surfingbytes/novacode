// node_modules
import { afterEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { workspace: { delete: vi.fn() } }
}));

vi.mock('./client', () => ({ prisma: prismaMock }));

// classes
import { Prisma } from '../../generated/client/client';
import { deleteWorkspace } from './workspaces';

afterEach(() => {
  vi.clearAllMocks();
});

describe('deleteWorkspace', () => {
  it('reports success', async () => {
    prismaMock.workspace.delete.mockResolvedValue({ id: 'w1' });
    expect(await deleteWorkspace('w1')).toEqual({ ok: true });
  });

  it('reports not_found for a missing row', async () => {
    prismaMock.workspace.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('No record found', { code: 'P2025', clientVersion: 'test' })
    );
    expect(await deleteWorkspace('missing')).toEqual({ ok: false, reason: 'not_found' });
  });

  it('reports error for any other failure', async () => {
    const error = new Error('connection lost');
    prismaMock.workspace.delete.mockRejectedValue(error);
    expect(await deleteWorkspace('w1')).toEqual({ ok: false, reason: 'error', error });
  });
});

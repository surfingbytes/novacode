// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { Prisma } from '../../generated/client/client';
import { prisma } from './client';
import { FavoriteLimitError, normalizeTagStringList } from './shared';
import { MAX_FAVORITE_WORKSPACES } from '@novacode/shared';

// types
import type { WorkspaceModel as Workspace } from '../../generated/client/models/Workspace';

// --------------------------------------------- Workspaces ---------------------------------------------

async function listWorkspaces(opts?: { includeArchived?: boolean }): Promise<Workspace[]> {
  const rows = await prisma.workspace.findMany({
    where: opts?.includeArchived ? undefined : { archived: false },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
  });
  return rows;
}

async function getWorkspace(id: string): Promise<Workspace | undefined> {
  const row = await prisma.workspace.findUnique({ where: { id } });
  return row ?? undefined;
}

async function createWorkspace(data: {
  name: string;
  path: string;
  group?: string | null;
  gitUserName?: string | null;
  gitUserEmail?: string | null;
  color?: string | null;
  defaultAgentType?: string | null;
  tags?: string[] | null;
  forgeConnectionId?: string | null;
  forgeRepo?: string | null;
}): Promise<Workspace> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const maxSort = await prisma.workspace.aggregate({ _max: { sortOrder: true } });
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
  const tagsArr =
    data.tags != null && Array.isArray(data.tags)
      ? normalizeTagStringList(data.tags)
      : null;
  const tagsJson =
    tagsArr !== null && tagsArr.length > 0 ? tagsArr : Prisma.JsonNull;
  const row = await prisma.workspace.create({
    data: {
      id,
      name: data.name,
      path: data.path,
      group: data.group?.trim() || null,
      createdAt,
      gitUserName: data.gitUserName ?? null,
      gitUserEmail: data.gitUserEmail ?? null,
      color: data.color ?? null,
      sortOrder,
      defaultAgentType: data.defaultAgentType ?? null,
      tags: tagsJson,
      forgeConnectionId: data.forgeConnectionId ?? null,
      forgeRepo: data.forgeRepo ?? null
    }
  });
  return row;
}

async function updateWorkspace(
  id: string,
  patch: {
    name?: string;
    path?: string;
    group?: string | null;
    gitUserName?: string | null;
    gitUserEmail?: string | null;
    color?: string | null;
    defaultAgentType?: string | null;
    tags?: string[] | null;
    isFavorite?: boolean;
    /** null clears the override (back to remote auto-detect). */
    forgeConnectionId?: string | null;
    forgeRepo?: string | null;
  }
): Promise<Workspace | undefined> {
  const existingWorkspace = await getWorkspace(id);
  if (!existingWorkspace) {
    return undefined;
  }
  const tagsArr =
    patch.tags !== undefined
      ? Array.isArray(patch.tags)
        ? normalizeTagStringList(patch.tags)
        : null
      : undefined;
  const tagsJson =
    tagsArr === undefined
      ? undefined
      : tagsArr === null || tagsArr.length === 0
        ? Prisma.JsonNull
        : tagsArr;

  let favoritePatch: { isFavorite?: boolean; favoriteOrder?: number | null } = {};
  if (patch.isFavorite !== undefined && patch.isFavorite !== existingWorkspace.isFavorite) {
    if (patch.isFavorite) {
      if (existingWorkspace.archived) {
        throw new FavoriteLimitError('Archived workspaces cannot be favorited');
      }
      const favoriteCount = await prisma.workspace.count({
        where: { isFavorite: true, archived: false }
      });
      if (favoriteCount >= MAX_FAVORITE_WORKSPACES) {
        throw new FavoriteLimitError(
          `At most ${MAX_FAVORITE_WORKSPACES} favorite workspaces are allowed`
        );
      }
      const maxOrder = await prisma.workspace.aggregate({
        where: { isFavorite: true },
        _max: { favoriteOrder: true }
      });
      favoritePatch = {
        isFavorite: true,
        favoriteOrder: (maxOrder._max.favoriteOrder ?? -1) + 1
      };
    } else {
      favoritePatch = { isFavorite: false, favoriteOrder: null };
    }
  }

  const row = await prisma.workspace.update({
    where: { id },
    data: {
      name: patch.name ?? existingWorkspace.name,
      path: patch.path ?? existingWorkspace.path,
      group: patch.group !== undefined ? (patch.group?.trim() || null) : existingWorkspace.group,
      gitUserName: patch.gitUserName ?? existingWorkspace.gitUserName,
      gitUserEmail: patch.gitUserEmail ?? existingWorkspace.gitUserEmail,
      color: patch.color ?? existingWorkspace.color,
      defaultAgentType: patch.defaultAgentType ?? existingWorkspace.defaultAgentType,
      ...(tagsJson !== undefined && { tags: tagsJson }),
      ...(patch.forgeConnectionId !== undefined && { forgeConnectionId: patch.forgeConnectionId }),
      ...(patch.forgeRepo !== undefined && { forgeRepo: patch.forgeRepo }),
      ...favoritePatch
    }
  });
  return row;
}

async function reorderWorkspaces(ids: string[]): Promise<void> {
  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.workspace.update({ where: { id }, data: { sortOrder: index } })
    )
  );
}

async function archiveWorkspace(id: string, archived: boolean): Promise<Workspace | undefined> {
  const existingWorkspace = await prisma.workspace.findUnique({ where: { id } });
  if (!existingWorkspace) {
    return undefined;
  }
  return prisma.workspace.update({
    where: { id },
    data: {
      archived,
      ...(archived ? { isFavorite: false, favoriteOrder: null } : {})
    }
  });
}

export type DeleteWorkspaceResult = { ok: true } | { ok: false; reason: 'not_found' } | { ok: false; reason: 'error'; error: unknown };

export async function deleteWorkspace(id: string): Promise<DeleteWorkspaceResult> {
  try {
    await prisma.workspace.delete({ where: { id } });
    return { ok: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return { ok: false, reason: 'not_found' };
    }
    return { ok: false, reason: 'error', error };
  }
}

export const workspaceDb = {
  listWorkspaces,
  getWorkspace,
  createWorkspace,
  updateWorkspace,
  reorderWorkspaces,
  archiveWorkspace,
  deleteWorkspace
};

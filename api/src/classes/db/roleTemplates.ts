// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { prisma } from './client';

// types
import type { RoleTemplateModel as RoleTemplate } from '../../generated/client/models/RoleTemplate';

// --------------------------------------------- Role Templates ---------------------------------------------

export async function listRoleTemplates(): Promise<RoleTemplate[]> {
  return prisma.roleTemplate.findMany({
    orderBy: [{ name: 'asc' }, { createdAt: 'asc' }]
  });
}

export async function getRoleTemplate(id: string): Promise<RoleTemplate | undefined> {
  const row = await prisma.roleTemplate.findUnique({ where: { id } });
  return row ?? undefined;
}

export async function findRoleTemplateByName(name: string): Promise<RoleTemplate | undefined> {
  const trimmed = name?.trim();
  if (!trimmed) {
    return undefined;
  }
  const row = await prisma.roleTemplate.findUnique({ where: { name: trimmed } });
  return row ?? undefined;
}

export async function createRoleTemplate(data: {
  name: string;
  description?: string | null;
  content: string;
}): Promise<RoleTemplate> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  return prisma.roleTemplate.create({
    data: {
      id,
      name: data.name.trim(),
      description: data.description ?? null,
      content: data.content,
      createdAt
    }
  });
}

export async function updateRoleTemplate(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    content?: string;
  }
): Promise<RoleTemplate | undefined> {
  const existing = await prisma.roleTemplate.findUnique({ where: { id } });
  if (!existing) {
    return undefined;
  }
  const data: {
    name?: string;
    description?: string | null;
    content?: string;
    updatedAt: string;
  } = {
    updatedAt: new Date().toISOString()
  };
  if (patch.name !== undefined) {
    data.name = patch.name.trim();
  }
  if (patch.description !== undefined) {
    data.description = patch.description;
  }
  if (patch.content !== undefined) {
    data.content = patch.content;
  }
  return prisma.roleTemplate.update({
    where: { id },
    data
  });
}

export async function deleteRoleTemplate(id: string): Promise<boolean> {
  try {
    await prisma.roleTemplate.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export const roleTemplateDb = {
  listRoleTemplates,
  getRoleTemplate,
  findRoleTemplateByName,
  createRoleTemplate,
  updateRoleTemplate,
  deleteRoleTemplate
};

// node_modules
import { randomUUID } from 'node:crypto';

// classes
import { prisma } from './client';

// types
import type { PushSubscriptionModel as PushSubscription } from '../../generated/client/models/PushSubscription';

// --------------------------------------------- Push Subscriptions ---------------------------------------------

export async function upsertPushSubscription(data: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Omitted = keep the stored preference (defaults: tasks on, CI off). */
  notifyTasks?: boolean;
  notifyCi?: boolean;
}): Promise<PushSubscription> {
  const prefs = {
    ...(data.notifyTasks !== undefined && { notifyTasks: data.notifyTasks }),
    ...(data.notifyCi !== undefined && { notifyCi: data.notifyCi })
  };
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: data.endpoint }
  });
  if (existing) {
    return prisma.pushSubscription.update({
      where: { endpoint: data.endpoint },
      data: {
        userId: data.userId,
        p256dh: data.p256dh,
        auth: data.auth,
        ...prefs
      }
    });
  }
  return prisma.pushSubscription.create({
    data: {
      id: randomUUID(),
      userId: data.userId,
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth: data.auth,
      createdAt: new Date().toISOString(),
      ...prefs
    }
  });
}

export async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

export async function listPushSubscriptionsByUser(userId: string): Promise<PushSubscription[]> {
  return prisma.pushSubscription.findMany({ where: { userId } });
}

export async function listPushSubscriptions(kind?: 'task' | 'ci'): Promise<PushSubscription[]> {
  if (kind === 'task') return prisma.pushSubscription.findMany({ where: { notifyTasks: true } });
  if (kind === 'ci') return prisma.pushSubscription.findMany({ where: { notifyCi: true } });
  return prisma.pushSubscription.findMany();
}

export async function hasCiPushSubscriptions(): Promise<boolean> {
  return (await prisma.pushSubscription.count({ where: { notifyCi: true } })) > 0;
}

export const pushDb = {
  upsertPushSubscription,
  deletePushSubscriptionByEndpoint,
  listPushSubscriptionsByUser,
  listPushSubscriptions,
  hasCiPushSubscriptions
};

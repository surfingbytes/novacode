// node_modules
import webpush from 'web-push';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// classes
import { db } from './database';
import { config } from './config';

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  /** Small monochrome icon URL (Android status bar) */
  badge?: string;
}

function markdownToPlainText(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/[#*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(input: string, maxLen = 280): string {
  const normalized = markdownToPlainText(input);
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen - 1)}…`;
}

const VAPID_KEYS_FILE = 'vapid-keys.json';
/** Web Push contact — VAPID subject claim (mailto: or https: URL). */
const VAPID_SUBJECT = 'mailto:admin@localhost';

let vapidKeys: { publicKey: string; privateKey: string } | null = null;

/**
 * Loads keys from the JSON file in the config dir, or generates and saves them
 * on first use. Idempotent; safe to call from startup and lazily from getters.
 */
export function ensureVapidKeys(): void {
  if (vapidKeys) {
    return;
  }

  const filePath = join(config.configDir, VAPID_KEYS_FILE);

  if (existsSync(filePath)) {
    try {
      const raw = readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw) as { publicKey?: string; privateKey?: string };
      if (data.publicKey && data.privateKey) {
        vapidKeys = { publicKey: data.publicKey, privateKey: data.privateKey };
        return;
      }
    } catch {
      // fall through to generate
    }
  }

  const keys = webpush.generateVAPIDKeys();
  const dir = config.configDir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(keys, null, 2) + '\n', 'utf8');
  vapidKeys = { publicKey: keys.publicKey, privateKey: keys.privateKey };
  console.log(`[push] Generated VAPID keys and saved to ${filePath}`);
}

function getVapidKeys(): { publicKey: string; privateKey: string } | null {
  if (!vapidKeys) {
    ensureVapidKeys();
  }
  return vapidKeys;
}

let configured = false;

function ensureConfigured(): boolean {
  if (configured) {
    return true;
  }
  const keys = getVapidKeys();
  if (!keys) {
    return false;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  return getVapidKeys()?.publicKey ?? null;
}

export async function sendPushToAll(payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) {
    return;
  }
  const subscriptions = await db.listPushSubscriptions();
  if (subscriptions.length === 0) {
    return;
  }

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: payload.tag,
    url: payload.url ?? '/',
    icon: '/favicon.ico',
    badge: payload.badge ?? '/notification-badge.png'
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          message
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await db.deletePushSubscriptionByEndpoint(sub.endpoint);
        }
      }
    })
  );
}

export async function sendTaskDonePush(
  sessionName: string,
  workspaceName: string,
  agentLastMessage: string
): Promise<void> {
  const context = [workspaceName, sessionName || 'Session'].filter(Boolean).join(' • ');
  await sendPushToAll({
    title: `Task finished: ${context}`,
    body: compactText(agentLastMessage || context || 'Task finished'),
    tag: 'task-done',
    url: '/'
  });
}

export function isPushConfigured(): boolean {
  return getVapidPublicKey() !== null;
}


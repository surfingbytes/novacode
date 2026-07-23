// classes
import { pushApi } from '@/classes/api';

const STORAGE_KEY = 'notificationsEnabled';
const DEFAULT_ICON = '/favicon.ico';
/** Android status bar / collapsed notification — should be white-on-transparent, ~96×96 */
const DEFAULT_BADGE = '/notification-badge.png';
const REPLY_ACTION_ID = 'reply';

type ExtendedNotificationOptions = NotificationOptions & {
  data?: { url?: string };
  actions?: Array<{ action: string; title: string; icon?: string }>;
  requireInteraction?: boolean;
};

export function isNotificationsEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(enabled));
}

export function canRequestPermission(): boolean {
  return 'Notification' in window;
}

export function getPermissionState(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) return 'denied';
  return Notification.requestPermission();
}

function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = window.atob(padded);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

function extractKeys(sub: PushSubscription): { p256dh: string; auth: string } | null {
  const p256dh = sub.getKey('p256dh');
  const auth = sub.getKey('auth');
  if (!p256dh || !auth) return null;
  const toBase64 = (arr: ArrayBuffer): string => {
    const bytes = new Uint8Array(arr);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return window.btoa(binary);
  };
  return { p256dh: toBase64(p256dh), auth: toBase64(auth) };
}

export async function syncPushSubscription(enabled: boolean): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();

  if (!enabled || Notification.permission !== 'granted') {
    if (existing) {
      try {
        await pushApi.unsubscribe(existing.endpoint);
      } catch {
        // ignore backend sync errors
      }
      await existing.unsubscribe();
    }
    return;
  }

  const { data } = await pushApi.getPublicKey();
  if (!data.enabled || !data.publicKey) return;

  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(data.publicKey)
    }));

  const keys = extractKeys(subscription);
  if (!keys) return;
  await pushApi.subscribe({ endpoint: subscription.endpoint, keys });
}

async function showNotification(title: string, options: ExtendedNotificationOptions): Promise<void> {
  if (!isNotificationsEnabled()) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  // Android PWAs require service-worker backed notifications.
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        ...options,
        badge: options.badge ?? DEFAULT_BADGE
      } as NotificationOptions);
      return;
    } catch {
      // Fall through to window notifications when SW is not ready.
    }
  }

  const notification = new Notification(title, {
    ...options,
    badge: options.badge ?? DEFAULT_BADGE
  } as NotificationOptions);
  notification.onclick = () => {
    const targetUrl = typeof options.data === 'object' ? (options.data as { url?: string }).url : undefined;
    if (targetUrl) {
      window.location.href = targetUrl;
    }
    window.focus();
    notification.close();
  };
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
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

export function notifyTaskDone(
  sessionName: string,
  workspaceName: string | undefined,
  agentLastMessage: string,
  workspaceId: string,
  sessionId: string
): void {
  const context = [workspaceName, sessionName || 'Session'].filter(Boolean).join(' • ');
  const body = compactText(agentLastMessage || context || 'Task finished');
  const sessionUrl = `/workspace/${encodeURIComponent(workspaceId)}/session/${encodeURIComponent(sessionId)}`;
  void showNotification(`Task finished: ${context}`, {
    body,
    icon: DEFAULT_ICON,
    tag: 'task-done',
    data: { url: sessionUrl },
    actions: [{ action: REPLY_ACTION_ID, title: 'Reply' }],
    requireInteraction: true
  });
}

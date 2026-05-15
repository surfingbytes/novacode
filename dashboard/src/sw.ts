/// <reference lib="webworker" />

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;
type SwNotificationAction = { action: string; title: string; icon?: string };

clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload: {
    title?: string;
    body?: string;
    tag?: string;
    icon?: string;
    /** Small monochrome icon (status bar / collapsed) on Android */
    badge?: string;
    url?: string;
    actions?: SwNotificationAction[];
  } = {};
  try {
    payload = event.data.json() as typeof payload;
  } catch {
    payload = { body: event.data.text() };
  }

  const title = payload.title || 'Nova Code';
  const options = {
    body: payload.body || '',
    tag: payload.tag,
    icon: payload.icon || '/favicon.ico',
    badge: payload.badge || '/notification-badge.png',
    data: { url: payload.url || '/' },
    actions: payload.actions ?? [{ action: 'reply', title: 'Reply' }],
    requireInteraction: true
  } as NotificationOptions;

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: string } | undefined;
  const target = data?.url || '/';
  const action = event.action;
  const shouldFocusAndNavigate = action === '' || action === 'reply';
  if (!shouldFocusAndNavigate) {
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          void client.focus();
          if ('navigate' in client) {
            void client.navigate(target);
          }
          return;
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

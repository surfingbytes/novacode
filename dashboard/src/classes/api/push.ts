import { http } from './http';

// ---------------------------------- Push notifications ----------------------------------
export const pushApi = {
  getPublicKey: (): ReturnType<typeof http.get<{ enabled: boolean; publicKey: string | null }>> =>
    http.get<{ enabled: boolean; publicKey: string | null }>('/push/public-key'),

  subscribe: (subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    notifyTasks?: boolean;
    notifyCi?: boolean;
  }): ReturnType<typeof http.post<{ ok: boolean }>> =>
    http.post<{ ok: boolean }>('/push/subscribe', subscription),

  unsubscribe: (endpoint: string): ReturnType<typeof http.post<{ ok: boolean }>> =>
    http.post<{ ok: boolean }>('/push/unsubscribe', { endpoint })
};

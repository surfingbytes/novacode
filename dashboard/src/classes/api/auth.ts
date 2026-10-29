import { http } from './http';

// types
import type { ApiToken, CreatedApiToken } from '@/@types/index';

// ---------------------------------- Auth ----------------------------------
export type AuthLoginOptions = {
  needsSetup: boolean;
  localLogin: boolean;
  oidcEnabled: boolean;
  oidcDisplayName: string;
};

export const authApi = {
  needsSetup: (): ReturnType<typeof http.get<{ needsSetup: boolean }>> =>
    http.get<{ needsSetup: boolean }>('/auth/needs-setup'),

  loginOptions: (): ReturnType<typeof http.get<AuthLoginOptions>> =>
    http.get<AuthLoginOptions>('/auth/login-options'),

  setup: (username: string, password: string): ReturnType<typeof http.post<{ token: string }>> =>
    http.post<{ token: string }>('/auth/setup', { username, password }),

  login: (username: string, password: string): ReturnType<typeof http.post<{ token: string }>> =>
    http.post<{ token: string }>('/auth/login', { username, password }),

  validate: (): ReturnType<typeof http.post<{ valid: boolean; username: string }>> =>
    http.post<{ valid: boolean; username: string }>('/auth/validate', undefined, {
      // Bound the wait — a timeout is treated as "stay logged in" by the caller.
      timeout: 10000
    }),

  logout: (): ReturnType<typeof http.post<void>> => http.post('/auth/logout'),

  changePassword: (
    currentPassword: string,
    newPassword: string
  ): ReturnType<typeof http.put<{ ok: boolean }>> =>
    http.put<{ ok: boolean }>('/auth/change-password', {
      currentPassword,
      newPassword
    }),

  changeUsername: (newUsername: string): ReturnType<typeof http.put<{ token: string }>> =>
    http.put<{ token: string }>('/auth/change-username', { newUsername }),

  listApiTokens: (): ReturnType<typeof http.get<ApiToken[]>> =>
    http.get<ApiToken[]>('/auth/api-tokens'),

  createApiToken: (name: string): ReturnType<typeof http.post<CreatedApiToken>> =>
    http.post<CreatedApiToken>('/auth/api-tokens', { name }),

  deleteApiToken: (id: string): ReturnType<typeof http.delete> =>
    http.delete(`/auth/api-tokens/${id}`)
};

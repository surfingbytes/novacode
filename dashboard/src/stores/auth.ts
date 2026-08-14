// node_modules
import { defineStore } from 'pinia';
import { isAxiosError } from 'axios';
import { ref } from 'vue';

// classes
import { authApi } from '@/classes/api';

const SIGNED_IN_KEY = 'nova:signedIn';
const LEGACY_TOKEN_KEY = 'token';

function readSignedInFlag(): boolean {
  try {
    if (localStorage.getItem(SIGNED_IN_KEY) === '1') {
      return true;
    }
    if (localStorage.getItem(LEGACY_TOKEN_KEY)) {
      localStorage.setItem(SIGNED_IN_KEY, '1');
      return true;
    }
  } catch {
    // ignore quota / private mode
  }
  return false;
}

export const useAuthStore = defineStore('auth', () => {
  // -------------------------------------------------- Refs --------------------------------------------------
  const bSignedIn = ref<boolean>(readSignedInFlag());
  const username = ref<string | null>(null);
  const bValidated = ref<boolean>(false);

  function persistSignedIn(name: string): void {
    bSignedIn.value = true;
    bValidated.value = true;
    username.value = name;
    try {
      localStorage.setItem(SIGNED_IN_KEY, '1');
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch {
      // ignore quota / private mode
    }
  }

  // -------------------------------------------------- Methods --------------------------------------------------
  const login = async (usernameInput: string, passwordInput: string): Promise<boolean> => {
    try {
      await authApi.login(usernameInput, passwordInput);
      persistSignedIn(usernameInput);
      return true;
    } catch {
      return false;
    }
  };

  const validate = async (): Promise<boolean> => {
    try {
      const response = await authApi.validate();
      if (response.data.valid) {
        persistSignedIn(response.data.username);
        return true;
      }
      logout();
      return false;
    } catch (error: unknown) {
      if (isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401 || status === 403) {
          logout();
          return false;
        }
      }
      // Server restart/network issue: keep the signed-in hint if we had one.
      return bSignedIn.value;
    }
  };

  const setToken = (_newToken: string, newUsername: string): void => {
    persistSignedIn(newUsername);
  };

  const logout = (): void => {
    void authApi.logout().catch(() => {
      // cookie clear is best-effort; local state still drops
    });
    bSignedIn.value = false;
    username.value = null;
    bValidated.value = false;
    try {
      localStorage.removeItem(SIGNED_IN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch {
      // ignore quota / private mode
    }
  };

  // -------------------------------------------------- Export --------------------------------------------------
  return {
    // data
    /** @deprecated use bSignedIn; kept so older checks keep working */
    token: bSignedIn,
    bSignedIn,
    username,
    bValidated,
    // methods
    login,
    validate,
    setToken,
    logout
  };
});

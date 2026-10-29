// node_modules
import { defineStore } from 'pinia';
import { isAxiosError } from 'axios';
import { ref } from 'vue';

// classes
import { authApi } from '@/classes/api';
import { safeGetItem, safeRemoveItem, safeSetItem } from '@/lib/safeLocalStorage';
import { clearAllUserLocalState } from '@/lib/sessionLocalState';

// stores
import { useNotificationsStore } from '@/stores/notifications';
import { useOrchestratorsStore } from '@/stores/orchestrators';
import { useSessionSpecsStore } from '@/stores/sessionSpecs';
import { useToastStore } from '@/stores/toasts';
import { useWorkspacesStore } from '@/stores/workspaces';

const SIGNED_IN_KEY = 'nova:signedIn';
const LEGACY_TOKEN_KEY = 'token';

function readSignedInFlag(): boolean {
  if (safeGetItem(SIGNED_IN_KEY) === '1') {
    return true;
  }
  if (safeGetItem(LEGACY_TOKEN_KEY)) {
    safeSetItem(SIGNED_IN_KEY, '1');
    return true;
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
    safeSetItem(SIGNED_IN_KEY, '1');
    safeRemoveItem(LEGACY_TOKEN_KEY);
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
    safeRemoveItem(SIGNED_IN_KEY);
    safeRemoveItem(LEGACY_TOKEN_KEY);
    // Drop the previous user's data and sockets so the next login starts clean
    // and the sessions socket reconnects with the new cookie.
    useWorkspacesStore().reset();
    useOrchestratorsStore().reset();
    useSessionSpecsStore().reset();
    useToastStore().reset();
    useNotificationsStore().reset();
    clearAllUserLocalState();
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

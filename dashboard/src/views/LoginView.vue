<script setup lang="ts">
// node_modules
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// stores
import { useAuthStore } from '@/stores/auth';

// classes
import { authApi } from '@/classes/api';

// -------------------------------------------------- Store --------------------------------------------------
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

// -------------------------------------------------- Constants --------------------------------------------------
const OIDC_ERROR_MESSAGES: Record<string, string> = {
  oidc: 'Sign-in with SSO failed. Try again.',
  oidc_denied: 'Sign-in was cancelled.',
  oidc_config: 'SSO is not available right now.'
};

// -------------------------------------------------- Refs --------------------------------------------------
const bSetupLoading = ref<boolean>(true);
const bLocalLogin = ref<boolean>(true);
const bOidcEnabled = ref<boolean>(false);
const oidcDisplayName = ref<string>('SSO');
const bOidcRedirecting = ref<boolean>(false);

const username = ref<string>('');
const password = ref<string>('');
const bLoading = ref<boolean>(false);
const error = ref<string>('');

// -------------------------------------------------- Computed --------------------------------------------------
const redirectTarget = computed((): string => {
  const redirect = route.query.redirect;
  if (typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')) {
    return redirect;
  }
  return '/';
});

const submitDisabled = computed((): boolean => {
  if (!username.value || !password.value) {
    return true;
  }
  return false;
});

const queryError = computed((): string => {
  const code = route.query.error;
  if (typeof code !== 'string' || !code) {
    return '';
  }
  return OIDC_ERROR_MESSAGES[code] ?? OIDC_ERROR_MESSAGES.oidc;
});

const bShowPasswordForm = computed((): boolean => bLocalLogin.value && !bOidcRedirecting.value);

const bShowOidcButton = computed(
  (): boolean => bOidcEnabled.value && !bOidcRedirecting.value
);

const bNoLoginMethod = computed(
  (): boolean => !bSetupLoading.value && !bLocalLogin.value && !bOidcEnabled.value
);

// -------------------------------------------------- Methods --------------------------------------------------
function oidcStartHref(): string {
  const apiBase = String(import.meta.env.VITE_API_URL || `${location.origin}/api`).replace(
    /\/?$/,
    '/'
  );
  const url = new URL('auth/oidc/start', apiBase);
  if (redirectTarget.value !== '/') {
    url.searchParams.set('redirect', redirectTarget.value);
  }
  return url.toString();
}

const startOidc = (): void => {
  window.location.assign(oidcStartHref());
};

const goAfterSignIn = async (): Promise<void> => {
  await router.push(redirectTarget.value);
};

const submit = async (): Promise<void> => {
  if (submitDisabled.value) {
    return;
  }
  bLoading.value = true;
  error.value = '';

  const success = await auth.login(username.value, password.value);
  bLoading.value = false;
  if (success) {
    await goAfterSignIn();
  } else {
    error.value = 'Invalid username or password';
    password.value = '';
  }
};

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted(async (): Promise<void> => {
  try {
    const response = await authApi.loginOptions();
    if (response.data.needsSetup) {
      await router.push('/setup');
      return;
    }
    bLocalLogin.value = response.data.localLogin;
    bOidcEnabled.value = response.data.oidcEnabled;
    oidcDisplayName.value = response.data.oidcDisplayName;

    const signedIn = await auth.validate();
    if (signedIn) {
      await goAfterSignIn();
      return;
    }

    if (queryError.value) {
      error.value = queryError.value;
    } else if (route.query.from === 'oidc') {
      error.value = OIDC_ERROR_MESSAGES.oidc;
    } else if (response.data.oidcEnabled && !response.data.localLogin) {
      bOidcRedirecting.value = true;
      startOidc();
      return;
    }
  } catch {
    error.value = 'Unable to reach the server. Try again.';
  } finally {
    bSetupLoading.value = false;
  }
});
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-bg p-4 relative overflow-hidden">
    <!-- Ambient background glows -->
    <div class="pointer-events-none fixed inset-0 overflow-hidden">
      <div
        class="absolute -top-60 -right-60 w-[500px] h-[500px] bg-primary/10 rounded-full blur-3xl"
      ></div>
      <div
        class="absolute -bottom-60 -left-60 w-[500px] h-[500px] bg-primary/10 rounded-full blur-3xl"
      ></div>
      <div
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/5 rounded-full blur-3xl"
      ></div>
    </div>

    <div class="relative w-full max-w-sm">
      <Transition name="card" appear>
        <div class="bg-surface border border-border rounded-lg p-8">
          <!-- Logo -->
          <svg
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Nova Code"
            class="w-24 h-24 ms-auto me-auto text-primary"
          >
            <path
              d="M17 7.82959L18.6965 9.35641C20.239 10.7447 21.0103 11.4389 21.0103 12.3296C21.0103 13.2203 20.239 13.9145 18.6965 15.3028L17 16.8296"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
            <path
              d="M13.9868 5L12.9934 8.70743M11.8432 13L10.0132 19.8297"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
            <path
              d="M7.00005 7.82959L5.30358 9.35641C3.76102 10.7447 2.98975 11.4389 2.98975 12.3296C2.98975 13.2203 3.76102 13.9145 5.30358 15.3028L7.00005 16.8296"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>

          <!-- Welcome text -->
          <h1 class="text-xl font-semibold text-center mb-2">Welcome to Nova Code</h1>
          <p class="text-sm text-text-muted text-center mb-8">
            {{ bOidcRedirecting ? `Redirecting to ${oidcDisplayName}…` : 'Sign in to continue' }}
          </p>

          <div v-if="bSetupLoading || bOidcRedirecting" class="flex justify-center py-8">
            <div
              class="w-8 h-8 border-2 border-surface border-t-primary rounded-full animate-spin"
            ></div>
          </div>

          <p v-else-if="bNoLoginMethod" class="message is-error">
            No sign-in method is configured. Enable password login or OIDC.
          </p>

          <div v-else class="space-y-4">
            <form v-if="bShowPasswordForm" @submit.prevent="submit" class="space-y-4">
              <div class="field" :class="{ 'has-error': error }">
                <label class="block text-sm font-medium text-text-primary mb-1.5">Username</label>
                <div class="input-wrap is-error">
                  <input
                    v-model="username"
                    type="text"
                    autocomplete="username"
                    placeholder="Enter your username"
                    autofocus
                  />
                  <span class="icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </span>
                </div>
              </div>
              <div class="field" :class="{ 'has-error': error }">
                <label class="block text-sm font-medium text-text-primary mb-1.5">Password</label>
                <div class="input-wrap">
                  <input
                    v-model="password"
                    type="password"
                    autocomplete="current-password"
                    placeholder="••••••••"
                  />
                  <span class="icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                  </span>
                </div>
              </div>

              <p v-if="error" class="message is-error">
                {{ error }}
              </p>

              <button
                type="submit"
                :disabled="submitDisabled || bLoading"
                class="button is-primary w-full items-center justify-center mt-2"
              >
                <div v-if="bLoading" class="loading-spinner"></div>
                <span> Sign In </span>
              </button>
            </form>

            <div
              v-if="bShowPasswordForm && bShowOidcButton"
              class="flex items-center gap-3 text-xs text-text-muted uppercase tracking-wider"
            >
              <span class="h-px flex-1 bg-border"></span>
              <span>or</span>
              <span class="h-px flex-1 bg-border"></span>
            </div>

            <p v-if="error && !bShowPasswordForm" class="message is-error">
              {{ error }}
            </p>

            <button
              v-if="bShowOidcButton"
              type="button"
              class="button w-full items-center justify-center"
              @click="startOidc"
            >
              Sign in with {{ oidcDisplayName }}
            </button>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

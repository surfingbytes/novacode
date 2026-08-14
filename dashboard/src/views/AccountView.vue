<script setup lang="ts">
// node_modules
import { onMounted, ref } from 'vue';

// stores
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toasts';

// components
import PageShell from '@/components/layout/PageShell.vue';
import ConfirmModal from '@/components/ConfirmModal.vue';

// classes
import { apiErrorMessage, authApi } from '@/classes/api';
import { relativeTimeShort } from '@/utils/relativeTime';
import { passwordLengthError, requiredTrimmed } from '@/utils/formValidation';
import { useInlineFieldErrors } from '@/composables/useInlineFieldErrors';

// types
import type { ApiToken, CreatedApiToken } from '@/@types/index';

// -------------------------------------------------- Refs --------------------------------------------------
const authStore = useAuthStore();
const accountNewUsername = ref<string>('');
const accountCurrentPassword = ref<string>('');
const accountNewPassword = ref<string>('');
const accountConfirmPassword = ref<string>('');
const bChangingUsername = ref<boolean>(false);
const bChangingPassword = ref<boolean>(false);
const accountUsernameError = ref<string>('');
const accountPasswordError = ref<string>('');
const bAccountUsernameSuccess = ref<boolean>(false);
const bAccountPasswordSuccess = ref<boolean>(false);
const apiTokens = ref<ApiToken[]>([]);
const newApiTokenName = ref<string>('');
const createdApiToken = ref<CreatedApiToken | null>(null);
const bLoadingApiTokens = ref<boolean>(false);
const bCreatingApiToken = ref<boolean>(false);
const bRevokingApiToken = ref<boolean>(false);
const tokenToRevoke = ref<ApiToken | null>(null);
const toastStore = useToastStore();

const { errors: usernameFieldErrors, touch: touchUsername, onInput: onUsernameInput, validateAll: validateUsername, reset: resetUsername } =
  useInlineFieldErrors({
    username: () => {
      const next = accountNewUsername.value.trim();
      if (!next) {
        return requiredTrimmed(accountNewUsername.value, 'Username');
      }
      if (next === authStore.username) {
        return 'New username is the same as current.';
      }
      return undefined;
    }
  });

const {
  errors: passwordFieldErrors,
  touch: touchPassword,
  onInput: onPasswordInput,
  validateAll: validatePassword,
  reset: resetPassword
} = useInlineFieldErrors({
  current: () => requiredTrimmed(accountCurrentPassword.value, 'Current password'),
  next: () =>
    requiredTrimmed(accountNewPassword.value, 'New password') ??
    passwordLengthError(accountNewPassword.value),
  confirm: () => {
    if (!accountConfirmPassword.value) {
      return 'Confirm your new password';
    }
    if (accountConfirmPassword.value !== accountNewPassword.value) {
      return 'New password and confirmation do not match.';
    }
    return undefined;
  }
});

// -------------------------------------------------- Methods --------------------------------------------------
const changeUsername = async (): Promise<void> => {
  accountUsernameError.value = '';
  bAccountUsernameSuccess.value = false;
  if (!validateUsername()) {
    return;
  }
  const newUsername = accountNewUsername.value.trim();
  bChangingUsername.value = true;
  try {
    const response = await authApi.changeUsername(newUsername);
    authStore.setToken(response.data.token, newUsername);
    accountNewUsername.value = '';
    resetUsername();
    bAccountUsernameSuccess.value = true;
    setTimeout(() => {
      bAccountUsernameSuccess.value = false;
    }, 3000);
  } catch (err: unknown) {
    const msg =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
    accountUsernameError.value = msg ?? 'Failed to change username.';
  } finally {
    bChangingUsername.value = false;
  }
};

const changePassword = async (): Promise<void> => {
  accountPasswordError.value = '';
  bAccountPasswordSuccess.value = false;
  if (!validatePassword()) {
    return;
  }
  const current = accountCurrentPassword.value;
  const newP = accountNewPassword.value;
  bChangingPassword.value = true;
  try {
    await authApi.changePassword(current, newP);
    accountCurrentPassword.value = '';
    accountNewPassword.value = '';
    accountConfirmPassword.value = '';
    resetPassword();
    bAccountPasswordSuccess.value = true;
    setTimeout(() => {
      bAccountPasswordSuccess.value = false;
    }, 3000);
  } catch (err: unknown) {
    const msg =
      err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
    accountPasswordError.value = msg ?? 'Failed to change password.';
  } finally {
    bChangingPassword.value = false;
  }
};

async function loadApiTokens(): Promise<void> {
  bLoadingApiTokens.value = true;
  try {
    const response = await authApi.listApiTokens();
    apiTokens.value = response.data;
  } catch (err: unknown) {
    toastStore.error(apiErrorMessage(err, 'Failed to load API keys'));
  } finally {
    bLoadingApiTokens.value = false;
  }
}

async function createApiToken(): Promise<void> {
  const name = newApiTokenName.value.trim();
  if (!name) {
    return;
  }
  bCreatingApiToken.value = true;
  try {
    const response = await authApi.createApiToken(name);
    createdApiToken.value = response.data;
    newApiTokenName.value = '';
    apiTokens.value = [response.data, ...apiTokens.value];
  } catch (err: unknown) {
    toastStore.error(apiErrorMessage(err, 'Failed to create API key'));
  } finally {
    bCreatingApiToken.value = false;
  }
}

async function copyCreatedToken(): Promise<void> {
  const token = createdApiToken.value?.token;
  if (!token) {
    return;
  }
  try {
    await navigator.clipboard.writeText(token);
    toastStore.success('API key copied');
  } catch {
    toastStore.error('Could not copy API key');
  }
}

async function confirmRevokeApiToken(): Promise<void> {
  const target = tokenToRevoke.value;
  if (!target) {
    return;
  }
  bRevokingApiToken.value = true;
  try {
    await authApi.deleteApiToken(target.id);
    apiTokens.value = apiTokens.value.filter((token) => token.id !== target.id);
    tokenToRevoke.value = null;
    toastStore.success('API key revoked');
  } catch (err: unknown) {
    toastStore.error(apiErrorMessage(err, 'Failed to revoke API key'));
  } finally {
    bRevokingApiToken.value = false;
  }
}

onMounted(() => {
  void loadApiTokens();
});
</script>

<template>
  <PageShell>
    <div class="mb-6">
      <h1 class="text-xl font-semibold text-text-primary">Account</h1>
      <p class="text-sm text-text-muted mt-1">
        Change your username, password, or API keys. You will stay signed in after changing username.
      </p>
    </div>

    <div class="space-y-8">
      <!-- Change username -->
      <div class="box bg-surface!">
        <h2 class="text-md font-semibold text-text-primary mb-3">Change username</h2>
        <hr />
        <p class="message is-info mb-3">Current: {{ authStore.username ?? '—' }}</p>
        <div class="field">
          <div class="label">New username</div>
          <div class="input-wrap">
            <span class="icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            <input
              v-model="accountNewUsername"
              type="text"
              placeholder="New username"
              :disabled="bChangingUsername"
              :aria-invalid="Boolean(usernameFieldErrors.username)"
              aria-describedby="account-username-error"
              @blur="touchUsername('username')"
              @input="onUsernameInput('username')"
            />
          </div>
          <p
            v-if="usernameFieldErrors.username || accountUsernameError"
            id="account-username-error"
            class="hint is-error"
          >
            {{ usernameFieldErrors.username || accountUsernameError }}
          </p>
        </div>
        <div class="flex justify-end mt-4">
          <button
            class="button is-primary"
            :disabled="bChangingUsername || !accountNewUsername.trim()"
            @click="changeUsername"
          >
            <div v-if="bChangingUsername" class="loading-spinner"></div>
            Update username
          </button>
        </div>
        <p v-if="bAccountUsernameSuccess" class="message is-success mt-2">Username updated.</p>
      </div>

      <!-- Change password -->
      <div class="box bg-surface!">
        <h2 class="text-md font-semibold text-text-primary mb-3">Change password</h2>
        <hr />
        <div class="field">
          <div class="label">Current password</div>
          <div class="input-wrap">
            <span class="icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </span>
            <input
              v-model="accountCurrentPassword"
              type="password"
              placeholder="Current password"
              :disabled="bChangingPassword"
              :aria-invalid="Boolean(passwordFieldErrors.current)"
              aria-describedby="account-password-current-error"
              @blur="touchPassword('current')"
              @input="onPasswordInput('current')"
            />
          </div>
          <p
            v-if="passwordFieldErrors.current"
            id="account-password-current-error"
            class="hint is-error"
          >
            {{ passwordFieldErrors.current }}
          </p>
        </div>
        <div class="field mt-2">
          <div class="label">New password</div>
          <div class="input-wrap">
            <span class="icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </span>
            <input
              v-model="accountNewPassword"
              type="password"
              placeholder="At least 8 characters"
              :disabled="bChangingPassword"
              :aria-invalid="Boolean(passwordFieldErrors.next)"
              aria-describedby="account-password-next-error"
              @blur="touchPassword('next')"
              @input="onPasswordInput('next')"
            />
          </div>
          <p v-if="passwordFieldErrors.next" id="account-password-next-error" class="hint is-error">
            {{ passwordFieldErrors.next }}
          </p>
        </div>
        <div class="field mt-2">
          <div class="label">New password</div>
          <div class="input-wrap">
            <span class="icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </span>
            <input
              v-model="accountConfirmPassword"
              type="password"
              placeholder="Confirm new password"
              :disabled="bChangingPassword"
              :aria-invalid="Boolean(passwordFieldErrors.confirm)"
              aria-describedby="account-password-confirm-error"
              @blur="touchPassword('confirm')"
              @input="onPasswordInput('confirm')"
            />
          </div>
          <p
            v-if="passwordFieldErrors.confirm || accountPasswordError"
            id="account-password-confirm-error"
            class="hint is-error"
          >
            {{ passwordFieldErrors.confirm || accountPasswordError }}
          </p>
        </div>

        <div v-if="bAccountPasswordSuccess" class="message is-success">Password updated.</div>

        <div class="flex justify-end mt-4">
          <button
            class="button is-primary"
            :disabled="
              bChangingPassword ||
              !accountCurrentPassword ||
              !accountNewPassword ||
              !accountConfirmPassword
            "
            @click="changePassword"
          >
            <div v-if="bChangingPassword" class="loading-spinner"></div>
            Update password
          </button>
        </div>
      </div>

      <!-- API keys -->
      <div class="box bg-surface!">
        <h2 class="text-md font-semibold text-text-primary mb-3">API keys</h2>
        <hr />
        <p class="text-sm text-text-muted mb-3">
          Use a key as <span class="font-mono text-xs">Authorization: Bearer nck_…</span> for scripts.
          The secret is shown only once.
        </p>
        <div v-if="createdApiToken" class="message is-info mb-3">
          <div class="font-medium mb-1">Copy this key now — it will not be shown again.</div>
          <div class="flex items-center gap-2 flex-wrap">
            <code class="text-xs break-all">{{ createdApiToken.token }}</code>
            <button type="button" class="button is-primary" @click="copyCreatedToken">Copy</button>
          </div>
        </div>
        <div class="field">
          <div class="label">Name</div>
          <div class="input-wrap">
            <input
              v-model="newApiTokenName"
              type="text"
              maxlength="64"
              placeholder="e.g. home-assistant"
              :disabled="bCreatingApiToken"
              @keyup.enter="createApiToken"
            />
          </div>
        </div>
        <div class="flex justify-end mt-4">
          <button
            class="button is-primary"
            :disabled="bCreatingApiToken || !newApiTokenName.trim()"
            @click="createApiToken"
          >
            <div v-if="bCreatingApiToken" class="loading-spinner"></div>
            Create API key
          </button>
        </div>
        <ul v-if="apiTokens.length > 0" class="mt-4 space-y-2">
          <li
            v-for="token in apiTokens"
            :key="token.id"
            class="flex items-center justify-between gap-3 text-sm border border-fg/10 rounded-md px-3 py-2"
          >
            <div class="min-w-0">
              <div class="font-medium text-text-primary truncate">{{ token.name }}</div>
              <div class="text-xs text-text-muted font-mono">
                {{ token.tokenPrefix }}
                <span class="text-text-muted/70">
                  · created {{ relativeTimeShort(token.createdAt) }}
                  <template v-if="token.lastUsedAt"> · used {{ relativeTimeShort(token.lastUsedAt) }}</template>
                  <template v-else> · never used</template>
                </span>
              </div>
            </div>
            <button type="button" class="button is-destructive" @click="tokenToRevoke = token">
              Revoke
            </button>
          </li>
        </ul>
        <p v-else-if="!bLoadingApiTokens" class="text-sm text-text-muted mt-3">No API keys yet.</p>
      </div>
    </div>

    <ConfirmModal
      :model-value="tokenToRevoke !== null"
      title="Revoke API key?"
      :description="tokenToRevoke ? `Revoke “${tokenToRevoke.name}”? Scripts using this key will fail immediately.` : ''"
      confirm-label="Revoke"
      :loading="bRevokingApiToken"
      @update:model-value="(open) => { if (!open && !bRevokingApiToken) tokenToRevoke = null }"
      @confirm="confirmRevokeApiToken"
    />
  </PageShell>
</template>



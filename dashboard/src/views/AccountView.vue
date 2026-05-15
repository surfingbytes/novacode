<script setup lang="ts">
// node_modules
import { ref } from 'vue';

// stores
import { useAuthStore } from '@/stores/auth';

// components
import PageShell from '@/components/layout/PageShell.vue';

// classes
import { authApi } from '@/classes/api';

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

// -------------------------------------------------- Methods --------------------------------------------------
const changeUsername = async (): Promise<void> => {
  accountUsernameError.value = '';
  bAccountUsernameSuccess.value = false;
  const newUsername = accountNewUsername.value.trim();
  if (!newUsername) {
    accountUsernameError.value = 'Enter a new username and your current password.';
    return;
  }
  if (newUsername === authStore.username) {
    accountUsernameError.value = 'New username is the same as current.';
    return;
  }
  bChangingUsername.value = true;
  try {
    const response = await authApi.changeUsername(newUsername);
    authStore.setToken(response.data.token, newUsername);
    accountNewUsername.value = '';
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
  const current = accountCurrentPassword.value;
  const newP = accountNewPassword.value;
  const confirm = accountConfirmPassword.value;
  if (!current || !newP || !confirm) {
    accountPasswordError.value = 'Fill in all password fields.';
    return;
  }
  if (newP.length < 8) {
    accountPasswordError.value = 'New password must be at least 8 characters.';
    return;
  }
  if (newP !== confirm) {
    accountPasswordError.value = 'New password and confirmation do not match.';
    return;
  }
  bChangingPassword.value = true;
  try {
    await authApi.changePassword(current, newP);
    accountCurrentPassword.value = '';
    accountNewPassword.value = '';
    accountConfirmPassword.value = '';
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
</script>

<template>
  <PageShell>
    <div class="mb-6">
      <h1 class="text-xl font-semibold text-text-primary">Account</h1>
      <p class="text-sm text-text-muted mt-1">
        Change your username or password. You will stay signed in after changing username.
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
            />
          </div>
          <p v-if="accountUsernameError" class="hint is-error">
            {{ accountUsernameError }}
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
            />
          </div>
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
            />
          </div>
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
            />
          </div>
          <p v-if="!accountConfirmPassword" class="hint is-error">
            {{ accountPasswordError }}
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
    </div>
  </PageShell>
</template>



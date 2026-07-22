<script setup lang="ts">
// node_modules
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

// components
import AppTerminal from '@/components/AppTerminal.vue';
import BaseModal from '@/components/BaseModal.vue';

// stores
import { useAuthStore } from '@/stores/auth';

// api
import { authApi, agentAuthApi, settingsApi } from '@/classes/api';


// classes
import { themes, applyTheme, DEFAULT_THEME_ID, resolveStoredThemeId } from '@/lib/themes';
import {
  isNotificationsEnabled,
  setNotificationsEnabled,
  canRequestPermission,
  getPermissionState,
  requestPermission,
  syncPushSubscription
} from '@/lib/notifications';

// -------------------------------------------------- Store --------------------------------------------------
const router = useRouter();
const auth = useAuthStore();

// -------------------------------------------------- Refs --------------------------------------------------
const step = ref<1 | 2 | 3 | 4>(1);

// Step 1: Profile
const username = ref<string>('');
const password = ref<string>('');
const passwordConfirm = ref<string>('');
const selectedThemeId = ref<string>(
  resolveStoredThemeId(localStorage.getItem('theme') ?? DEFAULT_THEME_ID)
);
const profileError = ref<string>('');
const bSavingProfile = ref<boolean>(false);

// Step 2: AI Agents
const bClaudeAuthenticated = ref<boolean>(false);
const bVibeConfigured = ref<boolean>(false);
const bStartingClaudeLogin = ref<boolean>(false);
const bLoggingOutClaude = ref<boolean>(false);
const authSessionId = ref<string | null>(null);
const authCode = ref<string>('');
const authUrl = ref<string | null>(null);
const bClaudeAuthSuccess = ref<boolean>(false);
const claudeAuthError = ref<string>('');
const authTerminalRef = ref<InstanceType<typeof AppTerminal> | null>(null);
// Vibe (Mistral) API key
const vibeApiKey = ref<string>('');
const bSavingVibeKey = ref<boolean>(false);
const bClearingVibeKey = ref<boolean>(false);
const vibeKeyError = ref<string>('');

// Step 3: Git Credentials
const gitName = ref<string>('');
const gitEmail = ref<string>('');
const bSavingGit = ref<boolean>(false);
const gitError = ref<string>('');

// Step 4: Finalize
const bNotifications = ref<boolean>(isNotificationsEnabled());
const notificationPermission = ref<NotificationPermission | 'unsupported'>(getPermissionState());
const bFinishing = ref<boolean>(false);

// -------------------------------------------------- Computed --------------------------------------------------
const canProceedStep1 = computed((): boolean => {
  return (
    username.value.trim().length > 0 &&
    password.value.length >= 6 &&
    password.value === passwordConfirm.value
  );
});

const passwordMismatch = computed((): boolean => {
  return passwordConfirm.value.length > 0 && password.value !== passwordConfirm.value;
});

const canProceedStep2 = computed((): boolean => bClaudeAuthenticated.value || bVibeConfigured.value);

const stepStatuses = computed<Record<1 | 2 | 3 | 4, 'complete' | 'active' | 'pending'>>(() => ({
  1: step.value > 1 ? 'complete' : step.value === 1 ? 'active' : 'pending',
  2: step.value > 2 ? 'complete' : step.value === 2 ? 'active' : 'pending',
  3: step.value > 3 ? 'complete' : step.value === 3 ? 'active' : 'pending',
  4: step.value === 4 ? 'active' : 'pending'
}));

// -------------------------------------------------- Methods --------------------------------------------------
// --- profile ---
const selectTheme = (themeId: string): void => {
  selectedThemeId.value = themeId;
  localStorage.setItem('theme', themeId);
  applyTheme(themeId);
};

const handleStep1Next = async (): Promise<void> => {
  if (!canProceedStep1.value) {
    return;
  }
  profileError.value = '';
  bSavingProfile.value = true;
  try {
    const response = await authApi.setup(username.value.trim(), password.value);
    auth.setToken(response.data.token, username.value.trim());
    await refreshAuthStatus();
    step.value = 2;
  } catch (e: unknown) {
    profileError.value =
      (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
      'Failed to create account. Please try again.';
  } finally {
    bSavingProfile.value = false;
  }
};

// --- agent auth ---
const refreshAuthStatus = async (): Promise<void> => {
  try {
    const claudeResponse = await agentAuthApi.claudeStatus();
    bClaudeAuthenticated.value = claudeResponse.data.authenticated;
  } catch {
    // ignore
  }
  try {
    const vibeResponse = await settingsApi.getVibeApiKeyStatus();
    bVibeConfigured.value = vibeResponse.data.configured;
  } catch {
    // ignore
  }
};

const startClaudeLogin = async (): Promise<void> => {
  bStartingClaudeLogin.value = true;
  try {
    authUrl.value = null;
    authCode.value = '';
    const response = await agentAuthApi.claudeLogin();
    authSessionId.value = response.data.sessionId;
  } catch {
    // ignore
  } finally {
    bStartingClaudeLogin.value = false;
  }
};

const logoutClaude = async (): Promise<void> => {
  bLoggingOutClaude.value = true;
  try {
    await agentAuthApi.claudeLogout();
    await refreshAuthStatus();
  } catch {
    // ignore
  } finally {
    bLoggingOutClaude.value = false;
  }
};

const submitAuthCode = async (): Promise<void> => {
  const code = authCode.value.trim();
  if (!code) {
    return;
  }
  authTerminalRef.value?.sendInput(code);
  await new Promise((resolve) => setTimeout(resolve, 100));
  authTerminalRef.value?.sendInput('\r');
  authCode.value = '';
};

const onAuthTokenFound = async (token: string): Promise<void> => {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    return;
  }
  try {
    claudeAuthError.value = '';
    const response = await agentAuthApi.claudeSaveToken(trimmedToken);
    if (response.data?.ok) {
      bClaudeAuthSuccess.value = true;
      dismissAuthTerminal();
      setTimeout(() => {
        bClaudeAuthSuccess.value = false;
      }, 3000);
    } else {
      claudeAuthError.value = 'Failed to save Claude token.';
    }
    await refreshAuthStatus();
  } catch {
    claudeAuthError.value = 'Failed to save Claude token.';
  }
};

const openAuthUrl = (url: string): void => {
  authUrl.value = url;
  window.open(url, '_blank', 'noopener,noreferrer');
};

const dismissAuthTerminal = (): void => {
  authSessionId.value = null;
  authUrl.value = null;
  authCode.value = '';
  agentAuthApi.claudeStatus()
    .then((r) => { bClaudeAuthenticated.value = r.data.authenticated; })
    .catch(() => {});
};

const onAuthSessionEnded = (): void => {
  refreshAuthStatus();
};

// --- Vibe (Mistral) API key ---
const saveVibeApiKey = async (): Promise<void> => {
  const key = vibeApiKey.value.trim();
  if (!key) return;
  bSavingVibeKey.value = true;
  vibeKeyError.value = '';
  try {
    await settingsApi.setVibeApiKey(key);
    vibeApiKey.value = '';
    await refreshAuthStatus();
  } catch {
    vibeKeyError.value = 'Failed to save API key.';
  } finally {
    bSavingVibeKey.value = false;
  }
};

const clearVibeApiKey = async (): Promise<void> => {
  bClearingVibeKey.value = true;
  try {
    await settingsApi.clearVibeApiKey();
    await refreshAuthStatus();
  } catch {
    // ignore
  } finally {
    bClearingVibeKey.value = false;
  }
};

// --- git setup ---
const handleStep3Next = async (): Promise<void> => {
  if (!gitName.value.trim() && !gitEmail.value.trim()) {
    step.value = 4;
    return;
  }
  bSavingGit.value = true;
  gitError.value = '';
  try {
    await settingsApi.update({
      gitUserName: gitName.value.trim() || null,
      gitUserEmail: gitEmail.value.trim() || null
    });
    step.value = 4;
  } catch (e: unknown) {
    gitError.value =
      (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
      'Failed to save git credentials.';
  } finally {
    bSavingGit.value = false;
  }
};

// --- notifications + finalize ---
const toggleNotifications = async (): Promise<void> => {
  if (!canRequestPermission()) {
    return;
  }
  const enabling = !bNotifications.value;
  if (enabling && Notification.permission !== 'granted') {
    const permissionState = await requestPermission();
    notificationPermission.value = permissionState;
    if (permissionState !== 'granted') {
      return;
    }
  }
  bNotifications.value = enabling;
  setNotificationsEnabled(enabling);
  try {
    await syncPushSubscription(enabling);
  } catch {
    // ignore push registration failures
  }
};

const handleFinish = async (): Promise<void> => {
  bFinishing.value = true;
  await router.push('/');
};

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted((): void => {
  refreshAuthStatus();
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col bg-bg">
    <!-- Header -->
    <header class="border-b border-border bg-surface px-6 py-4 shrink-0">
      <div class="max-w-5xl mx-auto flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <img src="/logo.svg" alt="Nova Code" class="w-8 h-8" />
          <span class="font-bold text-lg text-text-primary tracking-tight">Nova Code</span>
        </div>
        <span class="text-xs font-semibold text-text-muted uppercase tracking-widest hidden sm:block"
          >Initial Setup</span
        >
      </div>
    </header>

    <!-- Stepper -->
    <div class="shrink-0 bg-surface border-b border-border px-6 py-6">
      <div class="max-w-2xl mx-auto">
        <div class="relative flex items-center justify-between">
          <!-- Progress line background -->
          <div class="absolute top-5 left-0 w-full h-0.5 bg-border -z-10"></div>
          <!-- Progress line fill -->
          <div
            class="absolute top-5 left-0 h-0.5 bg-primary -z-10 transition-all duration-500"
            :style="{ width: `${((step - 1) / 3) * 100}%` }"
          ></div>

          <!-- Step indicators -->
          <template v-for="(label, i) in ['Profile', 'AI Agents', 'Git', 'Finalize']" :key="i">
            <div class="flex flex-col items-center gap-2">
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ring-4"
                :class="{
                  'bg-success text-on-accent ring-success/20 shadow-lg':
                    stepStatuses[((i + 1) as 1 | 2 | 3 | 4)] === 'complete',
                  'bg-primary text-on-accent ring-primary/20 shadow-lg shadow-primary/30':
                    stepStatuses[((i + 1) as 1 | 2 | 3 | 4)] === 'active',
                  'bg-surface border-2 border-border text-text-muted ring-transparent':
                    stepStatuses[((i + 1) as 1 | 2 | 3 | 4)] === 'pending'
                }"
              >
                <svg
                  v-if="stepStatuses[((i + 1) as 1 | 2 | 3 | 4)] === 'complete'"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
                  width="18" height="18" aria-hidden="true"
                ><polyline points="20 6 9 17 4 12"/></svg>
                <span v-else>{{ i + 1 }}</span>
              </div>
              <span
                class="text-[11px] font-bold uppercase tracking-wider transition-colors duration-300"
                :class="{
                  'text-success': stepStatuses[((i + 1) as 1 | 2 | 3 | 4)] === 'complete',
                  'text-primary': stepStatuses[((i + 1) as 1 | 2 | 3 | 4)] === 'active',
                  'text-text-muted': stepStatuses[((i + 1) as 1 | 2 | 3 | 4)] === 'pending'
                }"
              >
                {{ label }}
              </span>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Main Content (scrolls on short viewports / mobile; shell is fixed + overflow-hidden) -->
    <main
      class="flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-6 py-10 [-webkit-overflow-scrolling:touch]"
    >
      <Transition name="step" mode="out-in">
        <!-- ======================== STEP 1: Profile ======================== -->
        <div v-if="step === 1" key="step1" class="w-full max-w-2xl">
          <div class="text-center mb-10">
            <h1 class="text-3xl font-bold text-text-primary tracking-tight mb-3">
              Create your account
            </h1>
            <p class="text-text-muted text-base max-w-md mx-auto">
              Set up your admin credentials and personalize your experience.
            </p>
          </div>

          <div class="space-y-8">
            <!-- Account Fields -->
            <div class="bg-surface border border-border rounded-xl p-6 space-y-5">
              <h3 class="text-sm font-bold text-text-muted uppercase tracking-wider">
                Credentials
              </h3>

              <div class="field" :class="{ 'has-error': profileError }">
                <label class="label">Username</label>
                <div class="input-wrap">
                  <span class="icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </span>
                  <input
                    v-model="username"
                    type="text"
                    autocomplete="username"
                    placeholder="admin"
                    @keydown.enter="handleStep1Next"
                  />
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div class="field">
                  <label class="label">Password</label>
                  <div class="input-wrap">
                    <span class="icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                    </span>
                    <input
                      v-model="password"
                      type="password"
                      autocomplete="new-password"
                      placeholder="••••••••"
                    />
                  </div>
                  <p v-if="password && password.length < 6" class="hint is-error">
                    At least 6 characters required
                  </p>
                </div>

                <div class="field" :class="{ 'has-error': passwordMismatch }">
                  <label class="label">Confirm Password</label>
                  <div class="input-wrap">
                    <span class="icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 018-4.47"/><path d="M17 3l2 2-2 2"/></svg>
                    </span>
                    <input
                      v-model="passwordConfirm"
                      type="password"
                      autocomplete="new-password"
                      placeholder="••••••••"
                      @keydown.enter="handleStep1Next"
                    />
                  </div>
                  <p v-if="passwordMismatch" class="hint is-error">Passwords do not match</p>
                </div>
              </div>

              <p v-if="profileError" class="message is-error">{{ profileError }}</p>
            </div>

            <!-- Theme Selection -->
            <div class="space-y-4">
              <h3 class="text-sm font-bold text-text-muted uppercase tracking-wider">
                Interface Theme
              </h3>
              <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                <button
                  v-for="theme in themes"
                  :key="theme.id"
                  class="group relative rounded-xl border-2 transition-all duration-200 p-0.5 overflow-hidden focus:outline-none"
                  :class="
                    selectedThemeId === theme.id
                      ? 'border-primary shadow-lg shadow-primary/20'
                      : 'border-transparent hover:border-border'
                  "
                  @click="selectTheme(theme.id)"
                >
                  <!-- Color preview swatch -->
                  <div
                    class="rounded-lg h-12 w-full flex flex-col gap-1 items-stretch p-1.5"
                    :style="{ backgroundColor: theme.bg }"
                  >
                    <div
                      class="h-1.5 rounded-full w-3/4"
                      :style="{ backgroundColor: theme.primary }"
                    ></div>
                    <div
                      class="h-1 rounded-full w-full opacity-60"
                      :style="{ backgroundColor: theme.textMuted }"
                    ></div>
                    <div
                      class="h-1 rounded-full w-2/3 opacity-40"
                      :style="{ backgroundColor: theme.textMuted }"
                    ></div>
                  </div>
                  <!-- Check badge -->
                  <div
                    v-if="selectedThemeId === theme.id"
                    class="absolute top-1 right-1 w-4 h-4 bg-primary rounded-full flex items-center justify-center"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="10" height="10" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <!-- Label tooltip -->
                  <p class="text-center text-[10px] font-semibold text-text-muted mt-1.5 truncate px-1">
                    {{ theme.name }}
                  </p>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ======================== STEP 2: AI Agents ======================== -->
        <div v-else-if="step === 2" key="step2" class="w-full max-w-2xl">
          <div class="text-center mb-10">
            <h1 class="text-3xl font-bold text-text-primary tracking-tight mb-3">
              Connect AI Agents
            </h1>
            <p class="text-text-muted text-base max-w-md mx-auto">
              Connect your preferred AI coding assistants. You need at least one to start working.
            </p>
          </div>

          <div class="space-y-4 mb-6">
            <!-- Claude Card -->
            <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5">
              <div class="flex items-start justify-between gap-4 mb-4">
                <div class="min-w-0">
                  <p class="font-medium text-text-primary text-sm">Claude Code</p>
                  <p class="text-xs text-text-muted mt-1">
                    Sign in with your Anthropic account. A terminal will open — click the sign-in link, then paste the token shown in your browser.
                  </p>
                </div>
                <span
                  class="inline-flex items-center text-xs px-2.5 py-1 rounded-full border flex-shrink-0 font-medium"
                  :class="bClaudeAuthenticated
                    ? 'bg-success/10 text-success border-success/20'
                    : 'bg-warning/10 text-warning border-warning/20'"
                >
                  <span class="w-1.5 h-1.5 rounded-full mr-1.5" :class="bClaudeAuthenticated ? 'bg-success' : 'bg-warning'"></span>
                  {{ bClaudeAuthenticated ? 'Authenticated' : 'Not authenticated' }}
                </span>
              </div>
              <div class="flex items-center gap-3">
                <button
                  v-if="!bClaudeAuthenticated"
                  class="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-all"
                  :disabled="bStartingClaudeLogin"
                  @click="startClaudeLogin"
                >
                  <div v-if="bStartingClaudeLogin" class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Login to Claude
                </button>
                <button
                  v-else
                  class="flex items-center gap-2 bg-fg/[0.05] hover:bg-fg/[0.09] disabled:opacity-50 disabled:cursor-not-allowed border border-fg/[0.1] text-text-primary text-sm font-medium px-4 py-2.5 rounded-lg transition-all"
                  :disabled="bLoggingOutClaude"
                  @click="logoutClaude"
                >
                  <div v-if="bLoggingOutClaude" class="w-3.5 h-3.5 border-2 border-fg/30 border-t-fg rounded-full animate-spin"></div>
                  Logout
                </button>
                <a
                  href="https://claude.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-xs text-primary hover:text-primary-hover transition-colors"
                >Manage account &rarr;</a>
              </div>
              <p v-if="bClaudeAuthSuccess" class="text-xs text-success mt-2">
                Claude token saved. You're ready to use Claude Code.
              </p>
              <p v-if="claudeAuthError" class="text-xs text-destructive mt-2">{{ claudeAuthError }}</p>
            </div>

            <!-- Mistral Vibe Card -->
            <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5">
              <div class="flex items-start justify-between gap-4 mb-4">
                <div class="min-w-0">
                  <p class="font-medium text-text-primary text-sm">Mistral Vibe</p>
                  <p class="text-xs text-text-muted mt-1">
                    Enter your Mistral API key to use Mistral's coding agent.
                  </p>
                </div>
                <span
                  class="inline-flex items-center text-xs px-2.5 py-1 rounded-full border flex-shrink-0 font-medium"
                  :class="bVibeConfigured
                    ? 'bg-success/10 text-success border-success/20'
                    : 'bg-warning/10 text-warning border-warning/20'"
                >
                  <span class="w-1.5 h-1.5 rounded-full mr-1.5" :class="bVibeConfigured ? 'bg-success' : 'bg-warning'"></span>
                  {{ bVibeConfigured ? 'Configured' : 'Not configured' }}
                </span>
              </div>

              <div v-if="!bVibeConfigured" class="flex items-center gap-2">
                <div class="input-wrap flex-1">
                  <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg></span>
                  <input
                    v-model="vibeApiKey"
                    type="password"
                    placeholder="Mistral API key"
                    autocomplete="off"
                    @keydown.enter="saveVibeApiKey"
                  />
                </div>
                <button
                  class="flex items-center gap-2 bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-all shrink-0"
                  :disabled="bSavingVibeKey || !vibeApiKey.trim()"
                  @click="saveVibeApiKey"
                >
                  <div v-if="bSavingVibeKey" class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span v-else>Save</span>
                </button>
              </div>

              <div v-else class="flex items-center gap-3">
                <button
                  class="flex items-center gap-2 bg-fg/[0.05] hover:bg-fg/[0.09] disabled:opacity-50 disabled:cursor-not-allowed border border-fg/[0.1] text-text-primary text-sm font-medium px-4 py-2.5 rounded-lg transition-all"
                  :disabled="bClearingVibeKey"
                  @click="clearVibeApiKey"
                >
                  <div v-if="bClearingVibeKey" class="w-3.5 h-3.5 border-2 border-fg/30 border-t-fg rounded-full animate-spin"></div>
                  Remove key
                </button>
                <a
                  href="https://console.mistral.ai/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-xs text-primary hover:text-primary-hover transition-colors"
                >Manage API keys &rarr;</a>
              </div>

              <p v-if="vibeKeyError" class="text-xs text-destructive mt-2">{{ vibeKeyError }}</p>
            </div>
          </div>

          <p v-if="!canProceedStep2" class="text-center text-sm text-text-muted italic">
            Connect at least one agent to continue, or skip for now.
          </p>
        </div>

        <!-- ======================== STEP 3: Git Credentials ======================== -->
        <div v-else-if="step === 3" key="step3" class="w-full max-w-2xl">
          <div class="text-center mb-10">
            <h1 class="text-3xl font-bold text-text-primary tracking-tight mb-3">
              Git Credentials
            </h1>
            <p class="text-text-muted text-base max-w-md mx-auto">
              Configure your identity for version control. These will be used to attribute your
              commits.
            </p>
          </div>

          <div class="bg-surface border border-border rounded-xl p-8">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div class="field">
                <label class="label">Git Username</label>
                <div class="input-wrap">
                  <span class="icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  </span>
                  <input
                    v-model="gitName"
                    type="text"
                    placeholder="e.g. johndoe"
                    autocomplete="name"
                  />
                </div>
              </div>

              <div class="field">
                <label class="label">Git Email</label>
                <div class="input-wrap">
                  <span class="icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  </span>
                  <input
                    v-model="gitEmail"
                    type="email"
                    placeholder="name@example.com"
                    autocomplete="email"
                  />
                </div>
              </div>
            </div>

            <p v-if="gitError" class="message is-error mt-5">{{ gitError }}</p>
          </div>

          <p class="text-center mt-6 text-sm text-text-muted">
            Both fields are optional — you can configure these later in
            <strong class="text-text-primary">Settings</strong>.
          </p>
        </div>

        <!-- ======================== STEP 4: Finalize ======================== -->
        <div v-else-if="step === 4" key="step4" class="w-full max-w-2xl">
          <div class="text-center mb-10">
            <h1 class="text-3xl font-bold text-text-primary tracking-tight mb-3">
              Almost there!
            </h1>
            <p class="text-text-muted text-base max-w-md mx-auto">
              Your setup is complete. Optionally enable desktop notifications to stay on top of your
              AI's progress.
            </p>
          </div>

          <div class="bg-surface border border-border rounded-xl p-8 mb-6">
            <div class="flex items-start gap-6">
              <div
                class="w-14 h-14 bg-primary/10 rounded-xl flex items-center justify-center shrink-0"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="28" height="28" class="text-primary" aria-hidden="true"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/></svg>
              </div>
              <div class="flex-1">
                <h2 class="text-base font-bold text-text-primary mb-1">Desktop Notifications</h2>
                <p class="text-sm text-text-muted leading-relaxed mb-5">
                  Get notified when sessions complete, agents hit milestones, or tasks need
                  attention. Recommended for the best experience.
                </p>

                <div
                  class="flex items-center justify-between bg-bg border border-border rounded-lg px-4 py-3.5"
                >
                  <div>
                    <p class="text-sm font-semibold text-text-primary">Enable Real-Time Alerts</p>
                    <p class="text-xs text-text-muted mt-0.5">
                      Browser push notifications for critical updates
                    </p>
                  </div>
                  <button
                    class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none"
                    :class="bNotifications ? 'bg-primary' : 'bg-border'"
                    :disabled="notificationPermission === 'denied'"
                    :title="
                      notificationPermission === 'denied'
                        ? 'Notifications blocked in browser settings'
                        : ''
                    "
                    role="switch"
                    :aria-checked="bNotifications"
                    @click="toggleNotifications"
                  >
                    <span
                      class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200"
                      :class="bNotifications ? 'translate-x-5' : 'translate-x-0'"
                    ></span>
                  </button>
                </div>

                <p
                  v-if="notificationPermission === 'denied'"
                  class="text-xs text-warning mt-3 flex items-center gap-1.5"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  Notifications are blocked. Enable them in your browser settings to use this
                  feature.
                </p>
              </div>
            </div>
          </div>

          <!-- Summary -->
          <div class="bg-primary/5 border border-primary/15 rounded-xl px-6 py-4">
            <div class="flex gap-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="18" height="18" class="text-primary shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
              <p class="text-sm text-text-muted leading-relaxed">
                By finishing setup you agree to use this software responsibly. All settings can be
                changed at any time from
                <strong class="text-text-primary">Settings</strong>.
              </p>
            </div>
          </div>
        </div>
      </Transition>
    </main>

    <!-- Footer -->
    <footer class="shrink-0 border-t border-border bg-surface px-6 py-5">
      <div class="max-w-2xl mx-auto flex items-center justify-between">
        <!-- Back button -->
        <button
          v-if="step > 1"
          class="button"
          @click="step = ((step - 1) as 1 | 2 | 3 | 4)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          Back
        </button>
        <div v-else></div>

        <!-- Next / Finish button -->
        <div class="flex items-center gap-4">
          <!-- Skip for step 2 if no agents connected -->
          <button
            v-if="step === 2 && !canProceedStep2"
            class="text-sm text-text-muted hover:text-text-primary transition-colors font-medium"
            @click="step = 3"
          >
            Skip for now
          </button>

          <button
            v-if="step < 4"
            class="button is-primary has-glow"
            :disabled="
              (step === 1 && !canProceedStep1) ||
              (step === 1 && bSavingProfile) ||
              (step === 3 && bSavingGit)
            "
            @click="
              step === 1
                ? handleStep1Next()
                : step === 3
                  ? handleStep3Next()
                  : (step = ((step + 1) as 2 | 3 | 4))
            "
          >
            <div
              v-if="step === 1 && bSavingProfile"
              class="loading-spinner"
            ></div>
            <div
              v-else-if="step === 3 && bSavingGit"
              class="loading-spinner"
            ></div>
            <span v-else>Next Step</span>
            <svg v-if="!(step === 1 && bSavingProfile) && !(step === 3 && bSavingGit)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>

          <button
            v-else
            class="button is-primary has-glow"
            :disabled="bFinishing"
            @click="handleFinish"
          >
            <div v-if="bFinishing" class="loading-spinner"></div>
            <template v-else>
              <span>Launch Nova Code</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" aria-hidden="true"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/></svg>
            </template>
          </button>
        </div>
      </div>
    </footer>

    <!-- Authentication terminal overlay (Claude/Cursor login) -->
    <BaseModal
      :model-value="authSessionId !== null"
      labelledby="setup-auth-terminal-title"
      panel-class="max-w-3xl"
      @update:model-value="(v: boolean) => { if (!v) dismissAuthTerminal(); }"
    >
            <div class="flex shrink-0 items-center justify-between px-4 py-3 border-b border-fg/[0.08]">
              <p id="setup-auth-terminal-title" class="text-sm font-medium text-text-primary">Authentication terminal</p>
              <button
                class="text-sm px-3 py-2 text-text-muted hover:text-text-primary hover:bg-fg/[0.08] rounded-lg transition-all"
                @click="dismissAuthTerminal"
              >
                Dismiss
              </button>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto p-4">
              <div class="h-96 rounded-lg overflow-hidden bg-black/40">
                <AppTerminal
                  v-if="authSessionId"
                  ref="authTerminalRef"
                  :session-id="authSessionId"
                  :scan-urls="true"
                  class="w-full h-full"
                  @session-ended="onAuthSessionEnded"
                  @url-found="openAuthUrl"
                  @token-found="onAuthTokenFound"
                  @authentication-stored="dismissAuthTerminal"
                />
              </div>
            </div>

            <div class="flex shrink-0 gap-2 p-4 pt-0">
              <div class="flex-1 flex flex-col gap-2">
                <input
                  v-model="authCode"
                  type="text"
                  class="flex-1 min-w-0 bg-fg/[0.05] border border-fg/[0.1] rounded-lg px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all"
                  placeholder="Paste the code or token from your browser here"
                  @keydown.enter="submitAuthCode"
                />
                <div
                  v-if="authUrl"
                  class="flex items-center justify-between gap-2 text-xs text-text-muted"
                >
                  <span class="truncate">Browser didn't open? Use this button to open your sign-in link.</span>
                  <button
                    class="shrink-0 bg-fg/[0.08] hover:bg-fg/[0.12] text-text-primary text-xs font-medium px-3 py-1.5 rounded-lg border border-fg/[0.15] transition-all"
                    type="button"
                    @click="openAuthUrl(authUrl)"
                  >
                    Open sign-in link
                  </button>
                </div>
              </div>
              <button
                class="shrink-0 bg-primary hover:bg-primary-hover disabled:opacity-40 text-on-accent text-sm px-4 py-2.5 rounded-lg transition-all"
                :disabled="!authCode.trim()"
                @click="submitAuthCode"
              >
                Submit
              </button>
            </div>
    </BaseModal>
  </div>
</template>

<style scoped>
.step-enter-active,
.step-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.step-enter-from {
  opacity: 0;
  transform: translateX(24px);
}
.step-leave-to {
  opacity: 0;
  transform: translateX(-24px);
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>

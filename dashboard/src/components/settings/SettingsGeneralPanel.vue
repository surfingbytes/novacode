<script setup lang="ts">
// node_modules
import { ref, onMounted } from 'vue';

// classes
import { settingsApi } from '@/classes/api';

// lib
import {
  themes,
  applyTheme,
  DEFAULT_THEME_ID,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  resolveAutoTheme,
  resolveStoredThemeId,
  startAutoThemeWatcher,
  stopAutoThemeWatcher
} from '@/lib/themes';
import {
  isNotificationsEnabled,
  setNotificationsEnabled,
  canRequestPermission,
  getPermissionState,
  requestPermission,
  syncPushSubscription
} from '@/lib/notifications';

// -------------------------------------------------- Refs --------------------------------------------------
const activeThemeId = ref<string>(
  resolveStoredThemeId(localStorage.getItem('theme') ?? DEFAULT_THEME_ID)
);
const bAutoTheme = ref<boolean>(
  localStorage.getItem('autoTheme') === null ? true : localStorage.getItem('autoTheme') === 'true'
);
const darkThemeId = ref<string>(
  resolveStoredThemeId(localStorage.getItem('darkTheme') ?? DEFAULT_DARK_THEME_ID)
);
const lightThemeId = ref<string>(
  resolveStoredThemeId(localStorage.getItem('lightTheme') ?? DEFAULT_LIGHT_THEME_ID)
);
const bSavingTheme = ref<boolean>(false);

const bNotifications = ref<boolean>(isNotificationsEnabled());
const notifPermission = ref<NotificationPermission | 'unsupported'>(getPermissionState());

const bClaudeAutoContinue = ref<boolean>(false);
const bSavingClaudeAutoContinue = ref<boolean>(false);

// -------------------------------------------------- Methods --------------------------------------------------
const toggleNotifications = async (): Promise<void> => {
  if (!canRequestPermission()) {
    return;
  }
  const enabling = !bNotifications.value;
  if (enabling && Notification.permission !== 'granted') {
    const perm = await requestPermission();
    notifPermission.value = perm;
    if (perm !== 'granted') {
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

const selectTheme = async (themeId: string): Promise<void> => {
  if (themeId === activeThemeId.value || bSavingTheme.value) {
    return;
  }
  activeThemeId.value = themeId;
  localStorage.setItem('theme', themeId);
  applyTheme(themeId);
  bSavingTheme.value = true;
  try {
    await settingsApi.update({ theme: themeId });
  } catch {
    // ignore
  } finally {
    bSavingTheme.value = false;
  }
};

const selectDarkTheme = async (themeId: string): Promise<void> => {
  if (themeId === darkThemeId.value || bSavingTheme.value) {
    return;
  }
  darkThemeId.value = themeId;
  localStorage.setItem('darkTheme', themeId);
  if (bAutoTheme.value) {
    applyTheme(resolveAutoTheme());
  }
  bSavingTheme.value = true;
  try {
    await settingsApi.update({ darkTheme: themeId });
  } catch {
    // ignore
  } finally {
    bSavingTheme.value = false;
  }
};

const selectLightTheme = async (themeId: string): Promise<void> => {
  if (themeId === lightThemeId.value || bSavingTheme.value) {
    return;
  }
  lightThemeId.value = themeId;
  localStorage.setItem('lightTheme', themeId);
  if (bAutoTheme.value) {
    applyTheme(resolveAutoTheme());
  }
  bSavingTheme.value = true;
  try {
    await settingsApi.update({ lightTheme: themeId });
  } catch {
    // ignore
  } finally {
    bSavingTheme.value = false;
  }
};

const toggleAutoTheme = async (): Promise<void> => {
  bAutoTheme.value = !bAutoTheme.value;
  localStorage.setItem('autoTheme', String(bAutoTheme.value));
  if (bAutoTheme.value) {
    applyTheme(resolveAutoTheme());
    startAutoThemeWatcher();
  } else {
    stopAutoThemeWatcher();
    applyTheme(activeThemeId.value);
  }
  bSavingTheme.value = true;
  try {
    await settingsApi.update({ autoTheme: bAutoTheme.value });
  } catch {
    // ignore
  } finally {
    bSavingTheme.value = false;
  }
};

const toggleClaudeAutoContinue = async (): Promise<void> => {
  bClaudeAutoContinue.value = !bClaudeAutoContinue.value;
  bSavingClaudeAutoContinue.value = true;
  try {
    await settingsApi.update({ claudeAutoContinue: bClaudeAutoContinue.value });
  } catch {
    bClaudeAutoContinue.value = !bClaudeAutoContinue.value;
  } finally {
    bSavingClaudeAutoContinue.value = false;
  }
};

const loadSettings = async (): Promise<void> => {
  try {
    const response = await settingsApi.get();
    if (response.data.darkTheme) {
      darkThemeId.value = response.data.darkTheme;
      localStorage.setItem('darkTheme', response.data.darkTheme);
    }
    if (response.data.lightTheme) {
      lightThemeId.value = response.data.lightTheme;
      localStorage.setItem('lightTheme', response.data.lightTheme);
    }
    if (typeof response.data.autoTheme === 'boolean') {
      bAutoTheme.value = response.data.autoTheme;
      localStorage.setItem('autoTheme', String(response.data.autoTheme));
    }
    if (response.data.theme) {
      activeThemeId.value = response.data.theme;
      localStorage.setItem('theme', response.data.theme);
    }
    if (typeof response.data.claudeAutoContinue === 'boolean') {
      bClaudeAutoContinue.value = response.data.claudeAutoContinue;
    }
    if (bAutoTheme.value) {
      applyTheme(resolveAutoTheme());
      startAutoThemeWatcher();
    } else if (response.data.theme) {
      applyTheme(response.data.theme);
    }
  } catch {
    // ignore
  }
};

onMounted((): void => {
  loadSettings();
});
</script>

<template>
  <div role="tabpanel">
        <!-- Appearance -->
        <div class="settings-section-label nc-eyebrow">Appearance</div>
        <div class="settings-pref-list">
          <div class="settings-pref-row">
            <div class="settings-pref-row__text">
              <div class="settings-pref-row__title">Automatic dark / light mode</div>
              <div class="settings-pref-row__desc">Switches between your chosen dark and light themes based on your browser or OS preference.</div>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="bAutoTheme"
              :disabled="bSavingTheme"
              class="nc-toggle"
              :class="bAutoTheme ? 'on' : ''"
              @click="toggleAutoTheme"
            ><span class="nc-toggle-knob" /></button>
          </div>
          <div class="settings-pref-row">
            <div class="settings-pref-row__text">
              <div class="settings-pref-row__title">Auto-continue Claude conversations</div>
              <div class="settings-pref-row__desc">Automatically continue conversations when Claude API limits reset.</div>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="bClaudeAutoContinue"
              :disabled="bSavingClaudeAutoContinue"
              class="nc-toggle"
              :class="bClaudeAutoContinue ? 'on' : ''"
              @click="toggleClaudeAutoContinue"
            ><span class="nc-toggle-knob" /></button>
          </div>
        </div>

        <!-- Dark Theme -->
        <div class="settings-section-label nc-eyebrow" style="margin-top: 36px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>
          Dark Theme
        </div>
        <div class="settings-theme-grid">
          <button
            v-for="theme in themes.filter(t => t.dark)"
            :key="theme.id"
            type="button"
            class="settings-theme-swatch"
            :class="(bAutoTheme ? darkThemeId === theme.id : activeThemeId === theme.id) ? 'settings-theme-swatch--active' : ''"
            @click="bAutoTheme ? selectDarkTheme(theme.id) : selectTheme(theme.id)"
          >
            <div class="settings-theme-swatch__dots">
              <span v-for="(dot, i) in theme.previewDots" :key="i" class="settings-theme-swatch__dot" :style="{ background: dot }" />
            </div>
            <div class="settings-theme-swatch__name">{{ theme.name }}</div>
            <div v-if="bAutoTheme ? darkThemeId === theme.id : activeThemeId === theme.id" class="settings-theme-swatch__active-dot" />
          </button>
        </div>

        <!-- Light Theme -->
        <div class="settings-section-label nc-eyebrow" style="margin-top: 36px;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4 M12 7a5 5 0 100 10 5 5 0 000-10z"/></svg>
          Light Theme
        </div>
        <div class="settings-theme-grid">
          <button
            v-for="theme in themes.filter(t => !t.dark)"
            :key="theme.id"
            type="button"
            class="settings-theme-swatch"
            :class="(bAutoTheme ? lightThemeId === theme.id : activeThemeId === theme.id) ? 'settings-theme-swatch--active' : ''"
            @click="bAutoTheme ? selectLightTheme(theme.id) : selectTheme(theme.id)"
          >
            <div class="settings-theme-swatch__dots">
              <span v-for="(dot, i) in theme.previewDots" :key="i" class="settings-theme-swatch__dot" :style="{ background: dot }" />
            </div>
            <div class="settings-theme-swatch__name">{{ theme.name }}</div>
            <div v-if="bAutoTheme ? lightThemeId === theme.id : activeThemeId === theme.id" class="settings-theme-swatch__active-dot" />
          </button>
        </div>

        <!-- Notifications -->
        <template v-if="canRequestPermission()">
          <div class="settings-section-label nc-eyebrow" style="margin-top: 36px;">Notifications</div>
          <div class="settings-pref-list">
            <div class="settings-pref-row">
              <div class="settings-pref-row__text">
                <div class="settings-pref-row__title">Task completion notifications</div>
                <div class="settings-pref-row__desc">
                  Get a browser notification when an agent task finishes while the tab is in the background.
                  <span v-if="notifPermission === 'denied'" class="settings-pref-row__warn">
                    Notifications are blocked by your browser. Allow them in your browser's site settings.
                  </span>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="bNotifications"
                :disabled="notifPermission === 'denied'"
                class="nc-toggle"
                :class="bNotifications ? 'on' : ''"
                @click="toggleNotifications"
              ><span class="nc-toggle-knob" /></button>
            </div>
          </div>
        </template>

  </div>
</template>

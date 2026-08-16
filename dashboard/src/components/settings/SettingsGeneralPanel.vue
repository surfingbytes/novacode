<script setup lang="ts">
// node_modules
import { computed, onMounted, ref } from 'vue';
import { isOneShotAgentType, pickInexpensiveModel } from '@novacode/shared';

// components
import AgentModelPicker from '@/components/AgentModelPicker.vue';

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
import { safeGetItem, safeSetItem } from '@/lib/safeLocalStorage';

// types
import type { AgentModelOption, AgentType } from '@/@types/index';

// utils
import { agentSelectedStyle, agentTypeLabel } from '@/utils/agentTypeMeta';

// -------------------------------------------------- Refs --------------------------------------------------
const activeThemeId = ref<string>(
  resolveStoredThemeId(safeGetItem('theme') ?? DEFAULT_THEME_ID)
);
const bAutoTheme = ref<boolean>(
  safeGetItem('autoTheme') === null ? true : safeGetItem('autoTheme') === 'true'
);
const darkThemeId = ref<string>(
  resolveStoredThemeId(safeGetItem('darkTheme') ?? DEFAULT_DARK_THEME_ID)
);
const lightThemeId = ref<string>(
  resolveStoredThemeId(safeGetItem('lightTheme') ?? DEFAULT_LIGHT_THEME_ID)
);
const bSavingTheme = ref<boolean>(false);

const bNotifications = ref<boolean>(isNotificationsEnabled());
const notifPermission = ref<NotificationPermission | 'unsupported'>(getPermissionState());

const bClaudeAutoContinue = ref<boolean>(false);
const bSavingClaudeAutoContinue = ref<boolean>(false);

const utilityAgentType = ref<AgentType | null>(null);
const utilityModelSelection = ref<string>('');
const utilityModelOptions = ref<AgentModelOption[]>([]);
const bLoadingUtilityModels = ref<boolean>(false);
const bSavingUtility = ref<boolean>(false);
const bCursorAvailable = ref<boolean>(true);
const bClaudeAvailable = ref<boolean>(true);
const bMistralVibeAvailable = ref<boolean>(true);
const bOpenCodeAvailable = ref<boolean>(true);
const bCodexAvailable = ref<boolean>(true);

const availableUtilityAgents = computed(() => {
  const agents: AgentType[] = [];
  if (bCursorAvailable.value) agents.push('cursor-agent');
  if (bMistralVibeAvailable.value) agents.push('mistral-vibe');
  if (bClaudeAvailable.value) agents.push('claude');
  if (bOpenCodeAvailable.value) agents.push('open-code');
  if (bCodexAvailable.value) agents.push('codex');
  if (utilityAgentType.value && !agents.includes(utilityAgentType.value)) {
    agents.push(utilityAgentType.value);
  }
  return agents;
});

const utilityAgentGridClass = computed(
  () => `grid-cols-${Math.min(availableUtilityAgents.value.length + 1, 3)}`
);

function isUtilityAgentAvailable(agent: AgentType): boolean {
  if (agent === 'cursor-agent') return bCursorAvailable.value;
  if (agent === 'claude') return bClaudeAvailable.value;
  if (agent === 'mistral-vibe') return bMistralVibeAvailable.value;
  if (agent === 'open-code') return bOpenCodeAvailable.value;
  if (agent === 'codex') return bCodexAvailable.value;
  return false;
}

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
  safeSetItem('theme', themeId);
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
  safeSetItem('darkTheme', themeId);
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
  safeSetItem('lightTheme', themeId);
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
  safeSetItem('autoTheme', String(bAutoTheme.value));
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

const loadUtilityModels = async (agent: AgentType | null): Promise<void> => {
  if (!agent) {
    utilityModelOptions.value = [];
    return;
  }
  bLoadingUtilityModels.value = true;
  try {
    const { data } = await settingsApi.getAgentOptions(agent);
    utilityModelOptions.value =
      data.models.length > 0
        ? data.models
        : [{ id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null }];
    if (
      utilityModelSelection.value &&
      !utilityModelOptions.value.some((option) => option.id === utilityModelSelection.value)
    ) {
      utilityModelSelection.value = pickInexpensiveModel(utilityModelOptions.value);
    }
    if (!utilityModelSelection.value) {
      utilityModelSelection.value = pickInexpensiveModel(utilityModelOptions.value);
    }
  } catch {
    utilityModelOptions.value = [
      { id: 'auto', label: 'Auto', model: 'Auto', thinking: 'Auto', context: 'Auto', fast: null }
    ];
    if (!utilityModelSelection.value) {
      utilityModelSelection.value = 'auto';
    }
  } finally {
    bLoadingUtilityModels.value = false;
  }
};

const saveUtilitySettings = async (): Promise<void> => {
  bSavingUtility.value = true;
  try {
    await settingsApi.update({
      utilityAgentType: utilityAgentType.value,
      utilityModelSelection: utilityModelSelection.value
    });
  } catch {
    // ignore
  } finally {
    bSavingUtility.value = false;
  }
};

const selectUtilityAgent = async (agent: AgentType | null): Promise<void> => {
  if (agent && !isUtilityAgentAvailable(agent)) {
    return;
  }
  if (agent === utilityAgentType.value) {
    return;
  }
  utilityAgentType.value = agent;
  utilityModelSelection.value = '';
  await loadUtilityModels(agent);
  await saveUtilitySettings();
};

const onUtilityModelChange = async (value: string): Promise<void> => {
  if (value === utilityModelSelection.value) {
    return;
  }
  utilityModelSelection.value = value;
  await saveUtilitySettings();
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
      safeSetItem('darkTheme', response.data.darkTheme);
    }
    if (response.data.lightTheme) {
      lightThemeId.value = response.data.lightTheme;
      safeSetItem('lightTheme', response.data.lightTheme);
    }
    if (typeof response.data.autoTheme === 'boolean') {
      bAutoTheme.value = response.data.autoTheme;
      safeSetItem('autoTheme', String(response.data.autoTheme));
    }
    if (response.data.theme) {
      activeThemeId.value = response.data.theme;
      safeSetItem('theme', response.data.theme);
    }
    if (typeof response.data.claudeAutoContinue === 'boolean') {
      bClaudeAutoContinue.value = response.data.claudeAutoContinue;
    }
    try {
      const caps = await settingsApi.getAgentCapabilities();
      bCursorAvailable.value = caps.data.cursorAvailable;
      bClaudeAvailable.value = caps.data.claudeAvailable;
      bMistralVibeAvailable.value = caps.data.mistralVibeAvailable;
      bOpenCodeAvailable.value = caps.data.openCodeAvailable;
      bCodexAvailable.value = caps.data.codexAvailable;
    } catch {
      // keep defaults
    }
    utilityAgentType.value = isOneShotAgentType(response.data.utilityAgentType)
      ? response.data.utilityAgentType
      : null;
    utilityModelSelection.value = response.data.utilityModelSelection ?? '';
    await loadUtilityModels(utilityAgentType.value);
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

        <div class="settings-section-label nc-eyebrow" style="margin-top: 36px;">Background AI</div>
        <p class="settings-section-desc">
          Agent and model used for automatic commit messages and session titles. Automatic keeps the
          session or workspace agent and picks a cheaper model. Pin both if you want a specific cheap
          setup.
        </p>
        <div class="bg-fg/[0.02] border border-fg/[0.07] rounded-xl p-5 space-y-4">
          <div class="nc-field">
            <span class="nc-field-label">Agent</span>
            <div
              class="grid rounded-lg border border-fg/[0.12] bg-fg/[0.04] p-0.5 gap-1"
              :class="utilityAgentGridClass"
            >
              <button
                type="button"
                class="text-xs px-2 py-1.5 rounded-md border transition-colors"
                :class="
                  utilityAgentType === null
                    ? 'border-fg/20 bg-fg/[0.1] text-text-primary'
                    : 'border-transparent text-text-muted hover:text-text-primary hover:bg-fg/[0.06]'
                "
                :disabled="bSavingUtility"
                title="Use the session or workspace agent with a cheaper model"
                @click="selectUtilityAgent(null)"
              >
                Automatic
              </button>
              <button
                v-for="agent in availableUtilityAgents"
                :key="agent"
                type="button"
                class="text-xs px-2 py-1.5 rounded-md border border-transparent transition-colors text-text-muted hover:text-text-primary hover:bg-fg/[0.06]"
                :style="utilityAgentType === agent ? agentSelectedStyle(agent) : {}"
                :disabled="bSavingUtility"
                :title="agentTypeLabel(agent)"
                @click="selectUtilityAgent(agent)"
              >
                {{ agentTypeLabel(agent) }}
              </button>
            </div>
            <p v-if="availableUtilityAgents.length === 0" class="text-[11px] text-warning mt-2">
              No agents available. Configure an agent in Integrations.
            </p>
          </div>
          <div v-if="utilityAgentType" class="nc-field">
            <span class="nc-field-label">Model</span>
            <AgentModelPicker
              :model-value="utilityModelSelection"
              :agent-type="utilityAgentType"
              :model-options="utilityModelOptions"
              :disabled="bSavingUtility || bLoadingUtilityModels"
              variant="modal"
              @update:model-value="onUtilityModelChange"
            />
          </div>
          <p v-else class="text-[12.5px] text-text-muted">
            A cheaper model is chosen automatically for the session or workspace agent.
          </p>
        </div>

  </div>
</template>

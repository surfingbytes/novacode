<script setup lang="ts">
// node_modules
import { onBeforeUnmount, onMounted, ref, unref, watch, type Ref } from 'vue';
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  useRoute,
  useRouter,
  type RouteLocationNormalized
} from 'vue-router';

// components
import ConfirmModal from '@/components/ConfirmModal.vue';
import PageShell from '@/components/layout/PageShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import RuleTemplatesPanel from '@/components/RuleTemplatesPanel.vue';
import RuleFilesEditor from '@/components/RuleFilesEditor.vue';
import SettingsGeneralPanel from '@/components/settings/SettingsGeneralPanel.vue';
import SettingsGitPanel from '@/components/settings/SettingsGitPanel.vue';
import SettingsIntegrationsPanel from '@/components/settings/SettingsIntegrationsPanel.vue';
import SettingsMcpPanel from '@/components/settings/SettingsMcpPanel.vue';

const SETTINGS_TAB_IDS = ['general', 'git', 'integrations', 'mcp', 'rules', 'templates'] as const;
type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];

/** Panels that can hold unsaved edits expose `hasUnsavedChanges`. */
type DirtyAwarePanel = { hasUnsavedChanges?: Ref<boolean> | boolean };

const route = useRoute();
const router = useRouter();
const activeTab = ref<SettingsTabId>('general');
const activePanel = ref<DirtyAwarePanel | null>(null);
const bShowDiscardConfirm = ref<boolean>(false);
let pendingDiscardAction: (() => void) | null = null;
// Set while navigating after the user confirmed the discard, so the guards let it through.
let bDiscardConfirmed = false;

function isActivePanelDirty(): boolean {
  return Boolean(unref(activePanel.value?.hasUnsavedChanges));
}

function askDiscard(action: () => void): void {
  pendingDiscardAction = action;
  bShowDiscardConfirm.value = true;
}

function confirmDiscard(): void {
  const action = pendingDiscardAction;
  pendingDiscardAction = null;
  bShowDiscardConfirm.value = false;
  action?.();
}

function navigateDiscarding(to: RouteLocationNormalized): void {
  bDiscardConfirmed = true;
  void router.push(to.fullPath).finally(() => {
    bDiscardConfirmed = false;
  });
}

function applyTab(tab: SettingsTabId): void {
  activeTab.value = tab;
  void router.replace({ name: 'settings', query: { tab } });
}

function selectTab(tab: SettingsTabId): void {
  if (tab === activeTab.value) {
    return;
  }
  if (isActivePanelDirty()) {
    askDiscard(() => applyTab(tab));
    return;
  }
  applyTab(tab);
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (isActivePanelDirty()) {
    event.preventDefault();
    event.returnValue = '';
  }
}

// Back/forward between tabs changes only the query.
onBeforeRouteUpdate((to): boolean => {
  if (bDiscardConfirmed || to.query.tab === activeTab.value || !isActivePanelDirty()) {
    return true;
  }
  askDiscard(() => navigateDiscarding(to));
  return false;
});

onBeforeRouteLeave((to): boolean => {
  if (bDiscardConfirmed || !isActivePanelDirty()) {
    return true;
  }
  askDiscard(() => navigateDiscarding(to));
  return false;
});

onMounted((): void => {
  window.addEventListener('beforeunload', onBeforeUnload);
});

onBeforeUnmount((): void => {
  window.removeEventListener('beforeunload', onBeforeUnload);
});

watch(
  () => route.query.tab,
  (tab): void => {
    if (typeof tab === 'string' && (SETTINGS_TAB_IDS as readonly string[]).includes(tab)) {
      activeTab.value = tab as SettingsTabId;
    }
  },
  { immediate: true }
);
</script>

<template>
  <PageShell>
    <PageHeader
      eyebrow="// settings"
      title="Settings"
      subtitle="Configure appearance and preferences."
    />

    <div class="settings-tabs" role="tablist">
      <button
        v-for="tab in [
          { id: 'general', label: 'General' },
          { id: 'git', label: 'Git' },
          { id: 'integrations', label: 'Integrations' },
          { id: 'mcp', label: 'MCP' },
          { id: 'rules', label: 'Rules' },
          { id: 'templates', label: 'Templates' }
        ]"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        class="settings-tab"
        :class="activeTab === tab.id ? 'settings-tab--active' : ''"
        @click="selectTab(tab.id as SettingsTabId)"
      >
        {{ tab.label }}
      </button>
    </div>

    <SettingsGeneralPanel v-if="activeTab === 'general'" />
    <SettingsGitPanel v-if="activeTab === 'git'" ref="activePanel" />
    <SettingsIntegrationsPanel v-if="activeTab === 'integrations'" />
    <SettingsMcpPanel v-if="activeTab === 'mcp'" />

    <div v-if="activeTab === 'rules'" role="tabpanel">
      <div class="settings-section-label nc-eyebrow">Global rules</div>
      <p class="settings-section-desc">
        Markdown files injected into every agent prompt, in every workspace. Workspace rules still
        take precedence when they conflict.
      </p>
      <RuleFilesEditor ref="activePanel" source="global" hide-header />
    </div>

    <div v-if="activeTab === 'templates'" role="tabpanel">
      <div class="settings-section-label nc-eyebrow">Rule templates</div>
      <p class="settings-section-desc">
        Define reusable starters for new rule files. Available under a workspace's Rules tab and
        Settings → Rules.
      </p>
      <RuleTemplatesPanel />
    </div>

    <ConfirmModal
      v-model="bShowDiscardConfirm"
      title="Discard unsaved changes?"
      description="Your edits on this tab have not been saved and will be lost."
      confirm-label="Discard"
      variant="danger"
      @confirm="confirmDiscard"
    />
  </PageShell>
</template>

<style src="@/components/settings/settings-panels.css"></style>

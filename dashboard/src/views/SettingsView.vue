<script setup lang="ts">
// node_modules
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// components
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

const route = useRoute();
const router = useRouter();
const activeTab = ref<SettingsTabId>('general');

function selectTab(tab: SettingsTabId): void {
  activeTab.value = tab;
  void router.replace({ name: 'settings', query: { tab } });
}

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
    <SettingsGitPanel v-if="activeTab === 'git'" />
    <SettingsIntegrationsPanel v-if="activeTab === 'integrations'" />
    <SettingsMcpPanel v-if="activeTab === 'mcp'" />

    <div v-if="activeTab === 'rules'" role="tabpanel">
      <div class="settings-section-label nc-eyebrow">Global rules</div>
      <p class="settings-section-desc">
        Markdown files injected into every agent prompt, in every workspace. Workspace rules still
        take precedence when they conflict.
      </p>
      <RuleFilesEditor source="global" hide-header />
    </div>

    <div v-if="activeTab === 'templates'" role="tabpanel">
      <div class="settings-section-label nc-eyebrow">Rule templates</div>
      <p class="settings-section-desc">
        Define reusable starters for new rule files. Available under a workspace's Rules tab and
        Settings → Rules.
      </p>
      <RuleTemplatesPanel />
    </div>
  </PageShell>
</template>

<style src="@/components/settings/settings-panels.css"></style>

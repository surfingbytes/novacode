<script setup lang="ts">
// node_modules
import { computed } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// lib
import { isSendOnEnter } from '@/lib/sendOnEnter';

// utils
import { modKeyLabel } from '@/utils/platformKeys';

// types
interface ShortcutRow {
  /** Alternative key combos; each combo is a list of keys rendered as separate <kbd>s */
  combos: string[][];
  description: string;
}

interface ShortcutGroup {
  title: string;
  rows: ShortcutRow[];
}

// -------------------------------------------------- Props --------------------------------------------------

defineProps<{
  modelValue: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

// -------------------------------------------------- Computed --------------------------------------------------

const groups = computed<ShortcutGroup[]>(() => {
  const mod = modKeyLabel();
  const sendRows: ShortcutRow[] = isSendOnEnter()
    ? [
        { combos: [['Enter']], description: 'Send message' },
        { combos: [[mod, 'Enter']], description: 'Insert newline' }
      ]
    : [
        { combos: [[mod, 'Enter']], description: 'Send message' },
        { combos: [['Enter']], description: 'Insert newline' }
      ];
  return [
    {
      title: 'Global',
      rows: [
        { combos: [[mod, 'K']], description: 'Search' },
        { combos: [[mod, 'N']], description: 'New session' },
        { combos: [['?']], description: 'Keyboard shortcuts' }
      ]
    },
    {
      title: 'Chat',
      rows: [
        ...sendRows,
        { combos: [['Esc']], description: 'Stop generating' },
        { combos: [[mod, 'F']], description: 'Find in chat' },
        { combos: [['↑'], ['↓']], description: 'Recall previous prompts (empty composer)' }
      ]
    },
    {
      title: 'Files',
      rows: [{ combos: [[mod, 'S']], description: 'Save file' }]
    },
    {
      title: 'Lists and menus',
      rows: [
        { combos: [['↑'], ['↓']], description: 'Navigate' },
        { combos: [['Enter']], description: 'Select' },
        { combos: [['Esc']], description: 'Close' }
      ]
    }
  ];
});

// -------------------------------------------------- Methods --------------------------------------------------

const close = (): void => {
  emit('update:modelValue', false);
};
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    labelledby="shortcuts-modal-title"
    panel-class="max-w-lg"
    @update:model-value="close"
  >
    <ModalHeader
      eyebrow="// keyboard"
      title="Keyboard shortcuts"
      title-id="shortcuts-modal-title"
      @close="close"
    />
    <div class="flex-1 min-h-0 overflow-y-auto px-6 pt-3 pb-5">
      <section v-for="group in groups" :key="group.title" class="shortcuts__group">
        <h3 class="nc-eyebrow shortcuts__group-title">{{ group.title }}</h3>
        <ul class="shortcuts__rows">
          <li v-for="row in group.rows" :key="row.description" class="shortcuts__row">
            <span class="shortcuts__description">{{ row.description }}</span>
            <span class="shortcuts__keys">
              <template v-for="(combo, comboIndex) in row.combos" :key="comboIndex">
                <span v-if="comboIndex > 0" class="shortcuts__separator">/</span>
                <template v-for="(key, keyIndex) in combo" :key="keyIndex">
                  <span v-if="keyIndex > 0" class="shortcuts__separator">+</span>
                  <kbd class="kbd">{{ key }}</kbd>
                </template>
              </template>
            </span>
          </li>
        </ul>
      </section>
    </div>
  </BaseModal>
</template>

<style scoped>
.shortcuts__group + .shortcuts__group {
  margin-top: 16px;
}
.shortcuts__group-title {
  margin: 0 0 6px;
}
.shortcuts__rows {
  list-style: none;
  margin: 0;
  padding: 0;
}
.shortcuts__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 0;
  border-bottom: 1px solid var(--line);
}
.shortcuts__row:last-child {
  border-bottom: none;
}
.shortcuts__description {
  font-size: 13px;
  color: var(--fg-muted);
  min-width: 0;
}
.shortcuts__keys {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.shortcuts__separator {
  font-size: 11px;
  color: var(--fg-subtle);
}
</style>

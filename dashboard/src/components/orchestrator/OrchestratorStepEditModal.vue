<script setup lang="ts">
// node_modules
import { ref, watch } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// classes
import { normalizeDependsOn } from '@/utils/orchestratorPayload';

// types
import type { SubTask } from '@/@types/index';

/** Edit a step's name, category, prompt and dependencies. Extracted from OrchestratorPanel.vue. */

// -------------------------------------------------- Props --------------------------------------------------

const bOpen = defineModel<boolean>({ required: true });

const props = defineProps<{
  /** Index of the step being edited */
  taskIndex: number | null;
  subtasks: SubTask[];
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', draft: SubTask): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const editDraft = ref<SubTask>({ name: '', prompt: '', category: null });

// -------------------------------------------------- Watchers --------------------------------------------------

// Fresh draft from the step each time the modal opens
watch(bOpen, (bNowOpen) => {
  const task = props.taskIndex === null ? undefined : props.subtasks[props.taskIndex];
  if (!bNowOpen || !task) {
    return;
  }
  editDraft.value = {
    name: task.name,
    prompt: task.prompt,
    category: task.category ?? null,
    dependsOn: [...normalizeDependsOn(task.dependsOn)]
  };
});

// -------------------------------------------------- Methods --------------------------------------------------

function toggleDependsOn(depIndex: number) {
  const current = new Set(normalizeDependsOn(editDraft.value.dependsOn));
  if (current.has(depIndex)) {
    current.delete(depIndex);
  } else {
    current.add(depIndex);
  }
  editDraft.value = {
    ...editDraft.value,
    dependsOn: [...current].sort((left, right) => left - right)
  };
}
</script>

<template>
  <BaseModal
    v-model="bOpen"
    labelledby="edit-task-title"
    panel-class="max-w-md"
  >
    <ModalHeader
      eyebrow="// edit task"
      title="Edit task"
      title-id="edit-task-title"
      @close="emit('close')"
    />
    <div class="p-5 pt-4">
          <div class="space-y-4">
            <div>
              <label class="block text-xs font-medium text-text-muted mb-1">Name</label>
              <input
                v-model="editDraft.name"
                type="text"
                class="w-full text-sm px-3 py-2 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary"
                placeholder="Task name"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-text-muted mb-1"
                >Category (optional)</label
              >
              <input
                v-model="editDraft.category"
                type="text"
                class="w-full text-sm px-3 py-2 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary"
                placeholder="e.g. setup, implementation"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-text-muted mb-1">Prompt</label>
              <textarea
                v-model="editDraft.prompt"
                rows="4"
                class="w-full text-sm px-3 py-2 rounded-lg border border-fg/10 bg-fg/[0.04] text-text-primary placeholder-text-muted resize-y"
                placeholder="Instruction for this step"
              />
            </div>
            <div v-if="taskIndex !== null && taskIndex > 0">
              <p class="block text-xs font-medium text-text-muted mb-1">Depends on</p>
              <p class="text-xs text-text-muted mb-2">
                This step is skipped if a selected earlier step failed or was skipped.
              </p>
              <label
                v-for="(prior, depIndex) in subtasks.slice(0, taskIndex)"
                :key="'dep-' + depIndex"
                class="flex items-center gap-2 text-sm text-text-primary py-0.5"
              >
                <input
                  type="checkbox"
                  :checked="normalizeDependsOn(editDraft.dependsOn).includes(depIndex)"
                  @change="toggleDependsOn(depIndex)"
                />
                <span>Step {{ depIndex + 1 }}: {{ prior.name }}</span>
              </label>
            </div>
          </div>
          <div class="flex justify-end gap-2 mt-5">
            <button
              type="button"
              class="px-4 py-2 text-sm text-text-muted hover:text-text-primary border border-fg/10 rounded-lg"
              @click="emit('close')"
            >
              Cancel
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm font-medium btn-primary-solid rounded-lg"
              @click="emit('save', editDraft)"
            >
              Save
            </button>
          </div>
    </div>
  </BaseModal>
</template>

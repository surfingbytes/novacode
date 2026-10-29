<script setup lang="ts">
// node_modules
import { computed, ref, watch } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// classes
import { normalizeDependsOn } from '@/utils/orchestratorPayload';

// types
import type { SubTask } from '@/@types/index';

/**
 * Edit a step's name, category, prompt and dependencies, or (with `bNew`) draft a
 * new manual step. Extracted from OrchestratorPanel.vue.
 */

// -------------------------------------------------- Props --------------------------------------------------

const bOpen = defineModel<boolean>({ required: true });

const props = defineProps<{
  /** Index of the step being edited (ignored when adding) */
  taskIndex: number | null;
  subtasks: SubTask[];
  /** Add a step instead of editing one: empty draft, every manual step offered as dependency. */
  bNew?: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', draft: SubTask): void;
}>();

// -------------------------------------------------- Refs --------------------------------------------------

const editDraft = ref<SubTask>({ name: '', prompt: '', category: null });

// -------------------------------------------------- Computed --------------------------------------------------

const modalTitle = computed(() => (props.bNew ? 'Add step' : 'Edit task'));
const modalEyebrow = computed(() => (props.bNew ? '// add step' : '// edit task'));

/** Steps the draft may depend on: earlier manual steps (a new step goes before the automatic ones). */
const dependencyCandidates = computed(() => {
  const limit = props.bNew ? props.subtasks.length : props.taskIndex ?? 0;
  return props.subtasks
    .map((task, index) => ({ task, index }))
    .filter(({ task, index }) => index < limit && !task.kind);
});

/** A new step needs a name and a prompt; an edited one falls back to its previous values. */
const bCanSave = computed(
  () => !props.bNew || (editDraft.value.name.trim().length > 0 && editDraft.value.prompt.trim().length > 0)
);

// -------------------------------------------------- Watchers --------------------------------------------------

// Fresh draft from the step (or an empty one) each time the modal opens
watch(bOpen, (bNowOpen) => {
  if (!bNowOpen) {
    return;
  }
  if (props.bNew) {
    editDraft.value = { name: '', prompt: '', category: null, dependsOn: [] };
    return;
  }
  const task = props.taskIndex === null ? undefined : props.subtasks[props.taskIndex];
  if (!task) {
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
      :eyebrow="modalEyebrow"
      :title="modalTitle"
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
            <div v-if="dependencyCandidates.length > 0">
              <p class="block text-xs font-medium text-text-muted mb-1">Depends on</p>
              <p class="text-xs text-text-muted mb-2">
                This step is skipped if a selected earlier step failed or was skipped.
              </p>
              <label
                v-for="{ task: prior, index: depIndex } in dependencyCandidates"
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
              class="px-4 py-2 text-sm font-medium btn-primary-solid rounded-lg disabled:opacity-60"
              :disabled="!bCanSave"
              @click="emit('save', editDraft)"
            >
              {{ bNew ? 'Add step' : 'Save' }}
            </button>
          </div>
    </div>
  </BaseModal>
</template>

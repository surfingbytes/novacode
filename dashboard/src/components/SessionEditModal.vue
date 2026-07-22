<script setup lang="ts">
// node_modules
import { ref, watch } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';
import TagChipsInput from '@/components/input/TagChipsInput.vue';

// types
import type { Session } from '@/@types/index';

const props = defineProps<{
  modelValue: boolean;
  session: Session | null;
  loading?: boolean;
  /** Tag suggestions (e.g. other sessions in the workspace). */
  existingTags?: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [payload: { name: string; tags?: string[] | null }];
}>();

const name = ref('');
const formTags = ref<string[]>([]);

function tagsFromSession(s: Session | null): string[] {
  const raw = s?.tags;
  if (!raw || !Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== 'string') continue;
    const t = x.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

watch(
  () => props.session,
  (s) => {
    if (s) {
      name.value = s.name;
      formTags.value = tagsFromSession(s);
    }
  },
  { immediate: true }
);

const close = (): void => {
  if (!props.loading) emit('update:modelValue', false);
};

const onSave = (): void => {
  if (props.loading) return;
  const trimmedName = name.value.trim();
  if (!trimmedName) return;
  const tagsClean = formTags.value;
  emit('save', {
    name: trimmedName,
    tags: tagsClean.length > 0 ? tagsClean : null
  });
};
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    labelledby="session-edit-title"
    panel-class="max-w-sm"
    @update:model-value="close"
  >
    <!-- Panel -->
    <form class="contents" @submit.prevent="onSave">
          <ModalHeader
            eyebrow="// edit session"
            title="Edit session"
            title-id="session-edit-title"
            @close="close"
          />

          <div class="px-6 flex flex-col gap-4 pb-5">
            <!-- Name -->
            <div class="nc-field">
              <label class="nc-field-label" for="session-edit-name">Name</label>
              <input
                id="session-edit-name"
                v-model="name"
                type="text"
                placeholder="Session name"
                data-modal-autofocus
              />
            </div>

            <!-- Tags -->
            <div class="nc-field">
              <span class="nc-field-label"
                >Tags <span class="normal-case opacity-60">(optional)</span></span
              >
              <TagChipsInput
                v-model="formTags"
                :suggestions="existingTags ?? []"
                datalist-id="session-edit-tag-suggestions"
                hint="Separate tags with a comma, or press Enter/Done. Suggestions from other sessions."
              />
            </div>
          </div>

          <!-- Actions -->
          <div class="flex items-center justify-end gap-2 px-6 pb-5">
            <button
              type="button"
              class="button"
              :disabled="loading"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="button is-primary"
              :disabled="loading || !name.trim()"
            >
              <div v-if="loading" class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Save
            </button>
          </div>
    </form>
  </BaseModal>
</template>

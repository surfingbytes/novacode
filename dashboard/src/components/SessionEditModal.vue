<script setup lang="ts">
// node_modules
import { ref, watch } from 'vue';

// components
import BaseModal from '@/components/BaseModal.vue';
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
          <div class="px-6 pt-5 pb-4">
            <h2 id="session-edit-title" class="font-semibold text-text-primary text-lg">Edit session</h2>
          </div>

          <div class="px-6 flex flex-col gap-4 pb-5">
            <!-- Name -->
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-medium text-text-muted">Name</label>
              <input
                v-model="name"
                type="text"
                placeholder="Session name"
                autofocus
                class="w-full text-sm px-3 py-3 rounded-lg border border-fg/[0.12] bg-fg/[0.04] text-text-primary placeholder-text-muted focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>

            <!-- Tags -->
            <div class="flex flex-col gap-1.5">
              <label class="text-xs font-medium text-text-muted"
                >Tags <span class="font-normal opacity-60">(optional)</span></label
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
              class="px-4 py-2.5 text-sm text-text-muted hover:text-text-primary bg-fg/[0.04] hover:bg-fg/[0.08] border border-fg/[0.08] rounded-lg transition-all disabled:opacity-50"
              :disabled="loading"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="submit"
              class="flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-primary hover:bg-primary-hover text-on-accent rounded-lg shadow-lg shadow-primary/20 transition-all disabled:opacity-50"
              :disabled="loading || !name.trim()"
            >
              <div v-if="loading" class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Save
            </button>
          </div>
    </form>
  </BaseModal>
</template>

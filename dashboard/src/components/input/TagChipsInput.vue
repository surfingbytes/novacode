<script setup lang="ts">
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    /** Suggestions for the datalist (e.g. tags used elsewhere). */
    suggestions?: string[];
    placeholder?: string;
    hint?: string;
    datalistId?: string;
  }>(),
  {
    suggestions: () => [],
    placeholder: 'Add tag…',
    hint: 'Separate tags with a comma, or press Enter/Done.',
    datalistId: 'tag-chips-suggestions'
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const tagInput = ref('');

const tagSuggestions = computed((): string[] => {
  const raw = props.suggestions ?? [];
  const added = new Set(props.modelValue.map((t) => t.toLowerCase()));
  const q = tagInput.value.trim().toLowerCase();
  return raw
    .filter((t) => !added.has(t.toLowerCase()))
    .filter((t) => !q || t.toLowerCase().includes(q))
    .slice(0, 10);
});

function normalizeTags(raw: string[]): string[] {
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

function setTags(next: string[]): void {
  emit('update:modelValue', normalizeTags(next));
}

const addTag = (tag: string): void => {
  const t = tag.trim();
  if (!t) return;
  const lower = t.toLowerCase();
  if (props.modelValue.some((x) => x.toLowerCase() === lower)) return;
  setTags([...props.modelValue, t]);
  tagInput.value = '';
};

const removeTag = (index: number): void => {
  setTags(props.modelValue.filter((_, i) => i !== index));
};

const onTagInputKeydown = (e: KeyboardEvent): void => {
  const k = e.key;
  const isEnter = k === 'Enter' || k === 'NumpadEnter';
  const isComma = k === ',' || k === 'Comma';
  if (isEnter || isComma) {
    e.preventDefault();
    addTag(tagInput.value);
  }
};

const onTagInputKeyup = (e: KeyboardEvent): void => {
  const k = e.key;
  if (k === 'Enter' || k === 'NumpadEnter') {
    e.preventDefault();
    addTag(tagInput.value);
  }
};

const onTagInputInput = (): void => {
  const v = tagInput.value;
  if (!v.includes(',')) return;
  const parts = v.split(',');
  const remainder = parts.pop() ?? '';
  for (const p of parts) {
    addTag(p);
  }
  tagInput.value = remainder;
};
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <div class="input-wrap w-full min-w-0">
      <div
        class="tag-input-shell flex flex-wrap gap-1.5 items-center content-start w-full min-w-0 min-h-10 rounded-md border border-border bg-input px-3 py-1.5 text-sm transition-all outline-none focus-within:border-primary/70"
      >
        <span
          v-for="(tag, index) in modelValue"
          :key="`${tag}-${index}`"
          class="inline-flex items-center gap-0.5 shrink-0 rounded-md bg-primary/15 text-primary text-sm px-2 py-0.5 max-w-full"
        >
          {{ tag }}
          <button
            type="button"
            class="rounded hover:bg-primary/20 p-0.5"
            @mousedown.prevent
            @click="removeTag(index)"
            aria-label="Remove tag"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </span>
        <input
          v-model="tagInput"
          type="text"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          enterkeyhint="done"
          inputmode="text"
          class="tag-input-field min-h-0 border-0 bg-transparent px-1 py-0 shadow-none text-text-primary text-sm placeholder:text-text-muted outline-none"
          :placeholder="placeholder"
          :list="datalistId"
          @keydown="onTagInputKeydown"
          @keyup="onTagInputKeyup"
          @input="onTagInputInput"
          @blur="addTag(tagInput)"
        />
      </div>
    </div>
    <datalist :id="datalistId">
      <option v-for="s in tagSuggestions" :key="s" :value="s" />
    </datalist>
    <p v-if="hint" class="text-xs text-text-muted">{{ hint }}</p>
  </div>
</template>

<style scoped>
.tag-input-shell .tag-input-field {
  width: auto !important;
  min-width: 2.5rem;
  flex: 1 1 0%;
  min-height: 0 !important;
  height: auto !important;
  max-width: 100%;
  padding: 0 0.25rem !important;
  border: none !important;
  border-radius: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}
</style>

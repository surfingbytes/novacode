<script setup lang="ts">
// node_modules
import { computed, ref, watch } from 'vue';

// components
import ColorPicker from '@/components/input/ColorPicker.vue';
import DirPickerModal from '@/components/DirPickerModal.vue';

// types
import type { AgentType, Workspace } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------
const props = defineProps<{
  modelValue: boolean;
  workspace?: Workspace;
  /** Existing group names for suggestions when creating/editing (optional). */
  existingGroups?: string[];
  /** Tags from other workspaces for suggestions (optional). */
  existingTags?: string[];
  /** Whether Cursor can be used (authenticated). */
  cursorAvailable?: boolean;
  /** Whether Claude can be used (CLI available and token configured). */
  claudeAvailable?: boolean;
  /** Whether Mistral Vibe can be used (CLI on PATH and API key configured). */
  mistralVibeAvailable?: boolean;
  /** Whether OpenCode can be used (CLI on PATH and ACP server available). */
  codexAvailable?: boolean;
  openCodeAvailable?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'createGroup', value: string): void;
  (
    e: 'save',
    payload: {
      name: string;
      path: string;
      group: string | null;
      gitUserName: string | null;
      gitUserEmail: string | null;
      color: string | null;
      defaultAgentType: AgentType | null;
      tags: string[] | null;
    }
  ): void;
}>();

// -------------------------------------------------- Types --------------------------------------------------
interface FormState {
  name: string;
  path: string;
  group: string;
  gitUserName: string;
  gitUserEmail: string;
  color: string;
  defaultAgentType: string;
  tags: string[];
}

// -------------------------------------------------- Computed --------------------------------------------------
const AGENT_OPTIONS = computed(() => {
  const options: { value: AgentType; label: string }[] = [];
  if (props.cursorAvailable !== false) {
    options.push({ value: 'cursor-agent', label: 'Cursor' });
  }
  if (props.mistralVibeAvailable !== false) {
    options.push({ value: 'mistral-vibe', label: 'Mistral Vibe' });
  }
  if (props.claudeAvailable !== false) {
    options.push({ value: 'claude', label: 'Claude' });
  }
  if (props.openCodeAvailable !== false) {
    options.push({ value: 'open-code', label: 'OpenCode' });
  }
  if (props.codexAvailable !== false) {
    options.push({ value: 'codex', label: 'Codex' });
  }
  return options;
});

// -------------------------------------------------- Refs --------------------------------------------------
const form = ref<FormState>({
  name: '',
  path: '',
  group: '',
  gitUserName: '',
  gitUserEmail: '',
  color: '',
  defaultAgentType: '',
  tags: []
});
const errors = ref<{ name?: string; path?: string; defaultAgentType?: string }>({});
const bSaving = ref<boolean>(false);
const bShowDirPicker = ref<boolean>(false);
const bNewGroupAddActive = ref<boolean>(false);
const groupNameInput = ref<string>('');
const newGroupError = ref<string | null>(null);
const tagInput = ref<string>('');

// -------------------------------------------------- Computed --------------------------------------------------
/** Tag suggestions from other workspaces, filtered by current input, excluding already-added tags. */
const tagSuggestions = computed((): string[] => {
  const raw = props.existingTags ?? [];
  const added = new Set(form.value.tags.map((t) => t.toLowerCase()));
  const q = tagInput.value.trim().toLowerCase();
  return raw
    .filter((t) => !added.has(t.toLowerCase()))
    .filter((t) => !q || t.toLowerCase().includes(q))
    .slice(0, 10);
});

// -------------------------------------------------- Methods --------------------------------------------------
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

// --- validation ---
const validate = (): boolean => {
  errors.value = {};
  if (!form.value.name.trim()) errors.value.name = 'Name is required';
  if (!form.value.path.trim()) errors.value.path = 'Path is required';
  if (!form.value.defaultAgentType) errors.value.defaultAgentType = 'Default agent is required';
  return Object.keys(errors.value).length === 0;
};

// --- submit / close ---
const submit = async (): Promise<void> => {
  if (!validate()) return;
  addTag(tagInput.value);
  const tagsClean = normalizeTags(form.value.tags);
  form.value.tags = tagsClean;
  tagInput.value = '';
  bSaving.value = true;
  try {
    emit('save', {
      name: form.value.name.trim(),
      path: form.value.path.trim(),
      group: form.value.group.trim() || null,
      gitUserName: form.value.gitUserName.trim() || null,
      gitUserEmail: form.value.gitUserEmail.trim() || null,
      color: form.value.color.trim() || null,
      defaultAgentType:
        form.value.defaultAgentType &&
        AGENT_OPTIONS.value.some((o) => o.value === form.value.defaultAgentType)
          ? (form.value.defaultAgentType as AgentType)
          : null,
      tags: tagsClean.length > 0 ? tagsClean : null
    });
  } finally {
    bSaving.value = false;
  }
};

const close = (): void => {
  emit('update:modelValue', false);
};

// --- dir picker ---
const onDirPicked = (path: string): void => {
  form.value.path = path;
  bShowDirPicker.value = false;
  if (!form.value.name.trim()) {
    form.value.name = path.split('/').pop() ?? '';
  }
};

// --- group ---
const createNewGroup = (): void => {
  if (!groupNameInput.value.trim()) {
    newGroupError.value = 'Name is required';
    return;
  }

  newGroupError.value = null;
  bNewGroupAddActive.value = false;
  emit('createGroup', groupNameInput.value.trim());
  form.value.group = groupNameInput.value.trim();
  groupNameInput.value = '';
};

// --- tags ---
const addTag = (tag: string): void => {
  const t = tag.trim();
  if (!t) return;
  const lower = t.toLowerCase();
  if (form.value.tags.some((x) => x.toLowerCase() === lower)) return;
  form.value.tags = [...form.value.tags, t];
  tagInput.value = '';
};

const removeTag = (index: number): void => {
  form.value.tags = form.value.tags.filter((_, i) => i !== index);
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

/** Mobile keyboards often omit keydown for Enter; keyup + comma-in-value still commit. */
const onTagInputKeyup = (e: KeyboardEvent): void => {
  const k = e.key;
  if (k === 'Enter' || k === 'NumpadEnter') {
    e.preventDefault();
    addTag(tagInput.value);
  }
};

/** Commit tags when user types commas (works on soft keyboards that do not emit comma key events). */
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

// -------------------------------------------------- Watchers --------------------------------------------------
watch(
  () => props.modelValue,
  (open: boolean) => {
    if (open) {
      const rawTags = props.workspace?.tags;
      const tags = normalizeTags(
        Array.isArray(rawTags)
          ? rawTags.filter((t): t is string => typeof t === 'string')
          : []
      );
      form.value = {
        name: props.workspace?.name ?? '',
        path: props.workspace?.path ?? '',
        group: props.workspace?.group ?? '',
        gitUserName: props.workspace?.gitUserName ?? '',
        gitUserEmail: props.workspace?.gitUserEmail ?? '',
        color: props.workspace?.color ?? '',
        defaultAgentType: props.workspace?.defaultAgentType ?? '',
        tags
      };
      tagInput.value = '';
      errors.value = {};
    }
  }
);
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="modal-wrap" role="dialog" aria-modal="true">
        <!-- Backdrop -->
        <div class="modal-backdrop" @click="close"></div>

        <!-- Panel -->
        <div class="modal-panel max-w-md">
          <!-- Header -->
          <div class="modal-header">
            <div>
              {{ workspace ? 'Edit Workspace' : 'Add Workspace' }}
            </div>
            <button class="close-button" @click="close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="select-none"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>

          <!-- Body -->
          <div class="modal-body">
            <!-- Name -->
            <div class="field" :class="{ 'has-error': errors.name }">
              <div class="label">Workspace Name</div>
              <div class="input-wrap">
                <input v-model="form.name" type="text" placeholder="e.g. My Projects" />
              </div>
              <p v-if="errors.name" class="hint is-error">{{ errors.name }}</p>
            </div>

            <!-- Group (optional) -->
            <div class="field">
              <div class="label">
                Group

                <button @click="bNewGroupAddActive = true" v-if="!bNewGroupAddActive">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
                  New Group
                </button>
              </div>
              <div class="input-wrap">
                <select
                  v-if="!bNewGroupAddActive"
                  v-model="form.group"
                  :options="existingGroups || []"
                  placeholder="Select a group"
                  :clearable="false"
                >
                  <option v-for="g in existingGroups || []" :key="g" :value="g">{{ g }}</option>
                </select>
                <input v-else v-model="groupNameInput" type="text" placeholder="New group name" />
                <button class="button is-primary" @click="createNewGroup" v-if="bNewGroupAddActive">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H5a2 2 0 00-2 2v13a2 2 0 002 2h13a2 2 0 002-2v-6"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>
                  Create
                </button>
                <button
                  class="button is-icon"
                  @click="bNewGroupAddActive = false"
                  v-if="bNewGroupAddActive"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
              <p class="hint is-error" v-if="newGroupError">Name is required</p>
              <p class="hint" v-else>Select an existing group or type a new name to create one.</p>
            </div>

            <!-- Tags: chips + field share one bordered control (global input { width:100% } is overridden in scoped CSS). -->
            <div class="field">
              <div class="label">Tags</div>
              <div class="input-wrap w-full min-w-0">
                <div
                  class="tag-input-shell flex flex-wrap gap-1.5 items-center content-start w-full min-w-0 min-h-10 rounded-md border border-border bg-input px-3 py-1.5 text-sm transition-all outline-none focus-within:border-primary/70"
                >
                  <span
                    v-for="(tag, index) in form.tags"
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
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
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
                    placeholder="Add tag…"
                    list="tag-suggestions"
                    @keydown="onTagInputKeydown"
                    @keyup="onTagInputKeyup"
                    @input="onTagInputInput"
                    @blur="addTag(tagInput)"
                  />
                </div>
              </div>
              <datalist id="tag-suggestions">
                <option v-for="s in tagSuggestions" :key="s" :value="s" />
              </datalist>
              <p class="hint">
                Separate tags with a comma, or press Enter/Done. Suggestions from other workspaces.
              </p>
            </div>

            <!-- Path -->
            <div class="field" :class="{ 'has-error': errors.path }">
              <div class="label">Project Path</div>
              <div class="input-wrap">
                <input v-model="form.path" type="text" placeholder="/my-project" />
                <div class="icon is-small">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
                </div>
                <button class="button" @click="bShowDirPicker = true">Browse...</button>
              </div>
              <p v-if="errors.path" class="hint is-error">{{ errors.path }}</p>
              <p v-else class="hint">
                Path to the workspace directory. Use Browse to pick a folder from the server.
              </p>
            </div>

            <!-- Color -->

            <div class="field">
              <div class="label">Color</div>
              <ColorPicker v-model="form.color" />
            </div>

            <!-- Default Agent -->
            <div class="field" :class="{ 'has-error': errors.defaultAgentType }">
              <div class="label">Default Agent</div>
              <div class="button-select">
                <button
                  type="button"
                  class="button is-transparent"
                  v-for="opt in AGENT_OPTIONS"
                  :key="opt.value"
                  :class="form.defaultAgentType === opt.value ? 'is-active' : ''"
                  @click="form.defaultAgentType = opt.value"
                  v-text="opt.label"
                ></button>
              </div>
              <p v-if="errors.defaultAgentType" class="hint is-error">
                {{ errors.defaultAgentType }}
              </p>
            </div>
            <hr />

            <!-- Git Identity Override -->
            <div class="box">
              <h3 class="text-sm font-semibold text-text-primary mb-3">
                Git Identity Override (optional)
              </h3>
              <div class="grid grid-cols-2 gap-2">
                <div class="field">
                  <div class="label">Username</div>
                  <div class="input-wrap">
                    <input v-model="form.gitUserName" type="text" placeholder="your-username" />
                  </div>
                  <p class="hint">Leave blank to use global setting</p>
                </div>
                <div class="field">
                  <div class="label">Email</div>
                  <div class="input-wrap">
                    <input v-model="form.gitUserEmail" type="email" placeholder="your@email.com" />
                  </div>
                  <p class="hint">Leave blank to use global setting</p>
                </div>
              </div>
            </div>
            <!-- Git Identity Override -->
          </div>

          <!-- Footer -->
          <div class="modal-footer flex items-center justify-between gap-2">
            <button class="button is-transparent" @click="close">Cancel</button>

            <button class="button is-primary" :disabled="bSaving" @click="submit">
              <div v-if="bSaving" class="loading-spinner"></div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {{ workspace ? 'Save Workspace' : 'Create Workspace' }}
            </button>
          </div>
        </div>

        <DirPickerModal v-model="bShowDirPicker" :initial-path="form.path" @select="onDirPicked" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/*
 * Global `input { width: 100%; height: 2.5rem; ... }` forces the tag field to full width, so chips
 * wrap above the caret and look “outside” the typing area. Shrink the inner field to a flex item.
 */
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

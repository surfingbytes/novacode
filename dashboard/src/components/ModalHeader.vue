<script setup lang="ts">
// -------------------------------------------------- Props --------------------------------------------------

withDefaults(
  defineProps<{
    /** Eyebrow text shown above the title, e.g. '// add workspace' */
    eyebrow?: string;
    title: string;
    /** id applied to the title — point BaseModal's labelledby here */
    titleId?: string;
    showClose?: boolean;
  }>(),
  {
    eyebrow: undefined,
    titleId: undefined,
    showClose: true
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <div class="modal-header">
    <div class="modal-header__text">
      <div v-if="eyebrow" class="nc-eyebrow modal-header__eyebrow">{{ eyebrow }}</div>
      <h2 :id="titleId" class="modal-header__title">{{ title }}</h2>
    </div>
    <button
      v-if="showClose"
      type="button"
      class="modal-header__close"
      aria-label="Close dialog"
      @click="emit('close')"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        class="select-none"
      >
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 24px 0;
  flex-shrink: 0;
}
.modal-header__text {
  min-width: 0;
}
.modal-header__eyebrow {
  margin-bottom: 5px;
}
.modal-header__title {
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--fg);
  margin: 0;
}
.modal-header__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.1s,
    color 0.1s;
}
.modal-header__close:hover {
  background: var(--bg-hover);
  color: var(--fg);
}
</style>

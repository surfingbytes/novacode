<script setup lang="ts">
// node_modules
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

// components
import BaseModal from '@/components/BaseModal.vue';
import ModalHeader from '@/components/ModalHeader.vue';

// -------------------------------------------------- Types --------------------------------------------------

type TourAction = 'addWorkspace' | 'openIntegrations' | 'showShortcuts';

interface TourCard {
  title: string;
  sentences: [string, string];
  action?: { id: TourAction; label: string };
}

// -------------------------------------------------- Props --------------------------------------------------

const props = defineProps<{
  modelValue: boolean;
}>();

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  done: [];
  skip: [];
  addWorkspace: [];
}>();

// -------------------------------------------------- Constants --------------------------------------------------

const CARDS: TourCard[] = [
  {
    title: 'Workspaces',
    sentences: [
      'A workspace maps a directory under the data root to a project.',
      'Sessions, files and git for that project all live inside it.'
    ],
    action: { id: 'addWorkspace', label: 'Add workspace' }
  },
  {
    title: 'Sessions and agents',
    sentences: [
      'Start one chat per task and pick any of the five agents for it.',
      'Authenticate your agents in Settings first so they can run.'
    ],
    action: { id: 'openIntegrations', label: 'Open integrations' }
  },
  {
    title: 'Orchestrators',
    sentences: [
      'Plan big work in a chat and split it into steps.',
      'Run the steps one by one or in parallel, each in its own worktree.'
    ]
  },
  {
    title: 'Search and shortcuts',
    sentences: [
      'Press Ctrl/⌘+K to search workspaces, sessions and files.',
      'Press ? anywhere to open the keyboard shortcut cheat sheet.'
    ],
    action: { id: 'showShortcuts', label: 'Show shortcuts' }
  }
];

// -------------------------------------------------- Stores --------------------------------------------------

const router = useRouter();

// -------------------------------------------------- Refs --------------------------------------------------

const cardIndex = ref<number>(0);

// -------------------------------------------------- Computed --------------------------------------------------

const currentCard = computed((): TourCard => CARDS[cardIndex.value]);
const bIsFirstCard = computed((): boolean => cardIndex.value === 0);
const bIsLastCard = computed((): boolean => cardIndex.value === CARDS.length - 1);

// -------------------------------------------------- Methods --------------------------------------------------

const close = (): void => {
  emit('update:modelValue', false);
};

const goNext = (): void => {
  if (!bIsLastCard.value) {
    cardIndex.value += 1;
  }
};

const goBack = (): void => {
  if (!bIsFirstCard.value) {
    cardIndex.value -= 1;
  }
};

const finish = (): void => {
  emit('done');
  close();
};

const skip = (): void => {
  emit('skip');
  close();
};

/** BaseModal closes on Esc only (backdrop is disabled) — treat it as Skip. */
const onModalUpdate = (bOpen: boolean): void => {
  if (!bOpen) {
    skip();
  }
};

const runAction = (action: TourAction): void => {
  if (action === 'addWorkspace') {
    emit('addWorkspace');
    return;
  }
  if (action === 'openIntegrations') {
    // Leaving the page ends the tour; count it as skipped so it is not shown again.
    skip();
    void router.push({ name: 'settings', query: { tab: 'integrations' } });
    return;
  }
  window.dispatchEvent(new CustomEvent('novacode:open-shortcuts'));
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    goNext();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    goBack();
  }
};

// -------------------------------------------------- Watchers --------------------------------------------------

watch(
  () => props.modelValue,
  (bOpen) => {
    if (bOpen) {
      cardIndex.value = 0;
      window.addEventListener('keydown', onKeydown);
    } else {
      window.removeEventListener('keydown', onKeydown);
    }
  },
  { immediate: true }
);

// -------------------------------------------------- Lifecycle --------------------------------------------------

onBeforeUnmount((): void => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <!-- z-40 keeps the shortcuts cheat sheet (z-50) above the tour when opened from card 4 -->
  <BaseModal
    :model-value="modelValue"
    labelledby="tour-modal-title"
    panel-class="max-w-lg"
    overlay-class="z-40"
    :close-on-backdrop="false"
    @update:model-value="onModalUpdate"
  >
    <ModalHeader
      :eyebrow="`// tour ${cardIndex + 1}/${CARDS.length}`"
      :title="currentCard.title"
      title-id="tour-modal-title"
      :show-close="false"
    />
    <div class="flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-3">
      <p
        v-for="sentence in currentCard.sentences"
        :key="sentence"
        class="tour__sentence text-[13px] text-[var(--fg-muted)] leading-relaxed"
      >
        {{ sentence }}
      </p>
      <button
        v-if="currentCard.action"
        type="button"
        class="button tour__action mt-3"
        @click="runAction(currentCard.action.id)"
      >
        {{ currentCard.action.label }}
      </button>
    </div>
    <div class="flex flex-shrink-0 items-center justify-between gap-2 px-6 pb-5 pt-2">
      <div class="flex items-center gap-1.5" aria-hidden="true">
        <span
          v-for="(card, index) in CARDS"
          :key="card.title"
          class="tour__dot"
          :class="index === cardIndex ? 'tour__dot--active' : ''"
        />
      </div>
      <div class="flex items-center gap-2">
        <button v-if="!bIsLastCard" type="button" class="button tour__skip" @click="skip">
          Skip
        </button>
        <button v-if="!bIsFirstCard" type="button" class="button tour__back" @click="goBack">
          Back
        </button>
        <button
          v-if="bIsLastCard"
          type="button"
          class="button is-primary tour__done"
          data-modal-autofocus
          @click="finish"
        >
          Done
        </button>
        <button
          v-else
          type="button"
          class="button is-primary tour__next"
          data-modal-autofocus
          @click="goNext"
        >
          Next
        </button>
      </div>
    </div>
  </BaseModal>
</template>

<style scoped>
.tour__sentence + .tour__sentence {
  margin-top: 6px;
}
.tour__dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--line-strong);
  transition: background 0.15s;
}
.tour__dot--active {
  background: var(--accent);
}
</style>

<script setup lang="ts">
// -------------------------------------------------- Props --------------------------------------------------
withDefaults(
  defineProps<{
    icon?: 'folder' | 'terminal' | 'clock' | 'search' | 'git' | 'none';
    title: string;
    description?: string;
  }>(),
  {
    icon: 'none',
    description: undefined
  }
);
</script>

<template>
  <div class="flex flex-col items-center justify-center text-center gap-2.5 px-6 py-16">
    <div
      v-if="icon !== 'none'"
      class="w-14 h-14 rounded-[10px] bg-[var(--bg-elev)] border border-[var(--line)] flex items-center justify-center text-[var(--fg-muted)] mb-1"
      aria-hidden="true"
    >
      <svg v-if="icon === 'folder'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
      <svg v-else-if="icon === 'terminal'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6-6-6M12 19h8"/></svg>
      <svg v-else-if="icon === 'clock'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      <svg v-else-if="icon === 'search'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <svg v-else-if="icon === 'git'" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 01-9 9"/></svg>
    </div>
    <h3 class="m-0 text-[15px] font-semibold text-[var(--fg)]">
      {{ title }}
    </h3>
    <p v-if="description" class="m-0 text-[13px] leading-relaxed text-[var(--fg-subtle)] max-w-[340px]">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-2">
      <slot />
    </div>
  </div>
</template>

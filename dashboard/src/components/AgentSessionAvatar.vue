<script setup lang="ts">
// node_modules
import { computed } from 'vue';

// types
import type { AgentType } from '@/@types/index';

/** Served from `public/icons/` (bundled at build; not external URLs). */
function iconUrl(name: 'cursor' | 'claude' | 'vibe' | 'opencode'): string {
  return `${import.meta.env.BASE_URL}icons/${name}.svg`;
}

const CURSOR_ICON = iconUrl('cursor');
const CLAUDE_ICON = iconUrl('claude');
const VIBE_ICON = iconUrl('vibe');
const OPENCODE_ICON = iconUrl('opencode');

const props = defineProps<{
  agentType: AgentType;
}>();

// -------------------------------------------------- Computed --------------------------------------------------
const variant = computed(() => {
  if (props.agentType === 'claude') {
    return 'claude' as const;
  }
  if (props.agentType === 'mistral-vibe') {
    return 'vibe' as const;
  }
  if (props.agentType === 'open-code') {
    return 'opencode' as const;
  }
  return 'cursor' as const;
});

const iconSrc = computed(() => {
  if (variant.value === 'claude') {
    return CLAUDE_ICON;
  }
  if (variant.value === 'vibe') {
    return VIBE_ICON;
  }
  if (variant.value === 'opencode') {
    return OPENCODE_ICON;
  }
  return CURSOR_ICON;
});

const iconLabel = computed(() => {
  if (variant.value === 'claude') {
    return 'Claude';
  }
  if (variant.value === 'vibe') {
    return 'Mistral Vibe';
  }
  if (variant.value === 'opencode') {
    return 'OpenCode';
  }
  return 'Cursor';
});
</script>

<template>
  <div
    class="w-11 h-11 rounded-full shrink-0 flex items-center justify-center overflow-hidden border border-fg/10 p-1.5"
    :class="[
      variant === 'claude'
        ? 'avatar-tint-claude'
        : variant === 'vibe'
          ? 'avatar-tint-vibe'
          : variant === 'opencode'
            ? 'avatar-tint-opencode'
            : 'bg-white avatar-cursor-wrap'
    ]"
  >
    <img
      :src="iconSrc"
      :alt="iconLabel"
      class="avatar-icon-img object-contain"
      width="32"
      height="32"
      loading="lazy"
      decoding="async"
    />
  </div>
</template>

<style scoped>
/* ~30% smaller than filling the padded circle */
.avatar-icon-img {
  width: 70%;
  height: 70%;
}

/* Agent identity tints from theme tokens (adapt per theme, unlike raw palette classes) */
.avatar-tint-claude {
  background: color-mix(in oklab, var(--agent-claude) 12%, transparent);
}
.avatar-tint-vibe {
  background: color-mix(in oklab, var(--agent-vibe) 12%, transparent);
}
.avatar-tint-opencode {
  background: color-mix(in oklab, var(--agent-opencode) 12%, transparent);
}

/* Cursor only: invert circle + icon together on dark themes */
:global(html[data-theme='dark'] .avatar-cursor-wrap) {
  filter: invert(1);
}
</style>

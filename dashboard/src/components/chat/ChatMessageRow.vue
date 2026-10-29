<script setup lang="ts">
/**
 * Chat message row shell: avatar square + mono name/age caption (+ optional
 * copy / edit buttons); the message body goes in the default slot.
 * Extracted from ChatMessageList.vue.
 */

// -------------------------------------------------- Props --------------------------------------------------

withDefaults(
  defineProps<{
    /** Avatar color modifier, e.g. `user`, `claude`, `agent` */
    avatarVariant: string;
    initial: string;
    name: string;
    age: string;
    /** Message key used by find-in-chat (`data-find-key`) */
    findKey?: string;
    bFindMatch?: boolean;
    /** Show the copy-message button */
    bCopyable?: boolean;
    bCopied?: boolean;
    /** Show the edit-message button (put the text back into the composer) */
    bEditable?: boolean;
  }>(),
  {
    findKey: undefined,
    bFindMatch: false,
    bCopyable: false,
    bCopied: false,
    bEditable: false
  }
);

// -------------------------------------------------- Emits --------------------------------------------------

const emit = defineEmits<{
  (e: 'copy'): void;
  (e: 'edit'): void;
}>();
</script>

<template>
  <div
    class="chat-msg-row"
    :class="{ 'chat-msg-row--find': bFindMatch }"
    :data-find-key="findKey"
  >
    <!-- Avatar -->
    <div
      class="chat-avatar nc-mono"
      :class="`chat-avatar--${avatarVariant}`"
      aria-hidden="true"
    >
      {{ initial }}
    </div>
    <div class="min-w-0 flex-1 space-y-2">
      <!-- Name + age -->
      <div class="chat-msg-meta nc-mono">
        <span class="chat-msg-name">{{ name }}</span>
        <span class="chat-msg-age">· {{ age }}</span>
        <button
          v-if="bCopyable"
          type="button"
          class="chat-msg-action chat-msg-copy"
          :data-copied="bCopied ? '1' : undefined"
          :title="bCopied ? 'Copied' : 'Copy message'"
          :aria-label="bCopied ? 'Copied' : 'Copy message'"
          @click="emit('copy')"
        >
          <template v-if="bCopied">Copied</template>
          <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
        <button
          v-if="bEditable"
          type="button"
          class="chat-msg-action chat-msg-edit"
          title="Edit and resend"
          aria-label="Edit message"
          @click="emit('edit')"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/></svg>
        </button>
      </div>

      <slot />
    </div>
  </div>
</template>

<style scoped>
/* Redesign message row: avatar square + mono meta */
.chat-msg-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border-radius: 8px;
}
.chat-msg-row--find {
  outline: 1px solid color-mix(in oklab, var(--accent) 55%, transparent);
  outline-offset: 4px;
  background: color-mix(in oklab, var(--accent) 8%, transparent);
}
.chat-avatar {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 500;
  flex-shrink: 0;
  margin-top: 1px;
}
.chat-avatar--user {
  background: var(--accent-soft);
  color: var(--accent);
}
.chat-avatar--claude {
  background: color-mix(in oklab, var(--agent-claude) 16%, transparent);
  color: var(--agent-claude);
}
.chat-avatar--cursor-agent {
  background: color-mix(in oklab, var(--agent-cursor) 16%, transparent);
  color: var(--agent-cursor);
}
.chat-avatar--mistral-vibe {
  background: color-mix(in oklab, var(--agent-vibe) 16%, transparent);
  color: var(--agent-vibe);
}
.chat-avatar--open-code {
  background: color-mix(in oklab, var(--agent-opencode) 16%, transparent);
  color: var(--agent-opencode);
}
.chat-avatar--codex,
.chat-avatar--agent {
  background: var(--bg-elev-2);
  color: var(--fg-muted);
}
.chat-msg-meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 10.5px;
  color: var(--fg-subtle);
  line-height: 1;
  padding-top: 3px;
}
.chat-msg-action {
  display: inline-flex;
  align-items: center;
  align-self: center;
  margin-left: 2px;
  padding: 2px;
  border-radius: 4px;
  color: var(--fg-faint);
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.chat-msg-row:hover .chat-msg-action,
.chat-msg-action:focus-visible,
.chat-msg-copy[data-copied] {
  opacity: 1;
}
.chat-msg-action:hover,
.chat-msg-copy[data-copied] {
  color: var(--fg-muted);
}
@media (hover: none) {
  .chat-msg-action {
    opacity: 1;
  }
}
.chat-msg-name {
  color: var(--fg-muted);
  font-weight: 500;
}
.chat-msg-age {
  color: var(--fg-faint);
}
</style>

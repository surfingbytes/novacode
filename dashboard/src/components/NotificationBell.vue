<script setup lang="ts">
// node_modules
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

// stores
import { useNotificationsStore, type AppNotification, type AppNotificationKind } from '@/stores/notifications';

// utils
import { relativeTimeShort } from '@/utils/relativeTime';

// -------------------------------------------------- Props --------------------------------------------------

withDefaults(
  defineProps<{
    /** Compact icon-only style for the mobile sidebar footer */
    compact?: boolean;
  }>(),
  { compact: false }
);

// -------------------------------------------------- Refs --------------------------------------------------

const KIND_ICON_PATHS: Record<AppNotificationKind, string> = {
  'session-finished': 'M20 6L9 17l-5-5',
  'orchestrator-finished': 'M12 21a9 9 0 100-18 9 9 0 000 18z M8 12l3 3 5-6',
  'orchestrator-failed': 'M12 21a9 9 0 100-18 9 9 0 000 18z M15 9l-6 6 M9 9l6 6',
  'orchestrator-needs-input': 'M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z M12 8v4 M12 15.5h.01',
  'automation-failed': 'M12 3l9.5 17h-19L12 3z M12 10v4 M12 17h.01'
};

const notifications = useNotificationsStore();
const router = useRouter();

const bOpen = ref<boolean>(false);
const rootRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const buttonRef = ref<HTMLButtonElement | null>(null);

// -------------------------------------------------- Computed --------------------------------------------------

const badgeLabel = computed<string>(() => (notifications.unreadCount > 99 ? '99+' : String(notifications.unreadCount)));

const buttonLabel = computed<string>(() =>
  notifications.unreadCount === 0
    ? 'Notifications'
    : `Notifications, ${notifications.unreadCount} unread`
);

// -------------------------------------------------- Methods --------------------------------------------------

function toggle(): void {
  bOpen.value = !bOpen.value;
}

function close(bReturnFocus = false): void {
  bOpen.value = false;
  if (bReturnFocus) {
    buttonRef.value?.focus();
  }
}

function getMenuItems(): HTMLButtonElement[] {
  return Array.from(panelRef.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
}

function focusItem(index: number): void {
  const items = getMenuItems();
  if (items.length === 0) {
    return;
  }
  items[(index + items.length) % items.length]?.focus({ preventScroll: true });
}

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    close(true);
    return;
  }
  const items = getMenuItems();
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusItem(current + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusItem(current < 0 ? -1 : current - 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    focusItem(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    focusItem(-1);
  }
}

function onPointerDown(event: PointerEvent): void {
  if (rootRef.value?.contains(event.target as Node)) {
    return;
  }
  close();
}

function bindGlobal(): void {
  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointerDown, true);
}

function unbindGlobal(): void {
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('pointerdown', onPointerDown, true);
}

function openItem(item: AppNotification): void {
  notifications.markRead(item.id);
  close();
  void router.push(item.href);
}

// -------------------------------------------------- Watchers --------------------------------------------------

watch(bOpen, (bIsOpen) => {
  if (bIsOpen) {
    bindGlobal();
    void nextTick(() => {
      focusItem(0);
    });
  } else {
    unbindGlobal();
  }
});

// -------------------------------------------------- Lifecycle --------------------------------------------------

onBeforeUnmount(() => {
  unbindGlobal();
});
</script>

<template>
  <div ref="rootRef" class="notification-bell">
    <button
      ref="buttonRef"
      type="button"
      :class="compact ? 'notification-bell__button--compact' : 'notification-bell__button'"
      :aria-label="buttonLabel"
      :title="buttonLabel"
      aria-haspopup="menu"
      :aria-expanded="bOpen"
      @click="toggle"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.7 21a2 2 0 01-3.4 0" />
      </svg>
      <span v-if="notifications.unreadCount > 0" class="notification-bell__badge" data-testid="notification-badge">
        {{ badgeLabel }}
      </span>
    </button>

    <div
      v-if="bOpen"
      ref="panelRef"
      class="notification-bell__panel"
      :class="{ 'notification-bell__panel--compact': compact }"
      role="menu"
      aria-label="Notifications"
    >
      <div class="notification-bell__header">
        <span class="notification-bell__heading">Notifications</span>
        <div class="notification-bell__header-actions">
          <button
            type="button"
            role="menuitem"
            class="notification-bell__header-button"
            :disabled="notifications.unreadCount === 0"
            @click="notifications.markAllRead()"
          >
            Mark all read
          </button>
          <button
            type="button"
            role="menuitem"
            class="notification-bell__header-button"
            :disabled="notifications.items.length === 0"
            @click="notifications.clear()"
          >
            Clear
          </button>
        </div>
      </div>

      <p v-if="notifications.items.length === 0" class="notification-bell__empty">No notifications yet</p>
      <ul v-else class="notification-bell__list">
        <li v-for="item in notifications.items" :key="item.id" role="none">
          <button
            type="button"
            role="menuitem"
            class="notification-bell__item"
            :class="{ 'notification-bell__item--unread': !item.read }"
            @click="openItem(item)"
          >
            <svg
              class="notification-bell__kind-icon"
              :class="`notification-bell__kind-icon--${item.kind}`"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="KIND_ICON_PATHS[item.kind]" />
            </svg>
            <span class="notification-bell__text">
              <span class="notification-bell__title">{{ item.title }}</span>
              <span v-if="item.body" class="notification-bell__body">{{ item.body }}</span>
              <span class="notification-bell__time">{{ relativeTimeShort(item.createdAt) }}</span>
            </span>
            <span v-if="!item.read" class="notification-bell__unread-dot" aria-label="Unread" />
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.notification-bell {
  position: relative;
  flex-shrink: 0;
}

.notification-bell__button,
.notification-bell__button--compact {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.notification-bell__button:hover,
.notification-bell__button--compact:hover {
  background: var(--bg-hover);
  color: var(--fg);
}

.notification-bell__badge {
  position: absolute;
  top: 3px;
  right: 2px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--danger);
  color: #fff;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
  pointer-events: none;
}

.notification-bell__panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 300;
  width: min(22rem, calc(100vw - 16px));
  max-height: min(70vh, 28rem);
  display: flex;
  flex-direction: column;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg-elev);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.25);
  overflow: hidden;
}

/* Mobile sidebar footer: open upward across the drawer width (fixed so the narrow footer can't clip it). */
.notification-bell__panel--compact {
  position: fixed;
  top: auto;
  bottom: 64px;
  left: 8px;
  right: 8px;
  width: auto;
}

.notification-bell__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px 8px 12px;
  border-bottom: 1px solid var(--line);
}

.notification-bell__heading {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
}

.notification-bell__header-actions {
  display: flex;
  gap: 4px;
}

.notification-bell__header-button {
  padding: 3px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  cursor: pointer;
}

.notification-bell__header-button:hover:not(:disabled),
.notification-bell__header-button:focus-visible {
  background: var(--bg-hover);
  color: var(--fg);
}

.notification-bell__header-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.notification-bell__empty {
  margin: 0;
  padding: 24px 12px;
  text-align: center;
  font-size: 13px;
  color: var(--fg-muted);
}

.notification-bell__list {
  margin: 0;
  padding: 4px 0;
  list-style: none;
  overflow-y: auto;
}

.notification-bell__item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--fg);
  text-align: left;
  cursor: pointer;
}

.notification-bell__item:hover,
.notification-bell__item:focus-visible {
  background: var(--bg-hover);
  outline: none;
}

.notification-bell__kind-icon {
  flex-shrink: 0;
  margin-top: 1px;
  color: var(--fg-muted);
}

.notification-bell__kind-icon--orchestrator-failed,
.notification-bell__kind-icon--automation-failed {
  color: var(--danger);
}

.notification-bell__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.notification-bell__title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-bell__item:not(.notification-bell__item--unread) .notification-bell__title {
  color: var(--fg-muted);
}

.notification-bell__body {
  font-size: 12px;
  color: var(--fg-muted);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.notification-bell__time {
  font-size: 11px;
  color: var(--fg-muted);
  opacity: 0.8;
}

.notification-bell__unread-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 999px;
  background: var(--accent);
}
</style>

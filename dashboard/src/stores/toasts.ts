// node_modules
import { defineStore } from 'pinia';
import { ref } from 'vue';

// types
export type ToastKind = 'error' | 'success' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const ERROR_TIMEOUT_MS = 8000;

let nextToastId = 1;

export const useToastStore = defineStore('toasts', () => {
  // -------------------------------------------------- Refs --------------------------------------------------
  const toasts = ref<Toast[]>([]);

  // -------------------------------------------------- Methods --------------------------------------------------
  const dismiss = (id: number): void => {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  };

  const push = (kind: ToastKind, text: string, timeoutMs?: number): void => {
    const id = nextToastId;
    nextToastId += 1;
    toasts.value = [...toasts.value, { id, kind, text }];
    const timeout = timeoutMs ?? (kind === 'error' ? ERROR_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
    if (timeout > 0) {
      setTimeout(() => {
        dismiss(id);
      }, timeout);
    }
  };

  const error = (text: string): void => {
    push('error', text);
  };

  const success = (text: string): void => {
    push('success', text);
  };

  const info = (text: string): void => {
    push('info', text);
  };

  // -------------------------------------------------- Export --------------------------------------------------
  return {
    // data
    toasts,
    // methods
    dismiss,
    push,
    error,
    success,
    info
  };
});

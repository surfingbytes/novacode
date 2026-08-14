// node_modules
import { ref, type Ref } from 'vue';

/**
 * Per-field errors that stay quiet until blur or submit, then update as the
 * user types.
 */
export function useInlineFieldErrors<K extends string>(
  rules: Record<K, () => string | undefined>
): {
  errors: Ref<Partial<Record<K, string>>>;
  touch: (key: K) => void;
  onInput: (key: K) => void;
  validateAll: () => boolean;
  reset: () => void;
} {
  const errors = ref<Partial<Record<K, string>>>({}) as Ref<Partial<Record<K, string>>>;
  const touched = new Set<K>();

  function setError(key: K, message: string | undefined): void {
    if (message) {
      errors.value = { ...errors.value, [key]: message };
      return;
    }
    if (errors.value[key] === undefined) {
      return;
    }
    const next = { ...errors.value };
    delete next[key];
    errors.value = next;
  }

  function touch(key: K): void {
    touched.add(key);
    setError(key, rules[key]());
  }

  function onInput(key: K): void {
    if (!touched.has(key) && errors.value[key] === undefined) {
      return;
    }
    setError(key, rules[key]());
  }

  function validateAll(): boolean {
    let bOk = true;
    const next: Partial<Record<K, string>> = {};
    for (const key of Object.keys(rules) as K[]) {
      touched.add(key);
      const message = rules[key]();
      if (message) {
        next[key] = message;
        bOk = false;
      }
    }
    errors.value = next;
    return bOk;
  }

  function reset(): void {
    touched.clear();
    errors.value = {};
  }

  return { errors, touch, onInput, validateAll, reset };
}

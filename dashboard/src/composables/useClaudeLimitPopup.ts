/**
 * Claude usage-limit popup state and the auto-continue setting it shows.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { ref } from 'vue';

// classes
import { settingsApi } from '@/classes/api';

export function useClaudeLimitPopup() {
  // -------------------------------------------------- Refs --------------------------------------------------
  const bShowClaudeLimitPopup = ref(false);
  const claudeLimitResetTime = ref('');
  const claudeLimitResetTimeReadable = ref('');
  const bClaudeAutoContinueEnabled = ref(false);

  // -------------------------------------------------- Methods --------------------------------------------------
  function onClaudeLimitDetected(resetTime: string, resetTimeReadable: string): void {
    bShowClaudeLimitPopup.value = true;
    claudeLimitResetTime.value = resetTime;
    claudeLimitResetTimeReadable.value = resetTimeReadable;
  }

  function handleAutoContinueUpdated(enabled: boolean): void {
    bClaudeAutoContinueEnabled.value = enabled;
  }

  async function loadClaudeAutoContinueSetting(): Promise<void> {
    try {
      const { data } = await settingsApi.get();
      if (typeof data.claudeAutoContinue === 'boolean') {
        bClaudeAutoContinueEnabled.value = data.claudeAutoContinue;
      }
    } catch {
      // keep defaults
    }
  }

  return {
    // data
    bShowClaudeLimitPopup,
    claudeLimitResetTime,
    claudeLimitResetTimeReadable,
    bClaudeAutoContinueEnabled,
    // methods
    onClaudeLimitDetected,
    handleAutoContinueUpdated,
    loadClaudeAutoContinueSetting
  };
}

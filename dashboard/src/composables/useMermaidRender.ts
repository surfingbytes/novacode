/**
 * Debounced mermaid diagram rendering inside a root element.
 * Extracted from SessionChat.vue.
 */

// node_modules
import { nextTick, onUnmounted, type Ref } from 'vue';

// classes
import { renderMermaidDiagrams } from '@/lib/mermaid';

export function useMermaidRender(root: Ref<HTMLElement | null>) {
  let mermaidRenderTimer: ReturnType<typeof setTimeout> | null = null;

  // -------------------------------------------------- Methods --------------------------------------------------
  function scheduleMermaidRender(): void {
    if (mermaidRenderTimer !== null) {
      clearTimeout(mermaidRenderTimer);
    }
    mermaidRenderTimer = setTimeout(() => {
      mermaidRenderTimer = null;
      void nextTick(() => {
        void renderMermaidDiagrams(root.value);
      });
    }, 80);
  }

  // -------------------------------------------------- Lifecycle --------------------------------------------------
  onUnmounted(() => {
    if (mermaidRenderTimer !== null) {
      clearTimeout(mermaidRenderTimer);
      mermaidRenderTimer = null;
    }
  });

  return {
    // methods
    scheduleMermaidRender
  };
}

export type UseMermaidRender = ReturnType<typeof useMermaidRender>;

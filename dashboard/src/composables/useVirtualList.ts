// node_modules
import {
  computed,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  shallowRef,
  watch,
  type Ref
} from 'vue';

// utils
import {
  computeOffsets,
  findVisibleRange,
  VIRTUAL_LIST_OVERSCAN_PX,
  type VirtualRange
} from '@/utils/virtualWindow';

export interface VirtualEntry<T> {
  item: T;
  index: number;
  key: string;
}

export interface UseVirtualListOptions<T> {
  items: () => readonly T[];
  itemKey: (item: T) => string;
  /** Height used for items not measured yet. */
  estimateSize: () => number;
  /** Windowing starts at this many items; shorter lists render fully. */
  threshold: () => number;
  overscan?: number;
}

/** Attribute set on each rendered item wrapper so it can be measured. */
const VIRTUAL_KEY_ATTR = 'data-vl-key';

/**
 * Height updates allowed between two scroll/resize/list changes. An item whose
 * height depends on its position (e.g. `:last-child` styles) can flip the
 * range back and forth forever; production Vue has no recursion guard, so the
 * tab would freeze.
 */
const MAX_MEASURE_PASSES = 10;

function isScrollable(el: HTMLElement): boolean {
  const overflowY = getComputedStyle(el).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    if (isScrollable(node)) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/**
 * Client-side windowing for a vertical list inside any scroll container.
 * Renders only items near the viewport and pads the container to keep the full
 * scroll height. Item heights are measured after render and cached by key.
 */
export function useVirtualList<T>(
  containerRef: Ref<HTMLElement | null>,
  options: UseVirtualListOptions<T>
) {
  const overscan = options.overscan ?? VIRTUAL_LIST_OVERSCAN_PX;
  const sizes = new Map<string, number>();
  const sizesVersion = ref(0);
  const viewTop = ref(0);
  const viewBottom = ref(typeof window === 'undefined' ? 0 : window.innerHeight);
  const scrollParent = shallowRef<HTMLElement | null>(null);
  let resizeObserver: ResizeObserver | null = null;
  let frame: number | null = null;
  let measurePasses = 0;

  const bVirtual = computed(() => options.items().length >= options.threshold());

  const offsets = computed((): number[] => {
    void sizesVersion.value;
    const list = options.items();
    const estimate = options.estimateSize();
    return computeOffsets(list.length, (i) => sizes.get(options.itemKey(list[i])) ?? estimate);
  });

  const range = computed((): VirtualRange => {
    const count = options.items().length;
    if (!bVirtual.value) {
      return { start: 0, end: count };
    }
    return findVisibleRange(offsets.value, viewTop.value, viewBottom.value, overscan);
  });

  const visibleEntries = computed((): VirtualEntry<T>[] => {
    const { start, end } = range.value;
    return options
      .items()
      .slice(start, end)
      .map((item, i) => ({ item, index: start + i, key: options.itemKey(item) }));
  });

  const padTop = computed(() => (bVirtual.value ? (offsets.value[range.value.start] ?? 0) : 0));
  const padBottom = computed(() => {
    if (!bVirtual.value) {
      return 0;
    }
    const all = offsets.value;
    return Math.max(0, (all[all.length - 1] ?? 0) - (all[range.value.end] ?? 0));
  });

  function updateViewport(): void {
    const el = containerRef.value;
    if (!el) {
      return;
    }
    const parent = scrollParent.value;
    const parentTop = parent ? parent.getBoundingClientRect().top : 0;
    const parentHeight = parent ? parent.clientHeight : window.innerHeight;
    const top = parentTop - el.getBoundingClientRect().top;
    viewTop.value = top;
    viewBottom.value = top + parentHeight;
  }

  function scheduleViewportUpdate(): void {
    if (frame !== null) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = null;
      updateViewport();
    });
  }

  /** User scroll or window resize: the window moves, so items may be measured again. */
  function onViewportChange(): void {
    measurePasses = 0;
    scheduleViewportUpdate();
  }

  /** Caches heights of rendered items; bumps the version when any height changed. */
  function measure(): void {
    const el = containerRef.value;
    if (!el || !bVirtual.value || measurePasses >= MAX_MEASURE_PASSES) {
      return;
    }
    const changed: [string, number][] = [];
    for (const child of Array.from(el.children)) {
      const key = child.getAttribute(VIRTUAL_KEY_ATTR);
      if (key === null) {
        continue;
      }
      const height = child.getBoundingClientRect().height;
      // Hidden or not laid out (e.g. collapsed sidebar, jsdom): keep the estimate
      if (height > 0 && sizes.get(key) !== height) {
        changed.push([key, height]);
      }
    }
    if (changed.length > 0) {
      measurePasses++;
      for (const [key, height] of changed) {
        sizes.set(key, height);
      }
      sizesVersion.value++;
    }
  }

  function observeRenderedItems(): void {
    if (!resizeObserver) {
      return;
    }
    resizeObserver.disconnect();
    const el = containerRef.value;
    if (!el || !bVirtual.value) {
      return;
    }
    for (const child of Array.from(el.children)) {
      if (child.hasAttribute(VIRTUAL_KEY_ATTR)) {
        resizeObserver.observe(child);
      }
    }
  }

  function detach(): void {
    scrollParent.value?.removeEventListener('scroll', onViewportChange);
    window.removeEventListener('scroll', onViewportChange);
    scrollParent.value = null;
  }

  function attach(): void {
    detach();
    const el = containerRef.value;
    if (!el || !bVirtual.value) {
      return;
    }
    scrollParent.value = findScrollParent(el);
    (scrollParent.value ?? window).addEventListener('scroll', onViewportChange, {
      passive: true
    });
    updateViewport();
  }

  function afterRender(): void {
    measure();
    observeRenderedItems();
  }

  onMounted(() => {
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        measure();
        scheduleViewportUpdate();
      });
    }
    window.addEventListener('resize', onViewportChange);
    attach();
    afterRender();
  });

  onUpdated(afterRender);

  watch([containerRef, bVirtual], attach, { flush: 'post' });

  // Items reordered/added: the list may have moved relative to the viewport
  watch(() => options.items().length, scheduleViewportUpdate);

  // New or changed items need fresh measurements
  watch(options.items, () => {
    measurePasses = 0;
  });

  onBeforeUnmount(() => {
    detach();
    window.removeEventListener('resize', onViewportChange);
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  });

  return { bVirtual, visibleEntries, padTop, padBottom, range };
}

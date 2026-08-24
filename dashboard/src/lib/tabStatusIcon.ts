// types
import type { TabStatus } from '@/utils/tabStatus';

/** 32px is what browsers rasterise a 16px tab favicon to on HiDPI screens. */
const CANVAS_SIZE = 32;
/** Shrink the mark so the badge sits beside it rather than on top of it. */
const MARK_SCALE = 0.82;
const BADGE_CENTER = 26;
/** Transparent moat around the badge, so it separates on light and dark tab strips alike. */
const BADGE_CLEARANCE = 6.4;
const DOT_RADIUS = 5;
const RING_RADIUS = 3.6;
const RING_WIDTH = 2.2;

const BADGE_COLOR: Record<Exclude<TabStatus, 'idle'>, string> = {
  running: '#60a5fa',
  attention: '#f59e0b'
};

let markPromise: Promise<HTMLImageElement | null> | null = null;
const iconCache = new Map<TabStatus, string>();
let originalLinks: HTMLLinkElement[] | null = null;
let managedLink: HTMLLinkElement | null = null;
let appliedStatus: TabStatus = 'idle';

function loadMark(): Promise<HTMLImageElement | null> {
  if (!markPromise) {
    markPromise = new Promise((resolve) => {
      const image = new Image();
      image.onload = (): void => resolve(image);
      image.onerror = (): void => resolve(null);
      image.src = `${import.meta.env.BASE_URL}favicon-32x32.png`;
    });
  }
  return markPromise;
}

function drawBadgedIcon(mark: HTMLImageElement, status: Exclude<TabStatus, 'idle'>): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  const markSize = CANVAS_SIZE * MARK_SCALE;
  context.drawImage(mark, 0, 0, markSize, markSize);

  context.globalCompositeOperation = 'destination-out';
  context.beginPath();
  context.arc(BADGE_CENTER, BADGE_CENTER, BADGE_CLEARANCE, 0, Math.PI * 2);
  context.fill();
  context.globalCompositeOperation = 'source-over';

  if (status === 'attention') {
    context.fillStyle = BADGE_COLOR.attention;
    context.beginPath();
    context.arc(BADGE_CENTER, BADGE_CENTER, DOT_RADIUS, 0, Math.PI * 2);
    context.fill();
  } else {
    context.strokeStyle = BADGE_COLOR.running;
    context.lineWidth = RING_WIDTH;
    context.beginPath();
    context.arc(BADGE_CENTER, BADGE_CENTER, RING_RADIUS, 0, Math.PI * 2);
    context.stroke();
  }

  return canvas.toDataURL('image/png');
}

function staticIconLinks(): HTMLLinkElement[] {
  const links = document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
  return Array.from(links).filter((link) => link !== managedLink);
}

function mountManagedLink(href: string): void {
  if (!managedLink) {
    // A browser picks one icon out of every declared link, and Chrome prefers
    // the SVG one, so the static links have to step aside while we override.
    originalLinks = staticIconLinks();
    for (const link of originalLinks) {
      link.remove();
    }
    managedLink = document.createElement('link');
    managedLink.rel = 'icon';
    managedLink.type = 'image/png';
    document.head.appendChild(managedLink);
  }
  managedLink.href = href;
}

function unmountManagedLink(): void {
  if (!managedLink) {
    return;
  }
  managedLink.remove();
  managedLink = null;
  for (const link of originalLinks ?? []) {
    document.head.appendChild(link);
  }
  originalLinks = null;
}

export async function applyTabStatusIcon(status: TabStatus): Promise<void> {
  if (typeof document === 'undefined') {
    return;
  }
  appliedStatus = status;

  if (status === 'idle') {
    unmountManagedLink();
    return;
  }

  const cached = iconCache.get(status);
  if (cached) {
    mountManagedLink(cached);
    return;
  }

  const mark = await loadMark();
  if (!mark || appliedStatus !== status) {
    return;
  }
  const dataUrl = drawBadgedIcon(mark, status);
  if (!dataUrl) {
    return;
  }
  iconCache.set(status, dataUrl);
  if (appliedStatus === status) {
    mountManagedLink(dataUrl);
  }
}

export function resetTabStatusIcon(): void {
  appliedStatus = 'idle';
  unmountManagedLink();
}

export const PRELOAD_RELOAD_KEY = 'nc-preload-reload';

/**
 * Reloads the tab once when Vite fails to load a lazy chunk (stale build after deploy).
 * A sessionStorage guard prevents reload loops; a second failure only clears the guard.
 */
export function installPreloadErrorReload(win: Window = window): void {
  win.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    if (win.sessionStorage.getItem(PRELOAD_RELOAD_KEY)) {
      win.sessionStorage.removeItem(PRELOAD_RELOAD_KEY);
      return;
    }
    win.sessionStorage.setItem(PRELOAD_RELOAD_KEY, '1');
    win.location.reload();
  });
}

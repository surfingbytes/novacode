<script setup lang="ts">
// node_modules
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';

// classes
import { buildWsUrl } from '@/classes/api';
import { createManagedSocket, type ManagedSocket } from '@/lib/wsClient';

// types
import type { WsServerMessage, WsClientMessage } from '@/@types/index';

// -------------------------------------------------- Props --------------------------------------------------
const props = withDefaults(
  defineProps<{ sessionId?: string; wsUrl?: string; readOnly?: boolean; scanUrls?: boolean }>(),
  { readOnly: false, scanUrls: false }
);

const emit = defineEmits<{
  (e: 'sessionEnded'): void;
  (e: 'serverShutdown'): void;
  (e: 'urlFound', url: string): void;
  (e: 'tokenFound', token: string): void;
  (e: 'authenticationStored'): void;
}>();

// -------------------------------------------------- Types --------------------------------------------------
// (none)

// -------------------------------------------------- Refs --------------------------------------------------
const containerEl = ref<HTMLElement | undefined>(undefined);

const bIsAtBottom = ref<boolean>(true);
const bShowCopyButton = ref<boolean>(false);
const bCopied = ref<boolean>(false);

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let serializeAddon: SerializeAddon | null = null;
let managedSocket: ManagedSocket | null = null;
let resizeObserver: ResizeObserver | null = null;
let inputDisposable: { dispose(): void } | null = null;
let scrollDisposable: { dispose(): void } | null = null;
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
let bIsDestroyed: boolean = false;

// Touch-drag scroll state (xterm.js 6.0.0 workaround, see below)
let touchLastY: number | null = null;
let touchRemainderPx: number = 0;

let outputBuffer: string = '';
let bInBox: boolean = false;
const emittedUrls = new Set<string>();


// -------------------------------------------------- Computed --------------------------------------------------
// (none)

// -------------------------------------------------- Methods --------------------------------------------------
const scrollToBottom = (): void => {
  term?.scrollToBottom();
};

// xterm.js 6.0.0 replaced the viewport with a VS Code-style scrollbar that has no
// touch handling (upstream regression xtermjs/xterm.js#5489, fixed only in the
// unreleased 7.0.0 line), so touch-drag scrolling is emulated here via scrollLines.
const cellHeightPx = (): number => {
  const rowEl = containerEl.value?.querySelector<HTMLElement>('.xterm-rows > div');
  const measured = rowEl?.getBoundingClientRect().height;
  return measured && measured > 0 ? measured : 13 * 1.2; // fontSize * lineHeight fallback
};

const onTouchStart = (e: TouchEvent): void => {
  if (e.touches.length === 1) {
    touchLastY = e.touches[0].clientY;
    touchRemainderPx = 0;
  } else {
    touchLastY = null;
  }
};

const onTouchMove = (e: TouchEvent): void => {
  if (touchLastY === null || e.touches.length !== 1) {
    return;
  }
  const y = e.touches[0].clientY;
  touchRemainderPx += touchLastY - y;
  touchLastY = y;
  const cellPx = cellHeightPx();
  const lines = Math.trunc(touchRemainderPx / cellPx);
  if (lines !== 0) {
    touchRemainderPx -= lines * cellPx;
    term?.scrollLines(lines);
  }
  e.preventDefault();
};

const onTouchEnd = (): void => {
  touchLastY = null;
};

const copyTerminalText = async (): Promise<void> => {
  if (!term) {
    return;
  }
  const text = term.getSelection() || serializeAddon?.serialize() || '';
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for insecure contexts (http on LAN) where the clipboard API is unavailable
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  bCopied.value = true;
  if (copiedTimer) {
    clearTimeout(copiedTimer);
  }
  copiedTimer = setTimeout(() => {
    bCopied.value = false;
  }, 1500);
};

/** Strip ANSI escape sequences (CSI, OSC, etc.) so only raw text remains. Cursor-forward (CUF) codes like \u001b[1C are replaced with spaces. */
const stripAnsi = (s: string): string => {
  return s
    .replace(/\u001b\[(\d+)C/g, (_, n) => ' '.repeat(Math.max(0, parseInt(n, 10) || 1)))
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '') // CSI (e.g. colors, cursor, DEC private mode)
    .replace(/\u001b\][^\u001b]*(?:\u0007|\u001b\\)/g, '') // OSC
    .replace(/\u001b[PX^_][^\u001b]*\u001b\\/g, '') // SOS/PM/APC string params
    .replace(/\u001b[\]A-Z\\^_]/g, ''); // single-char escapes
};

const isBoxTop = (plain: string): boolean => {
  return /^\s*┌[\s─]*┐\s*$/.test(plain.trim());
};

const isBoxBottom = (plain: string): boolean => {
  return /^\s*└[\s─]*┘\s*$/.test(plain.trim());
};

const writeFiltered = (data: string): void => {
  if (!term) return;
  outputBuffer += data;
  let result: string = '';
  for (;;) {
    const nl = outputBuffer.indexOf('\n');
    const crlf = outputBuffer.indexOf('\r\n');
    let lineEnd: number;
    let lineLen: number;
    if (crlf >= 0 && (nl < 0 || crlf <= nl)) {
      lineEnd = crlf;
      lineLen = 2;
    } else if (nl >= 0) {
      lineEnd = nl;
      lineLen = 1;
    } else {
      break;
    }
    const line = outputBuffer.slice(0, lineEnd + lineLen);
    outputBuffer = outputBuffer.slice(lineEnd + lineLen);
    const plain = stripAnsi(line);
    if (isBoxTop(plain)) {
      bInBox = true;
      continue;
    }
    if (bInBox) {
      if (isBoxBottom(plain)) {
        bInBox = false;
      }
      continue;
    }
    result += line;
  }
  if (result) term.write(result);
};

const flushOutputBuffer = (): void => {
  if (outputBuffer && term) {
    term.write(outputBuffer);
    outputBuffer = '';
  }
  bInBox = false;
};

const sendWs = (msg: WsClientMessage): void => {
  managedSocket?.send(msg);
};

const terminalWsUrl = (): string => props.wsUrl ?? buildWsUrl(props.sessionId ?? '');

const connectWs = (): void => {
  if (bIsDestroyed) return;
  managedSocket?.close();
  managedSocket = createManagedSocket({
    url: terminalWsUrl(),
    onOpen: () => {
      fitAddon?.fit();
      const cols = term?.cols ?? 220;
      const rows = term?.rows ?? 50;
      sendWs({ type: 'resize', cols, rows });
    },
    onMessage: handleWsMessage,
    onConnectionChange: (bConnected) => {
      if (!bConnected && !bIsDestroyed) {
        term?.writeln('\r\n\x1b[33m[Disconnected — reconnecting…]\x1b[0m');
      }
    },
    onUnauthorized: () => {
      term?.writeln('\r\n\x1b[31m[Authentication failed — please log in again]\x1b[0m');
    }
  });
};

const handleWsMessage = (data: string): void => {
  try {
      const msg = JSON.parse(data) as WsServerMessage;
      if (msg.type === 'history' || msg.type === 'output') {
        if (msg.data) {
          if (props.readOnly) writeFiltered(msg.data);
          else term?.write(msg.data);
          if (props.scanUrls) {
            // Split on \r\n, \r, or \n so terminal overwrites (\r) become separate lines
            let lines = msg.data.split(/\r\n|\r/).map((line) => stripAnsi(line).trim());

            // remove empty lines, only keep one if there are multiple empty lines in sequence
            const filteredLines: string[] = [];
            for (let index = 0; index < lines.length; index++) {
              const line = lines[index];
              if (line.trim() !== '') {
                filteredLines.push(line);
              } else if (
                index > 0 &&
                lines[index - 1].trim() !== '' &&
                index < lines.length - 1 &&
                lines[index + 1].trim() === ''
              ) {
                filteredLines.push(line);
              }
            }
            lines = filteredLines;

            for (let index = 0; index < lines.length; index++) {
              const line = lines[index];

              if (line.startsWith('sk-ant-')) {
                let token = line;
                let nextIndex = index + 1;
                while (nextIndex < lines.length && lines[nextIndex].trim() !== '') {
                  if (lines[nextIndex].startsWith('Store')) {
                    break;
                  }
                  token += lines[nextIndex];
                  nextIndex++;
                }

                emit('tokenFound', token);
              }

              if (line.startsWith('https://')) {
                let url = line;
                let nextIndex = index + 1;
                while (nextIndex < lines.length && lines[nextIndex].trim() !== '') {
                  url += lines[nextIndex];
                  nextIndex++;
                }

                if (!emittedUrls.has(url)) {
                  emittedUrls.add(url);
                  emit('urlFound', url);
                }
              }

              if (line == 'Authentication tokens stored securely.') {
                emit('authenticationStored');
              }
            }
          }
        }
      } else if (msg.type === 'status' && msg.status) {
        if (msg.status === 'stopped' || msg.status === 'error' || msg.status === 'failed') {
          emit('sessionEnded');
        }
      } else if (msg.type === 'server-shutdown') {
        emit('serverShutdown');
      }
    } catch {
      // ignore
    }
};

const sendInput = (data: string): void => {
  sendWs({ type: 'input', data });
};

defineExpose({ sendInput, scrollToBottom, isAtBottom: bIsAtBottom });

// -------------------------------------------------- Terminal theme (follows app theme tokens) --------------------------------------------------

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function buildTerminalTheme(): Record<string, string> {
  return {
    background: cssVar('--bg-elev', '#171614'),
    foreground: cssVar('--fg', '#f5f1ea'),
    cursor: cssVar('--accent', '#8b85ff'),
    selectionBackground: cssVar('--bg-hover', '#23201d'),
    black: cssVar('--bg-hover', '#23201d'),
    red: cssVar('--danger', '#e87676'),
    green: cssVar('--success', '#7ec994'),
    yellow: cssVar('--warn', '#e6b067'),
    blue: cssVar('--agent-cursor', '#7aa2ff'),
    magenta: cssVar('--accent', '#8b85ff'),
    cyan: cssVar('--agent-opencode', '#50c8d6'),
    white: cssVar('--fg-muted', '#a6a098'),
    brightBlack: cssVar('--fg-faint', '#48443f'),
    brightRed: cssVar('--danger', '#e87676'),
    brightGreen: cssVar('--success', '#7ec994'),
    brightYellow: cssVar('--warn', '#e6b067'),
    brightBlue: cssVar('--agent-cursor', '#7aa2ff'),
    brightMagenta: cssVar('--accent', '#8b85ff'),
    brightCyan: cssVar('--agent-opencode', '#50c8d6'),
    brightWhite: cssVar('--fg', '#f5f1ea')
  };
}

const handleThemeChanged = (): void => {
  if (term) {
    term.options.theme = buildTerminalTheme();
  }
};

// -------------------------------------------------- Lifecycle --------------------------------------------------
onMounted((): void => {
  if (!containerEl.value) return;

  term = new Terminal({
    fontFamily: '"Cascadia Code", "JetBrains Mono", "Fira Code", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'bar',
    theme: buildTerminalTheme(),
    allowProposedApi: false,
    scrollback: 5000
  });
  window.addEventListener('nc-theme-changed', handleThemeChanged);

  fitAddon = new FitAddon();
  serializeAddon = new SerializeAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(serializeAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(containerEl.value);
  fitAddon.fit();

  // xterm 6 removed the .xterm-viewport element; track at-bottom via the public API
  scrollDisposable = term.onScroll(() => {
    const buffer = term?.buffer.active;
    if (buffer) {
      bIsAtBottom.value = buffer.viewportY >= buffer.baseY;
    }
  });

  // Touch scrolling workaround + copy affordance for coarse-pointer devices
  bShowCopyButton.value = window.matchMedia('(pointer: coarse)').matches;
  containerEl.value.addEventListener('touchstart', onTouchStart, { passive: true });
  containerEl.value.addEventListener('touchmove', onTouchMove, { passive: false });
  containerEl.value.addEventListener('touchend', onTouchEnd, { passive: true });
  containerEl.value.addEventListener('touchcancel', onTouchEnd, { passive: true });

  const attachInput = (): void => {
    inputDisposable?.dispose();
    inputDisposable = null;
    if (!props.readOnly && term) {
      inputDisposable = term.onData((data: string) => {
        sendWs({ type: 'input', data });
      });
    }
  };
  attachInput();

  connectWs();

  resizeObserver = new ResizeObserver(() => {
    fitAddon?.fit();
    const cols = term?.cols ?? 220;
    const rows = term?.rows ?? 50;
    sendWs({ type: 'resize', cols, rows });
  });
  resizeObserver.observe(containerEl.value);
});

watch(
  () => [props.sessionId, props.wsUrl],
  () => {
    term?.clear();
    outputBuffer = '';
    bInBox = false;
    emittedUrls.clear();
    connectWs();
  }
);

watch(
  () => props.readOnly,
  () => {
    if (!term) return;
    if (!props.readOnly) {
      flushOutputBuffer();
    } else {
      outputBuffer = '';
      bInBox = false;
    }
    inputDisposable?.dispose();
    inputDisposable = null;
    if (!props.readOnly) {
      inputDisposable = term.onData((data: string) => {
        sendWs({ type: 'input', data });
      });
    }
  }
);

onUnmounted((): void => {
  bIsDestroyed = true;
  managedSocket?.close();
  window.removeEventListener('nc-theme-changed', handleThemeChanged);
  containerEl.value?.removeEventListener('touchstart', onTouchStart);
  containerEl.value?.removeEventListener('touchmove', onTouchMove);
  containerEl.value?.removeEventListener('touchend', onTouchEnd);
  containerEl.value?.removeEventListener('touchcancel', onTouchEnd);
  inputDisposable?.dispose();
  scrollDisposable?.dispose();
  if (copiedTimer) {
    clearTimeout(copiedTimer);
  }
  resizeObserver?.disconnect();
  term?.dispose();
});
</script>

<template>
  <div class="app-terminal-wrap">
    <div ref="containerEl" class="app-terminal" :class="{ 'is-read-only': readOnly }"></div>
    <button
      v-if="bShowCopyButton"
      type="button"
      class="terminal-copy-button"
      @click="copyTerminalText"
    >
      {{ bCopied ? 'Copied!' : 'Copy' }}
    </button>
  </div>
</template>

<style>
.app-terminal-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.terminal-copy-button {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 20;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--fg-muted, #a6a098);
  background: var(--bg-hover, #23201d);
  border: 1px solid rgb(245 241 234 / 0.12);
  border-radius: 6px;
  opacity: 0.85;
}

.terminal-copy-button:active {
  opacity: 1;
}

.app-terminal {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--bg-elev, #171614);
  border-radius: 4px;
  overflow: hidden;
  /* Keep touch drags for the manual scroll workaround (xterm.js 6.0.0 has no touch handling) */
  touch-action: none;
}

.app-terminal .xterm {
  height: 100%;
  padding: 8px;
}

.app-terminal.is-read-only .xterm-cursor-layer {
  display: none;
}
</style>

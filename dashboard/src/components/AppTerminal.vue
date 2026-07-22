<script setup lang="ts">
// node_modules
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

// classes
import { buildWsUrl } from '@/classes/api';

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
let viewport: HTMLElement | null = null;

let term: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let webSocket: WebSocket | null = null;
let resizeObserver: ResizeObserver | null = null;
let inputDisposable: { dispose(): void } | null = null;
let bIsDestroyed: boolean = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay: number = 1000;

let outputBuffer: string = '';
let bInBox: boolean = false;
const emittedUrls = new Set<string>();


// -------------------------------------------------- Computed --------------------------------------------------
// (none)

// -------------------------------------------------- Methods --------------------------------------------------
const onViewportScroll = (): void => {
  if (!viewport) return;
  bIsAtBottom.value = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 4;
};

const scrollToBottom = (): void => {
  term?.scrollToBottom();
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
  if (webSocket && webSocket.readyState === WebSocket.OPEN) {
    webSocket.send(JSON.stringify(msg));
  }
};

const terminalWsUrl = (): string => props.wsUrl ?? buildWsUrl(props.sessionId ?? '');

const scheduleReconnect = (): void => {
  if (bIsDestroyed) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  term?.writeln(`\r\n\x1b[33m[Reconnecting in ${Math.round(delay / 1000)}s…]\x1b[0m`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!bIsDestroyed) connectWs();
  }, delay);
};

const connectWs = (): void => {
  if (bIsDestroyed) return;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (webSocket) {
    webSocket.onclose = null;
    webSocket.onerror = null;
    webSocket.close();
  }

  webSocket = new WebSocket(terminalWsUrl());

  webSocket.onopen = () => {
    reconnectDelay = 1000;
    fitAddon?.fit();
    const cols = term?.cols ?? 220;
    const rows = term?.rows ?? 50;
    sendWs({ type: 'resize', cols, rows });
  };

  webSocket.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string) as WsServerMessage;
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

  webSocket.onerror = () => {};

  webSocket.onclose = () => {
    if (bIsDestroyed) return;
    term?.writeln('\r\n\x1b[33m[Disconnected]\x1b[0m');
    scheduleReconnect();
  };
};

const handleVisibilityChange = (): void => {
  if (document.visibilityState !== 'visible') return;
  if (
    !webSocket ||
    webSocket.readyState === WebSocket.CLOSED ||
    webSocket.readyState === WebSocket.CLOSING
  ) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    term?.writeln('\r\n\x1b[33m[Reconnecting…]\x1b[0m');
    connectWs();
  }
};

const handleOnline = (): void => {
  if (
    !webSocket ||
    webSocket.readyState === WebSocket.CLOSED ||
    webSocket.readyState === WebSocket.CLOSING
  ) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    connectWs();
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
  term.loadAddon(fitAddon);
  term.loadAddon(new WebLinksAddon());
  term.open(containerEl.value);
  fitAddon.fit();

  viewport = containerEl.value.querySelector('.xterm-viewport');
  if (viewport) viewport.addEventListener('scroll', onViewportScroll, { passive: true });

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

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('online', handleOnline);

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
  if (reconnectTimer) clearTimeout(reconnectTimer);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('online', handleOnline);
  window.removeEventListener('nc-theme-changed', handleThemeChanged);
  if (viewport) viewport.removeEventListener('scroll', onViewportScroll);
  inputDisposable?.dispose();
  webSocket?.close();
  resizeObserver?.disconnect();
  term?.dispose();
});
</script>

<template>
  <div ref="containerEl" class="app-terminal" :class="{ 'is-read-only': readOnly }"></div>
</template>

<style>
.app-terminal {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--bg-elev, #171614);
  border-radius: 4px;
  overflow: hidden;
}

.app-terminal .xterm {
  height: 100%;
  padding: 8px;
}

.app-terminal .xterm-viewport {
  overflow-y: auto !important;
}

.app-terminal.is-read-only .xterm-cursor-layer {
  display: none;
}
</style>

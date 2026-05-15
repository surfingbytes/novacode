// node_modules
import { spawn, type ChildProcess } from 'node:child_process';

// classes
import { config, readMcpClients, type McpClientServerConfig } from './config';

const STDIO_PROBE_MS = 2000;
const HTTP_TIMEOUT_MS = 10_000;

export type McpCheckKind = 'stdio' | 'http';

export interface McpCheckResult {
  ok: boolean;
  kind: McpCheckKind;
  /** Present when ok is false */
  error?: string;
  /** Short success context (e.g. HTTP status) */
  detail?: string;
}

function mergeStdioEnv(configDir: string, extra?: Record<string, string>): Record<string, string> {
  const base = config.agentEnv();
  return { ...base, ...(extra ?? {}) };
}

function checkStdio(configDir: string, cfg: McpClientServerConfig): Promise<McpCheckResult> {
  const cmd = cfg.command?.trim();
  if (!cmd) {
    return Promise.resolve({ ok: false, kind: 'stdio', error: 'Missing command' });
  }
  const args = cfg.args ?? [];
  const env = mergeStdioEnv(configDir, cfg.env);

  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const done = (result: McpCheckResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve(result);
    };

    try {
      child = spawn(cmd, args, {
        cwd: configDir,
        env,
        stdio: 'ignore',
        shell: false
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      done({ ok: false, kind: 'stdio', error: msg });
      return;
    }

    child.on('error', (err) => {
      done({ ok: false, kind: 'stdio', error: err.message });
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }
      if (code === 0) {
        done({
          ok: false,
          kind: 'stdio',
          error: 'Process exited immediately; stdio MCP servers should keep running'
        });
      } else {
        const hint = signal ? ` (signal ${signal})` : '';
        done({
          ok: false,
          kind: 'stdio',
          error: `Process exited with code ${code ?? '?'}${hint}`
        });
      }
    });

    timer = setTimeout(() => {
      if (settled) {
        return;
      }
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        } catch {
          // ignore
        }
      }, 500);
      done({ ok: true, kind: 'stdio', detail: 'Process started' });
    }, STDIO_PROBE_MS);
  });
}

async function checkHttp(cfg: McpClientServerConfig): Promise<McpCheckResult> {
  const url = cfg.url?.trim();
  if (!url) {
    return { ok: false, kind: 'http', error: 'Missing URL' };
  }

  const ac = new AbortController();
  const timeoutHandle = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(cfg.headers ?? {})) {
      headers.set(k, v);
    }
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: ac.signal,
      redirect: 'follow'
    });
    clearTimeout(timeoutHandle);
    return { ok: true, kind: 'http', detail: `HTTP ${response.status}` };
  } catch (e) {
    clearTimeout(timeoutHandle);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, kind: 'http', error: msg };
  }
}

function isHttpLike(cfg: McpClientServerConfig): boolean {
  return !!(cfg.url && !cfg.command);
}

/**
 * Dry-run connectivity checks for MCP client entries (stdio: spawn probe; HTTP: GET URL).
 * Runs in parallel across servers.
 */
export async function checkMcpClients(
  configDir: string,
  servers?: Record<string, McpClientServerConfig>
): Promise<Record<string, McpCheckResult>> {
  const map = servers ?? readMcpClients(configDir);
  const entries = Object.entries(map);
  const out: Record<string, McpCheckResult> = {};

  await Promise.all(
    entries.map(async ([name, cfg]) => {
      if (isHttpLike(cfg)) {
        out[name] = await checkHttp(cfg);
      } else if (cfg.command?.trim()) {
        out[name] = await checkStdio(configDir, cfg);
      } else {
        out[name] = {
          ok: false,
          kind: 'stdio',
          error: 'Invalid entry: set either command (stdio) or url (HTTP)'
        };
      }
    })
  );

  return out;
}

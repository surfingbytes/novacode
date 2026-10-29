/**
 * Starts a throwaway stack for the e2e smoke test and returns its teardown:
 * - Postgres: a disposable `postgres:17` docker container, or E2E_DATABASE_URL (must be an empty, throwaway DB)
 * - API: ts-node-dev with CONFIG_DIR, HOME and WORKSPACE_BROWSE_ROOT in a temp dir
 * - dashboard: Vite dev server pointed at the API via VITE_API_URL
 * Child processes get an explicit env, so the shell's DATABASE_URL, tokens and /config are never used.
 */

// node_modules
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// e2e
import { E2E_API_PORT, E2E_DASHBOARD_PORT, E2E_HOST, E2E_WORKSPACE_DIR } from './constants';

const ROOT = resolve(__dirname, '..');
const LOG_DIR = join(__dirname, '.logs');
const STARTUP_TIMEOUT_MS = 120_000;

// --------------------------------------------- Helpers ---------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(what: string, check: () => Promise<boolean> | boolean, logFile?: string): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      // not ready yet
    }
    await sleep(500);
  }
  const tail = logFile ? `\n--- ${logFile} (tail) ---\n${readFileSync(logFile, 'utf8').slice(-4000)}` : '';
  throw new Error(`e2e: timed out waiting for ${what}${tail}`);
}

async function httpOk(url: string): Promise<boolean> {
  const res = await fetch(url);
  return res.ok;
}

/** Spawn a long-running child in its own process group, logging to e2e/.logs/<name>.log. */
function startProcess(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): { child: ChildProcess; logFile: string } {
  const logFile = join(LOG_DIR, `${name}.log`);
  const log = createWriteStream(logFile);
  const child = spawn('npx', ['--no-install', ...args], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  return { child, logFile };
}

function stopProcess(child: ChildProcess | undefined): void {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

/** Start a disposable Postgres container; returns its URL and container name. */
async function startPostgres(): Promise<{ url: string; container: string }> {
  const container = `novacode-e2e-pg-${process.pid}`;
  execFileSync('docker', [
    'run', '-d', '--rm', '--name', container,
    '-e', 'POSTGRES_USER=postgres', '-e', 'POSTGRES_PASSWORD=postgres', '-e', 'POSTGRES_DB=novacode',
    '-p', '127.0.0.1::5432',
    'postgres:17'
  ], { stdio: 'ignore' });
  // TCP check: the image's init phase only listens on the unix socket
  await waitFor('postgres', () => {
    execFileSync('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'novacode'], { stdio: 'ignore' });
    return true;
  });
  const mapped = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }).trim().split('\n')[0]!;
  const port = mapped.slice(mapped.lastIndexOf(':') + 1);
  return { url: `postgresql://postgres:postgres@127.0.0.1:${port}/novacode`, container };
}

// --------------------------------------------- Setup ---------------------------------------------

export default async function globalSetup(): Promise<() => Promise<void>> {
  mkdirSync(LOG_DIR, { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), 'novacode-e2e-'));
  const configDir = join(tempDir, 'config');
  const browseRoot = join(tempDir, 'data-root');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(browseRoot, E2E_WORKSPACE_DIR), { recursive: true });

  let container: string | null = null;
  let api: ChildProcess | undefined;
  let dashboard: ChildProcess | undefined;

  const teardown = async (): Promise<void> => {
    stopProcess(dashboard);
    stopProcess(api);
    if (container) {
      try {
        execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
      } catch {
        // already removed
      }
    }
    await sleep(500);
    rmSync(tempDir, { recursive: true, force: true });
  };

  try {
    let databaseUrl = process.env['E2E_DATABASE_URL']?.trim();
    if (!databaseUrl) {
      const pg = await startPostgres();
      container = pg.container;
      databaseUrl = pg.url;
    }

    // minimal env: nothing from the shell leaks in (DATABASE_URL, agent tokens, NODE_ENV=production, ...)
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: process.env['PATH'],
      LANG: process.env['LANG'] ?? 'C.UTF-8',
      HOME: tempDir,
      NODE_ENV: 'development'
    };

    execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], {
      cwd: join(ROOT, 'api'),
      env: { ...baseEnv, DATABASE_URL: databaseUrl },
      stdio: 'inherit'
    });

    const apiProc = startProcess('api', ['ts-node-dev', '--transpile-only', 'src/index.ts'], join(ROOT, 'api'), {
      ...baseEnv,
      DATABASE_URL: databaseUrl,
      PORT: String(E2E_API_PORT),
      JWT_SECRET: 'e2e-only-jwt-secret-0123456789abcdef0123456789',
      CONFIG_DIR: configDir,
      WORKSPACE_BROWSE_ROOT: browseRoot,
      STARTUP_READY_FILE: join(tempDir, 'ready'),
      // TypeScript 6 rejects ts-node's implicit rootDir (TS5011) when only src/ is compiled
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({ rootDir: '.' }),
      LOG_LEVEL: 'warn'
    });
    api = apiProc.child;
    await waitFor('API health', () => httpOk(`http://${E2E_HOST}:${E2E_API_PORT}/api/health`), apiProc.logFile);

    const dashboardProc = startProcess(
      'dashboard',
      ['vite', '--host', E2E_HOST, '--port', String(E2E_DASHBOARD_PORT), '--strictPort'],
      join(ROOT, 'dashboard'),
      { ...baseEnv, VITE_API_URL: `http://${E2E_HOST}:${E2E_API_PORT}/api` }
    );
    dashboard = dashboardProc.child;
    await waitFor('dashboard', () => httpOk(`http://${E2E_HOST}:${E2E_DASHBOARD_PORT}/`), dashboardProc.logFile);
  } catch (err) {
    await teardown();
    throw err;
  }

  return teardown;
}

import { writeFileSync } from 'node:fs';

export const STARTUP_STATUS_FILE =
  process.env['STARTUP_STATUS_FILE']?.trim() || '/tmp/novacode-startup.json';
export const STARTUP_READY_FILE =
  process.env['STARTUP_READY_FILE']?.trim() || '/tmp/novacode-ready';

export const STARTUP_STEPS = ['boot', 'config', 'agents', 'database', 'api'] as const;
export type StartupStep = (typeof STARTUP_STEPS)[number];

export type StartupStatusPayload = {
  status: 'starting';
  step: string;
  detail: string;
  progress: number;
};

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
}

/** Parse the JSON status file written by the Docker entrypoint. */
export function parseStartupStatus(raw: string): StartupStatusPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: 'starting',
      step: 'boot',
      detail: 'Starting Nova Code…',
      progress: 0
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return {
      status: 'starting',
      step: 'boot',
      detail: 'Starting Nova Code…',
      progress: 0
    };
  }
  const record = parsed as Record<string, unknown>;
  const step = typeof record['step'] === 'string' && record['step'].trim() ? record['step'] : 'boot';
  const detail =
    typeof record['detail'] === 'string' && record['detail'].trim()
      ? record['detail']
      : 'Starting Nova Code…';
  return {
    status: 'starting',
    step,
    detail,
    progress: clampProgress(Number(record['progress']))
  };
}

export function startupStepIndex(step: string): number {
  const index = (STARTUP_STEPS as readonly string[]).indexOf(step);
  return index < 0 ? 0 : index;
}

/** Tell the entrypoint progress server it can exit so Fastify can own the port. */
export function signalStartupReady(): void {
  try {
    writeFileSync(STARTUP_READY_FILE, '1');
  } catch {
    // no startup gate (local `npm run dev` without Docker)
  }
}

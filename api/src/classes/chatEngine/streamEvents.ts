// types
import type { BusySubagents } from './types';

export function parseBackgroundTasksLine(line: string): BusySubagents | null {
  try {
    const event = JSON.parse(line) as { type?: string; running?: unknown; total?: unknown };
    if (event.type !== 'background_tasks') return null;
    const running = typeof event.running === 'number' && event.running >= 0 ? event.running : null;
    const total = typeof event.total === 'number' && event.total >= 0 ? event.total : null;
    if (running === null || total === null) return null;
    return { running, total };
  } catch {
    return null;
  }
}

export function parseClaudeRateLimitError(rawError: string): { resetAtIso?: string; resetAtReadable?: string } | null {
  const text = rawError.trim();
  if (!/hit your limit/i.test(text) && !/rate limit/i.test(text)) {
    return null;
  }

  const resetMatch = text.match(/resets?\s+([0-9]{1,2}:[0-9]{2}\s*[ap]m(?:\s*\(utc\))?)/i);
  if (!resetMatch) {
    return {};
  }

  const resetAtReadable = resetMatch[1].trim();
  const timeMatch = resetAtReadable.match(/([0-9]{1,2}):([0-9]{2})\s*([ap]m)/i);
  if (!timeMatch) {
    return { resetAtReadable };
  }

  const hour12 = Number.parseInt(timeMatch[1] ?? '0', 10);
  const minute = Number.parseInt(timeMatch[2] ?? '0', 10);
  const ampm = (timeMatch[3] ?? '').toLowerCase();
  if (Number.isNaN(hour12) || Number.isNaN(minute) || hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) {
    return { resetAtReadable };
  }

  let hour24 = hour12 % 12;
  if (ampm === 'pm') hour24 += 12;

  const now = new Date();
  const resetDateUtc = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour24,
      minute,
      0,
      0
    )
  );
  if (resetDateUtc.getTime() <= now.getTime()) {
    resetDateUtc.setUTCDate(resetDateUtc.getUTCDate() + 1);
  }
  return { resetAtIso: resetDateUtc.toISOString(), resetAtReadable };
}

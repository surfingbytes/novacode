/**
 * Formatting helpers for automations — shared by AutomationCard (list + grid
 * layouts) and the AutomationsView run panel. Extracted from AutomationsView.
 */

// types
import type { Automation } from '@/@types/index';

export function formatDate(iso: string | null): string {
  if (!iso) {
    return '—';
  }
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function formatInterval(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}m`;
  }
  if (minutes < 1440) {
    return `${minutes / 60}h`;
  }
  if (minutes < 10080) {
    return `${minutes / 1440}d`;
  }
  return `${minutes / 10080}w`;
}

export function formatNextRun(automation: Automation): string {
  if (!automation.enabled) {
    return 'Disabled';
  }
  if (!automation.nextRunAt) {
    return '—';
  }
  const next = new Date(automation.nextRunAt);
  const now = new Date();
  const diff = next.getTime() - now.getTime();
  if (diff <= 0) {
    return 'Running soon…';
  }
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) {
    return `in ${mins}m`;
  }
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    return `in ${hrs}h ${mins % 60}m`;
  }
  return `in ${Math.floor(hrs / 24)}d`;
}

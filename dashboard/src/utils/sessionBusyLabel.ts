import type { Session } from '@/@types';

/** Label for the busy badge: "Busy" or "Busy · 2/3" when subagents are outstanding. */
export function sessionBusyLabel(
  session: Pick<Session, 'busySubagents'> | { busySubagents?: Session['busySubagents'] }
): string {
  const subagents = session.busySubagents;
  if (!subagents || subagents.total <= 0) {
    return 'Busy';
  }
  return `Busy · ${subagents.running}/${subagents.total}`;
}

export function sessionBusyTitle(
  session: Pick<Session, 'busySubagents'> | { busySubagents?: Session['busySubagents'] }
): string {
  const subagents = session.busySubagents;
  if (!subagents || subagents.total <= 0) {
    return 'Session is running';
  }
  return `Session is running — ${subagents.running} of ${subagents.total} subagents still running`;
}

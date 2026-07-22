const relFmtLong = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** Compact relative time, e.g. "just now", "5m ago", "2h ago", "3d ago". */
export function relativeTimeShort(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(dateStr).toLocaleDateString();
}

/** Verbose relative time via Intl.RelativeTimeFormat, e.g. "5 minutes ago", "yesterday". */
export function relativeTimeLong(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '—';
  }
  const diffSec = Math.round((then - Date.now()) / 1000);
  if (Math.abs(diffSec) < 60) {
    return relFmtLong.format(diffSec, 'second');
  }
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) {
    return relFmtLong.format(diffMin, 'minute');
  }
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) {
    return relFmtLong.format(diffHr, 'hour');
  }
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 30) {
    return relFmtLong.format(diffDay, 'day');
  }
  return relFmtLong.format(Math.round(diffDay / 30), 'month');
}

// -------------------------------------------------- Types --------------------------------------------------

export type UsagePeriodPreset = 'today' | '7d' | '30d' | 'month' | 'custom';

export interface UsagePeriodRange {
  from: string;
  to: string;
}

// -------------------------------------------------- Constants --------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

// -------------------------------------------------- Methods --------------------------------------------------

/**
 * Parse a `YYYY-MM-DD` date input value as local midnight; null when malformed.
 */
function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Resolve a period preset to ISO `from`/`to` timestamps. Custom ranges take `YYYY-MM-DD`
 * values (as from `<input type="date">`) and cover both days fully: from local midnight of
 * `from` to local midnight after `to`. Invalid custom input falls back to the last 30 days.
 */
export function periodRange(
  preset: UsagePeriodPreset,
  now: Date,
  custom?: UsagePeriodRange
): UsagePeriodRange {
  const to = now.toISOString();
  switch (preset) {
    case 'today': {
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { from: midnight.toISOString(), to };
    }
    case '7d':
      return { from: new Date(now.getTime() - 7 * DAY_MS).toISOString(), to };
    case 'month': {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: firstOfMonth.toISOString(), to };
    }
    case 'custom': {
      const customFrom = custom ? parseLocalDate(custom.from) : null;
      const customTo = custom ? parseLocalDate(custom.to) : null;
      if (customFrom && customTo) {
        const endExclusive = new Date(
          customTo.getFullYear(),
          customTo.getMonth(),
          customTo.getDate() + 1
        );
        return { from: customFrom.toISOString(), to: endExclusive.toISOString() };
      }
      return { from: new Date(now.getTime() - 30 * DAY_MS).toISOString(), to };
    }
    case '30d':
    default:
      return { from: new Date(now.getTime() - 30 * DAY_MS).toISOString(), to };
  }
}

/**
 * Format a date as a local `YYYY-MM-DD` value for `<input type="date">`.
 */
export function toDateInputValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

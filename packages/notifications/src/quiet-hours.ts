export interface QuietHours {
  /** "HH:MM" local time. */
  readonly start: string;
  readonly end: string;
}

const toMinutes = (hhmm: string): number => {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

/** Minutes since local midnight in `timeZone`. */
export function localMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  return hour * 60 + minute;
}

/** True when `instant` falls inside quiet hours (which may wrap past midnight). */
export function isQuiet(instant: Date, quietHours: QuietHours, timeZone: string): boolean {
  const start = toMinutes(quietHours.start);
  const end = toMinutes(quietHours.end);
  if (start === end) {
    return false;
  }
  const now = localMinutes(instant, timeZone);
  return start < end ? now >= start && now < end : now >= start || now < end;
}

/**
 * When a notification may be delivered: now for urgent ones or outside quiet hours,
 * otherwise at the end of the current quiet period.
 */
export function deliverAfter(
  now: Date,
  options: { urgent: boolean; quietHours: QuietHours | null; timeZone: string },
): Date {
  const { urgent, quietHours, timeZone } = options;
  if (urgent || !quietHours || !isQuiet(now, quietHours, timeZone)) {
    return now;
  }
  const current = localMinutes(now, timeZone);
  const end = toMinutes(quietHours.end);
  const wait = (end - current + 24 * 60) % (24 * 60);
  const seconds = now.getUTCSeconds() * 1000 + now.getUTCMilliseconds();
  return new Date(now.getTime() + wait * 60_000 - seconds);
}

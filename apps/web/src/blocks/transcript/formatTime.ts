// One cached formatter for transcript times ("14:02"): creating an
// Intl.DateTimeFormat per message (toLocaleTimeString) is slow on long chats.
let formatter: Intl.DateTimeFormat | null = null;

export function formatTurnTime(value: Date | string | number): string {
  formatter ??= new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : formatter.format(date);
}

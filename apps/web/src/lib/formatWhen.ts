// "3 Oct, 15:25" — a timestamp the way the boards and Home write one (day,
// short month, 24h-or-locale time). `dateStyle: 'short'` printed "03/10/2026",
// which reads as March in the US and October elsewhere.
export function formatWhen(date: Date | string | number): string {
  return new Date(date).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

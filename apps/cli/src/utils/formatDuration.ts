/**
 * Format the duration between two dates as a human-readable string.
 * Falls back to elapsed time from startDate to now if endDate is omitted.
 */
export function formatDuration(startDate?: Date, endDate?: Date): string {
  if (!startDate) return '';
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = endDate ? (endDate instanceof Date ? endDate : new Date(endDate)) : new Date();
  const diff = end.getTime() - start.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

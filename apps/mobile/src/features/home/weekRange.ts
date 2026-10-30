/** MD-84: ISO week starts Monday at midnight in the device's local time zone. */
export function weekRange(now = new Date()): { from: string; to: string } {
  const monday = new Date(now);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  monday.setHours(0, 0, 0, 0);
  return { from: monday.toISOString(), to: now.toISOString() };
}

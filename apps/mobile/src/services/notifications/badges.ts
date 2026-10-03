// The app badge (06 §5.5): the sum of the last known Needs-you count per paired server. The active server's count
// comes from its attention feed; another server's from its last push (`data.counts`). Pure.

export const badgePrefKey = (serverId: string): string => `srv.${serverId}.badge.needsYou`;

export function badgeTotal(serverIds: readonly string[], read: (key: string) => number): number {
  return serverIds.reduce((sum, id) => sum + Math.max(0, Math.floor(read(badgePrefKey(id)) || 0)), 0);
}

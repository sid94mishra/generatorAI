// ────────────────────────────────────────────────────────────────
// Where "back" goes when there is no history to pop.
//
// A screen reached by a notification tap, a deep link or cold-start restore is
// the ROOT of the stack. The header's back button already falls back to a
// parent (`headerBack(fallback)`), but the Android hardware/gesture back had
// nothing to pop and closed the app — found by pressing back on a restored
// workflow screen on the emulator. Pure, so the mapping is tested.
// ────────────────────────────────────────────────────────────────

/** Paths where leaving the app on back is the platform-correct behaviour. */
const ROOTS = new Set(['/', '/chats', '/runs', '/projects', '/pair', '/revoked']);

export function backFallbackFor(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (ROOTS.has(path)) return null;
  const [first, second, third] = path.split('/').filter(Boolean);
  switch (first) {
    case 'chats':
      return '/(tabs)/chats';
    case 'runs':
      // A stage drill-in returns to its run.
      return third === 'stages' && second ? `/runs/${second}` : '/(tabs)/runs';
    case 'workflows':
    case 'automations':
    case 'scripts':
      return '/(tabs)/runs';
    case 'projects':
      // Deeper project screens (PRs, codebases) return to the project.
      return third && second ? `/projects/${second}` : '/(tabs)/projects';
    case 'settings':
      return second ? '/settings' : '/(tabs)';
    default:
      return '/(tabs)';
  }
}

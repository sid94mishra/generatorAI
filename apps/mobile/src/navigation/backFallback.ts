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
      // A run with no history behind it (a deep link, a notification) backs
      // out to the Workflows catalogue: there is no runs list, and the run's
      // workflow is not known from the path. The run screen itself knows it
      // and offers the workflow directly.
      return third === 'stages' && second ? `/runs/${second}` : '/(tabs)/runs?segment=workflows';
    case 'workflows':
      return '/(tabs)/runs?segment=workflows';
    case 'automations':
      return '/(tabs)/runs?segment=automations';
    case 'scripts':
      return '/(tabs)/runs?segment=scripts';
    case 'projects':
      // Deeper project screens (PRs, codebases) return to the project.
      return third && second ? `/projects/${second}` : '/(tabs)/projects';
    case 'settings':
      return second ? '/settings' : '/(tabs)';
    default:
      return '/(tabs)';
  }
}

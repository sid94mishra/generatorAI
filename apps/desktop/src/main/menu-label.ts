// ────────────────────────────────────────────────────────────────
// Native menu wording from the command registry. The registry holds one
// sentence-case label per command ("New chat", "Toggle side dock"); the
// application menu, the Dock menu and the JumpList use title case, which is
// the platform convention for menu items on macOS and Windows alike
// ("New Chat", "Toggle Side Dock"). The tray keeps the registry's sentence
// case, as its board draws it. Electron-free so it is unit-testable.
// ────────────────────────────────────────────────────────────────

/** Short words kept lower case in title case unless first or last (HIG). */
const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'the', 'to', 'via']);

/** "Toggle side dock" → "Toggle Side Dock"; "Search or jump to" → "Search or Jump To". */
export function menuLabel(label: string): string {
  const words = label.split(' ');
  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && i < words.length - 1 && MINOR.has(lower)) return lower;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

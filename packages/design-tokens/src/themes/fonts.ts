// ────────────────────────────────────────────────────────────────
// Type stacks.
//
// Every stack ENDS in the platform default, so no theme depends on a font
// being installed and nothing is bundled: a user with JetBrains Mono gets
// JetBrains Mono, a user without it gets Consolas, and neither gets a layout
// shift or a network request. That constraint is deliberate — the desktop
// shell runs offline, and a theme that only looks right with a webfont is a
// theme that looks wrong on first launch.
//
// The stacks differ enough to be felt (geometric vs humanist vs neo-grotesque)
// without being so exotic that the fallback reads as a different design.
// ────────────────────────────────────────────────────────────────

/** The historical default — pure platform UI font. */
export const SYSTEM_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

export const SYSTEM_MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** Neo-grotesque, tight apertures — the Linear / Vercel register. */
export const GEOMETRIC_SANS =
  '"Geist", "Inter Variable", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

/** Humanist, generous x-height — reads softer at small sizes. */
export const HUMANIST_SANS =
  '"IBM Plex Sans", "Source Sans 3", "Segoe UI", -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';

/** Rounded terminals — pairs with the pastel themes. */
export const ROUNDED_SANS =
  '"Nunito Sans", "Rubik", "Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';

export const CODE_MONO =
  '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const PLEX_MONO =
  '"IBM Plex Mono", "Roboto Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const CASCADIA_MONO =
  '"Cascadia Code", "Cascadia Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

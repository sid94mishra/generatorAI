// ────────────────────────────────────────────────────────────────
// Type stacks (D-16; 02-design-system-spec.md §5.1).
//
// Two variable families are bundled (Instrument Sans, JetBrains Mono). Every
// theme stack names its own fonts first, then the bundled family, then
// generic system fonts. No font is ever fetched from a CDN: the web app ships
// the files in its own build (`apps/web/src/styles/fonts.ts`), so the desktop
// shell renders identically offline and a theme's named font that is not
// installed falls back to the bundled family instead of a platform font.
//
// The exception is SYSTEM_SANS / SYSTEM_MONO (GitHub, One, Dracula …): the
// platform font IS that theme's choice, so those stacks stay system-only.
//
// ── Licensing and file choice (M-14) ────────────────────────────
// • Instrument Sans — © 2022 The Instrument Sans Project Authors
//   (github.com/Instrument/instrument-sans). SIL Open Font License 1.1.
// • JetBrains Mono — © 2020 The JetBrains Mono Project Authors
//   (github.com/JetBrains/JetBrainsMono). SIL Open Font License 1.1.
// The OFL allows bundling and redistributing the fonts inside an application
// (web, desktop, mobile) as long as the fonts are not sold on their own and
// the copyright + licence travel with them; the Fontsource packages carry the
// licence text (`node_modules/@fontsource-variable/*/LICENSE`). Neither family
// is modified, so the Reserved Font Name clause does not apply.
// Files: web/desktop use the Fontsource VARIABLE packages
// (`@fontsource-variable/instrument-sans`, `@fontsource-variable/jetbrains-mono`),
// upright `wght` axis only, latin + latin-ext subsets (4 woff2 files); the UI
// uses weights 400/500/600 (D-13). Mobile (next pass) bundles STATIC 400/500/600
// TTFs with the `expo-font` config plugin (variable fonts need Expo SDK 58).
// ────────────────────────────────────────────────────────────────

/** The historical default — pure platform UI font. */
export const SYSTEM_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

export const SYSTEM_MONO =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/** Neo-grotesque, tight apertures — the Linear / Vercel register. */
export const GEOMETRIC_SANS =
  '"Geist", "Inter Variable", "Inter", "Instrument Sans Variable", ui-sans-serif, system-ui, sans-serif';

/** Humanist, generous x-height — reads softer at small sizes. */
export const HUMANIST_SANS =
  '"IBM Plex Sans", "Source Sans 3", "Instrument Sans Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';

/** Rounded terminals — pairs with the pastel themes. */
export const ROUNDED_SANS =
  '"Nunito Sans", "Rubik", "Instrument Sans Variable", "Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';

/** The design's UI family (D-16), bundled. */
export const INSTRUMENT_SANS =
  '"Instrument Sans Variable", "Instrument Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** The design's machine-text family (D-16), bundled. */
export const BUNDLED_MONO =
  '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const CODE_MONO =
  '"JetBrains Mono Variable", "JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const PLEX_MONO =
  '"IBM Plex Mono", "Roboto Mono", "JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export const CASCADIA_MONO =
  '"Cascadia Code", "Cascadia Mono", "JetBrains Mono Variable", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/** The families the web build bundles (registered `font-family` names). */
export const BUNDLED_FONT_FAMILIES = ['Instrument Sans Variable', 'JetBrains Mono Variable'] as const;

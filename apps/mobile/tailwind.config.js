/** @type {import('tailwindcss').Config} */
// Colours come from the generated token module so web and mobile cannot
// diverge. Everything resolves through CSS variables at runtime, which is how
// theme + accent switching works without a re-render of the whole tree.
const { tailwindColors, radius, fontSize, spacing, lineHeight } = require('./src/theme/tokens.generated.ts');

module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  // The app exposes an explicit appearance picker (system / light / dark), so
  // the colour scheme is set imperatively rather than being driven purely by
  // `prefers-color-scheme`. NativeWind's default of `media` makes that throw
  // ("Cannot manually set color scheme, as dark mode is type 'media'"), so the
  // strategy has to be `class` for the picker to work at all.
  darkMode: 'class',
  theme: {
    extend: {
      colors: tailwindColors,
      // The token radii stop at 10px, which is a desktop scale. Touch
      // surfaces read as square at that size, so the mobile-only steps below
      // extend the ramp: rows 12, cards 16, sheets 24.
      borderRadius: {
        DEFAULT: `${radius.DEFAULT}px`,
        lg: `${radius.lg}px`,
        xl: `${radius.xl}px`,
        '2xl': '12px',
        '3xl': '16px',
        '4xl': '24px',
        full: '9999px',
      },
      fontSize: Object.fromEntries(
        Object.entries(fontSize).map(([k, v]) => [k, `${v}px`]),
      ),
      spacing: Object.fromEntries(Object.entries(spacing).map(([k, v]) => [k, `${v}px`])),
      // `leading-code` and `leading-relaxed` were already used in components
      // but never declared here, so they silently resolved to nothing and
      // every code block rendered at the default line height.
      lineHeight,
      fontFamily: {
        // RN only ever uses the first entry; the rest are for the web
        // preview, where JetBrainsMono is not installed and `font-mono`
        // otherwise silently fell back to the body serif — which made every
        // diff, tool argument and file view unreadable.
        mono: ['JetBrainsMono', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

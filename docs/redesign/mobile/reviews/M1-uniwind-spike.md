# M1-08 — Uniwind gates

Status: **GO — Uniwind 1.12.1 on SDK 57** (2026-10-02, MD-115). Gate A met; Gate B passed on iOS (12/12) and on
Android for every check the emulator could run (10 and 11 not re-run there, see below). No styling-engine migration is
claimed here: adoption is M3-05.

History: 2026-09-29 (Codex) — Gate A open (no release after 1.12.0), Gate B not run (MV-09).

## Gate A — platform-variant fix

| Package | Published tag (2026-10-02) |
|---|---|
| uniwind latest | **1.12.1** (2026-10-01) |
| expo latest / sdk-57 | 57.0.26 |
| expo next | 58.0.2 (SDK 58 not `latest`) |
| nativewind latest / rc | 4.2.7 / 5.0.0-rc.0 |

PR [#686](https://github.com/uni-stack/uniwind/pull/686) ("keep media queries for every rule of a block") merged
2026-09-23 as `31d91fc7`; the GitHub compare `31d91fc7…v1.12.1` is `ahead`, `behind_by 0`, so **v1.12.1 contains it**.
Gate A action for M3-05: pin `uniwind` **exactly** at `1.12.1`, and relax `platformClassVariant` to allow platform classes
inside `src/ui/**` only (02 §9.9). Checks 3 and 9 below were run on 1.12.1, as Gate A requires.

## Gate B — scratch app

Where: a standalone Expo SDK 57 app (RN 0.86.3, React 19.2.3, Reanimated 4.5.1, Tailwind 4.3.3, uniwind 1.12.1 exact),
run in **Expo Go** on both platforms — Uniwind has no native module (Metro + Tailwind transform only), so no dev-client
build was needed. The owner chose SDK 57 for this spike (plan order, 2026-10-02); SDK 58 is still only `next`.
Source: `reviews/M1-uniwind-spike/` (`App.tsx`, `global.css`, `metro.config.js`, `package.json`, `gen-themes.ts`).
Screenshots (local, gitignored): `docs/redesign/shots/mobile/M1-08/`.

Theme input: `gen-themes.ts` emits every theme × mode from `resolveDesignTokens` / `DESIGN_COLOR_VARS` (the same values
web's `--gai-*` layer uses) as Uniwind `@variant` blocks — `light`, `dark` plus 36 `<theme>-<mode>` (38 blocks × 32
colours); the 36 names go to `extraThemes`.

| # | Check | iOS (gai-iphone, iOS 26) | Android (gai-phone) |
|---|---|---|---|
| 1 | Builds and boots; `bg-surface` paints | pass — export 1,164 modules; app paints | pass — 1,290 modules (dev) |
| 2 | 38 `@variant` blocks; `setTheme` between instrument-dark, github-light, solarized-light | pass — colours switch, mount counter unchanged (no remount); no Metro warning about missing variables | pass — light → instrument-dark |
| 3 | `@variant ios/android` geometry | pass — `text-body` 17/24, `rounded-card` 14 | pass — 16/24, 12 |
| 4 | `updateCSSVariables` accent on the active theme; on an inactive theme then `setTheme` | pass — `#ff2d95` live; `#9be22d` set on github-dark persisted on switch | pass — both |
| 5 | `ScopedTheme` | pass — solarized-light card inside other themes, with that theme's own accent override | pass |
| 6 | `@theme inline` → `var(--gai-…)`; line-height / weight / tracking sub-vars | pass — display 32/37/600/−0.64, title 17/22/600; px line heights are absolute | pass — same |
| 7 | `shadow-pop` / `shadow-float` → RN `boxShadow`; `tabular-nums`; `font-mono` + weight | pass — visible; Menlo semibold | pass with a note: shadows, tabular OK; system `monospace` has no 600, renders regular → solved by bundled JetBrains Mono weights (M3-06) |
| 8 | `*ClassName` colour props; safe-area utilities | `placeholderTextColorClassName`, `colorClassName` (ActivityIndicator) work; `pt-safe` with `Uniwind.updateInsets` works. `selectionColorClassName` / `cursorColorClassName` accepted (no error), colour not measurable in screenshots — treat as unverified, kit falls back to `useThemeColors()` (§2.6) | placeholder + ActivityIndicator work |
| 9 | Release export: no cross-platform leak | pass — `ios:text-ok android:text-warn` resolves to ok-text on iOS | pass — resolves to warn on Android. Note: both platforms' `@variant ios/android` var tables ship in each bundle (`__uniwind-platform-ios/-android`, a few hundred bytes), selected at runtime — values never apply on the wrong OS |
| 10 | `Activity` hidden while the theme changes, then shown | pass — panel shows the new theme | **not re-run** — the emulator's System UI ANR (MV-18) made input unreliable; same JS path as iOS |
| 11 | Reanimated component via `withUniwind` animates | pass — width differs between consecutive frames | **not re-run** (as 10) |
| 12 | `@import '@generatorai/design-tokens/css/vocabulary.css'` resolves | pass — package specifier resolves (via a `file:` link in the scratch app; in the workspace it is a normal pnpm package) | same bundle |

No check of 1–6 or 9 failed → **go** (02 §9.9); the NativeWind 5 fallback is not needed (and NativeWind 5 is still RC).

## Consequences for M3

- M3-03…M3-08 may run on SDK 57 (07-phases "SDK fallback details"); M3-01/02 (SDK 58 + React Compiler) get their own
  mini-review when 58 is `latest`.
- M3-04's emitter can reuse the spike's approach: `@variant <theme>-<mode>` blocks from `resolveDesignTokens`, the theme
  names fed to `extraThemes`; accent overrides via `updateCSSVariables` per theme.
- Re-run checks 10 and 11 on Android with the first M3-05 native build (tracked in MV-09).

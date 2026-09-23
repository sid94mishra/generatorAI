---
title: Design system and interaction patterns
description: Shared tokens, themes, components, responsive workspaces, native platform adaptations, accessibility, and validation.
---

# Design system and interaction patterns

GeneratorAI shares semantic design tokens across web, native mobile and terminal interfaces. Each client renders those tokens through platform-appropriate components. Consistent meaning matters more than making a phone sheet, desktop panel and terminal pane look mechanically identical.

## Token architecture

`packages/design-tokens` owns the theme registry, semantic color derivation, typography, radius, spacing, motion and file-type colors. Emitters produce CSS, React Native values and ANSI-compatible terminal output. Generated web/native values should be regenerated from this package rather than edited independently.

| Token family | Implementation |
| --- | --- |
| Surfaces and text | Theme-specific semantic foreground/background/muted/raised/sidebar and border values |
| Intent | Primary/accent, success, warning, danger and matching readable foregrounds |
| Typography | System UI body families, code/monospace families and a shared scale; theme-specific font choices |
| Spacing | Four-unit grid: 0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64 |
| Base font scale | 11, 12, 14, 15, 17, 20, 24, 30 |
| Radius | Fallbacks 6, 8, 10 and fully rounded; active themes can choose their own radii |
| Motion | Instant 0 ms; fast 120 ms; normal 180 ms; slow 220 ms |
| File-type icons | Deliberately stable across themes to match the tree component's icon palette |

Theme definitions are GitHub, Graphite, Carbon, Clay, One, Dracula, Tokyo Night, Catppuccin, Ayu, Night Owl, Rosé Pine, Nord, Everforest, Gruvbox, Solarized, Flexoki and Contrast. The picker uses the registry's visible themes and groups them as Product, Editor and Low glare. GitHub is the default palette and dark is the default mode. Users can choose system/light/dark separately from palette and accent.

The source explicitly records an upstream vermilion file-icon contrast exception. Token-level contrast tests therefore do not justify a blanket claim that every rendered icon and surface meets every accessibility criterion.

## Web and desktop components

The React client uses Tailwind and shared UI primitives, with Radix components for dialogs, menus, popovers, selection and other accessible foundations. Lucide supplies interface icons. Workflow diagrams use React Flow; terminal rendering uses xterm; code and diff surfaces use the dedicated tree/diff components.

New controls should reuse the corresponding UI primitive and semantic color role. Loading, empty, error and disabled states need explanatory text and a recovery action where one exists. Success feedback should follow the server result, especially for provider setup, approvals, mutation forms and long-running operations.

The main layout provides three possible regions: navigation, task content and a workbench dock. The right pane persists tabs per entity, shares width preferences where appropriate, supports maximize/collapse and changes to a full-width sheet when two usable columns cannot fit. Inactive mounted panels must suspend unnecessary frame decoding/socket work. Long content belongs to an intentional scroll owner; nested unconstrained scrollers produce the double-scrollbar problem.

## Mobile platform adaptations

The Expo application uses native navigation with four primary tabs, custom screen headers, sheets, segmented controls, Reanimated gestures and safe-area helpers. The UI kit centralizes buttons, form fields, list rows, context menus, swipeable rows, keyboard-sticky controls, toasts, skeletons, state views and progress indicators.

| Pattern | iOS | Android |
| --- | --- | --- |
| Bottom navigation | iOS-sized bar and tinted glyphs, native glass where available | Material-style taller bar and selected-icon pill |
| Glass/material | `GlassSurface.ios.tsx` uses `expo-glass-effect` only when supported | `GlassSurface.tsx` uses opaque themed material surface |
| Accessibility fallback | Reduce Transparency or unavailable API produces an opaque surface | Opaque surface is the normal implementation |
| Sheets | Native route form sheets and shared custom sheets, safe-area-aware footer | Shared sheet behavior adapted to keyboard/back navigation |
| Motion | UI-thread Reanimated presets and iOS navigation gestures | UI-thread presets and Android back/keyboard handling |

Liquid Glass is applied to control chrome, not the code/transcript reading surface. It is an OS/API-dependent enhancement; an iOS build with opaque controls can be the correct fallback. The Android implementation is not a claim of using Apple's native material.

Wide mobile screens center content at a readable width and account for safe-area insets. Small screens show session tools as a full-width pane strip and sheets. A shared `TWO_PANE_MIN_WIDTH` token exists, but actual component decisions also consider host width and usable content; do not assume every mobile screen switches to desktop layout at exactly one breakpoint.

## Composer and long-running work

The composer must keep draft text, attachments and chosen model/options visible without competing with the transcript. Mobile's keyboard-sticky shell and turn-options sheets preserve writing space. Web/desktop use inline controls and popovers with more room for the model and session state. Slash suggestions, capture actions and prompt history share the task context.

Streamed output can update many times a second. Transcript selectors, virtualization, memoized panel bodies and UI-thread animations reduce contention. A hidden Browser panel should not decode the same frame stream as the visible one. A terminal should preserve session/scrollback when a tab is switched, while closing a tab follows its explicit cleanup policy.

Keep the distinction between current activity, a pending decision and a completed result visible. Plans, tool permissions, questions and background tasks are different interaction types; they should not collapse into a single ambiguous spinner.

## Accessibility and input

Web components use semantic buttons, labels, dialog behavior, keyboard navigation and visible focus. Dense right-pane icons expand their hit area beyond their visible glyph. Mobile primitives centralize target sizing, font-scale policy, accessible labels/roles, haptics and reduced motion. Control text uses bounded scale policies while content has separate reading behavior; test large text instead of assuming the default screen proves accessibility.

Mobile motion has two layers: Reanimated respects the OS reduce-motion policy in worklets, while preference-aware hooks honor the app's System/Reduced/Full selection. Reduce Transparency is a separate iOS setting. App lock also renders privacy protection during background transitions.

Keyboard shortcuts are contextual. Text-entry controls must retain printable characters, Escape should close the topmost transient surface, and navigating tabs should not unexpectedly send input to an inactive terminal. The [desktop](../clients/desktop.md) and [CLI](../clients/cli.md) pages list the major shortcuts; their source registries provide the complete contract.

## Contributor workflow

1. Identify the semantic role and existing component for the new control.
2. Update the token source if the design requires a reusable value; regenerate outputs using the root `tokens:write` script.
3. Check light/dark and a high-contrast palette, including disabled, hover, pressed and error states.
4. Check narrow and wide layouts, long labels, empty states, streaming content and large result sets.
5. Verify keyboard focus, screen-reader names, large text and reduced motion.
6. For native changes, run a device build: web preview cannot validate Liquid Glass, hardware keys, native push, biometrics or keyboard/gesture integration.

Relevant checks are `pnpm check:tokens`, web `check:design`, web `check:bundle`, package typechecks/tests, and mobile `bundle:analyze`. Confirm root script names in `package.json` if changing the tooling. Passing these checks is useful evidence, not a substitute for visual inspection of the rendered client.

## Review limits

This page documents the current design implementation and intended interaction contract. It is not a new accessibility conformance certificate or a claim that all native OS permutations were tested while building this documentation site. Product screenshots and earlier audit reports should retain their date/runtime context. When a design behavior changes, update this page together with the relevant client guide and evidence.

Sources: `packages/design-tokens/src/{tokens,registry}.ts`, `packages/design-tokens/src/themes/`, `packages/design-tokens/src/emit/`, `apps/web/src/components/ui/`, `apps/web/src/components/layout/RightPane.tsx`, `apps/mobile/src/components/ui/`, `apps/mobile/src/theme/`, `apps/mobile/src/navigation/`, `apps/mobile/app/(tabs)/_layout.tsx`, `packages/cli-core/src/keymap/Keymap.ts`.

## Documentation-site parity

The documentation site now generates its palette snapshot directly from this package. It offers the same 17 visible palettes, both appearances, and six accents. GitHub dark/blue is the default, matching the renderer baseline. The appearance menu in the navbar controls palette/accent; the mode toggle selects light or dark. The docs use a compact navigation rail, layered neutral panels, semantic borders, shared font stacks and the active palette's radii. Article text remains 15px with a relaxed reading line height.

Documentation preferences use their own local keys (`generatorai:docs:palette`, `generatorai:docs:accent`, plus Docusaurus mode storage) and do not change the connected application's settings. `npm run theme:generate` reads the shared source and writes only the documentation site's snapshot, so publishing the static docs does not require product packages at runtime.

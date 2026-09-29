# M1 tooling evidence

## M1-05 — lint and design guardrails (2026-09-29)

Task packet: MD-14/15/86, 02 §9.8, 07 M1-05, 08 Done loop. No redesigned surface; no board value changes. Root ESLint imports a mobile-only configuration; existing web/desktop policies are unchanged.

- Boundaries cover kit, blocks, feature domains, services, theme, routes and legacy. Kit cannot reach legacy, services or feature state; feature domains cannot import each other. Router adapters admit Stack/Link presentational exports, not hooks/router.
- React hooks and compiler rules enabled. Vocabulary checks use the actual Tailwind compiler plus generated shared vocabulary and mobile restrictions. UI component JSX requires a sibling story.
- Existing violations recorded per file, per diagnostic; `--update` never raises an allowance. `--strict` also requires decreases to be recorded. New files have zero allowance. Existing routes ratchet until ported (MD-108).
- Ten Node integration tests pass, including deliberate illegal imports/styles/classes, conditional hooks, new-route enforcement, named class string extraction and baseline transfer/growth rejection.
- Typecheck passes. Lint / strict design audit recorded in `.expo/m1-05-*.log`. No changed TypeScript application code for Vitest-related execution; tooling uses Node integration tests. Jest bootstrap remains M1-06.
- Fingerprint detects `packageJson:scripts` only. No native/runtime code changed; rebuilding is carried into M1-06 rather than claiming fingerprints match. No changed screen to walk through. Existing native characterization gaps remain MV-01…05.
- No legacy screen/component is replaced by this task.

## M1-06 — component test and story harness (2026-09-29)

Implementation complete; native acceptance remains pending MV-07.

- Jest 30 + SDK-matched jest-expo 57.0.5 + RNTL 14.0.1 + test-renderer run separate iOS and Android projects. Vitest remains the pure-logic runner (`test` / `test:unit`); Jest is `test:ui` / `test:kit`, per 07's higher-precedence task wording.
- Installed Worklets' supported Jest resolver is composed with workspace source resolution (including the client-only shared entry). Reanimated setup, keyboard mock and MMKV's built-in in-memory test mode are retained.
- Six assertions/tests pass across four platform suites: accessible native button activation, disabled behavior, and preview appearance changes that never write the saved app preference. Typecheck, lint and the shrinking design audit pass. Vitest-related reports no matching pure tests for the provider.
- Storybook RN 10.6 with controls/actions, LiteUI, automatic websocket channel and experimental MCP. Verified installed options and the `deviceAddons` field. `EXPO_PUBLIC_STORYBOOK=1` enables Metro integration; otherwise the route redirects and the wrapper strips Storybook imports. Generated `storybook.requires.ts` is ignored. Without a registered MCP connector, discovery remains `rg --files -g '*.stories.tsx'`.
- `/storybook?story=ui-verification-nativebutton--enabled&theme=instrument&mode=dark&accent=ink` selects a canvas for capture. `vrt-root` wraps it; `vrt-ready` follows a rendered story and two frames. The current story uses platform fonts. The M3 font loader and native text-scale sweep are still pending before real kit VRT.
- Legacy `components/ui/gallery.tsx` and its barrel export deleted. The bootstrap NativeButton is story-only, not the production M4 Button.
- Fingerprint requires rebuild: transitive on-device controls add datetimepicker/slider and pnpm changes native peer paths. iOS prebuild and pods succeed; native build started in `.expo/m1-06-ios-build.log`. Both native story walkthroughs and the dedicated flow remain pending; no device pass is claimed. Android follows iOS sequentially.
- Existing SDK peer mismatch: Storybook's UI advertises safe-area-context 5.8.0; SDK 57 retains its matched 5.7.0. Verify native behavior and revisit with M3, rather than upgrading the SDK's native peer silently.

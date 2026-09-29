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

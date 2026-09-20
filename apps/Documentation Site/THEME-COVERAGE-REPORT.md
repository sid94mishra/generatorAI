# Application theme and documentation coverage audit

Follow-up to the original documentation delivery. This report describes the current 69-page React/Docusaurus site, the application theme match, and the expanded configuration references. The original `AUDIT-REPORT.md` is historical.

## Theme match

The running Electron application was visually inspected alongside the shared design-token package and renderer appearance implementation. The documentation now uses the application's neutral workspace surfaces, blue default accent, compact navigation, system fonts, semantic borders, and corner radii. The palette baseline comes from source defaults; the visual inspection did not read the user's selected palette from application preferences.

| Application concept | Documentation implementation | Reason |
| --- | --- | --- |
| GitHub dark baseline | Background `#0d1117`, card `#161b22`, foreground `#e6edf3`, muted text `#8b949e`, border `#30363d` | Matches the renderer's default workspace palette |
| Blue accent | Link/accent `#4493f8`, filled action `#1f6feb` in GitHub dark | Preserves the distinction between readable text and contrast-adjusted action fills |
| Palette registry | All 17 visible themes; light and dark appearance; all six accents | Uses the same choices and resolved values as the application |
| Typography and surfaces | Shared sans/mono stacks, palette radii, semantic code and status colors | Keeps navigation, tables, examples and search visually consistent |
| Workspace layout | Compact 52px navbar, navigation rail, restrained panels and headings | Makes the site feel related to the developer workspace while retaining readable articles |
| Responsive behavior | Collapsing navigation, stacked phone layout, bounded search and appearance panels | Keeps controls reachable on smaller screens |
| Interaction | Keyboard focus, Escape dismissal, persisted palette/accent, reduced-motion support | Supports keyboard use and preserves reader preference |

Source authority: `packages/design-tokens/src/index.ts`, `packages/design-tokens/src/themes/{index,types,registry,tokens}.ts`, the renderer theme implementation, and the running desktop interface. `scripts/generate-theme.mjs` reads these pure modules to generate the local snapshot. Static hosting does not require importing the product at runtime.

The documentation stores its own preferences. It does not change GeneratorAI's settings. Its mode control offers light/dark; the product's separate system-mode preference is documented in the client settings guide.

## Content coverage

| Inventory | Current coverage |
| --- | --- |
| Markdown documents | 69 |
| Product module map | 10 top-level apps and 20 shared packages; nested device-key and test workspace covered in guides |
| HTTP surface | 331 literal route registrations and two separately documented regex routes |
| Client screens/settings | 20 web page component files, 41 mobile route-tree files, 15 settings sections |
| CLI surface | 219 commands in 25 groups in the existing registry snapshot |
| Environment inventory | 221 distinct statically found names |
| Configuration references | 90 evaluated shared/CLI schemas, 2,994 field rows, plus 35 route-local validators |
| Worked examples | 24 downloadable JSON bodies and four negative schema checks |
| Theme combinations | 17 palettes × two appearances × six accents = 204 |

Counts are an inventory, not a claim that there are 2,994 unique user options. Create/update/import schemas repeat fields. Route-file and environment extraction have explicit limitations described in the coverage guide.

The [configuration map](docs/configuration/index.md) connects every documented feature family to its configuration reference, feature guide and example or verification recipe:

- Dashboard/navigation; projects, codebases and worktrees.
- Chat setup and prompts; sources, attachments, provider selection, model/mode configuration and agent overrides.
- Plans, questions, permission decisions, review gates and optimistic concurrency.
- Reusable agents, skills, MCP connections and artifact catalogues.
- Workflow graphs, stages, dependencies, variables, sessions, retries, run profiles, review transitions, templates and hooks.
- Executable workflow scripts and their separate trust/configuration boundary.
- Automations, triggers, schedules, datasets, grouping, input sources and execution iteration.
- Diff/review, files, terminal, browser, widgets and background-task surfaces.
- Source control, accounts, editors and generated text preferences.
- Host audio, computer use, retention, networking, pairing, device scopes and revocation.
- Desktop/web preferences; mobile motion, haptics, lock and notification behavior; CLI/TUI output and keymaps.
- Extensions, widget manifests/actions, internal SDK, MCP entrypoint and optional process hosts.

Architecture coverage includes composition and dependency boundaries, domain entities, provider adapters, durable streams/replay, persistence and migrations, workspace mounts/checkpoints, source control, execution scheduling, automation fan-out, process ownership, transport/security, voice, observability and extension isolation. New [execution walkthroughs](docs/architecture/walkthroughs.md) follow concrete flows through those layers.

## Configuration quality and examples

The schema generator evaluates the actual pure Zod exports, rather than guessing defaults from text. It expands composed schemas, arrays, records, nested objects, variants, optional/nullable fields and numeric/string constraints. Full source contracts retain refinements and transformations. Route-local validators are extracted as source without starting handlers.

The guides distinguish schema defaults from startup overrides, persisted settings and per-run resolution. They explicitly distinguish omission, `null`, empty arrays and `false`; required children do not make an optional parent mandatory. Manually validated project/preferences bodies and type-only settings are identified separately. A declared field is not presented as a guarantee of provider or UI support.

The examples include a brownfield planning chat, revision-safe plan edits and approvals, a reusable implementation agent, a multi-stage reviewed workflow, run profiles, stage-change requests, typed and scheduled automations, dataset grouping, HTTP inputs, browser configuration, HTTP/STDIO MCP, extensions, background tasks, CLI preferences, hooks, scripts and widget actions. Each includes its contract, usage context, placeholders and expected verification. Examples are validated locally; they do not execute agent/provider tasks or send requests to external services.

## Issues found and corrected

1. The previous documentation's teal presentation did not match the application. It now uses generated application tokens and the compact workspace design.
2. Mobile/tablet search positioning overlapped the appearance control. Both now participate in normal navbar layout, with bounded overlays.
3. A production compilation assumption left the palette options empty. The registry groups now use explicit `Array.from` iteration and are checked in the production browser build.
4. Generated JSON defaults could be interpreted as Markdown URL links. Default cells are now inline code.
5. Markdown asset rewriting added an unsuitable hashed/trailing-slash path to example downloads. A small React component builds exact static download URLs using the configured base path; the examples page explicitly enables MDX for that component.
6. Coverage previously lacked a unified field-level configuration section. It now includes generated contracts, non-schema preferences, complete examples and crosslinks from feature guides.

## Verification

Final verification results from the production browser runs: Machine-readable results live in `audit/browser-results.json`, `audit/subpath-browser-results.json` and `audit/example-validation.json`.

- Markdown/link/module/React checks: passed.
- Root and `/generatorai/` production builds: passed.
- Positive/negative configuration examples: 24 valid bodies passed; four invalid bodies were correctly rejected.
- Root browser regression: **188/188 passed**, 71 routes, zero unexpected browser errors.
- Subdirectory browser regression: **46/46 passed**, zero unexpected browser errors.
- Manual in-app browser review: homepage, palette switching, configuration map and worked example layout verified.
- The search check was synchronized with rendered destination content to avoid a navigation race. Chrome teardown exceeded the bounded cleanup wait on the subdirectory run after results were saved; all assertions and the test exit status passed.

Per-page checks cover HTTP status, hydrated content, heading visibility, loaded images and document-level overflow at desktop and phone sizes. Interaction checks cover local search, keyboard navigation, copy feedback, theme controls/persistence, small-screen overlays, mobile navigation, 404 recovery and exact example downloads. Theme checks compare rendered background, foreground, accent and action fills against all 204 source-derived combinations. Screenshots capture every route at both primary widths, each palette in light/dark, and the interaction states.

Selected local screenshots: [desktop home](audit/screenshots/desktop-home.png), [phone home](audit/screenshots/mobile-home.png), [configuration map](audit/screenshots/desktop-configuration-.png), [phone appearance](audit/screenshots/mobile-appearance.png), [GitHub dark](audit/screenshots/palette-github-dark.png). Screenshots and browser reports are ignored by Git but available in the local checkout.

## Scope and review limits

All writes performed by this task are inside `apps/Documentation Site`. Nothing was staged or committed. The shared working tree already contains product changes. The historical baseline hash check detects additional/concurrent differences outside this folder; those files were not edited or reverted by this task. The check is therefore not reported as a clean whole-repository scope verification.

This is documentation source analysis and documentation-site browser validation. It is not a renewed certification of every product workflow, provider account, native OS capability, package release or accessibility standard. Known partial implementations and differences between clients are documented instead of presented as universal support. Future source changes require regenerating references/examples/tokens and reviewing authored guides.

## Reproduce

Run from `apps/Documentation Site`:

```sh
npm run reference:generate
npm run theme:generate
npm run configuration:generate
npm run build
npm run preview
# In a second terminal:
npm run test:browser
```

For subdirectory hosting:

```sh
DOCS_BASE=/generatorai/ node scripts/docusaurus.mjs build --out-dir build-subpath
DOCS_BASE=/generatorai/ node scripts/docusaurus.mjs serve --dir build-subpath --host 127.0.0.1 --port 4318 --no-open
# In a second terminal:
DOCS_TEST_URL=http://127.0.0.1:4318/generatorai/ DOCS_BUILD_DIR=build-subpath DOCS_TEST_REPORT=audit/subpath-browser-results.json npm run test:browser -- --smoke
```

Source regeneration requires the surrounding checkout and installed product dependencies. Ordinary builds use generated snapshots stored inside this folder and the site's isolated dependencies. The site remains React/Docusaurus; no Vue stack was introduced.

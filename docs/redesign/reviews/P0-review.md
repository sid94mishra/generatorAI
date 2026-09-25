# P0 review — Documentation & rails

- **Range:** `a83a7bf..HEAD` on `desktop_redesign` (HEAD `eeec80e`; commits 53ba8f1, 780e256, 004e1c5, b2afabc, 24e435b, d007e87, eeec80e)
- **Date:** 2026-09-25 · macOS arm64 · reviewer: independent adversarial pass (read-only apart from this file)
- **Scope:** scripts, ESLint/Vitest/CI config, spec and smoke repairs, P0-05 deletions, doc edits made after the plan was added in 53ba8f1. I did not review the plan text itself. As instructed, I did not run the e2e suite or the desktop smokes; the lead appends the e2e result to BASELINE.md.

## Verification re-run

| Command | Result |
|---|---|
| `pnpm --filter @generatorai/web typecheck` | green |
| `pnpm lint` | green (0 errors; web 311 warnings). **All 26 turbo tasks were cache hits** (see P0-R11), so I also ran `pnpm --filter @generatorai/web lint` without the cache: 0 errors, 311 warnings, plus the boundaries `mode` deprecation notice |
| `pnpm --filter @generatorai/web check:design --strict` | OK: every rule unchanged or locked; `radixOverlaySelector` info 3; storiesPresent ok |
| `pnpm --filter @generatorai/web test` | 69 files / 650 tests passed (matches BASELINE) |
| `pnpm --filter @generatorai/web build && check:bundle && check:css` | build ok; bundle 309.5 KB gzip / 800 KB budget OK; check-css: 3 stylesheets, 51 `@theme inline` vars, OK |
| `node scripts/redesign/render-boards.mjs --only=ChatsList,Home` | 4 rendered, 0 failed; PNGs inspected, and the mono and sans fonts render correctly |
| `node scripts/redesign/render-boards.mjs --out=<tmp>` (all boards) | **120 rendered, 0 failed**, so the P0-01 acceptance holds |
| `node scripts/redesign/side-by-side.mjs --board=Home --mode=dark --shot=<tmp png>` | produced `compare-1440-dark.png` next to the shot |
| `node scripts/redesign/make-dummy-repo.mjs`, then `--clean` | work/ under `/var/folders/…/T/generatorai-dummy-repo-*` (outside the checkout); status shows A/M/D/R/?? as specified; branches main, feature/redesign-test, conflict-a/b and their remotes; big.json 716,809 B > 512 KiB; `--clean` removed it |
| Layer probes: `eslint --stdin --stdin-filename apps/web/src/<layer>/…` with throwaway targets created in `src/{ui,blocks,features/*,app,zzunknown}` and deleted in the same command | ui→data/legacy/blocks/features/app/platform/root, type-only imports, `export *` and dynamic `import()` all fail; blocks→features/legacy/app fail; features→other feature (alias and relative)/platform/legacy/app/root fail; legacy→features/app fail; data→ui/features/non-whitelisted legacy fail; root→features/blocks fail. **ui→unknown folder passes** (P0-R2). better-tailwindcss restricted/unknown classes fire in `ui/` and `features/` from both the repo root and `apps/web` |
| Ratchet scenarios on a temp copy of `apps/web/{src,scripts,baselines}` | a rise fails with file:line output; a locked rule fails; `--update` after a rise does not raise the baseline; a fall passes without `--strict`, fails with `--strict` and is locked in by `--update`; new-folder hits fail. **shadcn-shaped component without a story passes** (P0-R3) |

Repo state after the review: `git status` clean, and all probe and temp files removed.

---

## Critical

None.

## Major

### P0-R1 — CI e2e: a comment inside the line continuation drops `PORT`/`WIDGET_PORT`, and nothing asserts the dbPath (D-44)
- **Where:** `.github/workflows/ci.yml:365-376` (added in 004e1c5).
- **Evidence:** the three `# The server reads the BARE names…` lines sit between `WIDGET_PORT=… \` and `DB_PATH=… \`. In bash a `#` after a continuation starts a comment that ends the command, so `PORT=… WIDGET_PORT=…` becomes a bare assignment (not exported), and the server starts with only `DB_PATH…NODE_ENV`. I reproduced it with the same shape: `PORT=undefined WIDGET_PORT=undefined DB_PATH=/x/e2e.db`. The job passes today only because the server defaults (`apps/server/src/index.ts`: port 3100, `WIDGET_PORT ?? '3101'`) happen to equal `SERVER_PORT`. D-44 also requires that "scripts assert the `dbPath` in the startup log before running tests", and the job never checks it. That check is the only guard against a repeat of the silent real-DB bug that D-44 was written for.
- **Fix:** move the comment above the `(` subshell, or put the env in an `env:` block. After `wait_for … server`, add `grep -F "\"dbPath\":\"$state/e2e.db\"" "$state/logs/server.log" || { echo "::error::server not on the temp DB"; exit 1; }` (adjust to the log's actual format).

### P0-R2 — Boundaries fail open for any folder not declared as an element
- **Where:** `eslint.config.mjs:198-260` (the `boundaries/elements` list and the `boundaries/dependencies` rule only).
- **Evidence:** the probe `apps/web/src/ui/ProbeFrom.tsx` → `import { PZ } from '@/zzunknown/ProbeZ'` produced **no error**, while every declared layer was rejected. `default: 'disallow'` covers only known elements. A new `src/services/`, `src/queries/` or `src/constants/` folder therefore escapes D-04 for `ui`, `blocks` and `features` alike. `UI_LAYER` in `no-restricted-imports` does not list such folders either. D-03 ("enforcement by construction") is not met for this case.
- **Fix:** in block (b), enable `'boundaries/no-unknown': 'error'` (unknown targets) and `'boundaries/no-unknown-files': 'error'`. Scope `no-unknown-files` to non-test files, or add a `tests` element for `src/**/__tests__/**` and `*.test.*`, and add `styles` if TS ever imports from it. Add a probe case to the fixture test from P0-R4.

### P0-R3 — `check-stories` misses the component shape the shadcn CLI generates
- **Where:** `apps/web/scripts/check-stories.mjs:20-21, 42`.
- **Evidence:** `EXPORTED_COMPONENT` matches only `export function X`, `export const X`, `export class X`. The shadcn v4 templates, which the plan uses to seed Base UI (README "Key facts": "Base UI (seeded via shadcn CLI)"), declare `function Button(…) {…}` and end with `export { Button, buttonVariants }`. I created `src/ui/primitives/Button/Button.tsx` with exactly that shape in a temp copy, and the check printed `storiesPresent: every kit component has a story`. The header comment treats `export { … }` files as re-exports and skips them. The P1 "file + story" rule would be unenforced from its first component.
- **Fix:** treat a file as a component when it declares a PascalCase `function`/`const`/`class` (exported or not) **and** exports anything. Or parse the `export { A, B }` list and require a story when any name is PascalCase and declared in the file. Treat only `export { X } from '…'` or `export * from` with no local declarations as re-exports.

### P0-R4 — The rails have no tests, and the "bad file fails lint" acceptance has no durable evidence
- **Where:** there are no tests for `check-design-system.mjs`, `check-stories.mjs`, `check-css-emission.mjs`, `render-boards.mjs` (`flattenBoard` is exported but never tested) or the ESLint layer rules. `scripts/__tests__/` holds only `copySecretsDir.test.mjs`.
- **Evidence:** the ratchet semantics (never raise, `--strict` fails on unlocked falls, lock at zero, per-file map kept on a rise) held when I checked them by hand, but nothing stops a regression. P0-R2 and P0-R3 are exactly the defects fixture tests would have caught. The P0-04 acceptance "a deliberately bad file in `ui/` fails lint (shown in PR)" has no PR, because work lands directly on the branch. The only evidence is this review's probe.
- **Fix:** add `scripts/__tests__/redesign-rails.test.mjs` (root `node` vitest project). It should (1) run the ratchet against a temp `webDir` fixture for rise, fall, `--strict`, `--update`, lock and new-folder cases (the script needs a `--web-dir`/env override for this); (2) run `findMissingStories` on fixtures, including the shadcn shape; (3) run `flattenBoard` on one real board plus malformed variants (extra prop, missing helmet, leftover `{{`); (4) run `new ESLint().lintText(src, { filePath: 'apps/web/src/ui/X.tsx' })` for each layer edge from the probe table above, including the unknown-folder case.

## Minor

### P0-R5 — `.claude/CLAUDE.md` says "Layers (lint-enforced)", but some listed rules are not enforced
- **Where:** `.claude/CLAUDE.md:12-15, 22-23`; `eslint.config.mjs:230`.
- **Evidence:** "features: Data only via hooks/*Queries.ts or stores". The probe `features/alpha/ProbeFrom.ts` → `@tanstack/react-query` passes. `@/providers/PlatformProvider` (`usePlatform()` returns the raw `HttpPlatformClient`) is a `data` element, so features can reach the platform despite D-04 "platform only through hooks". `@generatorai/client-core` is also allowed. "inline style except for computed geometry" has no ratchet rule and no ESLint rule. This conflicts with D-03 ("every rule … has a mechanical check").
- **Fix:** add a features-only `no-restricted-imports` block (`@tanstack/react-query` except `useQueryClient` if it is needed, `@/providers/PlatformProvider`, `@generatorai/client-*`). The block must repeat `WEB_RESTRICTED_IMPORT_PATHS`, `LUCIDE` and `HEADLESS` because of the flat-config replace trap. Add a `scope: 'new'` ratchet rule for `style=\{\{`, or record in 01 which rules are review-only and drop "(lint-enforced)" for those.

### P0-R6 — The ratchet and ESLint disagree about stories
- **Where:** `apps/web/scripts/check-design-system.mjs:51` (`GLOBAL_EXEMPT` has no `*.stories.tsx`) vs `eslint.config.mjs:173` (block (a) ignores `**/*.stories.tsx`).
- **Evidence:** a P1 `Matrix` story in `src/ui/**` with a demo `<button>` or a fixed-width wrapper passes lint but fails `check:design` as a hard-zero new-folder hit. Sessions get contradictory signals.
- **Fix:** pick one policy and record it as a D-xx. Most likely, stories get the vocabulary rules (so they show real classes) but are exempt from `rawButtonElement`/`rawInputElement`/`arbitraryValue` for demo scaffolding. Then make both tools match.

### P0-R7 — "file:line for each new occurrence" can hide the new occurrence
- **Where:** `apps/web/scripts/check-design-system.mjs:333-347`.
- **Evidence:** a rise prints **every** occurrence in each file whose per-file count rose, capped at 60 lines. In the temp-copy scenario, adding one `text-xs` to `AgentEditorPage.tsx` printed all 11 matches. In the 100+-hit legacy files (`ChatInput.tsx`, `globals`-heavy pages), the new line can fall past the cap. 09 §2.1 asks for the new occurrences.
- **Fix:** when a file rose, intersect its hit lines with `git diff -U0 HEAD -- <file>` added lines (fall back to all hits when git is unavailable), or at least sort by line and print the count per file before truncating.

### P0-R8 — The `check-css` variable check is vacuous for self-referencing `@theme` keys
- **Where:** `apps/web/scripts/check-css-emission.mjs:66-78`.
- **Evidence:** `globals.css` has `--font-sans: var(--font-sans)` and `--font-mono: var(--font-mono)` in `@theme inline`, and the built CSS contains the literal declaration `--font-sans:var(--font-sans)`. `defined` counts that declaration as the definition, so the check passes even when the real value is missing. The comment ("the self-check below still needs") refers to a check that does not exist.
- **Fix:** build `defined` from declarations whose value is not exactly `var(<same name>)`, and fix the comment.

### P0-R9 — The main-module guard silently no-ops when a script is run through a symlink
- **Where:** `apps/web/scripts/check-stories.mjs:50`; `scripts/redesign/render-boards.mjs:161`.
- **Evidence:** `node <symlink-to-repo>/apps/web/scripts/check-stories.mjs` prints nothing and exits 0; run directly, it prints `[check-stories] OK`. `import.meta.url` is the realpath, but `process.argv[1]` is not. The same thing happens with macOS `/tmp`→`/private/tmp`, Windows junctions/`subst` drives and symlinked worktrees, and `render-boards` then exits 0 without rendering anything.
- **Fix:** `fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)` (Node 22 has no `import.meta.main`).

### P0-R10 — `side-by-side` compares against a stale board PNG after a board refresh
- **Where:** `scripts/redesign/side-by-side.mjs:34-39`.
- **Evidence:** it renders only when `boards/png/<Board>.<mode>.png` is missing. After `boards/web/*.dc.html` or `VERSION` changes, the old gitignored PNG is reused, and DIFF.md is written against the old design.
- **Fix:** re-render when the PNG's mtime is older than the `.dc.html` (or `VERSION`), or always render one board (about 1 s).

### P0-R11 — Turbo's lint cache ignores the root ESLint config
- **Where:** `turbo.json:30-32`.
- **Evidence:** `turbo run lint --filter=@generatorai/web --dry=json` shows `globalCacheInputs.files: []`, and the task inputs include `apps/web/tsconfig.eslint.json` but not `eslint.config.mjs`. After a guardrail edit, `pnpm lint` replays a cached green result. My run was 26/26 cached. CI is unaffected because it has no turbo cache.
- **Fix:** add `"globalDependencies": ["eslint.config.mjs"]`, or give `lint` the inputs `["$TURBO_DEFAULT$", "$TURBO_ROOT$/eslint.config.mjs"]`.

### P0-R12 — Lint messages in new code point at the legacy kit
- **Where:** `eslint.config.mjs:26, 32, 36, 146-159, 288`.
- **Evidence:** in `ui/`, `blocks/` and `features/`, the raw `<button>`/`<select>` warnings say "Use <Button> from @/components/ui", and the `Loader2` error inside `ui/` says "Use <Spinner> from @/components/ui". The boundaries rule forbids `ui/` from importing `@/components/*`. The raw-element warning also fires on `src/ui/primitives/**`, where D-43 says the kit must render raw elements (only the ratchet exempts them). Per D-03 these messages steer sessions, and they currently steer them the wrong way.
- **Fix:** build the new-folder variants of `WEB_RESTRICTED_SYNTAX`/`WEB_RESTRICTED_IMPORT_PATHS` with messages that point at `@/ui/primitives` / `@/ui/icons`, and add `apps/web/src/ui/primitives/**` to the design-system block's `ignores` (keeping `components/ui/**`).

### P0-R13 — Doc drift
- `docs/redesign/README.md:27-28`: a blank line splits the scripts table, so the `make-dummy-repo` row renders as a header-less broken table. Delete the blank line.
- `docs/redesign/README.md:37`: says "D-01…D-42", but D-43 and D-44 now exist. In `01-decisions.md`, D-43 and D-44 sit before D-41 and D-42. Move them to the end of §E or of the file.
- `docs/redesign/09-verification.md:396` (§3.7) still has `check:design: a && b`, and §2.3 (`:156`, `:170`) still shows `apps/web/tsconfig.json` and `boundaries/element-types`. D-43 overrides all three, but a P1 session copying §3.7/§2.3 would reintroduce them. Add "superseded by D-43" notes inline.
- `.github/AGENTS.md:209, 212`: P0-03 renamed these rows but kept the wrong defaults. The server's `DB_PATH` default is `<repo>/packages/db/data/generatorai.db` and `TEMPLATES_DIR` is `<repo>/templates` (`apps/server/src/index.ts:217-231`).

### P0-R14 — The COORDINATION note understates P0-04's impact on the Workflow Overhaul
- **Where:** `docs/redesign/COORDINATION.md:11` ("warnings only in legacy code").
- **Evidence:** `boundaries/dependencies` is **error** across all of `apps/web/src`. The workflow-owned `hooks/{workflow,automation,script}Queries.ts` and `stores/workflow*` are `data` elements, so any new import from them into `components/**` (other than the three whitelisted targets) or into `pages/**` now fails lint. Legacy → `app`/`features` also fails. The other session will hit these as errors after merging.
- **Fix:** rewrite the note: "boundaries errors apply to workflow-owned data files: data → components/pages is an error except Toast.tsx and composer/{builtins,types}.ts". List the escape: move shared types to `packages/shared` or `hooks/`.

### P0-R15 — Two repairs pass without checking anything
- `agent-tests/e2e/subsystems-live.spec.ts:123-131`: the new "every ready provider publishes a non-empty model catalog" test skips whenever no provider is ready. That is always the case on the CI runner, so in CI the catalog assertion never runs, and the primary-ready assertion was removed. The logic is right (it avoids special-casing a platform), but CI coverage is now nil. Surface the skip in BASELINE's end-of-P0 section. Longer term, give the CI/sandbox server a provider that reports ready (for example, check whether `GENERATORAI_LOAD_TEST_FAUX_HARNESS=true` registers as ready in `/harness/providers`) so the test runs somewhere.
- `agent-tests/desktop-diff-review-smoke.mjs:67`, `desktop-diff-render-check.mjs:55`: if pairing never succeeds, the smoke logs `WARN` and continues, and the failure then surfaces later as a confusing API error. Record it as a failed check (`record('pairing', false)`) or exit non-zero.

The other repairs are as strong as the originals or stronger. They pin `exact`/`level`, assert `aria-current`, the URL per settings section, the provider registry-driven "Default" badge and "n of m connected", the scoped stage-#1 locators, and the header toggle testid. Every testid they use exists in `apps/web/src` (`settings-page`, `project-pull-requests`, `pr-empty`, `pr-unavailable`, `data-stage-id`, `header-toggle-right-pane`, `right-pane-tab-${type}`, `right-pane-add-${type}`). `chats.spec.ts:14` (`.first()` on "New Chat") is the only loosening, and the empty-state duplicate justifies it. No app source changed in P0-03.

---

## Other checks (no findings)

- **P0-05 deletions:** zero importers confirmed for `ArtifactBrowser`, `ArtifactPicker`, `ChatList`, `chat/redesign/{StepRow,UsageChip}`, `CodebasePicker`, `ProjectPicker`, `WorkflowDefinitionList`: no static, relative, dynamic or string references in `apps/`, `packages/` or `agent-tests/` (only comments and the non-CI docs-site audit JSON). The 15 CSS classes and 8 keyframes have no users in web, desktop, design-tokens or shared, and no template-built `animate-${…}`/`dot-pulse-${…}`; `skeleton-shimmer`/`text-shimmer` are distinct and kept. `material-file-icons` and `rehype-highlight` are gone from package.json and the lockfile. `ToggleSwitch`/`StyledSelect` were correctly kept. Leftover comments still name deleted components (`components/ui/SearchableSelect.tsx:4`, `stores/catalogPrefsStore.ts:6`); cosmetic.
- **Baseline integrity:** each count in `design-system-baseline.json` equals the sum of its per-file map, and no keys are orphaned.
- **Cross-platform:** the scripts use `path`/`os.tmpdir()`/`pathToFileURL`/`execFileSync('git')` (no shell), and turn paths into POSIX form before regex tests. The ratchet regexes and `lineOf` give identical counts on CRLF checkouts. The dummy repo pins `core.autocrlf=false` and isolates git config. `@boundaries/elements` normalises `\` → `/`. Windows lint runs only on push (not on PRs), so Windows layer enforcement is so far established by reading the code, not by a run.
- **Vitest:** single web `unit` project (happy-dom + `vitest.setup.ts`), with the root config reusing it. No web tests exist outside `src/`, so the narrowed include loses nothing. `vitest related --run --project unit <file with no tests>` exits 0.
- **CLAUDE.md:** 79 lines (< 120); it contains the §6.1 loop, the §7.2 selector rule and the owner overrides.

## Exit criteria

| Item | Acceptance (07 §P0) | Status | Evidence |
|---|---|---|---|
| P0-01 | all 60 boards × 2 modes render with no validation error; side-by-side produces a compare PNG; scripts documented in README | **Met** (README table formatting: P0-R13) | 120/120 rendered; compare PNG produced; README "Redesign scripts" |
| P0-02 | launch.json starts the dev server; CLAUDE.md < 120 lines; make-dummy-repo prints a path outside the checkout | **Met** (launch.json by inspection only; I did not start it because :5173 is in use) | `dev` → `pnpm dev`, port 5173; 79 lines; path under `/var/folders/…/T` |
| P0-03 | CI runs on a PR into `desktop_redesign`; baseline lists pass/fail per spec | **Partly met.** Triggers are in place, but CI has never run on the branch (no push/PR). The per-spec table is there (57/23/2 pre-repair; sums check). UI smokes not baselined (owner waiver). The e2e server env is broken (P0-R1) | `ci.yml:5, 19`; BASELINE.md |
| P0-04 | `pnpm lint` + `check:design --strict` green; a bad file in `ui/` fails lint | **Met, with gaps.** Green re-run; the probe proves ui/ violations fail. Gaps: unknown folders (P0-R2), stories check (P0-R3), no durable fixture (P0-R4) | Verification table above |
| P0-05 | typecheck/test/e2e unchanged vs BASELINE | **Pending e2e.** typecheck green; 69/650 unchanged; e2e is being run by the lead | — |
| P0-06 | PD-19 amendment recorded in the Workflow Overhaul Plan | **Open** (owner action) | README progress |
| **Phase exit** | CI green on the redesign branch with all new rules; plan and boards in repo; BASELINE recorded | **Not yet met.** Plan and boards are in the repo (60 boards + canvas.json, VERSION). BASELINE has the pre-repair run, but its "End-of-P0 verification" section is empty. CI has not run on `desktop_redesign`; the local equivalents are green except e2e. Fix P0-R1 before the first push, otherwise the first CI e2e run relies on the default ports | — |

---

## Round 1 fixes

Landed in one commit, `redesign(P0-fix): address P0 review round 1`.

| Finding | What was done |
|---|---|
| **P0-R1** (Major) | `ci.yml` e2e: the explanatory comment moved above the `( … )` subshell, with a note that no comment may sit inside the continuation, so `PORT`/`WIDGET_PORT` reach the server again. After `wait_for … server`, the job polls up to 15 s for `"dbPath":"$state/e2e.db"` in `server.log` and fails with `::error::` (printing the logged dbPath) otherwise. Checked against the real format by starting `dist-bundle/server.mjs` briefly on :3377 with a temp `DB_PATH`: the pino startup line carries `"dbPath":"<path>"` (the `[Server] … listening` record). The shell shape was re-run locally and the YAML parses. |
| **P0-R2** (Major) | `eslint.config.mjs` (b): `boundaries/no-unknown-dependencies` (the v7 name; `no-unknown` is its deprecated alias) and `boundaries/no-unknown-files` are errors. Test files are `boundaries/ignore`d (they may import any layer). A `styles` element (`src/styles`) is importable from `root`. Probe in the real tree: a throwaway `src/zzunknown/ProbeZ.ts` imported from `src/ui/ProbeFrom.tsx` now fails (`no-unknown-dependencies`), and the file itself fails `no-unknown-files`; both were removed again. `pnpm --filter @generatorai/web lint`: 0 errors, 311 warnings (unchanged). |
| **P0-R3** (Major) | `check-stories.mjs`: a file is a component file when it declares a PascalCase (containing a lower-case letter) `function`/`const`/`class` at the start of a line, exported inline or not, **and** has any `export`. The shadcn `function Button` … `export { Button, buttonVariants }` shape is caught. Pure re-export files and `SIZES`-style constants are not. `isComponentSource` is exported for the tests. |
| **P0-R4** (Major) | New `scripts/__tests__/redesign-rails.test.mjs` (root `node` vitest project, 28 tests, about 2 s of test time), with every fixture under `os.tmpdir()`. (1) The ratchet runs against a temp webDir through the new `--web-dir=<dir>` flag: update/lock, rise with file:line, `--update` does not raise, fall/`--strict`/`--update`, lock at 0 then fail, a new-folder hard-zero, the D-45 story split, and storiesPresent. (2) `findMissingStories`/`isComponentSource`, including the shadcn shape. (3) `flattenBoard` on the real `Home` board, plus an extra prop, a missing `<helmet>` and a leftover `{{`. To make it importable, `render-boards.mjs` now parses argv inside `main()`. (4) ESLint layer probes: `new ESLint({ cwd: <temp tree>, overrideConfigFile: <repo>/eslint.config.mjs })` with `root-path` and the resolver pointed at a temp `apps/web` tree that holds real import targets (unresolved targets are not classified), `lintText` on virtual files. They cover ui→data, ui→unknown folder, features→other feature, features→platform, features→unknown, blocks→features, features→react-query and PlatformProvider (fail); app→features, same-feature, ui→ui and a react-query type import (pass); `text-sm` in ui (fails); a raw `<button>` in ui (fails), in ui/primitives and in a story (passes). CI: a new "Root script tests (redesign rails)" step in `build-and-test` on all three OSes (`pnpm exec vitest run --project node scripts/__tests__`), because `turbo test` never reaches root-package tests. A root `vitest run` picks the file up too. |
| **P0-R5** | A features-only `no-restricted-imports` block (error) bans `@tanstack/react-query`, `@generatorai/client-*` and `@/providers/PlatformProvider` (alias or relative), with `allowTypeImports`, and repeats `LUCIDE` + `HEADLESS`. `useQueryClient` is not allowed: invalidation belongs in `hooks/`. Inline style: a new ratchet rule `literalInlineStyle` (`scope: 'new'`, hard-zero in the new folders, 39 legacy hits informational) flags a `style={{…}}` with a literal string or number value, which approximates "except for computed geometry". CLAUDE.md "Layers" names the features restrictions and the undeclared-folder rule. D-43 records all three. |
| **P0-R6** | Recorded as **D-45**: stories follow the vocabulary rules in both tools and are exempt in both only from raw elements (`rawButtonElement`/`rawInputElement`, ESLint `no-restricted-syntax`) and arbitrary values (`arbitraryValue`, `ARBITRARY_VALUE_RESTRICTION`). The ratchet adds a `STORIES` exemption to those three rules. ESLint (a) now lints stories, and the ui/lib arbitrary-value exemption block also matches stories in the new folders. The legacy design-system block ignores stories. The rails tests pin both sides. |
| **P0-R7** | On a rise, the ratchet prints every `file (was → now)` summary first, so truncation cannot hide which file rose. Each file's hits are then narrowed to the lines added since HEAD (`git diff -U0 HEAD`, via `execFileSync`, no shell). When git cannot tell (the change is already committed, as in CI, or the tree is not a repository), it falls back to all hits, sorted by line. |
| **P0-R8** | `check-css-emission.mjs`: `defined` skips declarations whose value is exactly `var(<own name>)`, and the misleading comment was fixed. `check:css` still passes: the real `--font-sans`/`--font-mono` values are defined. |
| **P0-R9** | `check-stories.mjs` and `render-boards.mjs` compare `realpathSync(process.argv[1])` with `fileURLToPath(import.meta.url)`, inside a try/catch for a non-file argv[1]. Running `check-stories.mjs` through a symlinked checkout now prints OK. |
| **P0-R10** | `side-by-side.mjs` re-renders the board PNG when it is missing or older than the board's `.dc.html` or `boards/VERSION`, and fails early on an unknown board. The README row says so. |
| **P0-R11** | `turbo.json` `lint.inputs = ["$TURBO_DEFAULT$", "$TURBO_ROOT$/eslint.config.mjs"]`. The dry run lists `../../eslint.config.mjs` among the web lint inputs. I chose this over `globalDependencies`, which would also invalidate every build, test and typecheck cache on a lint-config edit. |
| **P0-R12** | The legacy design-system block now ignores the new folders. A new-folder block (error) carries `NEW_CODE_RESTRICTED_SYNTAX` and a `confirm` message pointing at `@/ui/primitives` (Button/IconButton, Select, useConfirm/AlertDialog P-32), and ignores `src/ui/primitives/**` (D-43) and stories (D-45). The Loader2 legacy path is dropped from every new-folder `no-restricted-imports` (LUCIDE already bans it, with the `@/ui/icons` message). The icon registry keeps Loader2 allowed. blocks/ and app/ get their own error-level LUCIDE + HEADLESS block. The ratchet already hard-zeros both there. |
| **P0-R13** | README: removed the blank line in the scripts table and changed "D-01…D-42" to "D-01…D-45". `01-decisions.md`: D-43 and D-44 moved after D-42 (end of §E), with D-45 after them. `09`: "Superseded by D-43" notes above the §2.3 boundaries sketch (tsconfig.eslint.json, `boundaries/dependencies`, fail-closed) and under the §3.7 `check:design` line. §3.6 was updated for the new stories detection. `.github/AGENTS.md`: `DB_PATH` default `<repo>/packages/db/data/generatorai.db`, `TEMPLATES_DIR` default `<repo>/templates` (the desktop app passes its own paths). |
| **P0-R14** | Rewrote the COORDINATION P0-04 row. `boundaries/dependencies` errors apply to the workflow-owned data files. data → components/pages is an error except `Toast.tsx` and `composer/{builtins,types}.ts`, and legacy → app/features fails. Escape: move shared types to `packages/shared` or `hooks/`. The row also notes the new undeclared-folder error. |
| **P0-R15** | `desktop-diff-review-smoke.mjs` records `renderer paired with its embedded server` as a check, so a pairing failure makes the smoke exit 1. `desktop-diff-render-check.mjs` prints FAIL and exits 1 when pairing fails. The smokes were not run (as instructed) and pass `node --check`. The catalog-test skip was already surfaced in BASELINE's End-of-P0 section. `07-phases.md` P2-00 now requires the fake provider to report `ready` in `/harness/providers` and the CI e2e server to enable it, so the catalog test runs in CI (plan note only). |

**Verification after the fixes:** web typecheck; `pnpm turbo lint --force` plus check:security/durability/docs/syncio/tokens; `check:design --strict` (OK, literalInlineStyle info 39); web tests; the rails tests (33/33 with copySecretsDir); web build, `check:bundle` and `check:css` (OK); `render-boards --only=Home` (2 rendered, 0 failed); `side-by-side` on Home (fresh PNG reused, compare written). I did not run the e2e suite or the desktop smokes. After the run, `git status` showed only the intended files, and no probe or fixture files remained in the tree.

---

## Round 2 review

- **Range:** `91448cf..HEAD` (fix commit `5386d18`) on `desktop_redesign`.
- **Date:** 2026-09-25 · macOS arm64 · reviewer: fresh independent adversarial pass (read-only apart from this section).

### Commands

| Command | Result |
|---|---|
| `pnpm --filter @generatorai/web typecheck` | green |
| `pnpm turbo lint --force` | 26/26 tasks, **0 cached**, 0 errors (web 311 warnings, unchanged) |
| `pnpm --filter @generatorai/web check:design --strict` | OK; `literalInlineStyle` info 39, `radixOverlaySelector` info 3, storiesPresent ok |
| `pnpm --filter @generatorai/web test` | 69 files / 650 tests passed |
| `pnpm exec vitest run --project node scripts/__tests__` | 2 files / 33 tests passed (rails 28, about 1.5 s); no `rails-*` dirs left in `$TMPDIR` |
| `pnpm --filter @generatorai/web build && check:bundle && check:css` | build ok; 309.5 KB gzip / 800 KB OK; check-css 3 stylesheets, 51 vars, OK |

### Round-1 fixes re-verified

- **R1:** I extracted the "Start server and web dev server" step from `ci.yml` with a YAML parser (`bash -n` OK) and ran it with the web part removed, using `RUNNER_TEMP` in a temp dir and `SERVER_PORT=3377`. The server listened on 3377, `WIDGET_PORT` on 3378 (the env reaches the server), and the D-44 grep matched `"dbPath":"<state>/e2e.db"`. The server was then stopped. **Fixed.**
- **R2:** real-tree `lintText` probes. `src/services/api.ts` and `src/assets/logo.ts` fail `boundaries/no-unknown-files`. `vite-env.d.ts`, `test-env.d.ts`, `main.tsx`, `router.tsx` and `src/__tests__` lint without errors, and `App.tsx` → `../package.json` (outside `include`) passes. **Fixed**, with no false positives on today's files.
- **R3:** the shadcn `function Button` … `export { Button, buttonVariants }` shape is detected (a rails test covers it). **Fixed.**
- **R5:** features → `@tanstack/react-query` (including `useQueryClient`), `@/providers/PlatformProvider` and `../../providers/PlatformProvider` fail. `import { type QueryClient }` passes. `no-restricted-imports` matches the literal specifier, so the relative bans are not affected by Windows path separators. New issues in R16 and R17.
- **R7:** in a temp git copy of `apps/web`, one added `text-xs` in `ChatInput.tsx` (11 hits) printed the summary line and then only `ChatInput.tsx:40` under "hits on lines changed since HEAD". **Fixed.**
- **R8:** in a temp copy of `dist/assets` with every real `--font-sans` definition removed (only `--font-sans:var(--font-sans)` left), check-css now fails with `--font-sans is not defined`. **Fixed.**
- **R9:** `node <symlink-to-repo>/apps/web/scripts/check-stories.mjs` prints OK, and `render-boards.mjs --only=NoSuchBoard` through the symlink fails as it should. **Fixed.**
- **R11:** the turbo dry run lists `../../eslint.config.mjs` in the web lint inputs. The inputs are set at task level, so every package's lint gets them. **Fixed.**
- **R12:** the new-folder messages point at `@/ui/primitives` / `@/ui/icons`; `ui/primitives/**` and stories are exempt; `blocks/` → `Loader2` fails with the D-17 message. **Fixed.**
- **R4:** the rails step runs in `build-and-test` on all three OSes (Ubuntu only on PRs). Fixtures live under `os.tmpdir()`, the tests use no shell and take about 1.5 s. Gaps in R20 and R21.
- **R13/R14/R15, docs:** D-41…D-45 are in order at the end of §E; README table fixed and "D-01…D-45"; `09` supersession notes present; CLAUDE.md is 82 lines; the COORDINATION row was rewritten; the smokes now fail on pairing. The remaining drift is in R22.

### Critical

None.

### Major

#### P0-R16 — The features ban on `@generatorai/client-*` values blocks the shared pure logic that CLAUDE.md sends to client-core
- **Where:** `eslint.config.mjs:85-89` (`FEATURES_DATA`, the `@generatorai/client-*` group); conflicts with `.claude/CLAUDE.md:20` ("Shared concepts … → packages/shared or client-core first") and D-40 ("share … logic").
- **Evidence:** `packages/client-core/src/index.ts` describes the package as "platform-agnostic client logic". Its value exports are pure: `runTitle`, `parseUnifiedDiff`, `formatTranscriptMarkdown`, `parseInlineToolCalls`, `encodeStageOverrides`, `resolveModelLimit`, `STOP_ARMING_MS`, `StopController`, `toEpochMs`, and `ApiError` (needed for `instanceof`). Today 13 legacy files in `components/`/`pages/` import these values. When P3/P4 move chat, runs and diff into `features/`, each of those imports becomes a lint **error**. Sessions will then write re-export shims in `hooks/`, which D-02 forbids, or move logic out of the package CLAUDE.md tells them to use. Without the platform client or react-query, client-core cannot fetch anything, so the ban adds no data-layer protection. (Round 1's R5 fix suggested this group, and the fix applied it as written.)
- **Fix:** drop `@generatorai/client-core` from the group and keep `@generatorai/client-runtime` / `@generatorai/client-transport`. If the raw request helpers must stay out of features, restrict only them: `{ group: ['@generatorai/client-core'], importNames: ['request', 'requestAllowing', 'requestText'], … }`. Add a rails case: features → `import { runTitle } from '@generatorai/client-core'` passes. Update D-43 and CLAUDE.md "Layers".

### Minor

#### P0-R17 — Features can still get the query client from `@/providers/QueryProvider`
- **Where:** `eslint.config.mjs:79-95`; `apps/web/src/providers/QueryProvider.tsx:190` (`export { queryClient }`).
- **Evidence:** the probe `features/alpha/X.tsx`: `import { queryClient } from '@/providers/QueryProvider'; queryClient.invalidateQueries()` produces **no error**. That bypasses the react-query ban that D-43 and CLAUDE.md call lint-enforced. The PlatformProvider ban also matches specifier spellings only, so `@/providers/PlatformProvider.js` (which TS bundler resolution and Vite resolve to the `.tsx`) is not caught.
- **Fix:** add `{ group: ['@/providers/QueryProvider', '**/providers/QueryProvider'], importNames: ['queryClient'], message: … }`. Better, express both bans as resolver-based `boundaries/dependencies` policies on the target files (`file.path: apps/web/src/providers/{PlatformProvider,QueryProvider}.tsx`, value imports only), so every spelling of the specifier is caught. Add rails cases for both.

#### P0-R18 — The sanctioned `ui/lib` arbitrary-value exemption cannot be used: `varInClassString` hard-zeros it
- **Where:** `apps/web/scripts/check-design-system.mjs:191-194` (no `exempt`); `09-verification.md` §2.1 table (`varInClassString` exempt "—"); `eslint.config.mjs:235-248`. This predates the fix commit, which re-edited this exemption without catching it.
- **Evidence:** Base UI passthroughs are CSS-variable classes by nature. The probe `src/ui/lib/overlay.ts`: `'origin-[var(--transform-origin)] max-h-(--available-height)'` (with a comment) passes ESLint but fails the ratchet twice (`varInClassString: 2 in src/{ui,blocks,features,app} (must be 0)`). The shadcn Base UI templates for Menu, Select, Popover and Tooltip, which P1 seeds, use exactly these classes. The tools contradict each other again (the class of problem R6/D-45 was meant to close), and the ratchet's message ("use the design utility that maps the token") names a utility that does not exist.
- **Fix:** exempt `^src/ui/lib/` from `varInClassString` as well (matching the 09 wording "for Radix/Base UI CSS-variable passthroughs"). Or decide that passthroughs are `@utility` rules in `src/styles` and drop the `ui/lib` exemption from both tools. Record the choice in D-43 and add a rails case.

#### P0-R19 — Tests under `ui/` are not exempt, although D-45 says "Tests stay exempt from everything"
- **Where:** `eslint.config.mjs:364-378` (the `ui/**` and `ui/icons/**` `no-restricted-imports` blocks have no `WEB_TEST_FILES` ignore).
- **Evidence:** the probe `ui/__tests__/X.test.tsx` importing `lucide-react` and `@/stores/sseManager` produces 2 errors. The same imports in `features/alpha/__tests__/X.test.tsx` pass.
- **Fix:** add `ignores: WEB_TEST_FILES` to the ui block (keeping `ui/icons/**`) and to the icons block, or narrow the D-45 sentence.

#### P0-R20 — The rails ESLint tests override the settings most likely to regress
- **Where:** `scripts/__tests__/redesign-rails.test.mjs:209-218`.
- **Evidence:** every layer probe replaces `boundaries/root-path` and `import/resolver.typescript.project`. A regression in the real config's own values would not be caught: for example, pointing the resolver back at `tsconfig.json` (the references bug D-43 records, where every `@/` import escaped the layer rules) or a wrong `REPO_ROOT`. Real `pnpm lint` stays green in that case too, because nothing then fails.
- **Fix:** add one probe with no overrides: `new ESLint({ cwd: REPO })`, `lintText` a virtual `apps/web/src/ui/X.tsx` that imports the real `@/stores/sseManager`, and expect `boundaries/dependencies`. This takes under a second.

#### P0-R21 — Windows risk (unverified): the fixture root uses the JS `realpathSync`, which keeps 8.3 short names
- **Where:** `scripts/__tests__/redesign-rails.test.mjs:23-28`.
- **Evidence:** on GitHub Windows runners, `os.tmpdir()` is `C:\Users\RUNNER~1\AppData\Local\Temp`. `fs.realpathSync` (the JS implementation) does not expand short names; `fs.realpathSync.native` does. The comment on that line says the resolver returns canonical paths (that is why the realpath call exists for macOS `/var`). If unrs-resolver canonicalizes to the long `runneradmin` form on Windows, resolved targets fall outside `root-path`, and every "fails" case in the ESLint suite fails on the push-only Windows leg. The step has never run on Windows.
- **Fix:** use `fs.realpathSync.native(fs.mkdtempSync(…))`. It is the same on macOS and Linux and expands 8.3 names on Windows. Or confirm with one Windows run before relying on the step.

#### P0-R22 — Doc drift after the fixes
- `docs/redesign/09-verification.md:52` (§1.3 CI steps) and `:259-271` (§2.7 CI placement table) do not list the new "Root script tests (redesign rails)" step (`build-and-test`, all OSes). They also omit `check:css` from §1.3. Add both.
- D-44 (`01-decisions.md:234-235`) lists `DB_PATH`, `ARTIFACTS_DIR`, `WORKSPACES_DIR`, `TEMPLATES_DIR` and `PORT`, but the server also defaults `GENERATORAI_EXTENSIONS_DIR` to `~/.generatorai/extensions` and creates it at startup (`apps/server/src/index.ts:239-250`). The CI e2e job and local isolated servers (sandbox, VRT, smokes) therefore still share the user's real extensions root. Add it to D-44's list and to the CI env.

Critical: 0, Major: 1, Minor: 6

## Round 2 fixes

| Finding | Status |
|---|---|
| P0-R16 (Major) | Fixed: the features ban covers `@generatorai/client-runtime`/`client-transport` only; `client-core` (pure helpers, read models) stays importable. D-43 and CLAUDE.md updated |
| P0-R17 | Fixed: `providers/QueryProvider` banned in `features/`; `.js` spellings of both provider paths added |
| P0-R18 | Fixed: `varInClassString` exempts `src/ui/lib/**`, matching ESLint |
| P0-R19 | Fixed: the `ui/` no-restricted-imports block ignores test files (D-45) |
| P0-R20 | Deferred, reason: the rails tests must point the resolver at a temp tree to lint virtual files against real targets; the real config values are exercised on every `pnpm lint` (26 tasks, `--force` in review), and any drift in `root-path`/resolver would fail every web import there. Revisit if a config value regresses unnoticed |
| P0-R21 | Fixed: `fs.realpathSync.native` in the two main-module guards and the rails test temp dir (expands Windows 8.3 short names) |
| P0-R22 | Fixed: 09 §1.3/§2.7 list the rails step and `check:css`; D-44, CLAUDE.md and the CI e2e server set `EXTENSIONS_DIR` |

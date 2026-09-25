# 10 — LLM implementation playbook

How to run this overhaul with Claude Code sessions. The approach is chosen so each session gets a small, bounded task, reads a fixed set of documents, and is stopped by a failing check when it drifts.

---

## 1. Session start protocol (every session)

1. Read `docs/redesign/README.md`. Then read the phase section of `07-phases.md` for your task, and the documents that section links to.
2. Read `01-decisions.md` in full the first time in a session. Decisions override anything else, including the boards.
3. Read the board(s) for your task from `docs/redesign/boards/web/<Board>.dc.html`. It is HTML: the `<helmet><style>` block holds the shared classes and the markup holds exact sizes. **Translate it through the Rosetta table** (`03-component-inventory-kit.md` §Rosetta). Never copy inline styles into the app.
4. Check whether the design has changed since the snapshot: list the artifact's files with the Artifact tool (`action: "list"`, `scope: "files"`, url `https://claude.ai/artifact/9dDDpwCiWcs5jEUA8ivPUs`) and compare the version in the header against `boards/web/VERSION` (the version recorded there). If it differs, re-read the changed boards and flag the differences before building.
5. Query the Storybook MCP server for existing components before writing a new one (see `09-verification.md` §3). **If a component exists, use it. If it almost fits, extend it (new variant) in `ui/` with a story. Never fork it inside a feature.**

## 2. Proposed `.claude/CLAUDE.md` (written in P0)

`.claude/CLAUDE.md` is effectively empty today (a single newline). P0 replaces it with the following. Keep it short; it links to the docs rather than duplicating them.

```markdown
# GeneratorAI — rules for UI work (web + desktop redesign)

Plan: docs/redesign/README.md. Decisions: docs/redesign/01-decisions.md (binding).

## Layers (lint-enforced)
- apps/web/src/ui/**        presentational kit. No stores, platform, react-query, router, blocks, features.
- apps/web/src/blocks/**    query-aware parts shared by ≥2 features. No features imports.
- apps/web/src/features/**  pages + domain parts. No cross-feature imports. Data only via hooks/*Queries.ts or stores.
- Never rewrite platform/*, stores/sseManager.ts, stores/streamStore.ts, packages/client-*.
- Shared concepts (status, nav, commands, icons, tool verbs, gate kinds, composer states) → packages/shared or client-core first.

## Styling
- Only design utilities: bg-surface, text-fg-2, text-ui, rounded-card, h-control … (docs/redesign/02-design-system-spec.md).
- Forbidden in new code: arbitrary values (text-[11px], w-[437px]), hex/rgb, var(--…) in className, palette classes (bg-blue-500), text-white/black, inline style except for computed geometry.
- Variants via cva; merge via cn() from ui/lib (generated tailwind-merge config). Never add variant="unstyled".
- Icons only via ui/icons concept names. Floating layers must carry data-gai-overlay (ui/ primitives do this for you).
- Never edit generated blocks (@generated-tokens markers, *.generated.ts).

## Components
- Translate boards through the Rosetta table (docs/redesign/03-component-inventory-kit.md). Check Storybook MCP before creating a component.
- New ui/ component = file + story (all variants × states) + a11y passing. Base UI uses `render` props (not Radix `asChild`).
- Keep existing data-testid and accessible names when porting; renaming one requires updating the e2e spec in the same PR.

## Done means (docs/redesign/09-verification.md §6)
typecheck · lint · check:design (counts may only go down) · related vitest · storybook tests for touched components ·
playwright-cli --browser=chrome --headed walkthrough at 1440×900 and 1100×760, dark+light, Instrument + Solarized light,
screenshots in docs/redesign/shots/<route>/ with a side-by-side vs the board and a written list of differences ·
the page's e2e spec · desktop smokes if shell/dock/overlays changed · old files deleted.
- Cross-platform: Windows, Linux and macOS are all first-class; no fix for one OS only; use CHROME constants and lib/desktop.ts.
- Git/SCM features: test against a throwaway dummy repo (node scripts/redesign/make-dummy-repo.mjs), never this checkout.
- Verify in the running app: ./node_modules/.bin/playwright-cli --browser=chrome --headed (Windows: .\node_modules\.bin\playwright-cli.cmd).
- No backward compatibility (pre-release, one developer): replace shapes and delete old code; no shims, aliases or migrations beyond D-02's scaffolding.
- Subagents: always set the model explicitly — Sonnet for small/medium tasks, Opus for complex ones, Fable only when Opus will not do.
- Codex provider testing: GPT-5.6-Terra or GPT-5.6-Luna, never GPT-5.3-Codex-Spark.
```

## 3. Task packet template

Every task is issued to a session as a packet like this. `07-phases.md` lists the tasks; the packet adds context.

```markdown
## Task <phase>.<n> — <title>
Goal: <one sentence, user-visible outcome>
Boards: boards/web/<A>.dc.html (+ states shown: empty/loading/error/narrow)
Template/layout: T-0x / L-0x
Components to use (existing): <names from Storybook MCP / inventory>
Components to add (with stories): <P-/C-/B-/F- ids>
Data: <hooks/queries/stores>; gaps: <G-xx or "none">
Files to replace: <paths>   Files to delete: <paths>
Shared-package additions: <status/nav/commands/ui-contract … or "none">
Contracts to preserve: <testids, desktop contracts, routes>
Acceptance: <bullets from 07-phases.md> + the Done checklist
Out of scope: <explicit>
```

## 4. Sizing rules

- One PR = one page, one block, or 3–6 related primitives. Keep diffs to about 1,500 changed lines or fewer, excluding deleted files and generated output.
- A giant-file split is **two** PRs:
  1. characterization tests plus the logic extraction, with no visual change;
  2. the new view on the kit.
- Never mix a platform upgrade with a feature port.

## 5. Parallel sessions and worktrees

- **Parallel-safe:** primitives in P3/P5 (one worktree per component group); independent list/detail pages in P5; settings sections in P6; the P2 backend endpoints.
- **Serial only:** tokens (P1), the shell PRs (P3), the chat workspace (P4), and lockdown (P7).
- **Conflict hotspots, removed in P0–P1 before any parallel work** (router split is P1-S3 in `06-desktop-and-shell.md` §10):
  - `router.tsx` → per-area route modules `app/routes/<area>.routes.tsx`, registered by `app/routes/index.ts`;
  - the `components/ui/index.ts` barrel → import by file path in the new `ui/`;
  - `globals.css` → features never touch it; only the token generator and `ui/styles` do.
- Each parallel session rebases before opening a PR. The generated token files are regenerated, not hand-merged (`pnpm tokens:write`).

## 6. Model choice for sessions and subagents

The owner's standing rule: choose models by task complexity, and always set the model explicitly on subagent calls.

| Work | Model |
|---|---|
| Token engine (P1) · shell and desktop chrome (P3) · chat workspace splits and composer (P4) · overlay contract · gap endpoints with SSE | Opus |
| Primitives from the Rosetta table · list/detail page ports · settings sections · stories · docs updates · test writing from a behaviour list | Sonnet |
| Reserved for the rare case Opus cannot handle | Fable |

## 7. Known LLM failure modes here, and the guard for each

| Failure mode | Guard |
|---|---|
| Re-inventing an existing component inside a feature | Storybook MCP lookup (§1.5); `eslint-plugin-boundaries`; review checklist |
| Copying board inline styles (`style="height: 44px"`) or arbitrary values | better-tailwindcss `no-unknown-classes` + arbitrary-value ban in `ui/`, `blocks/`, `features/`; ratchet |
| Radix-style `asChild` on Base UI parts | CLAUDE.md note; TypeScript error (Base UI has no `asChild` prop) |
| Faking data for designed elements with no API | D-36; the gap matrix names every gap; review rejects mock data outside tests/stories |
| Dropping a feature the board doesn't show (Keep/Undo, PR tab, FindBar, Widgets) | `04-screen-map.md` feature parity checklist, ticked in each port PR |
| Breaking the desktop browser view with a new overlay | `data-gai-overlay` from `ui/`; desktop smoke in the Done list |
| Fixing for one OS | CLAUDE.md rule; per-OS matrix for shell PRs |
| Using `text-sm`/`bg-blue-500` in new code while the legacy layer still works (it renders, so nothing looks broken) | Lint scoped to the new folders; ratchet counts |
| Editing generated CSS | `tokens:check` in CI fails |
| Touching the real repo while testing SCM | CLAUDE.md rule; dummy repo recipe in `09-verification.md` |

## 8. Definition of done for a phase

A phase is done when:
- all of its tasks are merged and every exit criterion in `07-phases.md` holds;
- the ratchet baseline has been lowered to the new counts;
- `DESIGN_SYSTEM.md` (from P3 on, it becomes the kit index) lists every new component;
- the progress table in `README.md` is updated.

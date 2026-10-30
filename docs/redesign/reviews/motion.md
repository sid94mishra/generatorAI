# Motion: expand / collapse and show / hide (D-109, 2026-10-06)

Owner: "All the expand/collapse actions — the changes tray, tool/step blocks, everything else — have no animation, so
they're jittery. Same for showing/hiding panels: the right dock, the left sidebar, the Activity column. Use common
components." Decision: **D-109** (01-decisions.md). Commits: 26ec3054 (tokens, utilities, kit), 2fcd5320 (inline
conversions), f5dfcd2d (panels), 908c50df (D-109 references, reduced-motion setting in the transcript hooks); the
first three say D-108 in their messages — that number was taken concurrently.

## Inventory (before → after)

| Pattern | Where | Before | After |
|---|---|---|---|
| Step rows / step groups (tool output, diffs, group children) | ui/patterns/StepRail (B-17 StepList) | instant | `CollapsiblePanel` height + fade, chevron turns with it |
| Raw tool call under a diff | blocks/transcript StepList `StepDetail` | instant | `Reveal gap={1.5}` |
| Response fold (header chevron) | blocks/transcript TranscriptTurn | instant (unmount) | two `Reveal`s (body; attachments + actions) |
| Thinking ("Thought") | ThoughtPill → Collapsible | instant | animates (Collapsible) |
| Changes tray: appearing, its file list | blocks/composer ChangesTray | pop / instant | tray eases in; list `Reveal` |
| Attachments row, blocking bar, live activity line | Composer, BlockingBar, LiveActivityLine | pop | ease in (leave at once: their content is gone) |
| Chat "Generating response…" strip | features/chat ChatPage | pop in/out | `Reveal` in and out |
| Collapsible / Accordion consumers (settings catalog rows, devices, map rows, stage events, agent overrides, new-chat options, form aside) | ui/primitives/Collapsible | instant | animate, no consumer change |
| Orchestrator workers on an Activity card | features/activity ActivityItem | instant | `Reveal` (card wrapper cancels the column gap) |
| Review threads, pending-comment note | blocks/diff, blocks/changes | instant | `Reveal` |
| Sources list, files tree beside a preview | blocks/files | instant | `Reveal` (height; width for the tree) |
| PR file diffs, codebase folders | features/projects | instant | `Reveal` |
| Run-dialog stage variables, exit-rule streak/reason, decision panels, agent-draft diff, capability overrides, run stage rows | blocks/workflow, features/workflows | instant | `Reveal` |
| Sidebar ↔ rail | ui/shell AppFrame | 184 px jump | sidebar slot eases its width, card flexes |
| Activity column docked / overlay | AppFrame + ActivityColumn | 288 px jump / pop | eases open from 0 (column keeps its width) / slides 12 px + fade |
| Sidebar flyout (forced rail) | AppFrame + SidebarFlyout | pop | slides in and out |
| Right dock (panel ≥ 1200) | SplitPane + DockFrame | 479 px jump | flex-grow eases; no easing during a separator drag or on first layout; surface stays visible until closed |
| Right dock as the narrow sheet | NarrowDockSheet | pop + gutter jump | slides from the edge; its 404 px gutter eases with it |
| Dock tab switch | DockPanel | instant | new tab fades in (120 ms), old one hides at once |
| Menus, popovers, selects, comboboxes, autocompletes, tooltips | ui/primitives (Base UI) | **not animated** (Base UI ships no motion) | `motion-pop` (fade + 97 % scale from the anchor side, 120 ms; none between tooltips) |
| Dialogs, alert dialogs, backdrops, sheets | ui/primitives | not animated | `motion-dialog`, `motion-fade`, `motion-sheet-start/-end` |
| Toasts | sonner | already animated | unchanged |
| Not animated on purpose | — | — | virtualized diff rows (fixed heights), the Changes "Kept" group (flex share), variables-table edit row (grid row group), version list "older" rows (list items), the `/` `@` composer menu (typeahead) |

## Shared pieces

- **Tokens** (design-tokens, `pnpm tokens:write`): `--gai-ease-in-out`; utilities `duration-fast|normal|slow`,
  `ease-in-out` (+ tailwind-merge groups, vocabulary tests). Reduced motion zeroes the durations (generated block).
- **Utilities** (globals.css "Motion"): `motion-collapse`, `motion-accordion`, `motion-reveal-x`, `motion-slide-start`,
  `motion-pop`, `motion-dialog`, `motion-fade`, `motion-sheet-start/-end`, `motion-size`, `motion-dock`, `motion-split`.
- **Kit** (ui/primitives/Collapsible): `Collapsible`, `Accordion`, `CollapsiblePanel`, `Reveal open motion gap`;
  ui/lib/motion `settleOnOpen` (clip while moving, unclip at rest) and `prefersReducedMotion` (setting or OS).
  ui/lib/popup `popupMotion`. AppFrame props `activityOpen` / `activityOverlay` / `flyoutOpen`.
- **A11y**: triggers keep `aria-expanded` (+ `aria-controls`); a closing panel is `inert`, a closed one is unmounted;
  focus stays on the trigger; testids / roles / names unchanged. Stories: Collapsible `Motion`, `ReducedMotion`,
  `RevealMotions`, `RevealReducedMotion`; AppFrame `Motion`, `MotionReduced` (play + axe).

## Evidence

Frame traces: a per-frame `requestAnimationFrame` sampler (element rect + opacity) plus a `layout-shift`
PerformanceObserver; "before" = the pre-change tree (e07a95b4) in a worktree on the same sandbox server.

**Desktop app** (Electron, production renderer, isolated profile, Faux harness, 1440×900 then 1100×760):

| Transition | Moving frames | Span | Max frame gap | Max step |
|---|---|---|---|---|
| Sidebar → rail / rail → sidebar | 11 / 11 | 167 ms | 19 ms | 42 / 46 px of 184 |
| Activity docked open / close | 12 / 11 | 200 / 167 ms | 19 ms | 69 / 71 px of 288 |
| Changes tray appears (composer height 165 → 206) | 11 | 166 ms | 19 ms | — |
| Step group expand / collapse **while streaming** | 11 / 11 | 167 ms | 19 ms | 21 / 23 px of 96 |
| Tray file list open / close | 11 / 12 | 165 / 218 ms | 19 ms | 26 / 23 px of 107 |
| Dock open / close (panel) | 11 / 12 | 167 / 198 ms | 52 / 19 ms | — |
| Activity overlay open / close (1100) | 11 / 11 | 199 / 168 ms | 34 / 19 ms | — |
| Dock sheet open / close (1100) | 11 / 11 | 166 / 167 ms | 19 ms | — |
| Reduced motion: Activity, step group | 1 | 0 ms | — | full jump (instant, as intended) |

**Before vs after (web, same server):** sidebar 1 frame (184 px, layout shift 0.12) → 11 frames (≤ 0.029 per frame);
Activity 1 frame (288 px, 0.335) → 11 frames; dock 1 frame (479 px) → 11 frames; tray 1 frame (+42 px) → 11 frames;
step group 1 frame (+96 px) → 11 frames. The 1100 px sheet's gutter jump (one 0.23 shift) is now spread (≤ 0.05).

**Streaming:** opening a group while the answer streams, the follow-scroll (D-91 spring) tracks the panel: scrollTop
moves 1–7 px per frame, the distance to the end peaks at ~73 px and closes smoothly (before: a 96 px step in one frame,
then the same spring). Collapsing clamps scrollTop with no jump and does not unpin. Expanded groups list their steps
(the 039619a0 nesting fix holds). Screenshots (local, PNGs are gitignored): `shots/motion/desktop-*.png`.

Single-frame stalls (50–170 ms) seen in the Vite dev server when a panel first mounts (React dev mode) are mount cost,
not motion; the production renderer shows none above 52 ms.

## Gates

typecheck · lint (0 errors) · check:design · unit (related, 28 files) + ui/lib tests · Storybook story tests (all 625;
popup stories now wait for the enter transition) · design-tokens tests + `check:tokens` · web build · check:bundle ·
check:css · e2e: activity-column, chats, navigation, nav-history, composer, changes-dock, context-usage-ui,
workflow-run, workflow-builder, projects (all pass) · desktop smokes: chrome 59/59, right-pane 9/9 (macOS). VRT
baselines not refreshed here (no Docker run): popups, dialogs and panels have no motion in a settled screenshot.

## Left

- The animated pieces listed as "not animated on purpose" above.
- Windows / Linux desktop smokes (CI backlog, as before).
- Mount stalls in dev mode only; nothing to fix in production.

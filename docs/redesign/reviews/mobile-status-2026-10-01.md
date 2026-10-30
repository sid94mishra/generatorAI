# Mobile redesign — status check (2026-10-01)

Scope: the Codex mobile run on `mobile_redesign` (plan `docs/redesign/mobile/`, 131 boards in
`docs/redesign/boards/mobile/`, 93 tasks M0–M10, MD-01…MD-107). Its committed state at `fefc369f` (M2-09) was merged into
`desktop_redesign`; 33 uncommitted files in the worktree (M2-10 server gaps, a migration) were left with Codex.

## Where it is

| Phase | Tasks | State |
|---|---|---|
| M0 Kickoff & environment | 4 | done |
| M1 Safety net & tooling (SDK 57) | 9 | M1-01/02/03/05 done; M1-06 (Jest + on-device Storybook) and M1-09 (data layer → `src/services`) implemented; M1-04 baselines taken, combined native suite not green (Android 7/8, iOS 6/8); M1-07 markdown and M1-08 Uniwind spikes pending |
| M2 Shared-logic adoption | 10 | M2-01…M2-09 implemented (timeline, status maps, composer logic, typed API, queries out of screens, read models, lifecycle/cache, multi-server runtime, deep links); native acceptance of each pending (MV-11…MV-22); M2-10 server gaps in progress (uncommitted) |
| M3 SDK 58+ & foundations | 8 | not started — waits for Expo SDK 58 stable and a qualifying Uniwind release (MV-06, MV-09) |
| M4 Kit (143 components) | 10 | not started |
| M5 Shell & navigation | 9 | not started |
| M6 Chat workspace & pane | 11 | not started |
| M7 Modules (Home, Projects, Agents, Automations, Settings, Pairing) | 9 | not started |
| M8 Workflows | 7 | not started |
| M9 System surfaces | 9 | not started |
| M10 Lockdown & store | 7 | not started |

About 19 of 93 tasks are implemented (all foundations/logic); **no redesigned screen exists yet**. The plan's own resume
point says so ("No redesigned production screen or completed batch is claimed").

## What the running app shows

iOS (`gai-iphone`, the 29 Sep build on Codex's Metro) opens to the legacy pairing sheet; Codex's committed baselines
(`docs/redesign/shots/mobile/baseline/`, gitignored PNGs in the worktree) show the legacy Home (tiles + Today / Running /
Needs you switcher) and legacy chat (old header, old composer). Against the boards (`MHome`, `MChatRunning`): none of the
new header, counts row, Needs you / Running sections, breadcrumb chat header, status line, working bar or composer is
built — expected, since M4–M7 have not started. The Android emulator (`gai-phone`) is in a System UI ANR loop (MV-18).

## Pending, in the plan's order

1. Close M1/M2 native acceptance: MV-01/02 terminal blank / sheet strip, MV-03 iOS notification open, MV-05 combined
   native suite, MV-07 Storybook flow, MV-08 markdown spike, MV-09 Uniwind Gate B, MV-10…MV-22 per-task native
   walkthroughs, MV-15 iOS launcher automation, MV-20 Android composer empty-draft regression; finish M2-10.
2. M3 platform upgrade + foundations (SDK 58, React Compiler, mobile vocabulary, Uniwind themes, fonts, SF/Material icons).
3. M4 kit (52 primitives, 30 layout/shell parts, 50 blocks, 11 native targets) with stories and VRT.
4. M5 shell (route tree, SidePanel, PaneShell, headers, adaptive layout, search, server switcher, deep links, keyboard).
5. M6 chat workspace (list, transcript, gates, composer, new chat, Changes/Files/Terminal/Browser/Computer/Tasks/Plan).
6. M7 modules, M8 workflows (incl. the list builder, MD-04), M9 system surfaces (Live Activity, widgets, quick actions,
   share, app lock), M10 lockdown (delete legacy, VRT, a11y, store readiness), with batch reviews A–F.

## Found while merging (for Codex)

- `apps/mobile` typecheck fails on a fresh checkout: `.rnstorybook/storybook.requires.ts` is gitignored and only exists
  after Metro runs with Storybook; generate it before `tsc` (e.g. a `pretypecheck` running `sb-rn-get-stories`).
- `desktop_redesign` now carries P7 (legacy token layer removed, Radix removed, zod declared in server/sdk, the design
  index, syntax-contrast clamp — fixing MV-12's meter test) and the final-review fixes; merge it back into
  `mobile_redesign` before the next task.

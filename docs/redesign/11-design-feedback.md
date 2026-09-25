# 11 — Design feedback (where the implementation deviates from the boards)

Every place where the plan overrides, corrects or completes the design. Implementers follow **this list and `01-decisions.md`** over the boards. The owner can later apply these to the design artifacts so boards and code converge.

## Web/desktop artifact (9dDDpwCiWcs5jEUA8ivPUs)

| # | Board(s) | Issue | Implementation does | Decision |
|---|---|---|---|---|
| DF-01 | Shared style block | `--fg-3` dark on `--overlay` is 4.30:1 (< 4.5) | Derived `fg-3` clamped to ≥ 4.5:1 on every surface | D-12 |
| DF-02 | Shared style block | `--line-strong` 1.37–1.66:1; inputs bordered with `--line` 1.2–1.3:1 | `line-strong` derived to ≥ 3:1 against all five surfaces (`ensureContrastAll`; the legacy `inputBorder()` only covers background/card); inputs, checkboxes and switches use it | D-12 |
| DF-03 | `.acc-*` classes | Fixed accent hexes; white text on green 4.37:1 and orange 4.08:1; they ignore the theme | Accents are derived per theme via `ensureContrast`; ink added | D-11 |
| DF-04 | Themes / Instrument | Label "4/6/8" contradicts component radii 4/5/6/7/8/10/12 | Base radius per theme with a derived scale; Instrument base 6 reproduces the boards | D-14 |
| DF-05 | ChatWorkflowRun and other v2 boards | `.i16` used but not defined | Icon size 16 exists in the kit | D-17 |
| DF-06 | ChatTasks | "Queue a message…" contradicts ComposerStates ("no queue") and workflow PD-3 | No queue | D-29 |
| DF-07 | DockChanges, Main | Keep / Keep all / Undo all missing (shipped feature) | Kept in the Changes dock | D-28 |
| DF-08 | DesktopMac | Traffic lights over the 48px rail not designed | Empty 44px drag row on the rail; page-header inset | D-23 |
| DF-09 | DesktopWindows | Linux (native frame) and plain web placement of strip items not designed | Items move to the sidebar header row | D-23 |
| DF-10 | — | No toasts in the desktop design (mobile has them) | sonner, errors and background completions only | D-30 |
| DF-11 | Settings | Only Appearance and Security drawn (13 sections missing) | Section recipe; mobile settings boards as content | D-32 |
| DF-12 | — | PR page, project Pull requests tab, CreateProject, 404/error not designed | Built from templates | D-31, D-32 |
| DF-13 | Agents, AgentEditor, Chats boards | Initials avatars for agents remain on some non-workflow boards; v2 workflow boards use a bot icon | `AgentGlyph` (bot icon or the agent's own icon) for agents everywhere; initials only for humans/devices | inventory P-Avatar |
| DF-14 | Foundations | Motion "none"; skeletons without shimmer | Transitions ≤ 120 ms; reduce-motion setting | D-20 |
| DF-15 | ChatCreate* vs NewChat | Two creation flows (full page and dialog) | Dialog for quick start; "More options" goes to the full page `/chats/new` | `04-screen-map.md` |
| DF-16 | Home | Designed data with no API (This week stats, System card) | Rendered only when the API lands (G-xx) | D-36 |
| DF-17 | Workflow/automation/scripts boards | They depict Workflow Overhaul Plan end states | Built by that plan on the kit | D-35 |
| DF-18 | Foundations status | "Paused" wording overlaps "Waiting" | 8-state map exactly as in v2 | D-18 |
| DF-19 | Pairing | 6-box code; the real code is 12 characters in 3 groups of 4 (`packages/shared/src/utils/pairingCode.ts`) | `PairingCodeInput` renders 3×4 from `PAIRING_CODE_LENGTH`/`PAIRING_CODE_GROUP_SIZE` | D-42 |
| DF-20 | SettingsSecurity | "Custom" network exposure the server does not support | Only the server-supported options are offered | D-42 |
| DF-21 | SettingsAppearance / SettingsSecurity nav | Group label "Agents & models" vs code "Agents" | Board label used (the group does hold providers and agents); section ids unchanged | D-42 |
| DF-22 | Shared style block | Focus drawn as `0 0 0 2px surface, 0 0 0 4px accent` (accent < 3:1 on some surfaces); switch thumb literal `#ffffff` | `focus-ring` outline in the `focus` token; switch thumb `surface` (off) / `on-accent` (on) | D-12 |

## Mobile artifact (3bBuQ3vGwYbJh7A2yX7kqA) — for the next pass

| # | Issue |
|---|---|
| MF-01 | The principles board says "6 accents"; the CSS defines 7 (ink + 6) |
| MF-02 | The Android "System (Material You)" accent is not in the token system |
| MF-03 | The phone themes board simplifies derived colours (`fg-3` = `fg-2`, literal hover/selected). The token package is the source |
| MF-04 | Unused tab-bar CSS (iOS floating bar, Android bottom bar) left in the style block |
| MF-05 | Keep / Keep all / Undo all missing on Changes |
| MF-06 | Reversals of saved mobile preferences (ink/neutral selected state, pills, composer glass, turn-setup sheet) — decide in mobile M0 (see `08-mobile-readiness.md` §3) |
| MF-07 | Mobile-only features without desktop/server counterparts (Pause agents, digest, quiet hours, per-project notification levels) |

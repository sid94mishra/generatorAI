# Backlog

Items the owner has parked. Each one says why it waits and what unblocks it.

## B-1 Update notice for unsigned macOS builds (parked 2026-10-12)

**Situation.** macOS builds are ad-hoc signed: there is no Apple Developer account, and the owner won't buy one until demand
justifies the $99/yr. Consequences for a user:

| Moment | macOS (unsigned) | Windows (unsigned) | Linux |
|---|---|---|---|
| First install | Gatekeeper: "Apple could not verify…", so the user goes to System Settings → Privacy & Security → **Open Anyway** (admin password) | SmartScreen: **More info → Run anyway** | no warning |
| Keychain on first launch | none: the app creates "GeneratorAI Safe Storage" itself and owns it | none (DPAPI) | none if gnome-keyring/KWallet is unlocked; else the "GeneratorAI is locked" dialog (U-31) |
| Relaunch, same version | silent | silent | silent |
| New version | **no update is offered**: Squirrel.Mac rejects unsigned updates, so `scripts/lib/build-config.mjs` withholds the `*-mac.yml` manifest and the check fails quietly | auto-download, installs on restart (NSIS); portable `.exe` is manual | AppImage and deb self-update (deb asks for the admin password) |
| After updating | Gatekeeper **Open Anyway** again, then **one** keychain prompt: the new build has a new cdhash, and the keychain partitions items by cdhash for apps without a Team ID. **Always Allow** keeps it quiet until the next version; **Allow** asks on every launch; **Deny** shows the U-31 dialog | silent | silent |

Self-signing does not help: D-142 was tried and withdrawn, because without an Apple-issued Team ID the grant stays tied to
the cdhash.

**The gap.** Mac users are never told a new version exists.

**Proposal (free).** In an unsigned macOS build, skip electron-updater's Mac path and do the following:
- Poll the GitHub Releases feed the build already resolves (`resolveGitHubPublish`) for the channel's latest version, at
  startup and every few hours, plus Help → Check for Updates.
- When it is newer, show a one-line notice: "GeneratorAI X.Y.Z is available".
  - **Download** opens the release's DMG asset in the browser.
  - **What's new** opens the release notes.
- The notice also says: "Quit GeneratorAI, replace it in Applications, then choose **Open Anyway** and **Always Allow**
  once."
- Dismissing hides it until the next version.
- Data (chats, projects, settings, vault) lives in `~/Library/Application Support/@generatorai/desktop`, so replacing the
  app keeps it.

**Unblocks / supersedes.** A Developer ID certificate plus notarization makes this unnecessary. Squirrel.Mac then
auto-updates, the keychain grant follows the Team ID, and there are no prompts at all.

## B-2 Windows/Linux CI desktop smokes (parked 2026-10-03)
They only run in CI, which needs `desktop_redesign` pushed (owner approval).

## B-3 VRT screenshot baselines (parked 2026-10-03)
Web P1-R7 and mobile MV-26 / M10-03. This Mac has no Docker, and keeping VRT is undecided.

## B-4 Scripts, end to end (parked 2026-11-01)
The Scripts page was empty in the owner's app, so its menu entries are hidden: `MENU_DESTINATIONS` in
`packages/shared/src/ui-contract/commands.ts` leaves it out of the sidebar, rail, palette and Home shortcuts. The page
still answers at `/scripts`, and its shortcut (G S, ⇧⌘S, Ctrl+7) still works. To revisit: where scripts come from and why
none were listed, then creating, running and editing one in the app. Then bring the entry back by dropping the filter.

## B-5 Agent cursor on a second display (parked 2026-11-07)
**Situation.** cua-driver draws the computer-use agent cursor in a single overlay window that covers only the main display.
Measured on the owner's Mac: the main display is 1440×900 at (0,0), and a second 2560×1440 monitor sits at (−570,−1440). The
apps the agent drives open on the second monitor, and their cursor positions (y < 0) are never drawn. This holds on 0.38.0 and
on 0.41.2, and the release notes up to 0.41.x mention no multi-display overlay. Actions on the second monitor therefore
show no agent cursor at all.

Already fixed and not part of this item:
- stale cursors, now hidden at turn end (c2638d22);
- effect-heavy motion, now a gentle arc with Fitts timing (9d399491, d8e317a0).

**Options:**
1. A GeneratorAI-drawn overlay: one transparent, click-through, always-on-top window per display in the desktop app. It
   animates the agent cursor with the same motion model, driven by the action targets the bridge already knows, and the
   driver's own cursor is switched off. This needs to work on Windows and Linux too.
2. Report the bug upstream at trycua/cua and wait for a driver fix. That is outward-facing, so it needs the owner's OK.

**How to verify.** Sample the driver's (or the app's) overlay windows with `CGWindowListCopyWindowInfo` while the cursor
moves to a window on each display; this needs no screen-capture permission. Pass when an overlay covers every target
position, on both displays.

## B-6 Computer use to an independent score above 8/10 (parked 2026-11-07)
**Goal.** An independent judge scores GeneratorAI computer use above 8/10, working from evidence files only. Every fix
stays generic: nothing is keyed to an app or a task, and every fix must carry to any app on macOS, Windows and Linux (owner
rule).

**State after 17 iterations** (macOS 27, Sonnet 5.5, installed signed app, branch `arch-echancement`, latest build
58687bfe, cua-driver 0.41.2):

| Judged rounds | Build | Overall | Pass rate (strict) | Original S1–S10 | Fresh held-out G1–G6 |
|---|---|---|---|---|---|
| R8a–R10a | 0.38 driver | 5.0 | 57% | 67% | — |
| R11a–R12a | f03bb6fd | 5.5 | 79% | 65% | 12/12 |
| R14a–R15a | d8e317a0 | **6.0** | 87% | 75% | 12/12 |
| R16a–R17a | 58687bfe | 5.7 | 79% | 70% | 12/12 |

What works:
- Standard controls: keypads, text areas, menus, Find panels, standard save panels, opening a file by path.
- New documents in iWork, TextEdit, Freeform, Script Editor, Grapher and VS Code.
- Honest replies: there has been no false success claim in a final answer since R12.
- Batching through `run_steps`.
- `save_as` checks the result on disk.

What never works:
- S4: a Numbers chart title.
- S5: a Freeform export through its separate export window.
- S6: Pages table cells; it passes only by chance.

**Open issues, ranked by expected impact.** Taken from the last judge report and owner findings.

| # | Issue | Shown by | Fix needed |
|---|---|---|---|
| 1 | No working foreground path: keys sent to an unfocused window or a canvas object are reported `ok` and change nothing | S4 every run, S3, S6 | A consented "bring to front" step that confirms focus, a per-batch read-back that retries in the foreground or refuses when nothing changed, and consent shown in the UI |
| 2 | `save_as` fails on export panels that are separate windows, and on the Replace sheet (`-25205`); the 4 s tree budget runs out before the Export button | S5 every run; S6, H2 and G6 sometimes | Treat any new window holding a save panel as the dialog, find its default button directly, give dialogs a larger tree budget, handle Replace |
| 3 | No budget stop: failing runs reach 50–72 calls and 5–10M context, because any snapshot lifts the unconfirmed-input stop | S4, S5, S6 | A stop after N batches with no change on the same target that a snapshot cannot lift, and pruning of unchanged screenshots |
| 4 | Tools report success that did not happen: `verified:true` on a wrong read-back, a false "Created", `target_lost` worded as "Performed", `ok` with no effect | S6, S8, G4, S4, H3, G1 | Compare the read-back with the requested value, confirm a new document by diffing the window list, keep refusal codes consistent |
| 5 | `newDocument` is not isolated: New opens a tab in the user's window before the New Window fallback runs, and that empty tab stays | G4 | Use New Window first when the app already has windows, and report the leftover tab |
| 6 | A menu command aimed at one window acts on whichever window of the app is in front (found while tidying VS Code on 2026-11-07) | owner's VS Code session | Bring the addressed window forward and confirm it is key before any menu command that changes or closes something |
| 7 | Word-processor table cells: the cell-by-index recipe left cells empty; Tab moves focus to a sidebar | S6 | Enter cell edit mode through accessibility, then correct the skill |
| 8 | New windows are not found when many windows of the app are open | H3, H2 | Resolve new windows by diffing the window list |
| 9 | No product-level protection of the file the user opened: an edit reached the original's window | H3 | Hash the original at open, refuse changing commands on its window when the task keeps it, restore it if it changed |
| 10 | Leftover state between runs: restored iWork, Preview and Grapher documents, Calculator mode, VS Code test windows, autosaved untitled documents | G2, H3, S3 and others | Harness reset before every run, plus product-side reporting of autosave residue |
| 11 | The agent searched the user's home folders (`ls ~/Desktop ~/Documents`, `find`) to look for an export | S5 | Confine file checks to the target folder, in the skill and the hint |
| 12 | Menu labels guessed wrong cost calls | S1, S4, S5, S8 | Fuzzy-match against the items the refusal already lists |
| 13 | Agent cursor missing on a second display | — | See B-5 |
| 14 | Genericity gaps: English-only labels; Windows and Linux never run; the skill's sections mirror the tuning tasks; G4 contaminated by two fixes | — | Measure on Windows and Linux, run a non-English UI, write a new held-out set |

**Definition of done** (judge criteria for above 8):
- **Original set:** at least 85% strict over 4 or more runs per task, with S4, S5 and S6 each passing at least 3 of 4.
- **New held-out set:** at least 85% strict on a never-tuned set of 10 or more tasks. It includes at least 3 third-party apps and the hard control classes: canvas text, export windows separate from the document, and word-processor tables.
- **Platforms:**
  - Windows and Linux runs within 10 points of macOS.
  - At least one run with a non-English UI.
- **Integrity:**
  - Zero false `ok`, `verified` or "Created" results.
  - Zero input into windows that existed before the task.
  - Zero changes outside the target paths.
  - Zero leftover state at the start of a run.
- **Cost:**
  - Median under 90 s and under 400k context per task.
  - No run over 2M context or 40 calls.
- **User control:** consent prompts and a live view shown in the evidence.

**How it was measured.**
- `cu-run.mjs` drives the installed app over CDP like a user: a new chat, the task typed in, consent answered.
- `batch.sh` resets the test apps, runs the tasks and verifies each one.
- `cu_verify.py` checks the output files on disk.
- `judge_compile.py` assembles `runs.json` and `traces.json`, and an Opus judge scores them from evidence only.
- The task set has three parts:
  - S1–S10: the original tasks.
  - H2–H4: held out at first, later tuned on.
  - G1–G6: fresh, and almost untuned.
- The harness, the fixtures, the judge brief, all four reports and a per-run results table (R6a–R17a) are parked in
  `docs/redesign/backlog/B-6-computer-use-eval/`. Its README lists what to do before resuming: port the harness to Node
  under `agent-tests/`, reset properly between runs, and write a new held-out set. Raw traces were left out because they
  contain listings of the owner's home folders.

**Unblocks.**
- Windows and Linux machines with the app installed: needed for the platform criteria.
- Owner decisions on the consent UX for foreground steps and on the second-display cursor (B-5).

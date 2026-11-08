# Builds per round (all macOS 27, Apple silicon, installed signed app, model Sonnet 5.5 via the Claude Agent SDK harness)

| Round | Build (commit on arch-echancement) | Change since the previous round |
|---|---|---|
| R6a | 5c5cc5d7 | All app-specific handling removed (iWork bundle-id checks, per-app skill recipes) → generic new-document, crash-on-read guard, generic skill |
| R7a | 5071e46d | Open popup menus named in results / stray menus closed; new-document settle + start-screen button; save_as format by popup items + extension, folder/appended-extension checks |
| R8a | 9ed5220c | Windowless apps reopened; re-find export window; menu note only with items; table-cell skill line |
| R9a | 88d78ef2 | LaunchServices reopen on macOS; typing after a pixel click aimed at that point; default-button Return; "duplicate before editing" in the standing hint |
| R10a | d40a9300 | Export window re-found ~3 s after Go to folder; background-disabled menus retried up to 3× |

Each task starts with the test apps terminated (their windows hold only test output). Apps may still restore autosaved test documents from earlier rounds.
H1–H4 are held-out tasks in apps never used for tuning (Word, Grapher, Preview, Script Editor), added when the app-specific handling was removed.
H1 cannot pass on this machine: Microsoft Word is unlicensed and only offers a trial or sign-in, which the agent must not accept.
Windows and Linux were not run (no machines); the code paths are shared but unmeasured.
After R10 started, one tool-description example ("budget.csv") was changed to "notes.csv" (commit 072367fb) because it matched a task's file name.
S7 has no file check: its answer is in the reply (the task's expected value is computed from the prompt in scenarios.json).
R6a-S3 shows "?" because the verifier crashed on an exported folder (the run exported budget.csv as a folder of two CSVs = a fail); the verifier was fixed afterwards.

## Rounds after the first judge report (REPORT-R8-R10.md)
| Round | Build | Change |
|---|---|---|
| R11a | 516ac0d2 | Undelivered background typing replayed in the foreground; refusal text in the agent's own tools; opened-file autosave note; skill fills a new sheet's empty table instead of adding a second; failed save_as closes its dialog |
| R12a | f03bb6fd | A windowId alone names its app; save/export dialogs waited for up to 12 s |

R11a and R12a add G1–G6: a FRESH held-out set written after the first judge report and never used for any fix or skill change (G1 TextEdit Find & Replace, G2 Calculator scientific mode, G3 Dictionary lookup, G4 Visual Studio Code — third-party Electron app, G5 Preview image→PDF keeping the original, G6 Keynote bullets deck→PDF). G2 and G3 are checked from the reply (expected: 1,036; "lasting for a very short time").
H1 (unlicensed Word) was not rerun in R11a/R12a.
In G4 the owner's own VS Code workspace window was open; the agent worked only in its own new window (checked after the round: no unsaved-change marker on the owner's window).

## Rounds after the second judge report (REPORT-R11-R12.md)
| Round | Build | Change |
|---|---|---|
| R13a | ced7974c | Paste only to the addressed window (key window brought forward); window_not_key escalates to foreground; `verified` only with a visible change; save_as reports files saved under a default name (folder diff); New via the window holding focus. Run right after the owner approved moving 39 test documents from earlier rounds to the Trash, so iWork apps launched with nothing to restore (a new state). |
| R14a, R15a | d8e317a0 | cua-driver upgraded 0.38.0 → 0.41.2 (owner-approved); a single named click/set_value runs as a one-step run_steps (0.41 refuses `name` on click); agent cursor hidden at the end of every chat turn and human-like motion applied on every session (not part of the scored behaviour, cosmetic). R14a and R15a are two runs on the SAME build. |

Score the current build on R14a + R15a. The fresh held-out set G1–G6 is unchanged since it was written. One fix was motivated by a G run: the paste-to-addressed-window fix (ced7974c) came from the R12a-G4 cross-window delivery; no skill change used the G set.

## Rounds after the third judge report (REPORT-R14-R15.md)
| Round | Build | Change |
|---|---|---|
| R16a, R17a | 58687bfe | press_key steps honour `modifiers`; newDocument waits for windows to settle (no restored document reported as created), opens the app's own New Window when New made a tab in a pre-existing window, ignores animated title marks; any snapshot lifts the unconfirmed-input stop (as the skill says); loose action names map to advertised ones and unsendable actions get an alternative; skill fills word-processor tables cell by cell (not Tab). Harness: outputs removed as folders too; G3b (Dictionary, "ubiquitous", expected "present, appearing, or found everywhere") replaces G3 in R16a so the query is actually typed; R17a runs G3. R16a and R17a are two runs on the SAME build. |

Score the current build on R16a + R17a.

# GeneratorAI computer use: independent evaluation (R8a–R10a, Opus judge, evidence only)

Pass rule: every verifier line passes (S7: the reply states 68,315). Classes: P = product, A = app/OS, M = model, E = environment.
All runs are macOS + Sonnet 5.5. There is no Windows or Linux data.

## Results, R8a–R10a (3 runs per task)

| Task | Pass /3 | Median s | Median calls | Median context | Failure causes |
|---|---|---|---|---|---|
| S1 TextEdit RTF | 3 | 99 | 17 | 1.18M | — |
| S2 TextEdit edit | 3 | 50 | 7 | 0.47M | — |
| S3 Numbers → CSV | 1 | 169 | 21 | 1.92M | R9a, R10a P: the placeholder table is emptied but not removed, the paste adds a second table, and the export becomes a folder. The table object cannot be deleted. |
| S4 Numbers chart → PDF | 0 | 139 | 25 | 2.51M | R8a, R9a P: the chart title never enters edit mode; typing reports ok and nothing changes. R10a M (P contributing): a background drag selected only the Apr row, and recovery deleted it. |
| S5 Freeform → PDF | 0 | 349 | 37 | 3.89M | R8a P: no Save button. R9a P: the name field went away. R10a P: 0 of 7 characters delivered while labelling shapes. |
| S6 Pages → DOCX | 1 | 221 | 31 | 2.97M | R8a P/M: no_focused_text_input, and keys landed in the sidebar. R10a P: 0 of 6 characters delivered; set_value did not take. |
| S7 Calculator | 3 | 50 | 4 | 0.25M | — |
| S8 TextEdit → Numbers | 3 | 93 | 8 | 0.44M | — |
| S9 Calculator → TextEdit | 3 | 144 | 22 | 1.44M | — (median 7 failed calls) |
| S10 Keynote → PDF | 3 | 121 | 15 | 0.93M | — (only the page count is checked) |
| H1 Word | 0 | 52 | 4 | 0.23M | E: unlicensed; the agent correctly declined the trial and sign-in |
| H2 Grapher → PDF | 1 | 95 | 24 | 1.78M | R8a P: typing never reached the custom field. R10a P/M: newDocument hit off_space_or_ax_unresolved; typing reported done but nothing changed. |
| H3 Preview → JPEG | 1 | 69 | 7 | 0.51M | R8a M: rotated the original. R9a P/M: Duplicate was disabled in the background, and the agent edited the original anyway. |
| H4 Script Editor | 2 | 81 | 7 | 0.35M | R8a P: no window (fixed in R9). |

The 18 failing runs break down as P 13, M 2, E 3.

## Pass rates (95% Wilson)

| Set | Passed | Rate | 95% CI |
|---|---|---|---|
| Original set | 20/30 | 66.7% | 48.8–80.8 |
| Held-out set, H1 excluded | 4/9 | 44.4% | 18.9–73.3 |
| Overall | 24/42 | 57.1% | 42.2–70.9 |
| Overall, H1 excluded | 24/39 | 61.5% | 45.9–75.1 |

| Round | Passed |
|---|---|
| R6a | 6/14 |
| R7a | 9/14 |
| R8a | 7/14 |
| R9a | 9/14 |
| R10a | 8/14 |

The pass rate has been flat since R7a.

## Genericity audit

- **Code:** no logic is keyed to an app. One example in a tool description matched a task's file name ("budget.csv"); it has since been changed.
- **Skill:** it names no apps, but its sections mirror the task list. The placeholder recipe is wrong in general, and every menu path and label in it is English.
- **Held-out tasks:** these were contaminated by the R8–R10 fixes, which targeted their failures. Failures follow control types (custom-drawn text, object selection, non-standard dialogs) rather than particular apps.
- **Windows and Linux:** unmeasured. Several fixes rely on macOS-only mechanisms.

## Scores

| Dimension | Score /10 |
|---|---|
| Task success | 5 |
| Speed | 5 |
| Token efficiency | 4 |
| Output quality | 6 |
| Robustness | 4 |
| Safety & user control | 6 |
| Generality | 5 |
| **Overall** | **5.0** |

The overall score weights task success 30%, robustness 15%, generality 15%, safety 15%, output quality 10%, speed 7.5% and token efficiency 7.5%.

## Competitors (estimated, different benchmarks)

| Product | Overall |
|---|---|
| Codex | about 7 |
| Claude Cowork / CU API | about 6 |
| Hermes | about 5.5 |
| GeneratorAI | 5.0 |
| Manus | about 4 |

Cursor is not comparable, and Grok is unrated.

## Top 5 fixes

1. **Confirm that typed text landed.** If it did not, fall back to the foreground with the user's consent, and never report "done" when nothing changed. Addresses S4, H2, S6 and S5.
2. **Selecting and deleting objects, and a correct placeholder recipe.** Paste into the existing placeholder and trim it, and select ranges by their first and last cells. Addresses S3 and S4.
3. **Make save_as robust for separate or slow export windows.** Use a larger tree budget, find the default button, track the name field after Go to folder, and close a dialog left open after a failure. Addresses S5.
4. **Have the product protect originals.** Record a hash when a file is opened, check it at the end, and restore the original if it changed. Addresses H3.
5. **Window targeting and refusal text.** Survive off_space_or_ax_unresolved, block input to windows that were already open, remove internal tool names from refusals, and reset the test harness between runs.

**What it takes to score above 8:**
- At least 85% strict passes on the original set and on a fresh, never-tuned held-out set of 10 or more apps, including third-party apps.
- Windows and Linux within 10 points of macOS.
- No constraint breaches and no false successes.
- A median under 90 s and under 400k context per task.
- Per-app consent and a live view, shown in the evidence.
- One test in a non-English UI.

## Verdict

The agent is careful and honest, and reliable on standard controls: 6 of the 14 tasks always pass. It is not yet a general desktop agent, at 57% strict. Thirteen of the 15 non-environment failures share one root cause: input is sent only in the background and is never checked. **5/10.**

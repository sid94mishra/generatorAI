# GeneratorAI computer use: independent evaluation, R11a + R12a (Opus judge, evidence only)

**Overall 5.5/10** (previous: 5.0)

## Scores

| Dimension | Score /10 | Weight |
|---|---|---|
| Task success | 6 | 30% |
| Speed | 5 | 7.5% |
| Tokens | 4 | 7.5% |
| Output quality | 6 | 10% |
| Robustness | 4 | 15% |
| Safety & user control | 6 | 15% |
| Generality | 6 | 15% |

## Pass rates

| Set | Passed | Rate | 95% CI |
|---|---|---|---|
| Original S1–S10 | 13/20 | 65.0% | 43.3–81.9% |
| Held-out H2–H4 | 5/6 | 83.3% | — |
| Fresh held-out G1–G6 | 12/12 | 100% | 75.7–100% |
| Overall | 30/38 | 78.9% | 63.7–88.9% |
| Overall, discounting the S8 `mv` pass and the G4 wrong-window pass | 28/38 | 73.7% | — |

On the comparable set the rate is flat: 6, 9, 7, 9, 8, 10, 8 of 13 from R6a to R12a.

## Failing runs

There were 8 failing runs. The product contributed to all 8, the environment to 4 and the model to 2.

| Task | Result | Cause |
|---|---|---|
| S4 | 0/2 | R11a: Numbers crashed, then restored windows held the keyboard. R12a: the chart title did not change although the tool reported ok. |
| S5 | 0/2 | `save_as` did not recognise Freeform's export window. The file was written as "Untitled 10.pdf" and went unnoticed. |
| S6 | 0/2 | Keys went to the Format sidebar instead of the table. One call reported `verified:true` when nothing had changed. |
| S10 | 1/2 | In R12a, `newDocument` was refused with `window_not_key`; 8 restored test documents were open. |
| H2 | 1/2 | In R12a, `newDocument` hit `off_space`, and typing into the custom field landed nowhere. |

## Other findings

- **G4:** typing aimed at window 13843 landed in leftover window 12541 (cross-window delivery).
- **G1:** a `set_value` that did not take emptied the replace field, so Replace All deleted text. Undo recovered it.
- **Fixes from the previous report:** the R11 foreground replay fired in no run, and the 12 s dialog wait did not fix Freeform.
- **Generality:** the code is clean and the fresh held-out set passed, but the G set covers standard controls only. The skill's sections mirror the tuning tasks. Labels are English only. Windows and Linux have not been run.

## Top 5 fixes

1. **Foreground path and multi-window focus:** a consented foreground step, `newDocument` and keys that work with other windows open, and blocking keys whenever the focused window is not the one addressed.
2. **Verify input at the element:** check focus is on the clicked element, read the value back after typing, never report `verified:true` without a change, and trigger the foreground replay when that check fails.
3. **`save_as` and separate export windows:** treat a new window that contains a save panel as the dialog, read the name back, diff the folder, and report files saved under a default name.
4. **Canvas objects:** use the inspector fields and the objects' own actions, and select ranges by their first and last cells, not by dragging.
5. **Budget and harness hygiene:** a service-level stop after repeated failures, pruning screenshots, no `find /`, and resetting restored documents before each run.

## What it takes to score above 8

- At least 85% on the original set.
- At least 85% on a never-tuned set of 10 or more apps that includes hard control classes and 3 or more third-party apps.
- Windows and Linux within 10 points of macOS.
- Zero cross-window deliveries and zero false `verified` results.
- A median under 90 s and under 400k context.
- Consent and a live view shown in the evidence.
- One run in a non-English UI.

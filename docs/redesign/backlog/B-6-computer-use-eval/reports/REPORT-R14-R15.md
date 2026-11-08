# GeneratorAI computer use: independent evaluation, R14a + R15a (Opus judge, evidence only)

Overall: 6.0/10 (previous reports: 5.0, then 5.5). Build d8e317a0, cua-driver 0.41.2, macOS, Sonnet 5.5.

## Scores

| Dimension | Score /10 |
|---|---|
| Task success | 6.5 |
| Speed | 6 |
| Tokens | 5 |
| Output quality | 6.5 |
| Robustness | 5 |
| Safety | 6.5 |
| Generality | 6 |

## Pass rates

| Set | Passed | Rate | 95% CI |
|---|---|---|---|
| Overall | 33/38 | 86.8% | 72.7–94.2 |
| Overall, G3 not counted as exercised | 31/38 | 81.6% | — |
| Original S1–S10 | 15/20 | 75% | — |
| H2–H4 | 6/6 | 100% | — |
| G1–G6 | 12/12 | 100% | — |
| Comparable 13-task set, R14a + R15a | 21/26 | 80.8% | — |

The comparable 13-task set gives the trend across rounds:

| Round | Passed |
|---|---|
| R6a | 6 |
| R7a | 9 |
| R8a | 7 |
| R9a | 9 |
| R10a | 8 |
| R11a | 10 |
| R12a | 8 |
| R13a | 6 |
| R14a | 10 |
| R15a | 11 |

## Failures

| Task | Result | Cause |
|---|---|---|
| S4 | 0/2 | Unfocused window; the chart was inserted without the data selected; a `modifiers` field was silently ignored, so "a" was typed into a cell. |
| S5 | 0/2 | Freeform's separate export window was not recognised. `newDocument` falsely reported "Created" for an existing board. |
| S6 | 1/2 | Tab between cells sent text to the sidebar. The skill recipe itself is at fault. |

## Flags

- **S9:** a name click with no match returned ok.
- **R14a-S6:** `verified:true` on a wrong value.
- **R14a-G1:** Replace All deleted words because `set_value` did not take; reverted.
- **G4:** a new tab opened in the owner's VS Code workspace window; the paste was unverified.
- **G3:** the query was already searched when Dictionary opened, so the run did not exercise the task.
- **`save_as`:** -25205 on a Replace sheet (S8, H2).
- **Harness hygiene:** leftover state between runs.

## Top fixes

1. A consented foreground path, plus a keystroke-guard reset that matches the skill.
2. `save_as` robustness: separate export windows, read the name field back, the default button, the Replace sheet.
3. Tool truthfulness: a no-match name click refuses, `verified` checks the requested value, unknown step fields are rejected, pixel clicks are allowed on windows without a tree, `changes` are reported for paste and type.
4. A truthful, isolated `newDocument`: diff the window list, open a new window instead of a tab in the user's window.
5. Canvas and table objects: select the data before Insert>Chart, set the title through inspector fields, and no Tab recipe for table cells.

## What it would take to score above 8

- At least 85% on the original set over 4 or more runs, with S4, S5 and S6 each at 3/4 or better.
- A fresh held-out set of 10 or more apps that includes hard control classes.
- A clean harness.
- Windows and Linux within 10 points of macOS.
- Zero false ok results.
- A median under 90 s and under 400k context per task.
- Consent and a live view shown in the evidence.
- A run in a non-English UI.

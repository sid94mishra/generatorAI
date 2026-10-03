# Automations — boards Automations, AutomationDetail, AutomationCreate

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: list (enable switch, row actions) → detail → Run now (execution recorded, 1/1 succeeded) → New automation
wizard (Basics → Trigger: Schedule, cron, timezone, missed/overlap policy, Next 3 runs).

## Matches
- List columns incl. Dataset / Permission / Last execution / Next run, footnote. Detail: stat strip, Execution history
  (IterationsTable), Trigger and Workflow rail cards. Wizard: Stepper with subtitles, trigger radio cards, schedule
  fields, next-runs preview, Back / Continue.

## Intentional deviations (D-82)
- 4-step wizard (board 6), no draft state, no edit UI; cron field instead of the Repeats seg (API shape).

## Defects (fixed)
- "1 workflow" instead of the workflow's name; execution table clipped at 1440 and crushed at 1100 (rail now stacks
  below ~1150px); "1 runs" (`470d0d84`).
- Stepper marker stacked above the title (`0ac31ff0`).

# Workflows — boards Workflows, WorkflowDetail, WorkflowRunDialog, WorkflowRun, WorkflowNew

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: list → detail → Run (dialog, `?run=1`) → run page (stage rows, dock Inspector / Changes / Files / Terminal);
New workflow (Blank / Template / Import cards, template grid, basics, Cancel).

## Matches
- List: header, stat strip, search + All/Published/Drafts, table, footnote → Scripts. Detail: breadcrumb with
  Published vN + Versions, Open in builder / Run, description + meta, Stages table, Setup and Variables cards, Runs
  rail. Run dialog: Variables, Stages overrides, Run options, Uploads, Plan preview aside, Cancel / Run. Run page:
  header (permission, turns·tokens, stage progress, started), stage table, dock.

## Intentional deviations (D-82)
- Stages table instead of the mini-DAG; no lifecycle card, Agent / Attempt columns, run number, median cost, status
  filters, Automation column, Duplicate as draft. WorkflowRunLoop / ChatWorkflowRun / WorkflowAgentDraft states need
  loop runs and P06 agent drafts the Faux sandbox does not produce (blocked here; stories cover the cards).

## Defects (fixed)
- No workflow glyph in list rows; run timestamps printed `03/10/2026` → "3 Oct, 15:25"; dock tab overflow; Dropzone
  "Choose files" at the far edge (`15093589`).

# Scripts — board Scripts

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: sidebar → Scripts; Reload; filter.

## Matches
- T-05 master-detail: list pane (H1 + count + Reload, filter, footer note), empty detail state.

## Intentional deviations
- Workflow scripts are off by default (they run with the server's privileges), so the sandbox shows no rows; the
  detail pane was compared in the first review.

## Defects (fixed)
- With scripts off the page claimed "No workflow scripts found — place files in templates/scripts" although 3 were
  there, and Reload failed silently → `GET /api/workflow-scripts/status`; the page says they are turned off, how many
  files exist and how to enable them; Reload errors show (`ef9bd5ca`).

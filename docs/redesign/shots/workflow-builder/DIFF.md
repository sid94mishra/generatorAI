# Workflow builder — boards WorkflowBuilder, WorkflowStagePrompt / Model / Tools / Hooks, WorkflowSettingsPanel, WorkflowValidate, WorkflowLoopBuilder

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: Open in builder; select a stage → Prompt / Session / Tools / Output / Policy / Hooks; workflow settings tabs;
typed an undeclared `{{risk_threshold}}` → Validate → problems panel with Declare; Wrap in loop; undo; leave with
unsaved changes → confirm dialog.

## Matches
- Rail shell, header (breadcrumb + name, status chip, undo/redo/history, Save ⌘S, Validate counts, Publish, Run),
  canvas toolbar, stage nodes, inspector tabs with counts, problems panel (codes, Declare / Go to, checked time,
  Check again), loop group node with its loop inspector.

## Intentional deviations (D-82)
- Agent-draft banner and version-history author need P06 / API data; no canvas minimap.

## Defects (fixed)
- Name input fixed at 256px left the status chip floating; Save stayed enabled with errors; "Validate1" (`83a74ecb`).

# Create chat page — boards ChatCreate, ChatCreateModel, ChatCreateOrchestrator

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: Home quick composer → More options → `/chats/new`; "Who works on this" cards, orchestrate switch, Model +
Effort seg, Where project picker, More (tags, browser), Summary aside, Esc / Cancel.

## Matches
- T-03 form + Summary aside; breadcrumb with mono `/chats/new`; Task, Name / Description; the three "Who" radio cards;
  Agent select; Orchestrate switch; Model select with tier/context meta and Effort seg; Where with project; footer
  with the blocking reason, Cancel, Create chat ⌘↵.

## Intentional deviations
- Capability tabs are not editable at creation (D-77); the model-strength warning with a fix (ChatCreateModel) has no
  API signal (D-36).

## Defects
- None on this page (the ⌘↵ hint follows the host — shared fix `9a2cd42c`).

# Home — board Home vs app

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: Home via the sidebar; quick composer Project / Agent / Model menus; "More options" → `/chats/new`; Needs you
rows Open / Allow once / Answer; Running row Stop (DV Error while it ran); Recently finished (incl. a failed turn
with Retry); This week and System cards; shortcut counts.

## Matches
- Date line + headline ("3 need you"), composer card with chips and More options, Needs you card with 56px two-line
  rows (warn hand glyph, title, detail, project, time, Open + Allow once / Answer), the neutral "Risky" badge (D-83).
- Recently finished rows: status glyph, title, project, "+11 −3 · Turn completed" / "Failed · <error>", time, Retry.
- Aside: This week (Chats, Workflow runs), System (server, agents, database, disk meter, uptime, version), counts.
- Model picker popover (board ComposerModelPicker): 620 wide, provider column / model list / detail pane, footer hints.

## Intentional deviations
- Running / Recently finished / This week render only with data (D-36).
- No "Approve" plan asks in this seed: the Faux harness cannot drive plan review (harness limit, not product).

## Defects (fixed)
- Model picker footer spanned the provider column and clipped its sign-in help → footer under the list (`4d5614c8`).
- Provider avatar initials drew punctuation ("F(") → letters only (`4d5614c8`).
- Running Stop and Recently-finished Retry were hover-only (board: always shown); "+0 −0" for a no-change turn (`e13eddaa`).
- Needs-you detail showed raw JSON (`{ "command": "git …`) → the command / path it names (`e872fb8c`).
- This week · Chats counted an orchestrator's hidden worker chats (`55e02511`).

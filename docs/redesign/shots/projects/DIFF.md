# Projects list + New project — board Projects

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: sidebar → Projects; New project (name, description, retention seg, max codebases, Add repository → Local git
with the dummy repo path, Browse dialog) → created; list search, scope, list/grid, row menu; sort chip.

## Matches
- Header, H1 + count, New project, search + Active/Archived seg + list/grid toggle, table columns (Project,
  Codebases, Active chats, Last run, Worktrees, Updated), row menu, footnote under the table.

## Intentional deviations
- "Run workflow…" absent from the row menu (D-74); Last run / Worktrees "—" until data exists (D-36).

## Defects (fixed)
- No folder glyph before project names; no sort chip (board "Updated") → Updated / Name / Created (`f81e93f3`).
- Segmented radios inside a Field were all named after the Field ("Worktree retention" ×4) (`4d5614c8`).
- "Default branch(optional)" label lacked a space (`4d5614c8`).
- Directory browser suggested `C:\src\my-app` on a macOS server (`f81e93f3`).

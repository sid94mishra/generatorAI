# Codebase detail — board CodebaseDetail

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: project → codebase link; Fetch; Logs; Default branch combobox; Worktrees seg; Files tab.

## Matches
- Title + type line, meta card (Path + copy, Default branch picker, Last fetched, Active worktrees, Fetch),
  Worktrees / Files tabs, All / Active / Orphaned / Completed seg, Clean up orphans, worktree table.

## Intentional deviations
- Size / Linked-to columns render once G-17 data exists (D-36, D-84).

## Defects (fixed)
- Fetch sat in the title row; the board puts it in the meta card (`f81e93f3`).

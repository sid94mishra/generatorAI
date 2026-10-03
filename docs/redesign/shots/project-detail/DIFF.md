# Project detail + Customization — boards ProjectDetail, ProjectCustomization

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: every tab (Codebases, Chats, Runs, Pull requests, Customization, Settings); Add codebase inline form (Local
git, Browse); Fetch / Logs; row menu → Delete codebase… confirm; Customization skill preview; Settings rows.

## Matches
- Breadcrumb header with New chat / Run workflow / More, H1 + meta line, path-segment tabs with counts, inline Add
  codebase card, codebase table, Customization seg Skills/Prompts/Agents/MCP with filter + Upload, enable switches,
  400 preview aside.

## Intentional deviations
- Needs-you banner only when the project has an ask (D-36); Runs without Trigger column (D-74).

## Defects (fixed)
- Codebase rows lacked the branch glyph; Fetch / Logs / ⋯ were hover-only → DataTable `alwaysShowActions` (+ story) (`f81e93f3`).
- Settings › Location: root path overflowed the card → wraps, with Copy (`f81e93f3`).
- Logs dialog said "No output yet" for a finished fetch with no output (`f81e93f3`).
- Chats tab count included hidden worker chats (8 vs 6 rows) (`55e02511`).

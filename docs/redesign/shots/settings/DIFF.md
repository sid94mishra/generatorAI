# Settings — boards SettingsAppearance, SettingsSecurity and the recipe sections (D-32)

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: sidebar gear → Settings modal; every nav entry (General, Appearance, Model providers, Agents, Skills, MCP
servers, Templates, Source control, Browser & terminal, Computer use, Audio, Extensions, Security & devices, Storage,
Workflow engine, Diagnostics); Appearance theme/mode switch; Diagnostics Refresh. Shots
`1440x900-instrument-dark-<section>.png`; Appearance matrix in `../settings-appearance/`.

## Matches
- 960×640 modal, searchable grouped nav, section header + description, SettingRow / SettingsTable recipe, footer
  save note. Appearance (mode seg, theme gallery with filters, accents, density, font size, reduce motion) and
  Security as in `../review-2/DIFF.md`.

## Intentional deviations
- Security single column (D-74, first review #16).

## Defects (fixed)
- Title Case section titles against the nav; red "Not installed" provider badges; empty skill badges; SectionHeader
  truncated its title before the hint ("Acco…"); two stacked Refresh buttons in Diagnostics (`a78800f3`).
- Agents section rows stacked vertically (`365db897`).

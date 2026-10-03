# Agents — boards Agents, AgentEditor, AgentPickerBoard

App: isolated seeded sandbox (`sandbox.mjs --port=3497 --web-port=5497`, temp DB under a private `TMPDIR`, Faux
harness with a validation fixture adding scripted chats: file edits, a risky shell gate, a question, a provider
error, an orchestrator with two workers, a long answer), project "DV Project" with a throwaway dummy repo
(`make-dummy-repo.mjs`) added through the UI. Headed Chrome via playwright-cli; shots `<w>x<h>-<theme>-<mode>[-state].png`
at 1440x900 and 1100x760 in Instrument dark, Instrument light and Solarized light (PNGs gitignored);
`compare-*.png` from `side-by-side.mjs`. Design validation pass, 2026-10-03 (`../../reviews/design-validation.md`).

Walked: sidebar → Agents; scope seg, role filter, sort; View / Edit / Export / Delete; editor: edit Description, ⌘S
save (persisted), Discard footer; Settings › Agents; New chat → agent picker popover.

## Matches
- 3-column card grid (glyph, name, role badge, actions, description, runtime line, scope + tags + version), Import /
  New agent, footnote. Editor: PageTitle, Identity, Instructions with byte count and combine mode, Role, Runtime,
  Skills / MCP, Capabilities, Effective capabilities + Used by aside, sticky "Unsaved changes · Discard / Save".
  Picker: search, scope seg, No agent, Orchestrators / Workers groups, detail pane.

## Intentional deviations
- AgentGlyph instead of initials (DF-13). The picker's Customize-capabilities pane is not built (D-77).
- No "Duplicate" for built-ins (no API) — the footnote says export + import instead.

## Defects (fixed)
- No sort chip / footnote; Import without its format (`552a926c`).
- Editor order (board: Role → Runtime → Skills / MCP / Capabilities); clipped capability labels; cards were
  role=button around their own buttons; Field-wrapped Textareas were named by their placeholder (`e8f2c0ca`).
- Settings › Agents rows stacked vertically (`365db897`).

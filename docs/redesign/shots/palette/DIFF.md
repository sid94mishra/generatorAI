# Command palette (P3-05) — board CommandPalette vs app

Shots (1440×900, isolated server :3421 + Vite :5421, seeded by `agent-tests/vrt/seed.ts`, Chrome headed, web host on macOS):
`1440x900-instrument-dark.png`, `1440x900-instrument-light.png`, `1440x900-solarized-light.png`,
`1440x900-instrument-dark-query.png` (query "sandbox": recent chats with a live badge),
`1440x900-instrument-dark-actions.png` (Tab on a recent chat). Side by side: `compare-1440-dark.png`, `compare-1440-light.png`.
The page behind the palette is still the legacy shell (P3-04 replaces it); only the palette is compared.

## Matches
- Frame: 640 wide, top edge at 120px on a 900px window, centred on the window, `overlay` surface, 1px `line`, dialog radius,
  `shadow-pop`, `scrim` backdrop over the whole window.
- Query row 48h: 16px search glyph `fg-3`, `text-body` input, result count ("2 results") small `fg-3` on the right, `line-soft` rule.
- Group labels 28h small `fg-3`; rows 36h, 6px side margin, control radius, 12px gap, `text-ui fg-2`; highlighted row
  `bg-selected` + `fg`; the matched part of a label is 600 `fg` ("**Sandbox** — Active Chat").
- Groups in board order: Go to · Actions · Recent chats. Actions starts with the board's four: New chat, New workflow,
  Toggle theme ("Dark → Light" / "Light → Dark" from the live appearance), Open settings.
- Recent chats: chat glyph, name, project (when the chat has one), `Needs you` / `Running` StatusBadge from the attention feed.
- Footer 32h `raised`, top rule: ↑ ↓ Navigate · ↵ Open · Tab Actions · Esc Close (Esc pushed right); keys come from the
  registry's `palette.*` entries.

## Intentional deviations
- **No entity-match group** ("Workflows › Run “Nightly dependency audit”", "Automations › Nightly audit"): entity search is
  P5-12 (G-18); D-36 — not rendered until the endpoint exists. The empty query therefore lists every destination and action.
- **Hints follow the host (D-24):** a browser tab shows sequences ("G then C", "N", "⇧ N"); the board's `Ctrl 4` / `Ctrl N`
  are the desktop Windows/Linux bindings, which the desktop app shows. Section order/numbers follow D-22 (Workflows is
  `Ctrl 5` on desktop, not the board's `Ctrl 4`). A sequence renders one Kbd per chord with "then" between them.
- **More actions than the board:** every `palette: true` registry command is listed (New project/automation/agent, Toggle
  sidebar, Toggle side dock, Keyboard shortcuts — the legacy palette's shortcuts-sheet entry — Reload scripts); the list scrolls.
- **Icons come from the registry:** New chat uses the registry's `plus` (board: pencil); Toggle theme shows the current
  mode's glyph (moon in dark, sun in light).
- **Secondary text on the highlighted row is `fg-2`, not `fg-3`:** `fg-3` on `selected` measures 3.9:1 (axe fails it);
  meta and the "then" between chords switch to `fg-2` while the row is highlighted.
- **Recent chat badges:** only the live states (Needs you, Running); the board's elapsed timer on Running needs B-25
  `palette-recent` (P5). No invented rows: with no chats the group shows a disabled "No recent chats" note.
- **Tab actions (not drawn on the board):** Go to rows — Open · Open in new tab · Copy link (browser tab only; on desktop a
  lone Open is no list, so Tab does nothing); recent chats — the same plus Archive (all hosts). Esc / Shift+Tab /
  Backspace on an empty query go back to the results with the query restored; footer reads ↑ ↓ Navigate · ↵ Run · Esc Back.

## Defects
- None found in the palette. Verified by hand: Mod+K opens from the page body, from a text input and from the chat composer
  textarea (D-46 `firesInEditable`; the K is not typed into the field); arrows move across groups; Enter on a Go to row
  navigates; Tab lists a chat's actions and Enter on Open navigates to it; Toggle theme flips dark ↔ light; Escape closes and
  returns focus to the field that had it (text preserved). No console errors.

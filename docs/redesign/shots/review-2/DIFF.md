# Final review 2 — board comparison (2026-10-03)

App: isolated seeded sandbox (:3397/:5397, Faux harness), Instrument dark, ink accent, 1440×900 unless noted.
Compares: `compare-ChatsList.png`, `compare-Home.png`, `compare-SettingsSecurity.png` (PNGs gitignored; regenerate
with `node scripts/redesign/side-by-side.mjs --board=<Board> --mode=dark --shot=<shot>`). Extra shots: Chats at
1100×760 dark/light, Instrument light and Solarized light at 1440×900, the chats row menu, a chat with its gate.

## ChatsList

- **Matches:** header, title + count, search, All/Active/Archived seg with counts, filter chips, sort chip, table
  columns and widths, status badges, dash for no project/agent/changes, footnote under the table, row actions on hover.
- **Intentional deviations:** pin glyph after a pinned chat's title and an accent unread dot (title semibold) — MG-02
  data the board predates (D-83). Row menu: Pin/Unpin and Mark as read/unread above Archive/Delete.
- **Defects:** none. Seed data differs (3 chats against the board's 48).

## Home

- **Matches:** date line, headline, composer card, Needs-you card with Open + Allow once, This week, System card,
  entity counts.
- **Intentional deviations:** a neutral "Risky" badge before the actions of a risky permission ask (MG-04, D-83; shot
  taken with the feed's verdict set to risky). Recently finished reads "PR #n opened" / "committed to <branch>" when
  the workspace ran the SCM flow (MG-13) — the seed has no finished items, so the section is hidden (D-36).
- **Defects:** none. Seed differences (no running items, no finished items, 3 chats).

## SettingsSecurity

- **Matches:** modal frame, nav, Servers table, This server rows, Network exposure seg and the env-pinned note.
- **Intentional deviations:** one column (first review #16, D-74/P6-04). Scope rows use the shared vocabulary (MG-23):
  every sensitive scope (each `exec:*` but `exec:agent`, each `admin:*`) carries the warning glyph and is confirmed —
  the board marks only Terminal. The sandbox runs without authentication, so no paired devices or requests render.
- **Defects:** none.

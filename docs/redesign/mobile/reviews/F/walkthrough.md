# Batch F — walkthrough of every screen family (merge-readiness §4 step 5, MV-28…MV-32)

Driver: a link walk over 32 routes (Home, Needs you, Chats, a chat with its Changes / Files pane, New chat, Projects
and a project, Agents and an agent, Workflows, a workflow, a run, its graph, the run sheet, Automations and an
automation, Scripts, Search, Servers, Settings and eleven sections), one `simctl io screenshot` each, plus the
screens the Maestro suite and the surface checks drove. Screenshots: `docs/redesign/shots/mobile/F/walkthrough/`.

## iOS 27 — gai-iphone, Instrument dark

All 32 routes render with real sandbox data. Defects found and fixed during the walk and the suite (commits in
maestro.md): blank run / workflow graphs, header title "settings/index" / "index" after a link, Turn sheet and editor
stacks restored on cold start, invisible toasts and sheets over editors, the wizard's sticky bar under the stepper,
squeezed agent name, raw JSON in the sidebar's Needs-you hints, a string header subtitle crashing workflow settings,
agent detail's admin-only capability preview (403 card) and New workflow's Create without `write:workflows` (c84d754a).

Open findings (owner):

| Finding | Where | Evidence |
|---|---|---|
| A short user message wraps mid-word ("Agai" / "n") | chat transcript, user bubble | `ios-phone-dark/chat.png`; not the `selectable` prop (checked); likely Fabric text measurement with the bubble's `items-end` + `maxWidth` |
| Locked rows squeeze their title to three lines ("Switch / and add / servers") | Settings › MCP, Model providers | `ios-phone-dark/settings-mcp.png`, `settings-providers.png` |
| Sticky footers keep their pre-keyboard accessibility frame | New chat, wizard, run sheet | MD-198 finding |

Light appearance: the app's own Appearance mode was set to Dark, so a system-light pass stays dark; the light pass is
re-run through `generatorai:///theme?mode=light` (below).

## iPadOS 27 — gai-ipad (portrait), Instrument dark and light

Paired with `sandbox-pair pair --udid=…` (first try). Both appearances set through `generatorai:///theme?mode=…`;
32 routes each (`ios-ipad-dark/`, `ios-ipad-light/`). Persistent sidebar with the live Needs-you list, module roots,
sheets as centred form sheets, the run graph and run sheet render correctly in both appearances.

| Observation | Notes |
|---|---|
| Some captures show the previous screen | the iPad simulator ran next to the VRT run and took 5–10 s per link; re-checked by hand (`/chats`, `/settings`, a chat): each lands correctly |
| Chat with the pane open is three columns at 1032 pt (sidebar + main + docked pane); the main column gets ~370 pt and the header title truncates | as specified (expanded ≥ 840: persistent sidebar + docked pane, `adaptiveModel.ts`); design call for the owner: dock only when the main column keeps ≥ 600 pt, or hide the sidebar while the pane is docked |

Not run on the iPad: hardware-keyboard shortcuts and rotation with a live terminal (MV-28; the terminal tab needs the
step-up the simulator cannot satisfy).

## Android 16 — gai-phone (emulator), Instrument dark and light

Same 32-route link walk over adb (`android-phone-dark/`, `android-phone-light/`). Every route renders with sandbox data
in both appearances after the fixes found here: pane tabs and TabRow filled the screen (464331ba, 8f0eb45a), so the
Changes / Files / Terminal / Browser panes and the project / PR / stage-editor tabs had no body.

| Finding | Where | Notes |
|---|---|---|
| The app renders an empty root after the scripted walk passes the New chat link (Back then leaves the app) | twice, in the 32-link walk at 4 s per link | not reproduced in shorter link sequences; the walk was finished in two halves from a fresh start. Owner: likely the same family as the New chat → chat Fabric crash (maestro.md) |
| Diagnostics' DSN field spans the full width (no side gutter) | Settings › Diagnostics › Crash reports | `android/crash-dsn.png`; the Input is `presentation="standalone"` outside a padded group |
| A just-opened chat restores its open pane (the pane covers the transcript on a phone) | chat by link | expected from the remembered pane state, worth a design glance on phones |

Not run: gai-tablet (the AVD is configured but has never been booted — a second emulator did not fit next to the phone in 8 GB RAM and ~7 GB free disk; MV-28), hardware keyboard, rotation with a live terminal.

# Composer (P4-08) — running app vs ComposerStates / ComposerModelPicker / AgentPickerBoard

Isolated stack (bundle server :3511, temp `generatorai-p408-*` DB, Faux harness with
`agent-tests/e2e/fixtures/faux-composer-changes.json`, Vite :5511), headed Chrome via
playwright-cli. Screenshots (gitignored, `*.png` here): `<state>.<theme>.<width>.png`,
themes `dark` (Instrument dark), `instrument-light`, `solarized-light`; widths 1440 and 1100.
Per the owner's "build fast" override this is one short summary, not a section per state.

| Board panel | Reached for real | Shot | Result |
|---|---|---|---|
| Idle · no agent | yes | idle, binding-* | Matches: raised 12-radius box, toolbar `+ · model · mode · effort · (tier) · gauge`, mic + square Send, meta row (Sources chip, Skills·MCP), key-hint row. |
| Typing | yes | typing | Matches; Send turns accent. |
| Binding · worker agent | yes | binding-worker-agent (3 themes, 1100) | Matches: agent chip with lock, `payments-api fix/checkout-flake +1`, `0 skills · 0 MCP` (from the agent snapshot). |
| Binding · orchestrate, no agent | yes | binding-orchestrate | "Orchestrating" chip (running count only when workers run). |
| Binding · orchestrator agent | yes | binding-orchestrator-agent | Team row: avatars + "Orchestrate mode is enabled by this agent". |
| Per-turn menus (mode, effort) | yes | menu-mode (3 themes), menu-effort | Matches (256 / 176 wide, check column, descriptions). Tier menu: the catalog models here have no long tier — covered by stories + characterization. |
| Gauge popover | empty state only | gauge-popover-empty | "Context usage appears here after the model responds." Filled popover: story `GaugePopover`. |
| `/` menu | yes | slash-menu (3 themes) | Matches: header + count, Tools / Skills / Prompts groups, badges, "Then: …" hint footer. |
| `@` menu | yes | mention-menu | Matches: name + mono path + mount badge, "↵ Attach contents · Esc Close". |
| Attachments | yes (file, image, @ file) | attachments, attachments-image-preview | Matches incl. image hover preview. Capture (filled) chip: story only (needs a browser capture). |
| Waiting on you | yes | waiting-on-you (3 themes) | Matches: warn bar + "Cancel and send"; Send is Stop. |
| Running → Stop → Stopping… | yes | running, stopping, after-stop-16s | Matches. Force reset after 15 s NOT reachable: the Faux provider stops gracefully; covered by ChatComposer.stop + story `PrimaryControl`. |
| Preparing / Preparation failed | no | — | The server validates sources up front (a branch checked out elsewhere is a 400 at create); covered by characterization + story `BlockingBars`. |
| Sources popover | yes | sources-popover | Matches (mount card, mode badge, branch, path + copy, footnote). |
| Model picker (ComposerModelPicker) | yes | model-picker (3 themes) | Matches: provider column ready-first with "Not signed in" / "Not installed", tiers Fast/Balanced/Powerful, detail pane, key footer. |
| Agent picker (AgentPickerBoard) | via New chat dialog | — | Built as B-02 and swapped into CreateChatDialog; not screenshotted in this pass. |

**Intentional deviations**
- Typing is no longer disabled while a turn runs (D-29): the page used to pass `disabled` during
  every turn ("Waiting for response…"), contradicting ComposerStates' "typing is never blocked".
- The key-hint row wraps under the meta row when the Sources label is long (board keeps one row).
- Tools-in-this-chat (+) toggles render nothing: no per-chat platform-tool storage is honoured
  mid-conversation yet (D-36); the registry is in place for the Workflow Overhaul.
- The changes tray above the box is still the legacy `ChatChangesTray` (owned by the Changes work).

**Defects found** — none open; fixed during the pass: toolbar chip glyphs stacked (kit Button wraps
children in one span), gauge ring/label misaligned, Sources label without a gap.

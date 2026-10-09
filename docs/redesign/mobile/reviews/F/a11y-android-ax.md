# Accessibility audit — android (gai-phone), text size accessibility-extra-extra-extra-large

2026-10-04T11:56:03.078Z · d5740738 · `node scripts/mobile/a11y-audit.mjs` (agent-device snapshot → `e2e/a11y-check.mjs`).
Errors 33 · warnings 3 · allowed 0.

| Route | Result | Rule | Selector | Finding |
|---|---|---|---|---|
| Home | error | role | id="home-subtitle" | Interactive control has no meaningful role |
| Home | warning | status | label="Running" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Home | warning | status | label="Needs you" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Home | error | role | @e67 | Interactive control has no meaningful role |
| Home | error | label | @e70 | Interactive control has no accessible label |
| Needs you | warning | status | label="Needs you" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Chats | error | label | @e50 | Interactive control has no accessible label |
| Chats | error | role | label="Bug Fixer" | Interactive control has no meaningful role |
| Chats | error | role | label="Bug Fixer" | Interactive control has no meaningful role |
| Chats | error | role | @e108 | Interactive control has no meaningful role |
| Chats | error | label | @e111 | Interactive control has no accessible label |
| Projects | error | label | @e50 | Interactive control has no accessible label |
| Projects | error | role | @e82 | Interactive control has no meaningful role |
| Projects | error | label | @e85 | Interactive control has no accessible label |
| Agents | error | label | @e50 | Interactive control has no accessible label |
| Agents | error | target | id="agent-row-delivery-lead" | Control frame 411.4×3.4 is below 48×48 dp |
| Workflows | error | label | @e44 | Interactive control has no accessible label |
| Workflows | error | role | @e82 | Interactive control has no meaningful role |
| Workflows | error | label | @e85 | Interactive control has no accessible label |
| Automations | error | role | @e43 | Interactive control has no meaningful role |
| Automations | error | label | @e46 | Interactive control has no accessible label |
| Automations | error | label | @e51 | Interactive control has no accessible label |
| Automations | error | label | @e73 | Interactive control has no accessible label |
| Automations | error | role | @e73 | Interactive control has no meaningful role |
| Automations | error | target | id="automation-switch-ae7b3f82-533a-431d-baf8-56bbead0b3e6" | Control frame 52.2×23.2 is below 48×48 dp |
| Automations | error | label | @e87 | Interactive control has no accessible label |
| Automations | error | role | @e87 | Interactive control has no meaningful role |
| Automations | error | target | @e87 | Control frame 52.2×23.2 is below 48×48 dp |
| Scripts | clean | | | |
| Search | clean | | | |
| Settings | error | role | label="Siddharths-MacBook-Air.local, 10.0.2.2:3197, Connected" | Interactive control has no meaningful role |
| Settings | error | label | @e47 | Interactive control has no accessible label |
| Settings › General | error | target | id="general-default-provider" | Control frame 411.4×17.1 is below 48×48 dp |
| Settings › Appearance | clean | | | |
| Settings › Security & devices | not audited | — | — | agent-device wait failed (COMMAND_FAILED; diagnostic mutriftz-e60c459d); inspect its session log |
| Settings › Notifications | not audited | — | — | agent-device wait failed (COMMAND_FAILED; diagnostic mutrj3wl-51e47e2f); inspect its session log |
| Settings › App lock & privacy | not audited | — | — | agent-device wait failed (COMMAND_FAILED; diagnostic mutrjrsh-b4ff49b7); inspect its session log |
| Settings › Widgets | not audited | — | — | agent-device wait failed (COMMAND_FAILED; diagnostic mutrkfd3-929dd484); inspect its session log |
| New workflow | not audited | — | — | agent-device wait failed (COMMAND_FAILED; diagnostic mutrl2xm-f662fdfb); inspect its session log |

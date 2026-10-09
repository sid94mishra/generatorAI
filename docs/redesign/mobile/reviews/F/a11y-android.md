# Accessibility audit — android (gai-phone), text size large

2026-10-04T11:52:07.547Z · d5740738 · `node scripts/mobile/a11y-audit.mjs` (agent-device snapshot → `e2e/a11y-check.mjs`).
Errors 86 · warnings 5 · allowed 0.

| Route | Result | Rule | Selector | Finding |
|---|---|---|---|---|
| Home | error | role | id="home-subtitle" | Interactive control has no meaningful role |
| Home | error | target | id="home-subtitle" | Control frame 379.4×20.2 is below 48×48 dp |
| Home | warning | status | label="Running" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Home | warning | status | label="Needs you" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Home | warning | status | label="Running" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Home | error | role | label="Loading, busy" | Interactive control has no meaningful role |
| Home | error | role | @e80 | Interactive control has no meaningful role |
| Home | error | label | @e83 | Interactive control has no accessible label |
| Needs you | error | target | label="Home" | Control frame 34.7×16.0 is below 48×48 dp |
| Needs you | warning | status | label="Needs you" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Chats | error | label | @e53 | Interactive control has no accessible label |
| Chats | error | role | label="Bug Fixer" | Interactive control has no meaningful role |
| Chats | error | target | label="Bug Fixer" | Control frame 82.3×20.2 is below 48×48 dp |
| Chats | error | role | label="Bug Fixer" | Interactive control has no meaningful role |
| Chats | error | target | label="Bug Fixer" | Control frame 82.3×20.2 is below 48×48 dp |
| Chats | error | role | label="Bug Fixer" | Interactive control has no meaningful role |
| Chats | error | target | label="Bug Fixer" | Control frame 82.3×20.2 is below 48×48 dp |
| Chats | error | role | label="Bug Fixer" | Interactive control has no meaningful role |
| Chats | error | target | label="Bug Fixer" | Control frame 82.3×20.2 is below 48×48 dp |
| Chats | error | role | label="Bug Fixer" | Interactive control has no meaningful role |
| Chats | error | target | label="Bug Fixer" | Control frame 82.3×20.2 is below 48×48 dp |
| Chats | error | role | label="Bug Fixer" | Interactive control has no meaningful role |
| Chats | error | target | label="Bug Fixer" | Control frame 82.3×20.2 is below 48×48 dp |
| Chats | error | target | id="chat-row-26a4a24e-3b71-4ee2-a2e7-6bcf85566380" | Control frame 411.4×33.1 is below 48×48 dp |
| Chats | error | role | @e189 | Interactive control has no meaningful role |
| Chats | error | label | @e192 | Interactive control has no accessible label |
| Projects | error | label | @e51 | Interactive control has no accessible label |
| Projects | error | target | id="project-row-93968f17-723c-44ed-820e-8553cb4564c1" | Control frame 411.4×6.5 is below 48×48 dp |
| Projects | error | role | @e133 | Interactive control has no meaningful role |
| Projects | error | label | @e136 | Interactive control has no accessible label |
| Agents | error | label | @e51 | Interactive control has no accessible label |
| Agents | error | target | id="agent-row-security-auditor" | Control frame 411.4×36.2 is below 48×48 dp |
| Workflows | error | label | @e45 | Interactive control has no accessible label |
| Workflows | error | role | @e89 | Interactive control has no meaningful role |
| Workflows | error | label | @e92 | Interactive control has no accessible label |
| Automations | error | label | @e43 | Interactive control has no accessible label |
| Automations | error | label | @e71 | Interactive control has no accessible label |
| Automations | error | role | @e71 | Interactive control has no meaningful role |
| Automations | error | label | @e85 | Interactive control has no accessible label |
| Automations | error | role | @e85 | Interactive control has no meaningful role |
| Automations | error | label | @e99 | Interactive control has no accessible label |
| Automations | error | role | @e99 | Interactive control has no meaningful role |
| Automations | error | label | @e113 | Interactive control has no accessible label |
| Automations | error | role | @e113 | Interactive control has no meaningful role |
| Automations | error | role | @e121 | Interactive control has no meaningful role |
| Automations | error | label | @e124 | Interactive control has no accessible label |
| Scripts | clean | | | |
| Search | warning | duplicate | id="search-row-nav:chats" | Interactive siblings share the same role and label |
| Search | error | target | id="search-row-nav:workflows" | Control frame 411.4×41.5 is below 48×48 dp |
| Settings | error | role | label="Siddharths-MacBook-Air.local, 10.0.2.2:3197, Connected" | Interactive control has no meaningful role |
| Settings | error | label | @e49 | Interactive control has no accessible label |
| Settings | error | label | @e79 | Interactive control has no accessible label |
| Settings | error | role | @e79 | Interactive control has no meaningful role |
| Settings | error | target | id="settings-skills" | Control frame 411.4×28.2 is below 48×48 dp |
| Settings › General | error | target | label="Settings" | Control frame 48.0×16.0 is below 48×48 dp |
| Settings › Appearance | error | target | label="Settings" | Control frame 48.0×16.0 is below 48×48 dp |
| Settings › Appearance | error | role | id="appearance-text-size" | Interactive control has no meaningful role |
| Settings › Appearance | error | target | id="appearance-text-size" | Control frame 411.4×21.7 is below 48×48 dp |
| Settings › Security & devices | error | target | label="Settings" | Control frame 48.0×16.0 is below 48×48 dp |
| Settings › Security & devices | error | role | id="security-approval-key" | Interactive control has no meaningful role |
| Settings › Security & devices | error | role | label="Key protection, This device has no secure element, Software" | Interactive control has no meaningful role |
| Settings › Security & devices | error | role | id="security-server-current" | Interactive control has no meaningful role |
| Settings › Security & devices | error | role | label="Exposure, Loopback only" | Interactive control has no meaningful role |
| Settings › Notifications | error | target | label="Settings" | Control frame 48.0×16.0 is below 48×48 dp |
| Settings › Notifications | error | label | @e67 | Interactive control has no accessible label |
| Settings › Notifications | error | role | @e67 | Interactive control has no meaningful role |
| Settings › Notifications | error | label | @e78 | Interactive control has no accessible label |
| Settings › Notifications | error | role | @e78 | Interactive control has no meaningful role |
| Settings › Notifications | error | label | @e89 | Interactive control has no accessible label |
| Settings › Notifications | error | role | @e89 | Interactive control has no meaningful role |
| Settings › Notifications | error | target | id="notifications-system" | Control frame 411.4×24.8 is below 48×48 dp |
| Settings › App lock & privacy | error | target | label="Settings" | Control frame 48.0×16.0 is below 48×48 dp |
| Settings › App lock & privacy | error | label | @e53 | Interactive control has no accessible label |
| Settings › App lock & privacy | error | role | @e53 | Interactive control has no meaningful role |
| Settings › App lock & privacy | error | role | label="Risky approvals, Shell, network and push permissions; workflow approvals, Every time" | Interactive control has no meaningful role |
| Settings › App lock & privacy | error | role | label="Terminal, browser and computer use, Opening the tab or turning it on, Every 10 min" | Interactive control has no meaningful role |
| Settings › App lock & privacy | error | role | label="Pairing, revoking and server settings, Each change, Every time" | Interactive control has no meaningful role |
| Settings › App lock & privacy | error | role | label="Ordinary approvals, Allow once, answers, plans, Unlocked phone" | Interactive control has no meaningful role |
| Settings › App lock & privacy | error | label | @e92 | Interactive control has no accessible label |
| Settings › App lock & privacy | error | role | @e92 | Interactive control has no meaningful role |
| Settings › App lock & privacy | error | role | id="app-lock-hide-previews" | Interactive control has no meaningful role |
| Settings › App lock & privacy | error | target | id="app-lock-hide-previews" | Control frame 411.4×32.8 is below 48×48 dp |
| Settings › Widgets | error | target | label="Settings" | Control frame 48.0×16.0 is below 48×48 dp |
| Settings › Widgets | error | label | @e53 | Interactive control has no accessible label |
| Settings › Widgets | error | role | @e53 | Interactive control has no meaningful role |
| Settings › Widgets | error | label | @e64 | Interactive control has no accessible label |
| Settings › Widgets | error | role | @e64 | Interactive control has no meaningful role |
| Settings › Widgets | error | role | label="Ordinary approvals, Needs unlock" | Interactive control has no meaningful role |
| Settings › Widgets | error | role | label="Risky approvals, Open the app" | Interactive control has no meaningful role |
| New workflow | error | label | @e57 | Interactive control has no accessible label |
| New workflow | error | role | label="Loading, busy" | Interactive control has no meaningful role |
| New workflow | error | target | id="workflow-new-name" | Control frame 345.9×41.5 is below 48×48 dp |

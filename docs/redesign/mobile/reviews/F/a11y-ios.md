# Accessibility audit — ios (gai-iphone), text size large

2026-10-03T22:54:41.203Z · 5674eb52 · `node scripts/mobile/a11y-audit.mjs` (agent-device snapshot → `e2e/a11y-check.mjs`).
Errors 104 · warnings 39 · allowed 0.

| Route | Result | Rule | Selector | Finding |
|---|---|---|---|---|
| Home | error | target | label="Open sidebar" | Control frame 36.0×36.0 is below 44×44 pt |
| Home | error | target | label="Search" | Control frame 36.0×36.0 is below 44×44 pt |
| Home | warning | status | label="Needs you" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Home | warning | status | label="Needs you" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Home | warning | duplicate | id="home-needs-chat:32ef027e-daf0-442a-8e78-8885a2a97c8a:7b0787f7-8855-4731-b491-5b3701f69d5b" | Interactive siblings share the same role and label |
| Home | warning | duplicate | id="home-needs-chat:9bda1972-69d6-4153-858a-1d487d0d4f53:0565f09b-d125-45c1-95d9-1e269165793c" | Interactive siblings share the same role and label |
| Home | warning | duplicate | id="home-needs-chat:daf69577-dbcd-4c95-a432-869165344867:465a027d-7dbb-4f3b-b38d-9c2b89e8d27e" | Interactive siblings share the same role and label |
| Needs you | error | target | label="Back to Home" | Control frame 38.1×37.1 is below 44×44 pt |
| Needs you | warning | status | label="Needs you" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Needs you | warning | status | label="Needs you" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Needs you | warning | status | label="Needs you" | Status word has no detectable glyph sibling; verify glyph + word visually |
| Needs you | warning | duplicate | id="home-needs-chat:32ef027e-daf0-442a-8e78-8885a2a97c8a:7b0787f7-8855-4731-b491-5b3701f69d5b" | Interactive siblings share the same role and label |
| Needs you | warning | duplicate | id="home-needs-chat:9bda1972-69d6-4153-858a-1d487d0d4f53:0565f09b-d125-45c1-95d9-1e269165793c" | Interactive siblings share the same role and label |
| Needs you | warning | duplicate | id="home-needs-chat:daf69577-dbcd-4c95-a432-869165344867:465a027d-7dbb-4f3b-b38d-9c2b89e8d27e" | Interactive siblings share the same role and label |
| Needs you | warning | duplicate | id="needs-you-chat:daf69577-dbcd-4c95-a432-869165344867:465a027d-7dbb-4f3b-b38d-9c2b89e8d27e" | Interactive siblings share the same role and label |
| Chats | error | target | label="Open sidebar" | Control frame 38.1×37.1 is below 44×44 pt |
| Chats | error | target | label="Select" | Control frame 41.3×36.0 is below 44×44 pt |
| Chats | error | target | label="Sort and more" | Control frame 44.6×36.0 is below 44×44 pt |
| Projects | error | target | label="Open sidebar" | Control frame 36.0×36.0 is below 44×44 pt |
| Projects | error | target | label="Sort" | Control frame 36.0×36.0 is below 44×44 pt |
| Agents | error | target | label="Open sidebar" | Control frame 36.0×36.0 is below 44×44 pt |
| Agents | error | target | label="Sort" | Control frame 36.0×36.0 is below 44×44 pt |
| Agents | error | target | label="Role, Any" | Control frame 69.3×34.3 is below 44×44 pt |
| Workflows | error | target | label="Open sidebar" | Control frame 36.0×36.0 is below 44×44 pt |
| Workflows | error | target | label="Sort" | Control frame 36.2×36.2 is below 44×44 pt |
| Workflows | error | label | @e54 | Interactive control has no accessible label |
| Automations | error | target | label="Open sidebar" | Control frame 36.0×36.0 is below 44×44 pt |
| Scripts | error | target | label="Open sidebar" | Control frame 36.0×36.0 is below 44×44 pt |
| Scripts | error | target | label="Reload scripts" | Control frame 36.0×36.0 is below 44×44 pt |
| Search | warning | duplicate | id="search-row-chat:c518114c-98fe-4799-b643-e42b1bc275a9" | Interactive siblings share the same role and label |
| Search | warning | duplicate | id="search-row-chat:2f5703e0-c9e7-4efe-a27c-da2c35a80de2" | Interactive siblings share the same role and label |
| Search | error | label | @e73 | Interactive control has no accessible label |
| Search | error | label | @e79 | Interactive control has no accessible label |
| Search | error | label | @e80 | Interactive control has no accessible label |
| Search | error | label | @e81 | Interactive control has no accessible label |
| Search | error | label | @e82 | Interactive control has no accessible label |
| Search | warning | duplicate | id="dictation" | Interactive siblings share the same role and label |
| Settings | warning | duplicate | id="search-row-chat:c518114c-98fe-4799-b643-e42b1bc275a9" | Interactive siblings share the same role and label |
| Settings | warning | duplicate | id="search-row-chat:2f5703e0-c9e7-4efe-a27c-da2c35a80de2" | Interactive siblings share the same role and label |
| Settings | warning | image-label | @e61 | Accessible image has no label |
| Settings | error | target | label="Open sidebar" | Control frame 36.0×36.0 is below 44×44 pt |
| Settings › General | warning | duplicate | id="search-row-chat:c518114c-98fe-4799-b643-e42b1bc275a9" | Interactive siblings share the same role and label |
| Settings › General | warning | duplicate | id="search-row-chat:2f5703e0-c9e7-4efe-a27c-da2c35a80de2" | Interactive siblings share the same role and label |
| Settings › General | warning | image-label | @e61 | Accessible image has no label |
| Settings › General | error | target | label="Open sidebar" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › General | error | target | id="settings-switch-server" | Control frame 95.1×40.5 is below 44×44 pt |
| Settings › General | error | target | id="settings-search" | Control frame 301.9×40.5 is below 44×44 pt |
| Settings › General | error | target | label="Back to Settings" | Control frame 36.0×36.0 is below 44×44 pt |
| Settings › Appearance | warning | duplicate | id="search-row-chat:c518114c-98fe-4799-b643-e42b1bc275a9" | Interactive siblings share the same role and label |
| Settings › Appearance | warning | duplicate | id="search-row-chat:2f5703e0-c9e7-4efe-a27c-da2c35a80de2" | Interactive siblings share the same role and label |
| Settings › Appearance | warning | image-label | @e61 | Accessible image has no label |
| Settings › Appearance | error | target | label="Open sidebar" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Appearance | error | target | id="settings-switch-server" | Control frame 95.1×40.5 is below 44×44 pt |
| Settings › Appearance | error | target | id="settings-search" | Control frame 301.9×40.5 is below 44×44 pt |
| Settings › Appearance | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Appearance | error | target | label="Back to Settings" | Control frame 36.0×36.0 is below 44×44 pt |
| Settings › Appearance | error | target | label="Reduce motion, System" | Control frame 97.0×34.3 is below 44×44 pt |
| Settings › Appearance | error | target | label="Reduce transparency, System" | Control frame 97.0×34.3 is below 44×44 pt |
| Settings › Security & devices | warning | duplicate | id="search-row-chat:c518114c-98fe-4799-b643-e42b1bc275a9" | Interactive siblings share the same role and label |
| Settings › Security & devices | warning | duplicate | id="search-row-chat:2f5703e0-c9e7-4efe-a27c-da2c35a80de2" | Interactive siblings share the same role and label |
| Settings › Security & devices | warning | image-label | @e61 | Accessible image has no label |
| Settings › Security & devices | error | target | label="Open sidebar" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Security & devices | error | target | id="settings-switch-server" | Control frame 95.1×40.5 is below 44×44 pt |
| Settings › Security & devices | error | target | id="settings-search" | Control frame 301.9×40.5 is below 44×44 pt |
| Settings › Security & devices | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Security & devices | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Security & devices | error | target | label="Reduce motion, System" | Control frame 89.3×31.6 is below 44×44 pt |
| Settings › Security & devices | error | target | label="Reduce transparency, System" | Control frame 89.3×31.6 is below 44×44 pt |
| Settings › Security & devices | error | target | label="Back to Settings" | Control frame 36.0×36.0 is below 44×44 pt |
| Settings › Notifications | warning | duplicate | id="search-row-chat:c518114c-98fe-4799-b643-e42b1bc275a9" | Interactive siblings share the same role and label |
| Settings › Notifications | warning | duplicate | id="search-row-chat:2f5703e0-c9e7-4efe-a27c-da2c35a80de2" | Interactive siblings share the same role and label |
| Settings › Notifications | warning | image-label | @e61 | Accessible image has no label |
| Settings › Notifications | error | target | label="Open sidebar" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Notifications | error | target | id="settings-switch-server" | Control frame 95.1×40.5 is below 44×44 pt |
| Settings › Notifications | error | target | id="settings-search" | Control frame 301.9×40.5 is below 44×44 pt |
| Settings › Notifications | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Notifications | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Notifications | error | target | label="Reduce motion, System" | Control frame 89.3×31.6 is below 44×44 pt |
| Settings › Notifications | error | target | label="Reduce transparency, System" | Control frame 89.3×31.6 is below 44×44 pt |
| Settings › Notifications | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Notifications | error | target | id="security-approval-register" | Control frame 82.5×40.5 is below 44×44 pt |
| Settings › Notifications | error | target | label="Add server" | Control frame 86.8×40.5 is below 44×44 pt |
| Settings › Notifications | error | target | label="Back to Settings" | Control frame 36.0×36.0 is below 44×44 pt |
| Settings › Notifications | error | target | label="Pause notifications, Off" | Control frame 64.7×34.3 is below 44×44 pt |
| Settings › App lock & privacy | warning | duplicate | id="search-row-chat:c518114c-98fe-4799-b643-e42b1bc275a9" | Interactive siblings share the same role and label |
| Settings › App lock & privacy | warning | duplicate | id="search-row-chat:2f5703e0-c9e7-4efe-a27c-da2c35a80de2" | Interactive siblings share the same role and label |
| Settings › App lock & privacy | warning | image-label | @e61 | Accessible image has no label |
| Settings › App lock & privacy | error | target | label="Open sidebar" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › App lock & privacy | error | target | id="settings-switch-server" | Control frame 95.1×40.5 is below 44×44 pt |
| Settings › App lock & privacy | error | target | id="settings-search" | Control frame 301.9×40.5 is below 44×44 pt |
| Settings › App lock & privacy | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › App lock & privacy | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › App lock & privacy | error | target | label="Reduce motion, System" | Control frame 89.3×31.6 is below 44×44 pt |
| Settings › App lock & privacy | error | target | label="Reduce transparency, System" | Control frame 89.3×31.6 is below 44×44 pt |
| Settings › App lock & privacy | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › App lock & privacy | error | target | id="security-approval-register" | Control frame 82.5×40.5 is below 44×44 pt |
| Settings › App lock & privacy | error | target | label="Add server" | Control frame 86.8×40.5 is below 44×44 pt |
| Settings › App lock & privacy | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › App lock & privacy | error | target | label="Allow" | Control frame 71.8×40.5 is below 44×44 pt |
| Settings › App lock & privacy | error | target | label="Pause notifications, Off" | Control frame 59.5×31.6 is below 44×44 pt |
| Settings › App lock & privacy | error | target | label="Back to Settings" | Control frame 36.0×36.0 is below 44×44 pt |
| Settings › App lock & privacy | error | target | label="Lock after leaving, 1 minute" | Control frame 104.3×34.3 is below 44×44 pt |
| Settings › Widgets | warning | duplicate | id="search-row-chat:c518114c-98fe-4799-b643-e42b1bc275a9" | Interactive siblings share the same role and label |
| Settings › Widgets | warning | duplicate | id="search-row-chat:2f5703e0-c9e7-4efe-a27c-da2c35a80de2" | Interactive siblings share the same role and label |
| Settings › Widgets | warning | image-label | @e61 | Accessible image has no label |
| Settings › Widgets | error | target | label="Open sidebar" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Widgets | error | target | id="settings-switch-server" | Control frame 95.1×40.5 is below 44×44 pt |
| Settings › Widgets | error | target | id="settings-search" | Control frame 301.9×40.5 is below 44×44 pt |
| Settings › Widgets | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Widgets | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Widgets | error | target | label="Reduce motion, System" | Control frame 89.3×31.6 is below 44×44 pt |
| Settings › Widgets | error | target | label="Reduce transparency, System" | Control frame 89.3×31.6 is below 44×44 pt |
| Settings › Widgets | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Widgets | error | target | id="security-approval-register" | Control frame 82.5×40.5 is below 44×44 pt |
| Settings › Widgets | error | target | label="Add server" | Control frame 86.8×40.5 is below 44×44 pt |
| Settings › Widgets | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Widgets | error | target | label="Allow" | Control frame 71.8×40.5 is below 44×44 pt |
| Settings › Widgets | error | target | label="Pause notifications, Off" | Control frame 59.5×31.6 is below 44×44 pt |
| Settings › Widgets | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| Settings › Widgets | error | target | label="Lock after leaving, 1 minute" | Control frame 96.0×31.6 is below 44×44 pt |
| Settings › Widgets | error | target | label="Back to Settings" | Control frame 36.0×36.0 is below 44×44 pt |
| New workflow | warning | duplicate | id="search-row-chat:c518114c-98fe-4799-b643-e42b1bc275a9" | Interactive siblings share the same role and label |
| New workflow | warning | duplicate | id="search-row-chat:2f5703e0-c9e7-4efe-a27c-da2c35a80de2" | Interactive siblings share the same role and label |
| New workflow | warning | image-label | @e61 | Accessible image has no label |
| New workflow | error | target | label="Open sidebar" | Control frame 33.1×33.1 is below 44×44 pt |
| New workflow | error | target | id="settings-switch-server" | Control frame 95.1×40.5 is below 44×44 pt |
| New workflow | error | target | id="settings-search" | Control frame 301.9×40.5 is below 44×44 pt |
| New workflow | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| New workflow | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| New workflow | error | target | label="Reduce motion, System" | Control frame 89.3×31.6 is below 44×44 pt |
| New workflow | error | target | label="Reduce transparency, System" | Control frame 89.3×31.6 is below 44×44 pt |
| New workflow | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| New workflow | error | target | id="security-approval-register" | Control frame 82.5×40.5 is below 44×44 pt |
| New workflow | error | target | label="Add server" | Control frame 86.8×40.5 is below 44×44 pt |
| New workflow | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| New workflow | error | target | label="Allow" | Control frame 71.8×40.5 is below 44×44 pt |
| New workflow | error | target | label="Pause notifications, Off" | Control frame 59.5×31.6 is below 44×44 pt |
| New workflow | error | target | label="Back to Settings" | Control frame 33.1×33.1 is below 44×44 pt |
| New workflow | error | target | label="Lock after leaving, 1 minute" | Control frame 96.0×31.6 is below 44×44 pt |
| New workflow | error | target | label="Project, No project" | Control frame 120.0×34.3 is below 44×44 pt |
| New workflow | error | target | label="Agent, None" | Control frame 81.0×34.3 is below 44×44 pt |
| New workflow | error | target | label="Effort, Default" | Control frame 95.3×34.3 is below 44×44 pt |
| New workflow | error | target | label="Permission, Default" | Control frame 95.3×34.3 is below 44×44 pt |

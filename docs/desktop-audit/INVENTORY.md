# Desktop audit inventory

Baseline: `db714ce`. Actual Electron desktop, isolated profile/database/workspaces under `/tmp/gai-desktop-audit`. No repository commits or staging. Screenshots and measurements are recorded as each route is visited; a screenshot alone is not evidence of a completed feature test.

## Architecture

Desktop hosts the shared React web renderer, its own authenticated Node server, native browser views, terminal integration, operating-system menus/window controls, pairing, and update services. Shared providers, workflow engine, source control, file changes, review, authentication, transport and SDK are described in [the project inventory](../mobile-audit/INVENTORY.md). Mobile is outside this pass.

## Screen and feature checklist

| Area | Features to exercise |
|---|---|
| Shell | Native title bar, resizing, sidebar, appearance, command palette, keyboard navigation, find, breadcrumbs, editor launcher, server connection |
| Dashboard | Summary counts, activity filters, running/attention states, new chat/workflow shortcuts |
| Chats list | Search/filter, create, archive, restore, rename/navigation |
| Chat creation | Name/description, provider/model, source-control toggles, agent/capability overrides, orchestration, project/local sources, advanced options |
| Chat | Streaming, markdown/code/tools, reasoning, model/mode, attachments, context, slash commands, follow-up, stop/retry, errors/approvals, voice configuration |
| Chat side pane | Changes/file tree/diff/review, browser/navigation, terminal/resize, computer consent, widgets, background tasks, plan, tab overflow/close/split sizing |
| Projects | Create/settings, repositories/local sources, details, codebase files, branches/worktrees, pull requests/configuration |
| Agents | List/filter, create/edit, instructions, roles, skills/MCP, tool/runtime policies, team composition, effective preview, export |
| Workflows | List/templates, definition, create/edit DAG, stage/dependency configuration, variables, skills/MCP, approval gates, run/timeline/inspector/output, retries/cancel |
| Scripts | Discovery/reload, detail/profiles/variables, execution |
| Automations | Create/detail, trigger modes, schedule, dataset/schema/mapping, limits/failures, manual execution, history, enable/disable |
| Settings: App | General; Appearance |
| Settings: Agents | Model Providers; Agents; Skills; MCP Servers; Templates |
| Settings: Integrations | Source Control; Browser & Terminal; Computer Use; Audio; Extensions |
| Settings: System | Security & Devices; Storage; Diagnostics |

## Scenarios

1. Greenfield Atlas Release Console: Node ESM API, release/dependency domain, persistence, chart dashboard, complex validated form, CSV import/export and node:test suite. Codex GPT-5.6 Sol, high reasoning. Created and submitted through desktop UI.
2. Brownfield update to that workspace, exercising change review and regression tests.
3. Multi-stage workflow with variables, dependencies, skills, human review and execution inspection.
4. Narrow desktop and light/dark appearance checks; keyboard and scroll ownership checks across routes.

## Design references

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/): platform conventions, hierarchy and window behavior.
- [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance): responsive renderer/main process, defer expensive work and measure actual behavior.
- [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html): content remains usable when constrained; diagrams/code may need contained two-dimensional scrolling.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): keyboard access, visible focus, accessible names and sufficient contrast.

Final results must distinguish completed real UI journeys, source/test coverage, and external-service/platform limitations.

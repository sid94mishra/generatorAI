# Source coverage inventory

Generated from the checked-out source by `npm run reference:generate`. This is a structural index, not a claim that every branch was exercised at runtime.

Use this inventory with the [module map](/architecture/modules.md), [feature index](/features/index.md), [clients](/clients/overview.md), and [settings guide](/clients/settings.md). Counts deliberately exclude this documentation site and build output. Generated entries ensure even less visible process hosts and contracts are discoverable.

## Applications and packages

The top-level product modules exclude the separate `agent-tests` workspace and the nested `apps/mobile/modules/generatorai-device-key` native module; both are covered in the module map. Local dependencies include runtime, development/build-time, and optional manifest dependencies.

| Directory | Package | Local manifest dependencies | Documentation |
| --- | --- | --- | --- |
| `apps/agent-host` | `@generatorai/agent-host` | `shared`, `core`, `agent-harness-providers` | [Architecture](/architecture/modules.md) |
| `apps/browser-host` | `@generatorai/browser-host` | `shared` | [Architecture](/architecture/modules.md) |
| `apps/cli` | `@generatorai/cli` | `agent-harness-providers`, `cli-core`, `client-core`, `client-runtime`, `client-transport`, `core`, `db`, `design-tokens`, `secrets`, `shared`, `workflow-spec`, `tui-kit` | [Architecture](/architecture/modules.md) |
| `apps/cua-host` | `@generatorai/cua-host` | `shared` | [Architecture](/architecture/modules.md) |
| `apps/desktop` | `@generatorai/desktop` | `client-runtime`, `design-tokens`, `shared` | [Architecture](/architecture/modules.md) |
| `apps/mobile` | `@generatorai/mobile` | `client-core`, `client-runtime`, `client-transport`, `design-tokens`, `relay-protocol`, `shared`, `workflow-spec`, `auth` | [Architecture](/architecture/modules.md) |
| `apps/pty-host` | `@generatorai/pty-host` | `shared` | [Architecture](/architecture/modules.md) |
| `apps/relay` | `@generatorai/relay` | `relay-protocol` | [Architecture](/architecture/modules.md) |
| `apps/server` | `@generatorai/server` | `agent-harness-providers`, `auth`, `core`, `db`, `relay-protocol`, `secrets`, `shared`, `workflow-spec`, `workflow-testkit` | [Architecture](/architecture/modules.md) |
| `apps/web` | `@generatorai/web` | `client-core`, `client-runtime`, `design-tokens`, `shared`, `workflow-spec` | [Architecture](/architecture/modules.md) |
| `packages/agent-harness-providers` | `@generatorai/agent-harness-providers` | `core`, `shared` | [Architecture](/architecture/modules.md) |
| `packages/auth` | `@generatorai/auth` | `secrets`, `shared` | [Architecture](/architecture/modules.md) |
| `packages/changes` | `@generatorai/changes` | `shared`, `git` | [Architecture](/architecture/modules.md) |
| `packages/checkpoints` | `@generatorai/checkpoints` | `shared`, `git` | [Architecture](/architecture/modules.md) |
| `packages/cli-core` | `@generatorai/cli-core` | `client-core`, `client-runtime`, `client-transport`, `secrets`, `shared`, `workflow-spec` | [Architecture](/architecture/modules.md) |
| `packages/client-core` | `@generatorai/client-core` | `client-transport`, `shared`, `workflow-spec` | [Architecture](/architecture/modules.md) |
| `packages/client-runtime` | `@generatorai/client-runtime` | `relay-protocol`, `shared` | [Architecture](/architecture/modules.md) |
| `packages/client-transport` | `@generatorai/client-transport` | `relay-protocol` | [Architecture](/architecture/modules.md) |
| `packages/core` | `@generatorai/core` | `changes`, `checkpoints`, `git`, `review`, `secrets`, `shared`, `source-control`, `workflow-spec` | [Architecture](/architecture/modules.md) |
| `packages/db` | `@generatorai/db` | `auth`, `core`, `checkpoints`, `review`, `shared`, `workflow-spec` | [Architecture](/architecture/modules.md) |
| `packages/design-tokens` | `@generatorai/design-tokens` | — | [Architecture](/architecture/modules.md) |
| `packages/git` | `@generatorai/git` | `shared` | [Architecture](/architecture/modules.md) |
| `packages/mcp-server` | `@generatorai/mcp-server` | `client-core`, `client-runtime`, `secrets`, `shared`, `workflow-spec` | [Architecture](/architecture/modules.md) |
| `packages/relay-protocol` | `@generatorai/relay-protocol` | — | [Architecture](/architecture/modules.md) |
| `packages/review` | `@generatorai/review` | `shared` | [Architecture](/architecture/modules.md) |
| `packages/sdk` | `@generatorai/sdk` | `agent-harness-providers`, `core`, `db`, `secrets`, `shared`, `workflow-spec` | [Architecture](/architecture/modules.md) |
| `packages/secrets` | `@generatorai/secrets` | `shared` | [Architecture](/architecture/modules.md) |
| `packages/shared` | `@generatorai/shared` | `workflow-spec` | [Architecture](/architecture/modules.md) |
| `packages/source-control` | `@generatorai/source-control` | `shared` | [Architecture](/architecture/modules.md) |
| `packages/tui-kit` | `@generatorai/tui-kit` | `cli-core`, `design-tokens`, `shared` | [Architecture](/architecture/modules.md) |
| `packages/workflow-spec` | `@generatorai/workflow-spec` | — | [Architecture](/architecture/modules.md) |
| `packages/workflow-testkit` | `@generatorai/workflow-testkit` | `agent-harness-providers`, `core`, `db`, `shared`, `workflow-spec` | [Architecture](/architecture/modules.md) |

## Web page components

Guide: [Web page components](/clients/web.md).

- `apps/web/src/features/agents/AgentEditorPage.tsx`
- `apps/web/src/features/agents/AgentsListPage.tsx`
- `apps/web/src/features/automations/AutomationDetailPage.tsx`
- `apps/web/src/features/automations/AutomationsListPage.tsx`
- `apps/web/src/features/automations/CreateAutomationPage.tsx`
- `apps/web/src/features/chat/ChatPage.tsx`
- `apps/web/src/features/chats/ChatsListPage.tsx`
- `apps/web/src/features/chats/create/ChatCreatePage.tsx`
- `apps/web/src/features/home/HomePage.tsx`
- `apps/web/src/features/projects/CodebaseDetailPage.tsx`
- `apps/web/src/features/projects/CreateProjectPage.tsx`
- `apps/web/src/features/projects/ProjectDetailPage.tsx`
- `apps/web/src/features/projects/ProjectsListPage.tsx`
- `apps/web/src/features/projects/PullRequestPage.tsx`
- `apps/web/src/features/scripts/ScriptsListPage.tsx`
- `apps/web/src/features/workflows/builder/WorkflowBuilderPage.tsx`
- `apps/web/src/features/workflows/create/WorkflowNewPage.tsx`
- `apps/web/src/features/workflows/detail/WorkflowDetailPage.tsx`
- `apps/web/src/features/workflows/list/WorkflowsListPage.tsx`
- `apps/web/src/features/workflows/run/WorkflowRunPage.tsx`

## Mobile route files

Guide: [Mobile route files](/clients/mobile.md).

- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/(app)/_layout.tsx`
- `apps/mobile/app/(app)/agents/[id]/edit.tsx`
- `apps/mobile/app/(app)/agents/[id]/index.tsx`
- `apps/mobile/app/(app)/agents/create.tsx`
- `apps/mobile/app/(app)/agents/import.tsx`
- `apps/mobile/app/(app)/agents/index.tsx`
- `apps/mobile/app/(app)/agents/new.tsx`
- `apps/mobile/app/(app)/automations/[id]/edit.tsx`
- `apps/mobile/app/(app)/automations/[id]/executions/[executionId].tsx`
- `apps/mobile/app/(app)/automations/[id]/index.tsx`
- `apps/mobile/app/(app)/automations/index.tsx`
- `apps/mobile/app/(app)/automations/new.tsx`
- `apps/mobile/app/(app)/chats/[id]/gate/[interactionId].tsx`
- `apps/mobile/app/(app)/chats/[id]/index.tsx`
- `apps/mobile/app/(app)/chats/[id]/steps/[stepId].tsx`
- `apps/mobile/app/(app)/chats/[id]/turn.tsx`
- `apps/mobile/app/(app)/chats/index.tsx`
- `apps/mobile/app/(app)/chats/new.tsx`
- `apps/mobile/app/(app)/index.tsx`
- `apps/mobile/app/(app)/needs-you.tsx`
- `apps/mobile/app/(app)/paired.tsx`
- `apps/mobile/app/(app)/pickers/model.tsx`
- `apps/mobile/app/(app)/projects/[id]/[tab].tsx`
- `apps/mobile/app/(app)/projects/[id]/add-codebase.tsx`
- `apps/mobile/app/(app)/projects/[id]/codebases/[cid]/[tab].tsx`
- `apps/mobile/app/(app)/projects/[id]/codebases/[cid]/file.tsx`
- `apps/mobile/app/(app)/projects/[id]/codebases/[cid]/index.tsx`
- `apps/mobile/app/(app)/projects/[id]/codebases/[cid]/logs.tsx`
- `apps/mobile/app/(app)/projects/[id]/codebases/[cid]/pull-requests/[number].tsx`
- `apps/mobile/app/(app)/projects/[id]/index.tsx`
- `apps/mobile/app/(app)/projects/[id]/skills/[configId]/edit.tsx`
- `apps/mobile/app/(app)/projects/[id]/skills/[configId]/index.tsx`
- `apps/mobile/app/(app)/projects/index.tsx`
- `apps/mobile/app/(app)/projects/new.tsx`
- `apps/mobile/app/(app)/scope-request.tsx`
- `apps/mobile/app/(app)/scripts/[id]/index.tsx`
- `apps/mobile/app/(app)/scripts/[id]/run.tsx`
- `apps/mobile/app/(app)/scripts/index.tsx`
- `apps/mobile/app/(app)/search.tsx`
- `apps/mobile/app/(app)/servers.tsx`
- `apps/mobile/app/(app)/settings/agents.tsx`
- `apps/mobile/app/(app)/settings/app-lock.tsx`
- `apps/mobile/app/(app)/settings/appearance.tsx`
- `apps/mobile/app/(app)/settings/audio.tsx`
- `apps/mobile/app/(app)/settings/browser-terminal.tsx`
- `apps/mobile/app/(app)/settings/computer-use.tsx`
- `apps/mobile/app/(app)/settings/diagnostics.tsx`
- `apps/mobile/app/(app)/settings/extensions.tsx`
- `apps/mobile/app/(app)/settings/general.tsx`
- `apps/mobile/app/(app)/settings/index.tsx`
- `apps/mobile/app/(app)/settings/mcp/add.tsx`
- `apps/mobile/app/(app)/settings/mcp/index.tsx`
- `apps/mobile/app/(app)/settings/notifications.tsx`
- `apps/mobile/app/(app)/settings/providers.tsx`
- `apps/mobile/app/(app)/settings/security/index.tsx`
- `apps/mobile/app/(app)/settings/security/pair-device.tsx`
- `apps/mobile/app/(app)/settings/skills.tsx`
- `apps/mobile/app/(app)/settings/source-control.tsx`
- `apps/mobile/app/(app)/settings/storage.tsx`
- `apps/mobile/app/(app)/settings/templates.tsx`
- `apps/mobile/app/(app)/settings/widgets.tsx`
- `apps/mobile/app/(app)/share.tsx`
- `apps/mobile/app/(app)/workflows/[id]/edit/_layout.tsx`
- `apps/mobile/app/(app)/workflows/[id]/edit/add-stage.tsx`
- `apps/mobile/app/(app)/workflows/[id]/edit/index.tsx`
- `apps/mobile/app/(app)/workflows/[id]/edit/loop/[stageKey].tsx`
- `apps/mobile/app/(app)/workflows/[id]/edit/settings.tsx`
- `apps/mobile/app/(app)/workflows/[id]/edit/stages/[stageKey].tsx`
- `apps/mobile/app/(app)/workflows/[id]/edit/validate.tsx`
- `apps/mobile/app/(app)/workflows/[id]/edit/versions.tsx`
- `apps/mobile/app/(app)/workflows/[id]/graph.tsx`
- `apps/mobile/app/(app)/workflows/[id]/index.tsx`
- `apps/mobile/app/(app)/workflows/[id]/run.tsx`
- `apps/mobile/app/(app)/workflows/[id]/runs/[runId]/approval/[stageRunId].tsx`
- `apps/mobile/app/(app)/workflows/[id]/runs/[runId]/graph.tsx`
- `apps/mobile/app/(app)/workflows/[id]/runs/[runId]/index.tsx`
- `apps/mobile/app/(app)/workflows/[id]/runs/[runId]/stages/[stageRunId].tsx`
- `apps/mobile/app/(app)/workflows/[id]/runs/index.tsx`
- `apps/mobile/app/(app)/workflows/index.tsx`
- `apps/mobile/app/(app)/workflows/new.tsx`
- `apps/mobile/app/(app)/workspaces/[workspaceId]/commit.tsx`
- `apps/mobile/app/(app)/workspaces/[workspaceId]/diff.tsx`
- `apps/mobile/app/(app)/workspaces/[workspaceId]/file.tsx`
- `apps/mobile/app/(dev)/crash.tsx`
- `apps/mobile/app/(dev)/live.tsx`
- `apps/mobile/app/(dev)/notify.tsx`
- `apps/mobile/app/(dev)/storybook.tsx`
- `apps/mobile/app/(dev)/theme.tsx`
- `apps/mobile/app/+native-intent.tsx`
- `apps/mobile/app/+not-found.tsx`
- `apps/mobile/app/pair.tsx`
- `apps/mobile/app/revoked.tsx`

## Desktop/web settings components

Guide: [Desktop/web settings components](/clients/settings.md).

- `apps/web/src/features/settings/agents/AgentsSection.tsx`
- `apps/web/src/features/settings/appearance/AppearanceSection.tsx`
- `apps/web/src/features/settings/CatalogRow.tsx`
- `apps/web/src/features/settings/general/GeneralSection.tsx`
- `apps/web/src/features/settings/mcp/McpSection.tsx`
- `apps/web/src/features/settings/providers/ProvidersSection.tsx`
- `apps/web/src/features/settings/sections/AudioSection.tsx`
- `apps/web/src/features/settings/sections/BrowserTerminalSection.tsx`
- `apps/web/src/features/settings/sections/ComputerUseSection.tsx`
- `apps/web/src/features/settings/sections/DiagnosticsSection.tsx`
- `apps/web/src/features/settings/sections/ExtensionsSection.tsx`
- `apps/web/src/features/settings/sections/StorageSection.tsx`
- `apps/web/src/features/settings/sections/WorkflowEngineSection.tsx`
- `apps/web/src/features/settings/security/AccessGroup.tsx`
- `apps/web/src/features/settings/security/CertificatePanel.tsx`
- `apps/web/src/features/settings/security/DevicesGroups.tsx`
- `apps/web/src/features/settings/security/PairDeviceGroup.tsx`
- `apps/web/src/features/settings/security/SecuritySection.tsx`
- `apps/web/src/features/settings/security/ServerPosture.tsx`
- `apps/web/src/features/settings/security/ServersGroup.tsx`
- `apps/web/src/features/settings/SettingsModal.tsx`
- `apps/web/src/features/settings/SettingsNav.tsx`
- `apps/web/src/features/settings/skills/SkillsSection.tsx`
- `apps/web/src/features/settings/source-control/SourceControlSection.tsx`
- `apps/web/src/features/settings/templates/TemplatesSection.tsx`

## Shared configuration contracts

Guide: [Shared configuration contracts](/reference/configuration.md).

- `packages/shared/src/config/AgentSchemas.ts`
- `packages/shared/src/config/AppConfig.ts`
- `packages/shared/src/config/AutomationSchemas.ts`
- `packages/shared/src/config/BrowserConfigSchema.ts`
- `packages/shared/src/config/ChatSchemas.ts`
- `packages/shared/src/config/childEnv.ts`
- `packages/shared/src/config/ExtensionManifestSchema.ts`
- `packages/shared/src/config/index.ts`
- `packages/shared/src/config/McpSchemas.ts`
- `packages/shared/src/config/numericEnv.ts`
- `packages/shared/src/config/OrchestratorSchemas.ts`
- `packages/shared/src/config/WidgetSchemas.ts`

## Count definitions

Web page component files are not unique URLs: several components handle both creation and editing. Mobile route-tree files include layouts and redirects, not just rendered screens. Settings sections are listed from the shared `SETTINGS_NAV` contract; what each renders is registered in `apps/web/src/app/registries/settingsSections.tsx`.

## Maintenance boundary

This index detects source structure, not semantic completeness. A new control within an existing page still needs an authored guide update and a human review. The docs cover the working tree including uncommitted product changes present at authoring time. Regenerate after application changes; review the diff before publishing.

## Settings registry

All 16 sections from `SETTINGS_NAV` (`packages/shared/src/ui-contract/settings.ts`):

| Section | URL |
| --- | --- |
| General | `/settings/general` |
| Appearance | `/settings/appearance` |
| Model providers | `/settings/providers` |
| Agents | `/settings/agents` |
| Skills | `/settings/skills` |
| MCP servers | `/settings/mcp` |
| Templates | `/settings/templates` |
| Source control | `/settings/source-control` |
| Browser & terminal | `/settings/browser-terminal` |
| Computer use | `/settings/computer-use` |
| Audio | `/settings/audio` |
| Extensions | `/settings/extensions` |
| Security & devices | `/settings/security` |
| Storage | `/settings/storage` |
| Workflow engine | `/settings/workflow-engine` |
| Diagnostics | `/settings/diagnostics` |

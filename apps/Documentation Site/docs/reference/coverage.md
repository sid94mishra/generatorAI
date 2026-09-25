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
| `apps/desktop` | `@generatorai/desktop` | — | [Architecture](/architecture/modules.md) |
| `apps/mobile` | `@generatorai/mobile` | `client-core`, `client-runtime`, `client-transport`, `design-tokens`, `relay-protocol`, `shared`, `workflow-spec`, `auth` | [Architecture](/architecture/modules.md) |
| `apps/pty-host` | `@generatorai/pty-host` | `shared` | [Architecture](/architecture/modules.md) |
| `apps/relay` | `@generatorai/relay` | `relay-protocol` | [Architecture](/architecture/modules.md) |
| `apps/server` | `@generatorai/server` | `agent-harness-providers`, `auth`, `core`, `db`, `relay-protocol`, `secrets`, `shared`, `workflow-spec` | [Architecture](/architecture/modules.md) |
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
| `packages/mcp-server` | `@generatorai/mcp-server` | `core`, `sdk`, `shared`, `workflow-spec` | [Architecture](/architecture/modules.md) |
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



## Mobile route files

Guide: [Mobile route files](/clients/mobile.md).

- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/(tabs)/_layout.tsx`
- `apps/mobile/app/(tabs)/chats.tsx`
- `apps/mobile/app/(tabs)/index.tsx`
- `apps/mobile/app/(tabs)/projects.tsx`
- `apps/mobile/app/(tabs)/runs.tsx`
- `apps/mobile/app/approvals.tsx`
- `apps/mobile/app/automations/[id].tsx`
- `apps/mobile/app/changes/[workspaceId]/file.tsx`
- `apps/mobile/app/changes/[workspaceId]/index.tsx`
- `apps/mobile/app/chats/[id]/gate/[interactionId].tsx`
- `apps/mobile/app/chats/[id]/plan/[planId].tsx`
- `apps/mobile/app/chats/[id].tsx`
- `apps/mobile/app/index.tsx`
- `apps/mobile/app/pair.tsx`
- `apps/mobile/app/projects/[id]/codebases/[cid]/file.tsx`
- `apps/mobile/app/projects/[id]/codebases/[cid]/files.tsx`
- `apps/mobile/app/projects/[id]/codebases/[cid]/pull-requests/[number].tsx`
- `apps/mobile/app/projects/[id]/codebases/[cid].tsx`
- `apps/mobile/app/projects/[id]/pull-requests.tsx`
- `apps/mobile/app/projects/[id].tsx`
- `apps/mobile/app/revoked.tsx`
- `apps/mobile/app/runs/[id]/stages/[stageRunId].tsx`
- `apps/mobile/app/runs/[id].tsx`
- `apps/mobile/app/scope-request.tsx`
- `apps/mobile/app/scripts/[id].tsx`
- `apps/mobile/app/search.tsx`
- `apps/mobile/app/settings/about.tsx`
- `apps/mobile/app/settings/accessibility.tsx`
- `apps/mobile/app/settings/appearance.tsx`
- `apps/mobile/app/settings/audio.tsx`
- `apps/mobile/app/settings/capabilities.tsx`
- `apps/mobile/app/settings/diagnostics.tsx`
- `apps/mobile/app/settings/extensions.tsx`
- `apps/mobile/app/settings/index.tsx`
- `apps/mobile/app/settings/notifications.tsx`
- `apps/mobile/app/settings/providers.tsx`
- `apps/mobile/app/settings/security.tsx`
- `apps/mobile/app/settings/source-control.tsx`
- `apps/mobile/app/settings/tools.tsx`
- `apps/mobile/app/terminal/[workspaceId].tsx`
- `apps/mobile/app/workflows/[id].tsx`

## Desktop/web settings components

Guide: [Desktop/web settings components](/clients/settings.md).

- `apps/web/src/components/settings/sections/Agents.tsx`
- `apps/web/src/components/settings/sections/Appearance.tsx`
- `apps/web/src/components/settings/sections/Audio.tsx`
- `apps/web/src/components/settings/sections/BrowserTerminal.tsx`
- `apps/web/src/components/settings/sections/Catalogs.tsx`
- `apps/web/src/components/settings/sections/ComputerUse.tsx`
- `apps/web/src/components/settings/sections/Diagnostics.tsx`
- `apps/web/src/components/settings/sections/Extensions.tsx`
- `apps/web/src/components/settings/sections/General.tsx`
- `apps/web/src/components/settings/sections/Providers.tsx`
- `apps/web/src/components/settings/sections/Security.tsx`
- `apps/web/src/components/settings/sections/SourceControl.tsx`
- `apps/web/src/components/settings/sections/WorkspaceRetention.tsx`

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

Web page component files are not unique URLs: several components handle both creation and editing. Mobile route-tree files include layouts and redirects, not just rendered screens. The 13 settings component files implement 15 registry sections: `Catalogs.tsx` contains Skills, MCP, and Templates.

## Maintenance boundary

This index detects source structure, not semantic completeness. A new control within an existing page still needs an authored guide update and a human review. The docs cover the working tree including uncommitted product changes present at authoring time. Regenerate after application changes; review the diff before publishing.

## Settings registry

All 15 sections from `sectionRegistry.tsx`:

| Section | URL |
| --- | --- |
| General | `/settings/general` |
| Appearance | `/settings/appearance` |
| Model Providers | `/settings/providers` |
| Agents | `/settings/agents` |
| Skills | `/settings/skills` |
| MCP Servers | `/settings/mcp` |
| Templates | `/settings/templates` |
| Source Control | `/settings/source-control` |
| Browser & Terminal | `/settings/browser-terminal` |
| Computer Use | `/settings/computer-use` |
| Audio | `/settings/audio` |
| Extensions | `/settings/extensions` |
| Security & Devices | `/settings/security` |
| Storage | `/settings/storage` |
| Diagnostics | `/settings/diagnostics` |

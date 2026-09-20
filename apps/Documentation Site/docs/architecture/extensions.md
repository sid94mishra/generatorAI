---
title: Extensions, skills, and MCP
description: The distinct extension mechanisms, their runtime wiring, widget bridge, and MCP server boundary.
---

# Extensions, skills, and MCP

GeneratorAI has several extension mechanisms with different trust and execution models. A skill is instructional content, an MCP server is an external tool source, an extension loads application code, a widget renders interactive UI, and a workflow script supplies programmatic execution configuration. They should not be documented as interchangeable “plugins.”

## Skills and the artifact catalog

`SystemArtifactService` discovers built-in system artifacts. `ProjectConfigService` supplies project assets. `ArtifactCatalog` combines skills and MCP entries into a single read model used by both `AgentService` validation and `AgentResolver` materialization.

Agents reference catalog IDs rather than embedding arbitrary MCP process definitions. The resolver combines enabled skills/MCP entries and overrides, applies removals, and returns warnings when a reference cannot be satisfied. `AgentStagingService` prepares resolved skill content for execution.

Provider support remains separate. A staged directory is only useful if the adapter accepts it. The [provider capability matrix](./providers.md) documents current differences, including unsupported skill-directory injection for several adapters.

## MCP consumption

The catalog resolves MCP servers from:

| Scope/source | Backing configuration |
| --- | --- |
| System | `templates/system/mcp-servers.json` plus server-side preferences and supplied inputs |
| Custom | Servers created through MCP settings, persisted by McpSettingsStore |
| Project | Project configuration records of type `mcp` and associated credential references |

An entry can be user-enabled yet still require configuration. Missing required inputs/credentials prevent it from becoming effectively enabled. Catalog objects carry `secretref:` pointers rather than raw credential values; `McpCredentialVault` and the hub resolve secrets near the harness handoff.

Merging catalog defaults, explicit agent selections, and inline runtime configuration follows `mergeMcpServers.ts`. A disabled server should not silently reappear because a later layer merged an outdated default. Native MCP support is provider-dependent.

## Application extensions

An extension directory contains `extension.json` with identity, version, metadata, and an `entry` path. The current schema is intentionally thin: the entry module exports `loadExtension(ai)` and registers contributions imperatively. There is no current declarative `contributes` block.

```json
{
  "id": "example.local-tools",
  "name": "Local tools example",
  "version": "0.1.0",
  "description": "An example extension entry point",
  "entry": "./index.js"
}
```

This is a minimal manifest shape, not a bundled extension with production behavior. The entry module still needs to exist and register valid contributions.

Extension roots are system, user and workspace scopes. Higher-precedence workspace entries override user entries, which override system entries with the same identity. Workspace entries are loaded lazily for relevant workspace access. Installation accepts an already extracted directory and validates the manifest; ordinary API installation cannot write system scope.

### What is wired today

| Extension API contribution | Current activation status |
| --- | --- |
| Widgets | Registered into WidgetRegistry |
| Custom tools | Registered into CustomToolRegistry |
| MCP servers | Staged by ExtensionAPI; activation not wired end to end |
| Commands | Staged; activation not wired end to end |
| Hooks | Staged; activation not wired end to end |
| Skills | Staged; activation not wired end to end |
| Prompts | Staged; activation not wired end to end |

`ExtensionManager.ts` explicitly logs the latter contributions as not yet wired. This does **not** mean the separate project/system skill catalog, standalone MCP settings, or workflow hook system is missing; those are other working paths.

Reload runs registered disposers and refreshes contributions. Entry-module hot reloads are bounded because ES module instances remain cached; an indefinitely reloadable, memory-free extension host is not implemented.

### Trust model

Extension entry modules are dynamically imported in the server process. A manifest permissions array or signature field is not proof of a sandbox or verified publisher. Treat server extensions as trusted local code. The host's general script sandbox setting does not automatically wrap arbitrary extension module imports.

## Widgets

`WidgetRegistry` contains descriptors; `WidgetService` stores instances and state associated with sessions/chats/workflow stages. The web client mounts them through `WidgetHost`, `WidgetFrame` and the widget bridge.

Canonical surfaces are `inline` and `widget`; legacy aliases are normalized. The service supports creating/updating instances, actions, state/context feedback, invocation acknowledgements and teardown acknowledgements. User interaction summaries can be included in the next chat turn so an agent understands what changed in the visible widget.

An agent-to-widget invocation needs a live mounted client. The service can report `notMounted` rather than falsely claiming a UI action happened. Persisted widget state alone does not execute browser-side code while every client is closed.

Widget assets have a dedicated origin and response CSP. Some frames use same-origin sandbox permission on that dedicated origin, so the security argument is origin separation plus policy rather than a universal opaque-origin iframe. See [Security](./security.md).

## Workflow scripts and hooks

`WorkflowScriptLoader` discovers and imports programmatic workflow modules, validates their schema, exposes profiles/metadata, and supports reload/save/validation operations. Imported scripts can provide registered hooks. Script import is code execution, not merely parsing a JSON document.

The visual workflow builder and script catalog are different authoring surfaces. A server route for saving a script does not imply every client has a script editor. Hook behavior also depends on execution location and provider support; provider-native pre-tool hooks differ from workflow lifecycle hooks.

## Exposing GeneratorAI through MCP

`packages/mcp-server` implements a real MCP stdio server. Its built-in tools are:

| Tool | Effect |
| --- | --- |
| `generatorai_list_chats` | List chats with optional status/project filters |
| `generatorai_send_prompt` | Send to an existing chat or create one first; returns chat identity rather than a completed streamed answer |
| `generatorai_run_workflow` | Start a workflow definition with optional variables/project |

A supplied `CustomToolRegistry` can expose additional tools through `toolAdapter`. The CLI boots `createGeneratorAI` from the internal SDK, then attaches `StdioServerTransport`. It therefore runs its own in-process engine/configuration; it is not automatically a client of the desktop app's existing server.

The package and SDK are private workspace packages. Document the source/build setup instead of presenting an unsupported public npm installation command. The SDK README's historical “zero importers” statement is superseded by this CLI implementation.

## Source evidence

`packages/core/src/services/ArtifactCatalog.ts`, `AgentResolver.ts`, `AgentStagingService.ts`, `ExtensionManager.ts`, `ExtensionApi.ts`, `WidgetService.ts`, and `WorkflowScriptLoader.ts`; `packages/core/src/mcp/`; `packages/shared/src/config/ExtensionManifestSchema.ts`; `apps/server/src/routes/extensions.ts`; `apps/web/src/components/widgets/`; `packages/mcp-server/src/`.

Related: [Providers](./providers.md), [Security](./security.md), [Execution](./execution.md), and [Feature guides](../features/index.md).

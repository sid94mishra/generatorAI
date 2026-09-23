---
description: Install hot-loaded extensions and understand how interactive widgets communicate with agents and workspaces.
---
# Extensions and widgets

Extensions add executable capabilities to GeneratorAI. The current extension manager activates **widgets and custom tools**. Its API also stages MCP server, command, hook, skill, and prompt contributions, but their registration into the corresponding services is not yet wired end to end. A contribution count in Settings therefore does not establish that the contribution is usable. The separate system/project skill, MCP, and workflow-hook features are implemented through their own paths.

Widgets are extensions' interactive UI components: the agent and user can both read or change a live widget through a mediated bridge.

## Install and manage an extension

1. Open **Settings → Extensions**.
2. Enter an absolute path on the server host to a directory containing `extension.json`.
3. Choose User scope for the standalone Settings install form. Workspace installation requires a resolvable `workspaceId` in the request; the current form's Workspace choice does not supply one, so use an API path with explicit workspace context for that scope.
4. Select **Install**, then inspect readiness and any reported load errors.
5. Use enable/disable, **Reload all**, or uninstall as needed.

Installation copies the package into the target scope and loads it. The current manifest is intentionally small: identity, metadata, permissions, and an ES-module entry path. Contributions are registered imperatively by the entry module; do not author an obsolete declarative `contributes` block based only on the summary shape returned by the UI API.

```json
{
  "id": "example.review-tools",
  "name": "Review Tools",
  "version": "1.0.0",
  "description": "Project review helpers",
  "entry": "./index.js"
}
```

This manifest alone is not a functional extension. Its entry module must exist and export the extension loader expected by the extension API. Installing a package executes server-side code; enable only code appropriate for that host.

## Widget surfaces

| Surface | Best suited to |
| --- | --- |
| Inline | Small controls and results at the tool's location in the transcript |
| Widget tab | Forms, editors, dashboards, or interactive tools that need a full panel |

The canonical surface values are `inline` and `widget`; historical aliases normalize to these. A descriptor identifies an extension/component, entry HTML, initial-property and state schemas, declared permissions, keywords, and optional typed actions. Each rendered instance has its own state, owning session, lifecycle status, and optional chat/run/stage associations.

Open a widget from its transcript card or the workspace dock. Multiple instances receive separate tabs; the unbound Widget tab can serve as a picker. The chat currently caps widget tabs at six and reports when a tab limit is reached.

## Agent and user interaction

The widget bridge exchanges state and actions between the iframe, client, and server. Agent tools can render/update a widget, inspect its state/action catalog, invoke an action, or execute supported widget-control code. User input can update persistent widget state and publish an event visible to the owning agent session.

A widget can request capabilities such as workspace read/write, tool invocation, chat messages, browser navigation, allowed-host network access, or clipboard access. These are checked by the permission policy at the bridge/RPC boundary; a rendered button is not an unrestricted connection to the host.

## Isolation and troubleshooting

The web widget host loads HTML from a separate asset origin and uses an iframe sandbox. It refuses to render when that asset origin is absent or resolves to the main application's origin. This is required for isolation, not a cosmetic preference.

If a widget is blank, inspect extension readiness, the entry asset, isolated asset-origin configuration, and the widget's load/error state. The frame detects missing handshakes and exposes retry behavior. Reloading an extension and updating a widget instance are different operations.

Agents need an explicit extension-authoring capability to write and hot-load extensions. Ordinary widget use and extension authoring are separate tool groups in [agent policy](./agents.md).

## Source evidence

`apps/web/src/components/settings/sections/Extensions.tsx`, `apps/web/src/components/widgets/WidgetFrame.tsx`, `apps/web/src/components/widgets/WidgetHost.tsx`, `apps/web/src/lib/widgetBridge.ts`, `packages/shared/src/config/ExtensionManifestSchema.ts`, `packages/shared/src/types/Extension.ts`, `packages/shared/src/types/Widget.ts`, and `packages/core/src/services/ExtensionManager.ts`.

## Configuration and worked examples

[Extensions](../configuration/extensions.md), [Widgets](../configuration/widgets.md), [Examples](../configuration/examples.md). See the [feature recipes](../guide/feature-recipes.md) for steps and observable results.

# Configuration map

Use this section to find the exact contract for a feature, then use its worked example and feature guide to apply it. Configuration is split across host startup, persisted host preferences, client preferences, reusable definitions, and per-run overrides. There is no single JSON file that configures the whole product.

## Find a feature's settings

| Feature / module | Configuration and details | Example / workflow |
| --- | --- | --- |
| Server, storage, streaming, telemetry, sandbox, retention, computer use | [Server fields](./server.md), [host preferences](./projects-and-settings.md), [environment mapping](../reference/configuration.md) | [Server setup](../guide/quickstart.md), [deployment](../operations/deployment.md) |
| Dashboard and navigation | [Navigation guide](../features/navigation.md), [client preferences](./projects-and-settings.md) | Filter active/attention items, open the owning chat/run, then return to the dashboard |
| Projects, codebases and worktrees | [Project settings](./projects-and-settings.md), [project guide](../features/projects.md) | Create a trial project, attach a local Git repository, select a worktree source for isolated work |
| Chat creation, sources, provider, agent, browser, permissions | [Chat fields](./chats.md), [browser fields](./browser.md), [chat guide](../features/chats.md) | [Planning chat](./examples.md#create-a-planning-chat), [brownfield prompt](./examples.md#send-a-brownfield-planning-prompt) |
| Plans, questions and permission prompts | [Interaction contracts](./chats.md), [interaction guide](../features/interactions.md) | [Question response](./examples.md#answer-a-structured-interaction), [revision-safe plan edit](./examples.md#edit-a-plan-with-optimistic-concurrency) |
| Reusable agents and skills | [Agent fields](./agents.md), [agent guide](../features/agents.md), [catalogues](../features/integrations.md) | [Implementation agent](./examples.md#create-a-reusable-implementation-agent), [capability override](./examples.md#add-a-skill-while-narrowing-tools) |
| Orchestrator and background tasks | [Task contracts](./orchestration.md), [execution architecture](../architecture/execution.md) | [Worker brief](./examples.md#define-a-bounded-worker-brief) |
| Workflow graph, variables, stage policy and review gates | [Workflow fields](./workflows.md), [workflow guide](../features/workflows.md) | [Reviewed delivery workflow](./examples.md#import-a-multi-stage-brownfield-workflow) |
| Workflow runs, stage overrides, retries and profiles | [Run contracts](./workflows.md), [run guide](../features/workflow-runs.md) | [Run profile](./examples.md#configure-an-individual-workflow-run), [request changes](./examples.md#request-changes-at-a-workflow-gate) |
| Workflow templates and lifecycle hooks | [Template/hook fields](./templates.md), [integrations](../features/integrations.md) | Inspect the exact hook phase and failure policy before binding it; templates and JSON imports have different contracts |
| Executable workflow scripts | [Script output/profile fields](./scripts.md), [authoring and trust gates](../features/workflow-scripts.md) | Load a trusted `.workflow.mjs`, inspect its graph, then use a bounded run profile |
| Automations, scheduling and input pipelines | [Automation fields](./automations.md), [automation guide](../features/automations.md) | [Typed rows](./examples.md#run-a-typed-dataset-through-a-workflow), [schedule](./examples.md#schedule-a-bounded-daily-run), [grouping](./examples.md#preview-grouped-automation-iterations) |
| MCP tool connections | [MCP fields](./mcp.md), [catalogue behavior](../features/integrations.md) | [HTTP](./examples.md#register-a-remote-mcp-connection), [STDIO](./examples.md#register-a-host-side-mcp-command) |
| Extensions and interactive widgets | [Manifest/install fields](./extensions.md), [widget fields](./widgets.md), [activation limits](../features/extensions.md) | [Extension manifest](./examples.md#describe-an-executable-extension), inspect instance state and actions in the widget tab |
| Changes, diffs, file tree, review, terminal and browser panes | [Workspace tools](../features/workspace-panels.md), [browser fields](./browser.md), [terminal preferences](./projects-and-settings.md) | [Workspace verification recipe](../guide/feature-recipes.md#review-a-task-through-every-workspace-pane) |
| Source-control accounts, generated text, editors, commit/push/PR | [Host preferences](./projects-and-settings.md), [source-control guide](../features/source-control.md) | [Source-control review recipe](../guide/feature-recipes.md#review-source-control-without-publishing) |
| Pairing, device scopes, exposure, relay and authentication | [Host/security preferences](./projects-and-settings.md), [route contracts](./route-contracts.md), [security](../architecture/security.md) | Pair a device to the intended host, inspect granted capabilities, then check refresh/revocation behavior |
| Voice, recognition model and TTS | [Audio fields](./projects-and-settings.md), [voice architecture](../architecture/voice-and-observability.md) | [Voice recipe](../guide/feature-recipes.md#configure-voice-and-notifications) |
| Mobile accessibility, app lock and notifications | [Device preferences](./projects-and-settings.md), [mobile guide](../clients/mobile.md) | Verify one preference at a time on a native device; app lock and host revocation are separate |
| CLI/TUI, profiles, output and keymaps | [CLI fields](./cli.md), [command reference](../reference/cli-surface.md) | [CLI configuration](./examples.md#configure-cli-output-and-tui-behavior) |
| Desktop shell and server lifecycle | [Desktop settings](./projects-and-settings.md), [desktop guide](../clients/desktop.md) | Choose the active server and verify its identity before expecting settings to match another client |
| SDK, MCP bridge and optional host processes | [SDK/MCP](../clients/sdk-mcp.md), [process architecture](../architecture/processes.md), [modules](../architecture/modules.md) | Use the internal composition APIs only in supported repository contexts; they are not published client configuration |

## Scope and precedence

1. **Process startup:** environment variables are read by entrypoints and mapped into `AppConfigSchema`. A schema default is a fallback, not necessarily the standalone or desktop startup value. See the [environment mapping](../reference/configuration.md).
2. **Persisted host preferences:** audio, source-control, network exposure, computer-use and workspace-retention settings use dedicated stores. They are not all `AppConfig` properties and are not all editable through one API.
3. **Project and reusable definitions:** project context, agent bindings, selected artifacts and workflow defaults establish a starting configuration. A catalogue entry must be selected and ready; mere installation does not bind it to every execution.
4. **Execution overrides:** workflow/stage/browser overrides, run profiles, chat agent overrides, per-chat permission policy and per-turn mode apply through their respective resolvers. They are not interchangeable merge formats.
5. **Policy enforcement:** host capabilities, device scopes, provider support and OS permissions still constrain execution. A field that asks for a tool is not a grant of that tool.
6. **Client-local preferences:** appearance, pane state, microphone selection and notification presentation can differ between devices connected to the same host.

Omission, `null`, an empty array and `false` are distinct. For example, agent update fields wrapped in `.optional()` do not apply their inner create-time defaults when omitted; nullable fields support explicit clearing where the route allows it. Check the update schema, not only the create schema.

## How to use the references

The generated pages expand the actual runtime schemas, including `.partial()`, `.omit()`, `.extend()`, nested arrays and union branches. Field rows can repeat across create/update/import contracts; the row count is not the number of unique user settings. Complete source snapshots preserve custom validation and transformations that a compact field table cannot express.

The [supplemental route contracts](./route-contracts.md) cover validators declared inside server route files, while [projects and settings](./projects-and-settings.md) covers preferences and manually validated bodies outside shared Zod modules. Type-only and loosely validated fields are labeled as such. Generated references are source coverage, not proof that every accepted option is wired into every provider/client.

Use the [architecture walkthroughs](../architecture/walkthroughs.md) to follow a configuration through storage and execution, and the [feature recipes](../guide/feature-recipes.md) to verify its visible effect.

# Core concepts

| Concept | Meaning | Related guide |
| --- | --- | --- |
| Host | The machine and server process that own execution, credentials, storage, and workspace paths | [Architecture](../architecture/overview.md) |
| Client | Desktop, browser, phone, or CLI/TUI used to operate the host | [Clients](../clients/overview.md) |
| Project | An organizing context for codebases and reusable configuration | [Features](../features/index.md) |
| Codebase | A repository or source directory attached to a project | [Features](../features/index.md) |
| Workspace | The concrete files and Git state a chat or run works against | [Architecture](../architecture/overview.md) |
| Chat | A persistent conversation with a provider and execution context | [Features](../features/index.md) |
| Turn | One submitted prompt and the provider/tool activity required to complete it | [Execution](../architecture/execution.md) |
| Provider / harness | An adapter that connects orchestration to a provider runtime, model catalog, and tool behavior | [Providers](../architecture/providers.md) |
| Agent | A reusable definition of instructions and capabilities; it is not itself a running process | [Features](../features/index.md) |
| Workflow definition | A reusable graph of stages and transition edges | [Features](../features/index.md) |
| Workflow run | One execution of a definition with inputs and recorded stage outcomes | [Execution](../architecture/execution.md) |
| Automation | A trigger plus execution policy that launches work repeatedly or with structured inputs | [Features](../features/index.md) |
| Skill | Reusable instructions/content loaded into an agent context | [Features](../features/index.md) |
| MCP server | An external tool interface; distinct from a skill's instructions | [SDK and MCP](../clients/sdk-mcp.md) |
| Checkpoint | A recorded workspace state used for inspection, comparison, or restore | [Features](../features/index.md) |
| Artifact | A persisted output such as a response, report, or file associated with execution | [Storage](../architecture/data-and-storage.md) |

## Separate definitions from executions

An agent or workflow definition describes reusable behavior. A chat session, stage run, or automation execution records work that happened. Editing a definition is not equivalent to changing a running provider process, and retrying a run is not the same as starting a new conversation.

## Separate conversation history from files

Chat history records messages and tools. A workspace holds files. A chat fork can branch conversation history while retaining the parent workspace, so it is not automatically an isolated branch for code experiments. Choose and verify the workspace isolation mode for the intended task.

## Separate the client from the host

The terminal, file browser, Git actions, integrated browser, and agent process generally operate on the host. Mobile operating-system permissions and desktop native facilities are separate from the host's capability and authorization checks. A successful UI connection does not imply permission to execute commands or author workflows.

## Read statuses in context

A streamed text fragment is not proof of successful completion. Providers emit completion/error events, workflow stages have their own state transitions, and an automation can coordinate multiple child runs. Follow the final status and relevant artifact rather than assuming that a quiet stream means success.

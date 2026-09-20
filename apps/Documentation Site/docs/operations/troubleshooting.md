# Troubleshooting

Start by identifying **which host** the client is connected to, its current provider, and the relevant chat/run/workspace ID. A client refresh does not fix a host authentication error, and restarting the wrong host can interrupt unrelated work.

| Symptom | Check | Next action |
| --- | --- | --- |
| UI opens but requests fail | Connection status, pairing state, scope, host reachability | Reconnect or pair through an authorized host; inspect response errors |
| Remote browser cannot pair | HTTPS/secure context, advertised URL, origin and proxy scheme | Correct the reachable origin and TLS/proxy setup |
| New chat cannot start | Provider runtime, model catalog, account authentication | Choose an available model and inspect Model Providers diagnostics |
| Codex not listed | CLI discovery on the host | Inspect provider path settings / `CODEX_CLI_PATH`; authenticate the actual runtime |
| Copilot enterprise authentication fails | GitHub host and token tenant | Remove accidental cross-tenant token overrides; use the correct provider login |
| Stream stalls | Network, cursor/replay state, host health, final run state | Reconnect and reconcile history; do not resend a mutating prompt blindly |
| Run waits indefinitely | Human approvals, questions, admission queues, stage timeouts | Resolve the waiting action or inspect executor/provider diagnostics |
| Workflow fails validation | Graph roots/cycles, missing nodes, variable inputs, overrides | Validate the definition and inspect each failing stage configuration |
| UI action denied on mobile | Granted scopes and mobile capability gate | Request needed access on the host or use an authoring client |
| Browser/terminal unavailable | Host backend, workspace binding, device scopes | Configure the host capability and inspect tool-specific errors |
| Computer-use preview unavailable | Native driver/platform, consent, OS permissions | Inspect Computer Use settings and driver diagnostics |
| Script is not discovered | Script gate, naming/location, validation errors | Enable only trusted scripts and reload the script catalog |
| Files appear in unexpected place | Chat source/workspace mode and actual host path | Inspect workspace metadata; a chat fork can share its parent's files |
| Changes restore fails | Baseline/checkpoint availability, conflicts, untracked state | Inspect comparison and restore scope before retrying |
| Extension contributes no command/hook | Current registration implementation | Widgets/tools activate; other extension contribution types remain staged |
| Server refuses startup off-loopback | Secure secret backend and exposure policy | Supply a stable protected/keyed secret backend and intentional authentication |
| High memory or slow UI | Provider sessions, queue depth, database work, live browser processes | Inspect health runtime counters and focused diagnostics before increasing limits |
| Docs search returns nothing in development | Local search index is built at production build time | Run the docs build and preview; check search there |

## Diagnose before destructive recovery

Capture the error message, request ID, host version, provider, and relevant resource IDs. Look at the final state in history as well as the live stream. Cancellation, retry, checkpoint restore, deletion, and database reset have different effects; they should not be interchangeable troubleshooting steps.

For a reproducible bug, record the smallest input and sequence that triggers it. Keep real credentials and private prompt contents out of shared reports.

## Related references

[Configuration](../reference/configuration.md), [Providers](../architecture/providers.md), [Security](../architecture/security.md), [Transports](../architecture/transports.md), [Settings](../clients/settings.md), [Storage](../architecture/data-and-storage.md).

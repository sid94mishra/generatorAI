# Feature verification recipes

These recipes connect configuration to visible application behavior. They are repeatable walkthroughs for a trial workspace, not claims that every product flow was executed while authoring the documentation. For exact JSON and limits, use the [configuration map](../configuration/index.md) and [validated examples](../configuration/examples.md).

## Start from the dashboard

Open Dashboard and compare the chat/workflow/automation counters with their lists. Select Today, Running and Needs attention, then open an activity item. Confirm that it opens the owning entity and that back navigation returns to the expected filter. Empty and disconnected states are meaningful: a zero count does not establish that a disconnected host has no work.

Use the sidebar or command palette to reach Projects, Chats, Agents, Workflows, Scripts, Automations and Settings. Web and desktop share those React surfaces; mobile and TUI organize the same resources differently. See [navigation](../features/navigation.md) and the [client matrix](../clients/overview.md).

## Build a greenfield task with reusable resources

1. Create a disposable project and attach an empty trial repository or folder. Confirm the host path and readiness.
2. Create the [implementation agent](../configuration/examples.md#create-a-reusable-implementation-agent). Add an actual project skill and a configured MCP entry, then preview effective capabilities.
3. Create a chat with that agent and a provider/model discovered by the current host. Select an appropriate source/worktree and planning mode.
4. Ask for an issue tracker with projects, filtering, accessible forms, empty states and tests. State storage constraints and prohibited side effects explicitly.
5. Answer the structured storage question, edit the plan using its current revision, and approve implementation only after the plan meets the acceptance criteria.
6. Inspect the transcript's reasoning/tool/result states and the right-pane surfaces below. Ask for a targeted correction when a test or design criterion fails.

The catalogue entry, selected agent, effective tools and executing provider are separate pieces of state. Investigate each if the task ignores a skill or cannot access a tool. See [agents](../features/agents.md), [integrations](../features/integrations.md) and [interactions](../features/interactions.md).

## Review a task through every workspace pane

| Surface | Practical action | Expected evidence |
| --- | --- | --- |
| Changes | Select each changed file, inspect unified/split presentation where offered, add a targeted review comment | Correct baseline, file paths, additions/deletions and review anchor |
| Files | Expand directories and open a text file; inspect unsupported/binary behavior | Readable content or an explicit unsupported state; this is not a general editor |
| Terminal | Create a terminal and run the repository's documented test command | Host shell, working directory, exit/output state and a responsive resize |
| Browser | Start a local preview, open its permitted URL, navigate and inspect viewport controls | Rendered page from the intended workspace; host capability and navigation policy enforced |
| Background tasks | Open a worker spawned by an orchestrator; inspect progress and its result digest | Task objective, state, artifacts, failures and cancellation behavior |
| Widget tabs | Open an installed widget, change a form field, invoke a declared action | Instance-specific state and a successful bridge response; errors remain visible |
| Review/plan surfaces | Save an edited plan or submit review feedback | Revision/anchor remains associated with the intended content |

Collapse, resize, maximize and switch panels while a task is streaming. A tab being visible is not proof that its backing service is connected. Use [workspace tools](../features/workspace-panels.md), [browser settings](../configuration/browser.md), [widgets](../features/extensions.md) and [workspace architecture](../architecture/workspaces.md) for prerequisites and ownership.

## Update a brownfield project with a review gate

Import the [reviewed delivery workflow](../configuration/examples.md#import-a-multi-stage-brownfield-workflow), choose the real project/codebase, and run it with a compatibility-sensitive feature. Inspect the graph before execution: Inspect and plan → Implement → Verify, with a failure-only triage stage.

At the plan gate, request a change and verify that it becomes an agent follow-up. Then approve the corrected revision. Inspect stage input/context, retry history and the final verification output. If a stage is rejected, observe its failed state and downstream edge policy; do not assume rejection retries automatically. A `min_length` output check only establishes that a report has enough characters, not that it is correct.

For a greenfield variant, change the feature input to a small new module while keeping the same gate, test and review criteria. For controlled provider comparisons, make a new trial run with an explicit stage provider/model override and compare artifacts, not just completion status.

## Configure hooks, templates and workflow scripts

Start from an existing template, inspect variables and selected artifacts, then save a separate definition. Add a hook only at a phase supported by the [template/hook schema](../configuration/templates.md). Review timeout, retries, failure policy and the host command/HTTP destination before execution. A stage hook and a workflow hook do not have identical phase sets.

For executable scripts, follow the [script guide](../features/workflow-scripts.md): enable the operator trust gate, load a trusted `.workflow.mjs`, inspect the compiled graph and use a named profile. Script output and script run profiles have separate [contracts](../configuration/scripts.md). Dynamic imports execute code on the host; JSON schema validation is not a sandbox.

## Preview automation data before scheduling

Use the [manual typed-dataset example](../configuration/examples.md#run-a-typed-dataset-through-a-workflow) with two rows. Preview the iterations and inspect each variable envelope. Trigger once, open the execution, then follow each child run. Test grouping with the [grouped preview](../configuration/examples.md#preview-grouped-automation-iterations).

Only after a manual run succeeds, add the [weekday schedule](../configuration/examples.md#schedule-a-bounded-daily-run). Verify the IANA timezone, next occurrence, missed-run policy, overlap behavior and retry policy. A schedule can be valid while its workflow is unavailable or the host is offline. A webhook receiver also needs its authentication and host enablement; creating an automation alone does not configure network access.

## Review source control without publishing

Open the repository's source-control surface, inspect branch/upstream readiness and select changes for review. Generate a commit message if a text-generation provider/model is configured, or inspect the heuristic fallback. Check the proposed diff and editor path without executing a commit or push.

If the intended task includes publishing, treat commit, sync, push and PR creation as distinct operations with their own results and conflict handling. Connecting an account does not enable automatic publication in every chat. Review the chat/workflow's explicit source-control policy and the [source-control guide](../features/source-control.md).

## Configure voice and notifications

In Audio, inspect model readiness and select the microphone. Dictate a short sentence with spoken punctuation, then compare `rule-based` formatting with `none`. Adjust the endpoint silence interval for the speaker and verify that partial text is committed once. Test TTS with a supported voice and speed.

On a native mobile device, enable notifications, inspect registration and test a harmless completion event. Compare foreground presentation with background delivery. The three preference switches are not three independent server mute channels; [host and device preferences](../configuration/projects-and-settings.md) explains the distinction.

## Pair another client and compare scope

Create an invitation for the intended host and minimum necessary capabilities. Pair a phone, browser or CLI, verify the fingerprint/selected connection and open a known chat. Compare transcript state and a read-only page before trying an administrative action.

If an action is disabled or forbidden, inspect the device grants and host support. Request access through the provided flow; a hidden control or a client preference does not override server policy. On mobile, verify app lock separately from host revocation. On CLI, inspect `config show --sources` and the active connection/profile before comparing behavior with desktop.

## Inspect extensions and design

Install a trusted extension in the scope supported by the UI, inspect enabled/loaded state and open its widget. Exercise a declared action and verify the corresponding instance state. Check missing-asset and permission errors. Contribution declarations that are not wired into runtime services remain unavailable even when their counts appear in Settings.

In Appearance, choose mode, palette and accent independently. Verify foreground/background, focus, forms, code, diff colors and disabled controls. On mobile also test large text, reduced motion, safe areas and native glass fallback. The [design system](../design/system.md) explains which parts are shared and which are native adaptations.

## Diagnose and recover

Use Diagnostics to compare running sessions, streaming, telemetry, storage and sandbox state with the symptom. Refresh connection status before starting a duplicate task. For lost stream updates, inspect replay/reconnection; for a failed run, inspect the stage error and actual retry policy; for an unavailable tool, inspect effective capabilities and scopes. Use [troubleshooting](../operations/troubleshooting.md) and the [end-to-end architecture traces](../architecture/walkthroughs.md).

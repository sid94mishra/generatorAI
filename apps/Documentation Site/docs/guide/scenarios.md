# Development scenarios

These walkthroughs connect the individual feature guides into reviewable tasks. They are example test plans, not claims that the application executed them during documentation authoring.

## Build a new project

Use a fresh trial codebase and an isolated workspace when supported by the chosen source.

1. Create a project named **Issue tracker trial** and attach the trial codebase.
2. Create a chat, select an available provider/model, and enable only the skills and tools needed for the task.
3. Submit the prompt below. Answer structured questions before implementation starts.
4. Read the generated plan. Inspect background tasks and tool calls as the work progresses.
5. Use **Changes** to inspect the patch, **Files** to read the result, **Terminal** for the test output, and **Browser** to inspect a running preview when the host provides it.
6. Add review comments for any defect and send a follow-up with acceptance conditions. Check the next diff and test results before accepting it.

```text
Build a small issue tracker in this workspace. First inspect the repository
and propose a plan. Ask me to choose the persistence approach before coding.
Include projects, issues, filtering, accessible forms, empty states, and tests.
Use existing conventions. Keep a short implementation log and final test report.
Do not commit, push, publish, or open a pull request.
```

The Files surface is a file inspection surface, not a promise of a general-purpose editor. Browser and terminal access depend on host capabilities and scopes.

## Make a brownfield update

Use an existing trial repository with a working baseline test command.

```text
Inspect the existing issue filtering implementation and its tests.
Add a priority filter while preserving saved URLs and existing behavior.
Explain the data flow, propose a backward-compatible change, then implement it.
Add focused regression tests and run the affected checks.
Report any tests you could not run and why. Do not commit or push.
```

Review the base state before starting. After the turn, compare changes against the intended baseline, inspect untracked files, and check that unrelated files were not changed. A checkpoint is useful for inspection and restore, but a restore can change files; inspect its scope before using it.

## Turn the work into a workflow

Create stages with distinct outcomes, for example **Inspect → Plan → Implement → Verify → Review**. Use a human approval gate before implementation if you want to review the plan. Set explicit inputs, stage context, tool capabilities, timeouts, and failure transitions.

Use a small test input first. Watch the run timeline and stage messages. Test a failure branch by supplying a harmless invalid input, then inspect retry and cancellation behavior. Confirm output validation behavior in the feature guide: not every validator name implies full semantic validation.

## Add automation only after a manual run works

Create a **manual** automation with the tested workflow. Trigger it with representative typed inputs, inspect execution and child run histories, and check error reporting. If repetition is needed, then configure schedule or webhook behavior and review the resulting permissions and credentials.

The [feature catalogue](../features/index.md) contains the controls and limits for each step. The [client matrix](../clients/overview.md) identifies which authoring and execution surfaces exist on each client.

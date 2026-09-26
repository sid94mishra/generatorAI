# Workflow operations: flow keys, budgets, summaries and tracing

How to run the workflow engine in production: how many stages run at once and why a
stage waits, what a run may spend, how stage summaries are paid for, and how to trace
and measure runs. Loops, maps, waits and sub-workflows are in
[feature-workflow-control-flow.md](./feature-workflow-control-flow.md); runs and their
commands in [feature-workflow-runs.md](./feature-workflow-runs.md).

## 1. Flow keys: the one concurrency gate

Every stage launch is admitted by the server's `AdmissionController` on its **flow
keys**. A key is a named concurrency limit; a launch takes all of its keys at once or
waits for all of them (it never holds one key while it waits for another), in FIFO
order per key. While it waits the stage stays `ready`, so the wait never counts as
attempt time, and the run page says what it waits for:
`ready · waiting for provider claude-agent (4/4)`.

| Key | Gates | Default | Configurable |
| --- | --- | --- | --- |
| `global` | Every agent stage of every run | Sized from the machine (CPU and memory), 2–16 | Yes |
| `provider:<id>` | Every turn on a provider, **chat turns included** | `provider:claude-agent` = 4 (each turn is a ~250 MB CLI process); other providers unlimited | Yes |
| `model:<id>` | Every stage on that model | Not gated unless you add it | Yes |
| `check:global` | Every `check` stage (a check takes no provider key) | 2 | Yes |
| `worktree:<mountId>` | Writers of a run mount while a `mount_per_item` map holds it (shared / write / exclusive leases) | — | No (shown live) |
| `run:<id>` | A run's own `maxParallel` (enforced by the scheduler) | the workflow's `maxParallel` | In the workflow |

`provider:<id>` is the provider's own per-turn permit: a chat turn takes it for one
turn; a workflow stage takes it at admission and holds it for its whole attempt (its
turns and its judge turns do not take it again). The old hidden
`GENERATORAI_MAX_CONCURRENT_AGENT_TURNS` cap is gone; this key is it. With the
out-of-process agent host on (`GENERATORAI_AGENT_HOST=true`), the gateway admits every
turn on the same key before the turn crosses IPC.

**Where to set them:** Settings → Workflow engine (admin), or
`PUT /api/settings/workflow-engine` with `admin:settings`:

```json
{ "flowLimits": { "global": 8, "provider:claude-agent": 6, "model:claude-opus-4-1": 2 } }
```

`flowLimits` is the whole set: a key you leave out goes back to its default. Limits are
1–256 and apply at once (a raised limit admits waiters immediately; a lowered one lets
the holders finish). `GET /api/settings/workflow-engine` returns the settings, the
defaults and every key live (`running`, `queued`, `limit`), including the worktree
leases and each live run's `run:<id>`; `/api/health` publishes `flows` too. The settings
live in `<dataDir>/workflow-engine.json`.

**Trigger debounce.** In the same settings, `triggerDebounceMs` (default 2,000; 0 turns
it off): an identical automation webhook delivery or cron fire of the same automation
within the window returns the execution the first one started instead of starting a
second one.

## 2. Budgets and cost

A run budget (`workflow.budget`, or the invocation's) and a stage budget
(`stage.budget`) limit `maxTurns`, `maxTokens`, `maxWallClockMs` (time parked for a
human excluded) and `maxCostUsd`. Exhausting one is never success:

- a stage over its budget fails with `budget_exceeded` (and retries or pauses as its
  policy says);
- a run over its budget **drains**: it launches nothing new and pauses with the reason
  `budget_exhausted`, emits `workflow_run.budget_exhausted` and sends a push
  notification ("Workflow run out of budget") to paired devices that can read
  workflows. Resuming alone pauses it again. Raise the run budget — `raise_budget`
  without an `instanceId` adds its deltas (the run header's "Raise budget 50%", or
  `generatorai run command <run> - raise_budget --json '{"maxTurns": 50}'`); the run
  resumes once it is under the new budget — or cancel it. A loop's own budget is raised
  with `raise_budget` on the loop instance.

**Cost is only what the provider reports.** claude-agent reports a dollar cost per turn
(`total_cost_usd`); the engine reads `costUsd` from the provider's usage event and
nothing else. Other providers report tokens, not dollars (Copilot's `cost` is a
premium-request multiplier and is never read as USD). There is no pricing table: a run
on a provider that reports no cost shows tokens, and `maxCostUsd` never triggers on it.
The run header shows usage against the budget (turns, tokens, wall clock, and dollars
only when reported); the run page's Usage tab rolls usage up per instance.

## 3. Stage summaries (turn economy)

A successor with `context.mode: summary` reads its sources' summaries. What a summary
costs is the source stage's `output.summary`:

| Policy | Summary | Model turns |
| --- | --- | --- |
| `auto` (default) | JSON stages: their own `summary` field, else the output keys. Text stages: the first ~1,200 characters plus the headings of the rest | One summary turn only when a successor reads the summary **and** the output is over 6,000 characters |
| `llm` | Written after the stage completes, in a separate one-turn conversation on the **workflow summary model** (Settings → Workflow engine; unset = the stage's model) | One, off the critical path: only the successors that read the summary wait for it; a failure falls back to the `auto` summary |
| `none` | None (a summary reader gets the output instead) | None |

A stage without file-write or shell tools gets the `[Workspace]` directories in its
system message but not the rules on where to create files. A clean git checkout whose
HEAD tree is the previous snapshot skips its checkpoint without taking the per-repository
lock, so parallel read-only stages no longer queue behind each other's snapshot.

## 4. Tracing and metrics

Tracing is OpenTelemetry, off unless `OTEL_ENABLED=true`
(`apps/server/src/instrumentation.ts`; `OTEL_EXPORTER_OTLP_ENDPOINT`, default
`http://localhost:4318`; `OTEL_SAMPLE_RATE`; `OTEL_SERVICE_NAME`). Spans follow the
GenAI semantic conventions:

```
workflow.run                        workflow.run.id, workflow.run.status
  workflow.loop <key>               workflow.instance_path, exit reason
    workflow.iteration <k>
  workflow.map <key>
    workflow.item <i>
      invoke_agent <stage key>      gen_ai.operation.name=invoke_agent, gen_ai.agent.name/id,
                                    gen_ai.request.model, gen_ai.provider.name,
                                    gen_ai.usage.input_tokens/output_tokens,
                                    workflow.instance_path, workflow.stage.attempt
        chat <model>                gen_ai.operation.name=chat, gen_ai.conversation.id,
                                    gen_ai.request/response.model, gen_ai.usage.*
          execute_tool <tool>       gen_ai.tool.name, gen_ai.tool.call.id
```

One `invoke_agent` span per stage attempt; the provider's `chat` and `execute_tool`
spans nest under it (chat turns outside workflows are root `chat` spans). **Message
content is not recorded** unless you set
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` (then `gen_ai.input.messages`
and `gen_ai.output.messages` carry the prompt and the answer — they can contain
secrets and personal data).

Metrics (meter `generatorai.workflow` unless noted):

| Metric | Kind | Labels |
| --- | --- | --- |
| `workflow.loop.iterations` | histogram | `loop`, `exitReason` |
| `workflow.loop.cost_usd` | histogram (USD) | `loop` |
| `workflow.stage.attempts` | counter | `mode` (fresh, resume, restart) |
| `workflow.stage.repairs` | counter | |
| `workflow.scheduler.decision_latency_ms` | histogram | `message` |
| `workflow.scheduler.cas_conflicts` | counter | |
| `workflow.stream.rows_per_event` (meter `generatorai.server`) | histogram | `family` (harness, stage_run, workflow_run, …) |

## 5. Measurements

- **Engine overhead per stage:** `pnpm --filter @generatorai/workflow-testkit bench`
  runs a 10-stage chain on the zero-latency faux provider. 16.6 ms per stage on the dev
  machine (target < 150 ms); the bench warns when slower than `bench/baseline.json` and
  fails only when more than 25% worse.
- **Stream write amplification (W-42):** `pnpm --filter @generatorai/server bench`
  routes a T1 run's events through the server's scope fan-out: 2.00 `stream_cursors`
  rows per event (a session or global row plus the run scope), down from 3 writes per
  event before the RunLogger JSONL copy was removed. Accepted at ≤ 2.2 (a warning
  above).

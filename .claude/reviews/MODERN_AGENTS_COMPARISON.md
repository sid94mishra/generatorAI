# Modern Agent Systems Comparison

Research timestamp: April 2026. Sources inline. This document compares GeneratorAI against the current state of the art across vendor SDKs (Anthropic Claude Agent SDK, OpenAI Agents SDK), multi-agent frameworks (LangGraph, CrewAI, AutoGen v0.4+, Mastra, Vercel AI SDK), durable execution engines (Inngest, Temporal, Restate), and cross-cutting infrastructure (observability, durable streaming, sandboxing).

## Part 1 — Vendor SDKs

### Anthropic — Claude Agent SDK

The SDK extracts Claude Code's production internals. Core primitives:

| Primitive | Purpose |
|---|---|
| `query()` / `ClaudeSDKClient` | Entry point, `resume: sessionId` for continuation |
| Subagents (`.claude/agents/*.md`) | Child agents with separate context windows — multi-agent via `Task` tool |
| Hooks | `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `Notification`, `PreCompact`, `SessionStart`, `SessionEnd` — shell, MCP tool, or in-proc callback. Return codes: allow/deny/modify/continue-with-context |
| MCP | First-class: stdio, SSE, HTTP, in-process SDK servers. Tools surfaced as `mcp__<server>__<tool>` |
| Permissions | Four modes: `default`, `acceptEdits`, `plan`, `bypassPermissions` + `allow/deny/ask` rules in `settings.json`. `canUseTool` callback for dynamic decisions |
| Skills | `.claude/skills/<name>/SKILL.md` — auto-invoked by frontmatter description, 2026's packaged-behavior pattern |
| Slash commands | `.claude/commands/<name>.md` — explicit invocation |
| Memory model | `CLAUDE.md` auto-loaded; separate API-level **memory tool** (file-backed `/memories/` KV) survives sessions |
| Context editing (beta) | API-level tool-result and thinking-block clearing (`context-management-2025-06-27` header) |
| Prompt caching | `cache_control: {type:"ephemeral"}`, 5m/1h TTL, workspace-scoped since Feb 2026 |
| Extended thinking | `thinking: {type:"enabled", budget_tokens: N}`; thinking blocks auto-preserved across turns on Opus 4.5+ |
| Streaming | Anthropic SSE, typed events (`message_start`, `content_block_*`, `message_delta`, `message_stop`) per block |
| Managed Agents (beta Apr 2026) | Anthropic's first-party "agent loop + tools + sandbox + state" service |
| Observability | No first-party OTel exporter; community via OpenInference / Langfuse / Traceloop using GenAI semconv |
| DAG | None native |

Refs: [Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview), [Subagents](https://platform.claude.com/docs/en/agent-sdk/subagents), [Hooks](https://platform.claude.com/docs/en/agent-sdk/hooks), [Permissions](https://platform.claude.com/docs/en/agent-sdk/permissions), [MCP](https://platform.claude.com/docs/en/agent-sdk/mcp), [Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool), [Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing), [Claude Code sandboxing](https://www.anthropic.com/engineering/claude-code-sandboxing), [Managed Agents beta](https://help.apiyi.com/en/anthropic-claude-managed-agents-public-beta-launch-en.html).

### OpenAI — Agents SDK + Responses + Realtime

| Primitive | Purpose |
|---|---|
| `Agent` | `name, instructions, model, tools, handoffs, guardrails, output_type, tool_use_behavior, hooks` |
| `Runner.run / run_streamed` | Loop: model → tools/handoff → repeat, up to `max_turns` |
| Handoffs | Control transfer via `transfer_to_<agent>` special tool; shared history; optional `input_filter` |
| Guardrails | Input (first agent, pre-LLM), Output (final, post-LLM), Tool (per invocation). Tripwires raise exceptions |
| Sessions | `SQLiteSession`, `OpenAIConversationsSession`, `RedisSession`, custom — auto prepend/append |
| Tools | `@function_tool` + hosted (`web_search`, `file_search`, `code_interpreter`, `computer_use`, `image_generation`) + `agent.as_tool()` |
| Responses API | Stateful via `previous_response_id` or `store:true`; parallel tool calls; typed event taxonomy |
| Realtime API | Bidirectional WebSocket/WebRTC speech-to-speech; `interrupt_response: true`; server-VAD events |
| Tracing | Built-in `TraceProvider → BatchTraceProcessor → BackendSpanExporter` → traces.openai.com; OTel via OpenInference/Logfire/Arize |
| Evals | OpenAI Evals + Langfuse / Arize |
| DAG | None — pipelines are plain Python calling `Runner.run` |

Refs: [Agents SDK](https://openai.github.io/openai-agents-python/), [Handoffs](https://openai.github.io/openai-agents-python/handoffs/), [Guardrails](https://openai.github.io/openai-agents-python/guardrails/), [Sessions](https://openai.github.io/openai-agents-python/sessions/), [Running agents](https://openai.github.io/openai-agents-python/running_agents/), [Tracing](https://openai.github.io/openai-agents-python/tracing/), [Responses streaming](https://developers.openai.com/api/reference/resources/responses/streaming-events), [Realtime events](https://platform.openai.com/docs/api-reference/realtime-server-events).

### Concept mapping — vendor SDKs

| Concern | GeneratorAI | Claude Agent SDK | OpenAI Agents SDK |
|---|---|---|---|
| Sessions | `ICopilotPort` + `sessions` table | `query({resume})` + on-disk transcripts, `cleanupPeriodDays` | `Session` protocol: SQLite / Conversations / Redis |
| Tools | Tool registry per stage | MCP + built-in + in-proc SDK MCP; parallel | `@function_tool` + hosted + `as_tool`; `parallel_tool_calls` |
| Hooks | 22 phases, script/http/function | 9 phases, shell/MCP/in-proc | `AgentHooks` + `RunHooks` on start/end/tool/handoff |
| Permissions | Map SDK kind → domain type | 4 modes + `allow/deny/ask` + `canUseTool` | Guardrail tripwires (no plan mode) |
| MCP | Passed through | First-class + in-proc servers | `MCPServerStdio` / `MCPServerSse` |
| Streaming | SSE + ring buffer, no backpressure | Typed content-block events | Responses `response.*` events + `RunItemStreamEvent` |
| DAG | `DAGScheduler` | ✗ | ✗ |
| Handoff | Hook-driven implicit | Subagents (Task tool) | Handoffs (control) + `as_tool` (call-return) |
| Memory / compaction | ✗ | Memory tool + `PreCompact` hook + context editing + CLAUDE.md | Raw history only — **gap** |
| Sandboxing | Docker microVM / host | Claude Code sandbox + computer_use in user sandbox | `computer_use` hosted / `code_interpreter` hosted |
| Observability | Opt-in OTel | Hook-as-data + community OTel | Built-in traces → traces.openai.com |
| Automations | node-cron | ✗ (use host scheduler + `claude -p`) | ✗ (host scheduler) |

**GeneratorAI's differentiators** vs vendor SDKs: DAG engine, cron/automations, SSE ring-buffer streaming, dual v1/v2 domain. **GeneratorAI's gaps**: no memory/compaction primitive, no plan-mode permission, no guardrail tripwire, opt-in observability, no built-in handoff pattern, and a hook taxonomy that isn't wired to the SDK's streaming event stream the way Claude's hooks are.

## Part 2 — Multi-agent frameworks

### Concept mapping

| Concern | GeneratorAI | LangGraph | CrewAI | AutoGen v0.4+ | Mastra | Vercel AI SDK | Inngest | Temporal | Restate |
|---|---|---|---|---|---|---|---|---|---|
| Graph model | DAG (stages+edges) | StateGraph + conditional edges | Sequential / hierarchical tasks + Flows | Message-based actor model | Explicit step DAG | Single LLM call loop | Implicit via `step.run` | Code-as-workflow | RPC handlers |
| Durable exec | SQLite event log | `Checkpointer` (multi-backend) | ✗ | ✗ | Inngest runner | ✗ | Step memoization | Event history replay | Journal + side-effect dedup |
| Resume | Stage re-run from row | Thread restart (re-exec node) | Re-run idempotent task | ✗ | `restart*()` from last step | ✗ | Skip memoized steps | Full replay, cached activities | Skip journaled effects |
| Tool abstraction | Custom per stage | LangChain Tool | Agent tool list | Pydantic specs | 94+ providers registry | JSON schema + 20+ providers | MCP (AgentKit) | Activities | RPC |
| Multi-agent | Hook-driven | Sub-graphs / supervisor | Hierarchical manager | RoundRobin / Selector / Swarm | Agents-in-steps | Single agent | AgentKit routing | Child workflows | Virtual Object RPC |
| Streaming | SSE + event log | Callback-based | Callbacks | Message callbacks | `.stream()` | **Native SSE/WS + RSC** | Webhooks | Query/Signal poll | Webhooks |
| Resumable stream | Via event replay | ✗ | ✗ | ✗ | ✗ | ✗ (resumable-stream helper) | ✗ | ✗ | ✗ |
| Observability | Opt-in OTel | LangSmith + Langfuse | Callbacks | Event hooks | Built-in logs | Callbacks | Dashboard + replay | Temporal UI | Admin UI |
| Human-in-loop | Conditional hooks | **`interrupt()` + `Command(resume=...)`** | Callback approvals | Message-based | Step pauses | Manual | `step.waitForEvent` | Signals | State + polling |
| Sandboxing | Docker microVM + host | ✗ | ✗ | ✗ | ✗ | App process | App process | Activity isolation | App process |
| Persistence | SQLite + in-mem session | Thread-keyed checkpoints | Task outputs | External | State across steps | ✗ | Execution journal | Event history | Journal + K/V (RocksDB) |
| TS support | Yes | Yes | Partial | Yes | Native | Yes | Yes | Yes | Yes |

Refs: [LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence), [LangGraph durable execution](https://docs.langchain.com/oss/python/langgraph/durable-execution), [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts), [CrewAI tasks](https://docs.crewai.com/en/concepts/tasks), [AutoGen 0.4](https://devblogs.microsoft.com/autogen/autogen-reimagined-launching-autogen-0-4/), [Mastra workflows](https://mastra.ai/docs/workflows/overview), [Vercel AI SDK streamText](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text), [Inngest steps](https://www.inngest.com/docs/learn/inngest-steps), [Temporal for AI](https://temporal.io/solutions/ai), [Restate key concepts](https://docs.restate.dev/foundations/key-concepts#durable-execution).

## Part 3 — Cross-cutting infrastructure best practice (April 2026)

### Observability

OpenTelemetry **GenAI semantic conventions** remain experimental but are the de facto standard; adoption by Datadog, Arize, Langfuse, OpenLLMetry. Enable via `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`.

Required span attributes:
- `gen_ai.system` (now renaming to `gen_ai.provider.name`), `gen_ai.operation.name` (`chat`, `text_completion`, `embeddings`, `create_agent`, `invoke_agent`, `execute_tool`)
- `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.request.{temperature,top_p,max_tokens}`
- `gen_ai.usage.{input,output}_tokens` (cached included), `gen_ai.response.id`, `gen_ai.response.finish_reasons[]`
- Agent spans: `gen_ai.agent.{id,name,description,version}`
- Tool spans: `gen_ai.tool.{name,call.id,type}`
- Span name convention: `{gen_ai.operation.name} {gen_ai.request.model}`

Community span-tree convention: one trace per user turn, root `agent.invoke` → children `chat` + `execute_tool` (with nested HTTP client spans).

Vendor posture:
- **Langfuse** — MIT OSS, native OTel GenAI ingest, strongest self-host option.
- **Arize Phoenix / AX** — OTel-native, OpenInference aligned, best for evals + drift.
- **LangSmith** — tightest LangChain/LangGraph integration; best replay.
- **Braintrust** — eval-first, blocks CI merges on regression.
- **Helicone** — proxy/gateway, single base-URL swap.
- **Honeycomb** — BubbleUp on high-cardinality `gen_ai.*` attrs.

Eval split: offline dataset-driven CI (Braintrust / Phoenix Evals / Langfuse Datasets / Inspect AI / DeepEval) + online sampled-trace scoring (all major vendors) + replay/time-travel debugging (LangGraph fork-from-checkpoint, Inngest Dev Server, Temporal Workflow Replayer, Restate deterministic journal).

### Durable execution

Three dominant architectures:
1. **Journaled workflow engines** — Temporal, Restate. Deterministic replay (Temporal) or journaled side effects (Restate). Strongest guarantees; Temporal requires code discipline (no direct `Math.random()`, `Date.now()`, `fetch`).
2. **Step-function SDKs** — Inngest `step.run(id, fn)` memoizes return values; Vercel Workflow, Trigger.dev, Hatchet follow this pattern.
3. **Graph checkpointers** — LangGraph `Checkpointer` saves state between nodes; on resume the failed node re-executes from scratch (documented footgun if in-node code is not idempotent).

Must-persist artifacts for an agent workflow: LLM responses (keyed by `prompt_hash+model+temperature+seed`), tool-call results (keyed by `tool_call.id`), side-effect boundaries, streaming cursor (last event id), reducer state.

Temporal-for-AI known issue: **history saturation** from large LLM payloads → standard mitigation is a **Payload Codec** that offloads prompts/responses to S3/Blob and stores references.

Deduplication on tool retry: use the model-emitted `tool_call.id` as idempotency key.

Resumable streaming (2026 convention): monotonic server event IDs, persisted to Redis/pubsub/Durable Objects, client sends `Last-Event-ID` on reconnect, server replays forward. AI SDK UI's `experimental_resume` + Vercel `resumable-stream` + Cloudflare Durable Objects are reference implementations. Separate consumption cursor (client) from emission cursor (server).

### Sandboxed code execution

Isolation tier: **Firecracker ≈ Cloud Hypervisor > gVisor > nsjail / rootless-Docker+seccomp > Node `vm`** (`vm` is explicitly not a security boundary — April 2026 `playwright-mcp` RCE via `browser_run_code` confirmed).

Managed providers:

| Provider | Isolation | Cold start | Notes |
|---|---|---|---|
| E2B | Firecracker microVM | ~150ms | $0.083/vCPU+2GB·hr, 24h session cap, 30-day paused standby |
| Daytona | Firecracker | **27–90ms** | Fastest; $24M Series A Feb 2026 |
| Modal | gVisor | sub-second | ML/GPU focus |
| Fly.io Sprites | Firecracker | 1-2s create, 300ms resume | Stateful, auto-idle |
| Cloudflare Containers/Sandboxes | gVisor-like | fast | GA 2026-04-13, $0.00002/vCPU-s, per-sandbox D1 state |
| Vercel Sandbox | microVM | - | Next.js + AI SDK integration |
| Runloop / Blaxel / Northflank / Freestyle | mixed | - | Specialized coding-agent runners |

Self-managed: Firecracker direct (custom kernels/GPU passthrough), gVisor (`runsc` as Docker runtime), nsjail (single-binary namespaces+seccomp), rootless Docker + seccomp + AppArmor + `--network none` (baseline, insufficient alone for untrusted code).

Filesystem patterns:
- **`git worktree` per agent task** — shared `.git` store, per-worktree HEAD/index. Eliminates `index.lock` contention. Standard for Claude Code, Aider, Augment, Cursor background agents.
- **OverlayFS / CoW** — E2B, Daytona, Sprites all use CoW rootfs → O(ms) spawn.
- **ZFS/Btrfs snapshot+clone** — self-hosted equivalent.

MCP servers for sandboxed execution (April 2026): Microsoft `playwright-mcp` (**CVE disclosed for `browser_run_code` via Node `vm`**; pin post-fix, default FS restrictions and origin controls added), Microsoft `@playwright/cli` (4× more token-efficient, but FS access, pair with sandbox), Code Executor MCP / MCP Run / Shell MCP (wrap E2B/Modal/Daytona behind MCP), OpenAI Agents SDK Apr-16-2026 built-in sandbox harness.

Security checklist: kernel isolation (Firecracker or gVisor — not containers alone); non-root UID + drop capabilities + seccomp default-deny; read-only rootfs + explicit writable mounts; **deny-by-default egress** + allowlist (package registries, specific APIs), block SSRF ranges; **credential proxy** so agent never sees raw API keys; hard per-call and per-sandbox-lifetime timeouts; no ambient secrets in env (inject per-call via short-lived tokens); prompt-injection guardrails at egress (Promptfoo, Lakera, Protect AI).

Refs: [OTel GenAI semconv](https://opentelemetry.io/docs/specs/semconv/gen-ai/), [OTel GenAI agent spans](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/), [OTel GenAI registry](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/), [Datadog GenAI blog](https://www.datadoghq.com/blog/llm-otel-semantic-convention/), [Braintrust best tracing tools 2026](https://www.braintrust.dev/articles/best-llm-tracing-tools-2026), [LangGraph durable exec](https://docs.langchain.com/oss/python/langgraph/durable-execution), [Temporal for AI](https://temporal.io/solutions/ai), [Inngest vs Temporal](https://www.inngest.com/compare-to-temporal), [Durable workflows for AI (Render)](https://render.com/articles/durable-workflow-platforms-ai-agents-llm-workloads), [Resume tokens and Last-Event-ID](https://dev.to/ablyblog/resume-tokens-and-last-event-ids-for-llm-streaming-how-they-work-what-they-cost-to-build-4l7e), [Vercel resumable-stream](https://github.com/vercel/resumable-stream), [AI SDK resume streams](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams), [E2B](https://e2b.dev), [Northflank sandbox runners](https://northflank.com/blog/best-sandbox-runners), [Cloudflare Containers GA](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/), [Playwright-MCP RCE #1495](https://github.com/microsoft/playwright-mcp/issues/1495), [git worktrees for parallel AI agents (Augment)](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution).

## Part 4 — Head-to-head: where GeneratorAI lags SOTA

1. **Deterministic / memoized replay** — Temporal, Restate, Inngest all journal side-effect outcomes; replay skips completed work. GeneratorAI's SQLite event log captures events but does **not** memoize LLM results, tool results, or step outputs. A re-run burns tokens redoing finished work.
2. **First-class `interrupt()` for human-in-loop** — LangGraph's `interrupt() + Command(resume=value)` is the cleanest approval/HITL primitive in the ecosystem. GeneratorAI has 22 hook phases but no explicit pause-and-inject-value. Approvals must be built manually per workflow.
3. **Resumable streaming with cursor** — AI SDK's `experimental_resume`, Vercel resumable-stream, Cloudflare Durable Objects + D1 pattern. GeneratorAI's SSE requires full replay and has the 30-s-after-terminal cleanup bug.
4. **Tool registry + MCP alignment** — Claude Agent SDK and Mastra both support 90+ providers and first-class MCP. GeneratorAI's tool surface is whatever the Copilot SDK exposes; there is no in-house tool registry, no MCP tool definitions, no BYO-tool UX.
5. **Memory + compaction primitive** — Claude's memory tool + `PreCompact` hook + context editing is the current reference design for long-running agents. GeneratorAI has none of this; context growth is the Copilot SDK's problem.
6. **Explicit agent handoff / swarm** — AutoGen Swarm `HandoffMessage`, CrewAI hierarchical manager, OpenAI Agents SDK handoffs. GeneratorAI does multi-stage DAG but no intra-session multi-agent handoff pattern.
7. **Observability by default with GenAI semconv** — OpenAI built-in tracing, LangSmith for LangGraph, Langfuse for everyone else. GeneratorAI has OTel opt-in and no adherence to `gen_ai.*` attribute names, so traces won't correlate in any GenAI-aware UI without code changes.
8. **Sandbox primitives for untrusted code** — Firecracker-class microVM (E2B, Daytona, Fly Sprites), Cloudflare Containers GA, Kubernetes Agent Sandbox CRD. GeneratorAI's Docker-microVM is a good start but fallback is silent/host, there's no per-tool sandbox, and no credential proxy / egress allowlist.
9. **Eval-as-code pipelines blocking CI** — Braintrust-style dataset + scorer in CI. GeneratorAI has no eval framework at all.
10. **`step.sleep` without consuming compute** — Inngest/Temporal/Restate durable sleep is the standard for long-lived multi-day agent tasks. GeneratorAI's cron/polling model pays for idle time.
11. **Outbox for exactly-once side effects** — Temporal Nexus, Restate virtual objects. GeneratorAI writes directly inside `executeStage`; a crash mid-write can duplicate external side effects on retry.
12. **Payload codec** — Temporal's AI-specific pattern to offload large prompt/response payloads outside the event journal. GeneratorAI's event table has no equivalent; long runs bloat the DB.

## Part 5 — Where GeneratorAI is actually ahead

1. **DAG engine with edge conditions.** None of the vendor SDKs ship one; LangGraph's StateGraph is closest but more graph-of-state than workflow-of-stages.
2. **Cron-triggered automations with loop/batch/script data sources.** Vendor SDKs leave this to the user entirely.
3. **Git repo management inside a run.** Preprocessor clone + per-run workspace + diff endpoint is an integrated pattern most frameworks leave ad-hoc.
4. **Full-stack delivery (server + React web + Ink CLI + TUI).** Most SDKs stop at the library; GeneratorAI gives end-user interfaces out of the box.
5. **22-phase hook system.** Broader than Claude's 9 hook phases, though less well integrated with the LLM event stream.
6. **System templates with preprocessing/postprocessing + git PR handoff.** A packaged "this is how code-review + code-generation workflows look" opinionation that frameworks like CrewAI and AutoGen require the user to assemble.

These are defensible differentiators. The improvement work should preserve them.

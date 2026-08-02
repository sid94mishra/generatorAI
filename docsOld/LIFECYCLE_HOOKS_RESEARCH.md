# AI Agent Framework Lifecycle Hooks & Event-Driven Extensibility Research

> Research compiled May 2026 — Concrete patterns, APIs, and comparison across 8+ framework categories.

---

## Executive Summary

Modern AI agent and workflow orchestration frameworks converge on a **class-based hooks / callback pattern** where users subclass a base hooks class and override async methods for specific lifecycle events. The most extensible systems combine **two hook scopes** (run-level + agent/task-level) with **interceptor/middleware chains** that can wrap execution and modify input/output.

**Key findings:**
1. **All mature frameworks expose 5–8 core lifecycle events** — start, end, tool_start, tool_end, error, handoff/transition
2. **Async (awaited, blocking) is the dominant pattern** — NOT fire-and-forget; hooks can block and gate execution
3. **Flow modification (abort/retry/skip) varies** — guardrails/tripwires halt execution; middleware `next()` chains enable wrapping
4. **Registration is via code** — not YAML/config files; decorators or constructor injection
5. **Error isolation in hooks is critical** — most frameworks log and continue; some propagate to abort the run

---

## 1. Claude / Anthropic SDK

**Architecture:** Low-level Messages API with tool-use loop. No built-in agent lifecycle hooks framework — the developer owns the agentic loop.

| Aspect | Detail |
|--------|--------|
| **Lifecycle events** | None built-in — developer implements the loop: `message.create()` → check `stop_reason` → execute tools → send `tool_result` → repeat |
| **Hook registration** | N/A — you write the loop, so you insert custom logic at any point |
| **Sync/Async** | Your choice — SDK supports both sync and async clients |
| **Flow modification** | Full control — you own the loop, so you can abort, retry, skip at will |
| **Error handling** | Your responsibility |
| **Pattern** | "Build your own loop" — maximum flexibility, zero built-in structure |

**Code pattern:**
```python
# The developer IS the hook system
while True:
    response = client.messages.create(model=..., messages=messages, tools=tools)
    
    # YOUR on_message_received hook point
    log_response(response)
    
    if response.stop_reason == "end_turn":
        break  # YOUR on_complete hook point
    
    for block in response.content:
        if block.type == "tool_use":
            # YOUR on_tool_start hook point
            result = execute_tool(block.name, block.input)
            # YOUR on_tool_end hook point
            messages.append({"role": "user", "content": [{"type": "tool_result", ...}]})
```

**Key insight:** Anthropic intentionally provides no lifecycle abstraction — the API is a building block. This is why frameworks like GeneratorAI exist.

---

## 2. OpenAI Agents SDK

**Architecture:** The most structured hook system of any AI agent SDK. Two-tier: **RunHooks** (run-level) + **AgentHooks** (per-agent).

### Lifecycle Events — RunHooksBase

| Hook | When | Signature |
|------|------|-----------|
| `on_agent_start` | Before agent invoked (on each agent change) | `(context, agent)` |
| `on_agent_end` | Agent produces final output | `(context, agent, output)` |
| `on_llm_start` | Before LLM call | `(context, agent, system_prompt, input_items)` |
| `on_llm_end` | After LLM call returns | `(context, agent, response)` |
| `on_tool_start` | Before tool invocation | `(context, agent, tool)` |
| `on_tool_end` | After tool invocation | `(context, agent, tool, result)` |
| `on_handoff` | Agent-to-agent handoff | `(context, from_agent, to_agent)` |

### Lifecycle Events — AgentHooksBase (per-agent)

| Hook | When |
|------|------|
| `on_start` | This specific agent begins |
| `on_end` | This agent produces output |
| `on_handoff` | This agent receives a handoff |
| `on_tool_start` / `on_tool_end` | Tool use by this agent |
| `on_llm_start` / `on_llm_end` | LLM calls by this agent |

### Key Properties

| Aspect | Detail |
|--------|--------|
| **Registration** | `Runner.run(agent, hooks=MyRunHooks())` or `Agent(hooks=MyAgentHooks())` |
| **Sync/Async** | All hooks are `async` — awaited (blocking), not fire-and-forget |
| **Flow modification** | Hooks are observational only — cannot abort/skip. Use **Guardrails** for flow control |
| **Error handling** | Hook exceptions propagate to caller |
| **Context** | `RunContextWrapper[TContext]` carries shared typed state through the run |

### Guardrails (Flow Control)

Separate from lifecycle hooks — guardrails CAN halt execution:

| Type | When | Can block? |
|------|------|------------|
| `@input_guardrail` | Before first agent runs | Yes — `tripwire_triggered` raises exception |
| `@output_guardrail` | After final agent output | Yes — raises `OutputGuardrailTripwireTriggered` |
| `@tool_input_guardrail` | Before each tool call | Yes — can reject/replace tool input |
| `@tool_output_guardrail` | After each tool call | Yes — can reject/replace tool output |

**Execution modes:** `run_in_parallel=True` (default) runs guardrail concurrently with agent; `run_in_parallel=False` blocks until guardrail completes.

```python
from agents import Agent, RunHooksBase, Runner

class MyHooks(RunHooksBase):
    async def on_agent_start(self, context, agent):
        print(f"Agent {agent.name} starting")
    
    async def on_tool_start(self, context, agent, tool):
        print(f"Tool {tool.name} called")
    
    async def on_tool_end(self, context, agent, tool, result):
        print(f"Tool {tool.name} returned: {result[:100]}")

result = await Runner.run(agent, "task", hooks=MyHooks())
```

---

## 3. LangChain / LangGraph

**Architecture:** Callback-handler based system inherited from LangChain, extended for graph execution.

### Callback Events

| Callback Method | Triggered When |
|----------------|----------------|
| `on_llm_start` | LLM call begins |
| `on_llm_end` | LLM call completes |
| `on_llm_error` | LLM call errors |
| `on_chain_start` | Chain/runnable starts |
| `on_chain_end` | Chain/runnable ends |
| `on_chain_error` | Chain/runnable errors |
| `on_tool_start` | Tool execution begins |
| `on_tool_end` | Tool execution completes |
| `on_tool_error` | Tool execution errors |
| `on_retriever_start` | Retriever query begins |
| `on_retriever_end` | Retriever returns results |
| `on_agent_action` | Agent decides an action |
| `on_agent_finish` | Agent produces final answer |

### Key Properties

| Aspect | Detail |
|--------|--------|
| **Registration** | Pass `callbacks=[handler]` to any runnable, or use `config={"callbacks": [...]}` |
| **Sync/Async** | Both `BaseCallbackHandler` (sync) and `AsyncCallbackHandler` (async) |
| **Flow modification** | Callbacks are observational — use `RunnableConfig` or custom nodes for flow control |
| **Error handling** | Errors in callbacks are logged but don't halt execution by default |
| **Propagation** | Callbacks propagate to child runnables automatically |
| **Streaming** | `astream_events()` provides structured event stream with `on_chain_start`, `on_llm_stream`, etc. |

### LangGraph-Specific: Node hooks via graph structure

```python
from langchain_core.callbacks import BaseCallbackHandler

class MyHandler(BaseCallbackHandler):
    def on_llm_start(self, serialized, prompts, **kwargs):
        print(f"LLM starting with {len(prompts)} prompts")
    
    def on_tool_end(self, output, **kwargs):
        print(f"Tool returned: {output}")
    
    def on_chain_error(self, error, **kwargs):
        print(f"Error: {error}")

# Attach to any invocation
result = chain.invoke(input, config={"callbacks": [MyHandler()]})
```

**LangGraph pattern:** Use `@graph.node` and define pre/post logic within node functions. Conditional edges serve as "hooks" controlling flow.

---

## 4. CrewAI

**Architecture:** Decorator-based crew lifecycle + callback attributes on Crew object.

### Lifecycle Hooks

| Hook | Type | When |
|------|------|------|
| `@before_kickoff` | Decorator | Before crew starts — receives `inputs`, can modify |
| `@after_kickoff` | Decorator | After crew completes — receives `CrewOutput`, can modify |
| `step_callback` | Crew attribute | Called after each step of every agent |
| `task_callback` | Crew attribute | Called after each task completes |
| `before_kickoff_callbacks` | Crew attribute | List of callables before crew starts |
| `after_kickoff_callbacks` | Crew attribute | List of callables after crew finishes |

### Key Properties

| Aspect | Detail |
|--------|--------|
| **Registration** | Decorators on `@CrewBase` class methods, or constructor args on `Crew()` |
| **Sync/Async** | Callbacks are synchronous by default; `akickoff()` for native async |
| **Flow modification** | `@before_kickoff` can modify inputs; `@after_kickoff` can modify output. `step_callback`/`task_callback` are observational |
| **Error handling** | Callbacks don't halt execution |
| **Checkpointing** | `CheckpointConfig(on_events=["task_completed"])` — saves state after configured events |

```python
from crewai import Crew
from crewai.project import CrewBase, before_kickoff, after_kickoff

@CrewBase
class MyCrew:
    @before_kickoff
    def prepare_inputs(self, inputs):
        inputs['extra'] = "injected data"
        return inputs  # CAN modify inputs
    
    @after_kickoff
    def process_output(self, output):
        output.raw += "\nPost-processed"
        return output  # CAN modify output

# OR via constructor:
crew = Crew(
    agents=[...], tasks=[...],
    step_callback=lambda step_output: print(f"Step: {step_output}"),
    task_callback=lambda task_output: print(f"Task done: {task_output}"),
)
```

---

## 5. AutoGen (Microsoft)

**Architecture:** Event-driven message passing. No formal "hooks" API — extensibility is through custom agents, message types, and the event stream.

### Event Types (Message-based)

| Event Type | When |
|-----------|------|
| `TextMessage` | Agent sends text |
| `ToolCallRequestEvent` | Agent requests tool call |
| `ToolCallExecutionEvent` | Tool execution completes |
| `ToolCallSummaryMessage` | Agent summarizes tool result |
| `ModelClientStreamingChunkEvent` | Streaming token received |
| `HandoffMessage` | Agent-to-agent handoff |

### Key Properties

| Aspect | Detail |
|--------|--------|
| **Registration** | Custom agents extend `BaseChatAgent`, override `on_messages()` / `on_messages_stream()` |
| **Sync/Async** | Fully async (`async for message in agent.run_stream(...)`) |
| **Flow modification** | Implement custom `TerminationCondition` or custom agent logic |
| **Error handling** | Errors propagate through async generators |
| **Middleware** | No built-in middleware chain — planned but not yet available |
| **Extensibility** | "Custom agent" pattern — subclass `BaseChatAgent` and implement `on_messages()` |

```python
from autogen_agentchat.agents import BaseChatAgent

class MyCustomAgent(BaseChatAgent):
    async def on_messages(self, messages, cancellation_token):
        # YOUR custom logic here — full control
        # Process messages, call tools, return response
        pass
    
    async def on_messages_stream(self, messages, cancellation_token):
        # Streaming version
        yield TextMessage(content="...", source=self.name)
```

**Key insight:** AutoGen favors composition over hooks — you build custom agents rather than attaching callbacks.

---

## 6. Temporal.io / Inngest

### Temporal — Interceptor Pattern

**Architecture:** Interceptor chain wrapping inbound/outbound calls. Most mature middleware pattern.

| Interceptor Type | What it wraps |
|-----------------|---------------|
| `WorkflowInboundCallsInterceptor` | Workflow execution, Signals, Queries |
| `WorkflowOutboundCallsInterceptor` | Scheduling Activities, starting Timers |
| `ActivityInboundCallsInterceptor` | Activity `execute` calls |
| `WorkflowClientInterceptor` | Client calls (start workflow, signal) |
| `NexusInboundCallsInterceptor` | Nexus Operation calls |

**Key pattern: `next()` chain — interceptors wrap the entire call:**

```typescript
class ActivityLogInterceptor implements WorkflowOutboundCallsInterceptor {
    async scheduleActivity(input: ActivityInput, next: Next<...>): Promise<unknown> {
        console.log('Starting activity', { activityType: input.activityType });
        try {
            return await next(input);  // Execute + all downstream interceptors
        } finally {
            console.log('Completed activity', { activityType: input.activityType });
        }
    }
}

// Registration
const worker = await Worker.create({
    interceptors: {
        workflowModules: [require.resolve('./workflows/my-interceptors')],
    },
});
```

| Aspect | Detail |
|--------|--------|
| **Registration** | Worker constructor `interceptors` option + file-based workflow interceptor modules |
| **Sync/Async** | Async (Promise-based) |
| **Flow modification** | YES — interceptors can modify input, transform output, swallow errors, or throw |
| **Error handling** | Interceptors participate in error chain — can catch, transform, or re-throw |
| **Composability** | Chain of responsibility — multiple interceptors wrap each other |

### Inngest — Middleware System

**Architecture:** Class-based middleware with lifecycle hooks per function run.

| Hook | When |
|------|------|
| `onRunStart` | Before function handler on first attempt |
| `onRunComplete` | After function completes |
| `wrapFunctionHandler` | Wraps entire function execution (before + `next()` + after) |
| `transformFunctionInput` | Modify function input (dependency injection) |
| `onRegister` (static) | One-time setup when middleware registered |

```typescript
class MyMiddleware extends Middleware.BaseMiddleware {
    id = "my-middleware";
    
    onRunStart({ ctx, functionInfo }) {
        console.log(`Starting ${functionInfo.id}`);
    }
    
    async wrapFunctionHandler({ next }) {
        console.log("before");
        const result = await next();  // Wraps execution
        console.log("after");
        return result;
    }
    
    transformFunctionInput(args) {
        return { ...args, ctx: { ...args.ctx, db: myDbClient } };
    }
}

const inngest = new Inngest({
    id: "my-app",
    middleware: [MyMiddleware],
});
```

| Aspect | Detail |
|--------|--------|
| **Registration** | Client-level or function-level `middleware` array |
| **Sync/Async** | Both supported — SDK awaits all hooks |
| **Flow modification** | YES via `wrapFunctionHandler` + `transformFunctionInput` |
| **Error handling** | Middleware can catch errors in `wrapFunctionHandler` |
| **Ordering** | Client middleware → Function middleware, descending order |

---

## 7. Airflow

**Architecture:** Pluggy-based listener system + per-DAG/task callbacks.

### Global Listeners (via Pluggy)

| Listener | When |
|----------|------|
| `on_starting` / `before_stopping` | Scheduler lifecycle |
| `on_dag_run_running` | DAG run begins |
| `on_dag_run_success` | DAG run succeeds |
| `on_dag_run_failed` | DAG run fails |
| `on_task_instance_running` | Task begins execution |
| `on_task_instance_success` | Task completes |
| `on_task_instance_failed` | Task fails (receives `error` param) |
| `on_task_instance_skipped` | Task skips itself |
| `on_asset_created` / `on_asset_changed` | Asset lifecycle |
| `on_new_dag_import_error` | DAG import fails |

### Per-DAG/Task Callbacks

| Callback | Scope |
|----------|-------|
| `on_success_callback` | Per-task or per-DAG |
| `on_failure_callback` | Per-task or per-DAG |
| `on_retry_callback` | Per-task |
| `on_execute_callback` | Per-task (pre-execute) |
| `sla_miss_callback` | DAG-level SLA |

```python
from airflow.listeners import hookimpl

@hookimpl
def on_task_instance_failed(previous_state, task_instance, error):
    send_alert(f"Task {task_instance.task_id} failed: {error}")

@hookimpl
def on_dag_run_success(dag_run, msg):
    notify_team(f"DAG {dag_run.dag_id} completed successfully")
```

| Aspect | Detail |
|--------|--------|
| **Registration** | Listeners via Airflow Plugin system; callbacks via DAG/task definition |
| **Sync/Async** | Listeners are synchronous (Pluggy); notifiers support `async_notify()` |
| **Flow modification** | Listeners are observational only; callbacks can't abort |
| **Error handling** | Listener errors can impact the component they run in (scheduler etc.) |
| **Scope** | Listeners are global (all DAGs); callbacks are per-DAG/task |

---

## 8. Dagster / Prefect

### Dagster

**Architecture:** Event-stream based with op-level hooks and sensors.

| Mechanism | When |
|-----------|------|
| `@success_hook` | Op/asset succeeds |
| `@failure_hook` | Op/asset fails |
| `HookContext` | Provides op info, resources, logging in hooks |
| Op events | `AssetMaterialization`, `ExpectationResult`, `Output` events |
| Sensors | React to external events, trigger runs |

```python
from dagster import success_hook, failure_hook, HookContext

@success_hook
def my_success_hook(context: HookContext):
    context.log.info(f"Op {context.op.name} succeeded")

@failure_hook  
def my_failure_hook(context: HookContext):
    send_alert(f"Op {context.op.name} failed")

@job(hooks={my_success_hook, my_failure_hook})
def my_job(): ...
```

### Prefect

**Architecture:** Decorator-based with state-change hooks.

| Hook | Available on |
|------|--------------|
| `on_completion` | `@flow`, `@task` |
| `on_failure` | `@flow`, `@task` |
| `on_cancellation` | `@flow`, `@task` |
| `on_crashed` | `@flow`, `@task` |
| `on_running` | `@flow`, `@task` |

```python
from prefect import flow, task

def my_hook(flow, flow_run, state):
    print(f"Flow {flow.name} entered state {state.name}")

@flow(on_completion=[my_hook], on_failure=[my_hook])
def my_flow():
    return "done"
```

---

## Structured Comparison Table

| Framework | Lifecycle Events | Registration | Sync/Async | Can Modify Flow? | Hook Error Handling | Hook Scopes |
|-----------|-----------------|-------------|------------|------------------|--------------------:|-------------|
| **Claude/Anthropic SDK** | None (you own the loop) | N/A | Your choice | Full control | Your responsibility | N/A |
| **OpenAI Agents SDK** | 7 (agent/llm/tool start+end, handoff) | `Runner.run(hooks=)` or `Agent(hooks=)` | Async (awaited) | No (use Guardrails) | Propagates to caller | Run + Agent |
| **LangChain/LangGraph** | 13+ (llm/chain/tool/retriever/agent) | `config={"callbacks": [...]}` | Both sync + async | No (observational) | Logged, doesn't halt | Per-invocation, propagates to children |
| **CrewAI** | 4 (before/after kickoff, step_cb, task_cb) | Decorators + constructor args | Sync (async via akickoff) | Yes (modify I/O in before/after) | Doesn't halt execution | Crew-level |
| **AutoGen** | Message-event types (no formal hooks) | Custom agent subclass | Async | Via custom agent logic | Via async generators | Per-agent |
| **Temporal** | Per-interceptor-type (workflow/activity/nexus) | Worker constructor + module files | Async (Promise) | YES (full wrap+modify) | Participate in error chain | Inbound + Outbound per type |
| **Inngest** | 4 (runStart, runComplete, wrap, transform) | Client/function `middleware` array | Both | YES (wrap + transform) | Caught in wrap handler | Client + Function |
| **Airflow** | 10+ (dag/task running/success/failed/skipped + lifecycle) | Plugin system (Pluggy) | Sync (Pluggy) | No (observational) | Can impact host component | Global + Per-task |
| **Dagster** | 2 (success_hook, failure_hook) + event stream | `@job(hooks={...})` | Sync | No (observational) | Logged | Job/Op level |
| **Prefect** | 5 (completion/failure/cancellation/crashed/running) | `@flow(on_failure=[...])` | Both | No (observational) | Logged | Flow + Task |

---

## Key Patterns & Best Practices

### Pattern 1: Two-Tier Hooks (Best for AI Agents)
**Used by:** OpenAI Agents SDK

```
RunHooks (global scope) ──► applies to ALL agents in a run
AgentHooks (per-agent)  ──► applies to ONE specific agent
```

**Why it works:** In multi-agent DAG workflows, you need both global cross-cutting concerns (logging, tracing) AND agent-specific behavior (rate limiting for expensive models, custom validation for specific stages).

### Pattern 2: Middleware `next()` Chain (Best for Wrapping)
**Used by:** Temporal, Inngest, Express.js

```typescript
async wrapExecution({ next }) {
    // BEFORE logic
    const startTime = Date.now();
    try {
        const result = await next();  // Execute wrapped code
        // AFTER logic (success)
        return result;
    } catch (error) {
        // AFTER logic (error) - can transform, retry, or re-throw
        throw error;
    } finally {
        // ALWAYS logic
        metrics.record(Date.now() - startTime);
    }
}
```

**Why it works:** Gives hooks full control — they can measure timing, catch errors, transform results, add retry logic, or completely replace execution.

### Pattern 3: Guardrails as Separate Flow-Control Mechanism
**Used by:** OpenAI Agents SDK

**Key insight:** Keep observational hooks (logging, tracing) separate from flow-control hooks (abort, skip, retry). This prevents accidental execution halts from logging code.

```
Lifecycle Hooks ──► observe only, never throw
Guardrails     ──► validate, CAN halt via tripwire
```

### Pattern 4: Decorator-Based Registration (Best for Simplicity)
**Used by:** CrewAI, Airflow, Dagster, Prefect

```python
@before_kickoff     # CrewAI
@success_hook       # Dagster
@hookimpl           # Airflow (Pluggy)
@flow(on_failure=[hook])  # Prefect
```

### Pattern 5: Event-Stream Architecture (Best for Decoupling)
**Used by:** AutoGen, Dagster, LangGraph

Rather than explicit hooks, emit typed events that consumers subscribe to. This is the most decoupled pattern but provides less control over execution flow.

---

## Recommendations for GeneratorAI

Based on this research, the optimal hook system for GeneratorAI's DAG-based multi-stage AI agent workflow should combine:

| Aspect | Recommended Pattern | Inspiration |
|--------|-------------------|-------------|
| **Hook scopes** | 3-tier: Run-level + Stage-level + Global | OpenAI (2-tier) + Airflow (global listeners) |
| **Hook types** | Observational hooks + Flow-control guardrails (separate) | OpenAI Agents SDK |
| **Registration** | Code-based: composition root injection + per-stage config | Temporal + OpenAI |
| **Execution model** | Async-awaited + `next()` wrapping for pre/post | Temporal + Inngest |
| **Error isolation** | Hooks wrapped in try/catch; errors logged but don't halt unless guardrail | Airflow + OpenAI |
| **Core events** | `on_stage_start`, `on_stage_end`, `on_stage_error`, `on_tool_use`, `on_llm_start`, `on_llm_end`, `on_run_start`, `on_run_end`, `on_handoff` | OpenAI + Airflow |
| **Custom script execution** | Sandboxed function execution at lifecycle points (inline JS/TS or external script path) | n8n Code node + Airflow PythonOperator |

### Suggested Hook Interface for GeneratorAI

```typescript
interface StageHooks {
    onStageStart?(ctx: StageHookContext): Promise<void>;
    onStageEnd?(ctx: StageHookContext, output: StageOutput): Promise<void>;
    onStageError?(ctx: StageHookContext, error: Error): Promise<ErrorAction>;  // retry | skip | abort
    onToolStart?(ctx: StageHookContext, tool: ToolCall): Promise<void>;
    onToolEnd?(ctx: StageHookContext, tool: ToolCall, result: string): Promise<void>;
    onLLMStart?(ctx: StageHookContext, prompt: string): Promise<void>;
    onLLMEnd?(ctx: StageHookContext, response: string): Promise<void>;
}

interface RunHooks {
    onRunStart?(ctx: RunHookContext): Promise<void>;
    onRunEnd?(ctx: RunHookContext, output: RunOutput): Promise<void>;
    onRunError?(ctx: RunHookContext, error: Error): Promise<void>;
    onStageTransition?(ctx: RunHookContext, from: string, to: string): Promise<void>;
}

// Flow-control guardrails (separate from observational hooks)
interface StageGuardrails {
    validateInput?(ctx: StageHookContext, input: string): Promise<GuardrailResult>;
    validateOutput?(ctx: StageHookContext, output: string): Promise<GuardrailResult>;
}

type GuardrailResult = { pass: true } | { pass: false; action: 'abort' | 'retry' | 'skip'; reason: string };
```

---

## Sources

- OpenAI Agents SDK: https://openai.github.io/openai-agents-python/ref/lifecycle/
- OpenAI Guardrails: https://openai.github.io/openai-agents-python/guardrails/
- Anthropic Tool Use: https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview
- CrewAI Crews: https://docs.crewai.com/concepts/crews
- AutoGen Agents: https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/agents.html
- Temporal Interceptors: https://docs.temporal.io/develop/typescript/interceptors
- Inngest Middleware: https://www.inngest.com/docs/features/middleware/create
- Airflow Listeners: https://airflow.apache.org/docs/apache-airflow/stable/administration-and-deployment/listeners.html
- Dagster Ops: https://docs.dagster.io/guides/build/ops
- Prefect: https://docs.prefect.io/v3/develop/write-tasks

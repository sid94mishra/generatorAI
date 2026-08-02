# 04 — CLI + copilot-bridge (`apps/cli` + `packages/copilot-bridge`)

Detailed implementation plan for the 2 Critical + 9 High findings across sections D (CLI) and E (Copilot-bridge) of [../CODE_REVIEW.md](../CODE_REVIEW.md).

---

## CLI

### [CRITICAL] `--detach` has no polling helper — `apps/cli/src/commands/automationControl.ts:47` (and equivalent for workflow run detach in `workflowRun.tsx`)

**Fix.** New command `generatorai automation execution watch <automationId> <executionId>` that renders the existing `AutomationProgress` Ink component against a live-fetched execution. Subscribe via the platform client (Direct or HTTP). Same pattern for workflow runs: `generatorai workflow watch <runId>` (already exists in workflowWatch.tsx — verify parity).

Update the `--detach` hint messages to point at these commands.

**Effort:** S.

### [HIGH] Composition-root duplicates server — `apps/cli/src/platform/composition-root.ts` vs `apps/server/src/composition-root.ts` (~350 lines overlap)

**Fix.** Extract shared wiring to new `packages/core/src/bootstrap/Container.ts`:

```ts
export interface CoreServices {
  eventBus: EventBus;
  sessionAllocator: SessionAllocator;
  chatManagementService: ChatManagementService;
  workflowDefinitionService: WorkflowDefinitionService;
  dagScheduler: DAGScheduler;
  stageExecutionService: StageExecutionService;
  workflowRunService: WorkflowRunService;
  /* + repos accessible to consumers: chatEntityRepo, workflowRunRepo, stageRunRepo, stageDefinitionRepo, stageEdgeRepo, … */
}

export function createCoreServices(
  db: AppDatabase,
  config: AppConfig,
  logger: ILogger,
  copilot: ICopilotPort,
  hookExecutor: HookExecutor,
  hookInterceptor: HookInterceptor,
  scriptRunner: IScriptRunner,
  httpClient: IHttpClient,
  gitManager: GitManager,
  templateRegistry: TemplateRegistry,
): CoreServices { /* all the current repo+service wiring */ }
```

Server composition root keeps: DB boot, Copilot boot, sandbox lifecycle, streaming manager, orchestrator + preprocessor + result validator + automation, and delegates core service wiring to `createCoreServices(...)`.

CLI composition root: same delegation, no streaming/sandbox wiring.

**Effort:** M. **Ripple.** Both composition roots shrink ~150 lines each. Changes to service signatures land in one place. Precondition for 1.6 SessionAllocator persistence and 1.23 cron lease.

### [HIGH] Subscribe semantic asymmetry — `DirectPlatformClient.ts:186–205` vs `HttpPlatformClient.ts:200–230`

**Fix.** DirectPlatformClient.subscribeToEvents gains the same `onConnected` / `onReconnecting` / `onDisconnected` lifecycle callbacks as HTTP. Direct mode fires `onConnected` synchronously on subscribe and `onDisconnected` on unsubscribe. Applies the same `afterSequence` and `kindPrefixes` filtering locally.

This keeps CLI TUI components (`DAGProgress`, `AutomationProgress`) identical across `--direct` and `--http` modes.

**Effort:** S.

### [HIGH] Synchronous `readdirSync` 10-depth artifact listing — `apps/cli/src/components/DAGProgress.tsx:76-93`

**Fix.**
1. Replace `fs.readdirSync` with `fs.promises.readdir(… {withFileTypes: true})`.
2. Reduce depth cap from 10 → 5 (sufficient for typical DAG workspaces).
3. Exclude directories: `.git`, `node_modules`, `.next`, `dist`, `build`, `.cache`.
4. Detect symlinks via `fs.lstat` and skip.
5. Call from a React effect; setState on completion.

**Effort:** S.

### [HIGH] `loadConfig` only deep-merges `copilot` + `webhooks` — `apps/cli/src/config/loadConfig.ts:127-141`

**Fix.** Generalize: for every key present in any of `{fileConfig, envOverrides, cliOverrides}`, if any value is a non-null non-array object, deep-merge all three. Else take highest-precedence scalar. No hardcoded allowlist.

**Effort:** S. **Acceptance:** `--sandbox.provider=host` overrides file-level `sandbox: { provider: 'docker', image: 'foo' }` without losing `image`.

### Additional CLI ripple — Ctrl+C in HTTP mode doesn't cancel the remote run

**Fix.** CLI's SIGINT handler, when `HttpPlatformClient` was used for the active run, calls `client.cancelRun(runId)` before shutdown. Preserve 5 s grace on the ACK before force-exit.

**Effort:** S. **Deps:** this leans on 0.1 auth landing so cancel requests authenticate.

---

## Copilot-bridge

### [CRITICAL] Zero tests — `packages/copilot-bridge/`

**Fix.** Build a three-file test suite:

**`__tests__/CopilotAdapter.test.ts`**
- `initialize/stop/forceStop/shutdown` lifecycle — asserts client.start/stop is called, polling interval set/cleared, `activeSessions` metric incremented.
- `createConversation` with all options — systemMessage, tools (via `createSdkTool`), mcpServers, provider BYOK, `onPermissionRequest`, `skillDirectories`, `customAgents`, streaming flag.
- `resumeConversation` — in-memory path (no-op) vs cross-process path (calls `client.resumeSession`); cleanup of listener tracking on handle replacement.
- `sendPromptAndWait` — resolves on `session.idle`, rejects on `session.error`, returns last assistant message + tool calls.
- `sendPrompt` — fire-and-forget; no idle wait.
- `onConversationEvent` — handler registered, mapped, cleanup on unsubscribe; listener tracking set pruned on delete.
- `deleteConversation` / `destroyConversation` — cleanup flow.
- Client state polling — maps SDK states (`connected|connecting|disconnected|error`) to core states.

**`__tests__/event-mapper.test.ts`** — one test per SDK event kind:
- `assistant.message_delta → copilot.token`
- `assistant.message → copilot.message_complete`
- `assistant.reasoning_delta → copilot.reasoning_delta`
- `assistant.reasoning → copilot.reasoning_complete`
- `tool.execution_start → copilot.tool_start` (preserves `callId`)
- `tool.execution_complete → copilot.tool_complete` (callId, result, success)
- `session.idle|error|start → copilot.idle|error|session_start`
- `user.message → copilot.user_message`
- `assistant.usage → copilot.usage`
- `assistant.turn_start|turn_end`
- `session.info / pending_messages.modified / session.usage_info → copilot.session_info` (collapsed)
- unknown SDK type → `copilot.unknown` with raw in data
- Edge cases: `data` null/undefined → coerced to `{}`; missing optional fields.

**`__tests__/tool-factory.test.ts`**
- `createSdkTool` wraps definition with name/description/schema.
- Handler arg normalization: `null`, primitive, array → `{}`; object passthrough.
- `buildSdkTools` maps arrays.

**Mocking strategy.** `vi.mock('@github/copilot-sdk', () => ({ CopilotClient: vi.fn(...), defineTool: vi.fn(...) }))` returning stub sessions with `send / on / getMessages / abort / destroy`.

**Effort:** L (2–3 days). **Acceptance:** ≥90% coverage on the three source files; `pnpm --filter @generatorai/copilot-bridge test` green; wired into `turbo test` + CI.

### [HIGH] Heavy `as unknown as` / `Record<string, unknown>` casts — `CopilotAdapter.ts:69, 196, 230, 372, 397`, `event-mapper.ts:38/43/62`, `tool-factory.ts:22`

**Fix.** Each cast addressed individually:

- **Line 69 (client options).** Build with proper `ConstructorParameters<typeof CopilotClient>[0]` type; the single `cliUrl` conditional assignment uses a narrow `(opts as Record<string, unknown>)[key] = value` instead of casting the whole thing.
- **Line 196 (mcpServers).** Replace double-cast with a per-entry mapper that extracts only the known fields.
- **Line 230 (permission details).** Don't spread `sdkRequest` as unknown; construct an explicit `details` object copying only safe fields.
- **Lines 372/397 (event data in `sendPromptAndWait`).** Coerce to `Record<string, unknown>` once at the top of the callback; downstream accesses are narrow.
- **event-mapper.ts 38/43/62.** Coerce `sdkEvent.data` once near line 41 (already partly done); reuse the variable.
- **tool-factory.ts:22.** Replace with an IIFE returning `Record<string, unknown>` with full null/array guards.

**Effort:** M. **Acceptance:** `as unknown as` count reduced from 10+ to ≤3; every remaining cast has an explanatory comment.

### [HIGH] Unused options `defaultModel` / `defaultTimeoutMs` / `cliPath` — `CopilotAdapter.ts:42-53`

**Fix.** Pick one path, not both:
- **Option A (recommended): wire them up.** `defaultModel` → default when `createConversation.params.model` is undefined. `defaultTimeoutMs` → feeds the `sendPromptAndWait` timeout (coordinates with 2.25). `cliPath` → pass to `CopilotClient` options.
- **Option B (remove):** delete from interface; remove from CLI + server composition roots.

**Effort:** S.

### [HIGH] `resumeConversation` no-ops when in-memory — `CopilotAdapter.ts:246-267`

**Fix.** Keep the no-op for in-memory case (deliberate for single-session reuse across stages within one process). Before calling `client.resumeSession` in the cross-process path, clean up lingering listener cleanups from prior handles. On SDK failure, throw a descriptive error instead of silently succeeding. Extensive docstring explaining the tradeoff.

**Effort:** S.

### [HIGH] `sendPromptAndWait` has no timeout — `CopilotAdapter.ts:335-395`

**Fix.** New optional param `timeoutMs?: number` (default 5 × 60 000 = 5 min). On timeout: reject with `Prompt timeout after Xms`. `clearTimeout` and `session.on` `unsubscribe` in a `finally` block. Update `ICopilotPort.sendPromptAndWait` signature; callers in `StageExecutionService` can pass stage-level timeouts from the `StageDefinition.timeoutMs` field.

**Effort:** M. **Deps:** coordinate with 1.24 AbortSignal propagation — on timeout, also call `session.abort()` so the SDK stops working rather than just rejecting our wait.

---

## CLI cross-cutting note — 1.3 shared composition-root is the highest-leverage item here

Landing `packages/core/src/bootstrap/Container.ts` first unblocks:
- Clean fix for subscribe asymmetry (platform clients delegate uniformly to core events).
- Ctrl+C cancel in HTTP mode (reuses server's shutdown order).
- Future sandbox/cron improvements that touch both processes.

Sequence the subsystem work: 1.3 → CLI subscribe parity → CLI Ctrl+C cancel → everything else.

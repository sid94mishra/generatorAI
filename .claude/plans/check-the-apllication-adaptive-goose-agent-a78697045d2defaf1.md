# CLI Implementation Plan Review

## Executive Summary

The plan is well-structured, comprehensive in most areas, and architecturally sound. It correctly identifies the Ink+Zustand+Commander stack, follows modern agentic CLI patterns, and handles the hardest problems (SSE streaming, HITL, DAG visualization) with appropriate depth. However, there are **concrete API coverage gaps**, an **overly optimistic timeline**, and several **missing cross-cutting concerns** that need attention before implementation begins.

---

## 1. Completeness: API Coverage Gaps

### What the plan covers well
- Chat CRUD + prompts + messages + SSE: **Complete**
- Workflow Definitions CRUD + stages + edges + validate + import/export: **Complete**
- Workflow Runs CRUD + lifecycle + per-stage controls + HITL: **Complete**
- Automations CRUD + enable/disable + trigger + executions + data source test: **Complete**
- Projects CRUD + codebases + configs + MCP servers + worktrees + file browser: **Complete**
- Templates list/get: **Complete**
- Webhooks CRUD: **Complete**
- Hooks list + test: **Complete**
- Workspaces list/show/archive/commit/delete/cleanup: **Complete**
- Streaming unified SSE + replay: **Complete**

### MISSING endpoints not covered by the command tree

**A. Orchestrator routes (entire subsection omitted)**
The plan maps `run workspace` and `run diff` but completely omits the **orchestrator-specific** endpoints, which are a distinct route group (`/api/orchestrator/`):

| Server Endpoint | Plan Coverage |
|---|---|
| `GET /orchestrator/system-workflows` | MISSING - not in any command |
| `GET /orchestrator/system-workflows/:id` | MISSING |
| `POST /orchestrator/from-template` | MISSING - distinct from `workflow import-template` |
| `POST /orchestrator/runs` | MISSING - starts an *orchestrated* run (different from `run create` + `run start`) |
| `GET /orchestrator/runs/:id/context` | MISSING - gets orchestration context |
| `POST /orchestrator/runs/:id/cancel` | MISSING - cancels an orchestrated run |
| `POST /orchestrator/workflows/:id/uploads` | MISSING - file upload to workflow definition |
| `GET /orchestrator/workflows/:id/files` | MISSING - list workflow-level files |
| `GET /orchestrator/workflows/:id/files/download` | MISSING - download workflow file |
| `DELETE /orchestrator/workflows/:id/files` | MISSING - delete workflow file |
| `POST /orchestrator/runs/:id/uploads` | MISSING - upload skills/prompts/agents per-run |
| `GET /orchestrator/runs/:id/workspace` | Partially covered by `run workspace` |
| `GET /orchestrator/runs/:id/workspace/download` | MISSING |
| `GET /orchestrator/runs/:id/workspace/content` | MISSING - read file as text |
| `GET /orchestrator/runs/:id/workspace/diff` | Partially covered by `run diff` |

**Recommendation:** Add an `orchestrator` command group or extend `workflow` and `run`:
```
generatorai orchestrator
    system-workflow list
    system-workflow show <id>
    from-template <templateId> [--name] [--var key=val]...
    start <definitionId> [--var key=val]... [--project] [--codebase]...
    context <runId>
    cancel <runId>
    upload <defOrRunId> --category <skills|agents|prompts> --file <path>...
    files <defId>
    download <defOrRunId> --path <p> [--source workspace|artifacts|uploads]
    content <runId> --path <p> [--source workspace|artifacts|uploads]
```

**B. Copilot routes (partially omitted)**
- `GET /copilot/conversations` -- MISSING (list active SDK conversations)
- `GET /copilot/conversations/:id/messages` -- MISSING (SDK conversation messages)
- `POST /copilot/ping` -- covered as `system health`, but plan's `system status` maps to `copilot/state` without mentioning these

**Recommendation:** Add under `system`:
```
generatorai system conversations [--limit]
generatorai system conversation-messages <id>
```

**C. Sessions route**
- `GET /sessions/:sessionId/chat` -- MISSING (per-session message history with optional `?stageRunId` filter). Used by the web UI to show per-stage messages on the workflow run page.

**Recommendation:** Add `run messages <runId> [--stage <stageId>]` that resolves the session and calls this endpoint.

**D. Health config endpoint**
- `GET /health/config` -- MISSING (returns server's public config: port, max sessions, streaming config, copilot defaults, sandbox settings)

**Recommendation:** Add `system config` command or fold into `system health --verbose`.

**E. Automation webhook token rotation**
- `POST /automations/:id/rotate-webhook-token` -- MISSING
- `POST /automations/webhooks/:token` -- MISSING (public webhook trigger by token)

**Recommendation:** Add:
```
generatorai automation rotate-token <id>
generatorai automation webhook-trigger <token> [--payload-file <f>]
```

**F. Project codebase status endpoint**
- `GET /projects/:id/codebases/:cid/status` -- MISSING (get codebase git status)

**Recommendation:** Add `project codebase status <projectId> <codebaseId>`

**G. Project available-artifacts endpoint**
- `GET /projects/:id/available-artifacts` -- MISSING (merged system + project artifacts)

**Recommendation:** Add `project artifacts <projectId> [--type agent|prompt|skill]`

**H. MCP server update endpoint**
- `PUT /projects/:id/mcp-servers/:mid` -- MISSING (update MCP server config). Plan only has add/list/remove.

**Recommendation:** Add `project mcp-server update <projectId> <serverId> [--name] [--url] [--command] [--enabled]`

**I. Workspace worktrees endpoint**
- `GET /workspaces/:id/worktrees` -- MISSING (list worktrees for a workspace)

**Recommendation:** Add `workspace worktrees <id>`

**J. OpenAPI spec endpoint**
- `GET /api/openapi.json` and `GET /api/docs` -- Not critical for CLI, but `generatorai system openapi` could be useful for development.

### Summary: ~20 endpoints are missing from the command tree out of the 120+ total.

---

## 2. Architecture Review

### What is well-justified

**Commander 13 + Ink 5 + Zustand 5:** Excellent choice. Commander is already in the monorepo, Ink is the standard for React-in-terminal TUIs (Claude Code itself uses Ink), and Zustand eliminates the prop-drilling problem that plagued the deprecated CLI. The team's React expertise transfers directly.

**Two-mode platform client (Http + Direct):** Correct architectural decision. The interface-based port abstraction matches the codebase's existing DI patterns. The factory function is clean.

**SSE architecture (eventsource -> EventRouter -> StreamBlocks -> Zustand -> Ink):** Sound. The plan correctly identifies the unified `/api/stream` endpoint and the `Last-Event-ID` replay semantics. The StreamBlock type union is well-designed.

### Gaps and concerns

**2a. SSE reconnection resilience not specified.** The plan mentions `eventsource 4` for auto-reconnect but does not describe:
- What happens when the server restarts and the in-memory buffer is lost
- How the CLI falls back to REST replay (`/api/stream/replay`) when SSE replay exceeds the sync cap (200 events)
- How the sequence-based dedup works on the client side to avoid duplicate rendering

The web client's `sseManager.ts` already solves this with a dedup set keyed on `sequenceId`. The plan says "copy SSE reconnection + dedup logic" but does not specify *how* it adapts to the CLI's Zustand store model.

**Action:** Add a "Reconnection Protocol" subsection in section 5 that explicitly describes:
1. On SSE disconnect, the `eventsource` library auto-reconnects with `Last-Event-ID`
2. If the server returns events, they're deduped against `streamStore`'s last-seen seq
3. If the gap is too large (>200 events missed), CLI calls `/api/stream/replay` in a paginated loop until caught up, then resumes SSE
4. On server restart (seq reset), detect via a seq regression and full-flush the store

**2b. Direct mode feature boundary is vague.** The plan says DirectPlatformClient provides "Core features only (no projects, no orchestrator)" but doesn't enumerate what that means. The deprecated client has 648 lines -- which methods are stubs that throw `NotSupportedError`? Without this, a user in `--direct` mode will hit confusing runtime errors.

**Action:** Add a table listing which command groups work in direct mode vs HTTP mode, and have the CLI detect direct mode at command registration time to hide or annotate unsupported commands.

**2c. The `@generatorai/streaming` package is not in the dependency list.** The plan lists `@generatorai/core` and `@generatorai/db` but the streaming package (`packages/streaming`) contains `DurableStreamManager` types that the Direct mode client would need for in-process streaming.

**2d. No error boundary strategy for Ink.** Ink crashes hard on unhandled React errors. The plan's Phase 7 mentions "Error handling: graceful failures" but doesn't describe a React error boundary component for the TUI. Claude Code and similar tools wrap their entire Ink tree in an error boundary that prints a stack trace and gracefully exits.

**Action:** Add an `ErrorBoundary.tsx` component to the Phase 6 deliverables.

---

## 3. Feasibility: Timeline Assessment

### The 9-week timeline is optimistic by 3-5 weeks.

**Phase 1 (2 weeks): Realistic.** Foundation work is well-scoped, largely copy-adapt from deprecated CLI.

**Phase 2 (1 week for chat + streaming): Too tight.** Streaming output with collapsible tool calls, markdown rendering, multi-line input with history, and SSE subscription is a minimum 2-week effort. The `StreamingOutput` component alone (381 lines in the deprecated CLI) needs significant enhancement. Chat `start` requires an interactive loop that manages SSE subscription, user input, HITL prompts, and graceful shutdown -- this is one of the hardest components.

**Phase 3 (1 week for workflow + DAG visualization): Reasonable** if dagre layout + ASCII rendering is a pre-existing pattern. If building box-drawing + edge routing from scratch in ASCII, add a week.

**Phase 4 (1 week for runs + live DAG): Too tight.** Live streaming DAG with per-stage output selection, HITL approval inline, stage-level controls -- this is the showcase feature and deserves 2 weeks.

**Phase 5 (1 week for automation + project + webhook + hook + workspace): Too tight.** This is 5 command groups with ~35 commands total. Even with straightforward CRUD wrapping, wiring + testing = 2 weeks.

**Phase 6 (2 weeks for full TUI with 15 views + 8 stores + 20 components): Severely underestimated.** The TUI is essentially a second application. 15 views, each with data fetching, keyboard navigation, SSE subscriptions, and error handling. The deprecated CLI had only 9 views and was incomplete. Realistic estimate: 4-5 weeks for a quality TUI, or 2-3 weeks if views are built incrementally as "good enough" and polished later.

**Phase 7 (1 week for polish + testing + docs): Too tight.** ~30 test files, integration tests against a running server, help text for every command. Minimum 2 weeks.

### Realistic timeline: 12-14 weeks total

Or: cut the TUI to MVP (5-7 views instead of 15) for the initial release, and ship remaining views as a follow-up. This would bring it to ~10 weeks.

### Dependency risks

1. **`@github/copilot-sdk@^0.1.0` stability.** Pinned at 0.1.25, pre-1.0. SDK changes could break the copilot-bridge and require cascading CLI changes. Mitigation: the CLI talks to the server (which wraps the SDK), not directly -- but Direct mode *does* depend on the SDK transitively.

2. **`eventsource` v4.** Verify it supports the `Last-Event-ID` header correctly on reconnect and handles CORS/auth headers if the server ever adds API key checks.

3. **`@dagrejs/dagre` for ASCII.** Dagre outputs x/y coordinates for SVG layout. Converting to ASCII box-drawing requires a custom renderer that maps floating-point positions to character grid cells. This is non-trivial and not off-the-shelf. Consider `ascii-dag` or `terminal-dag` alternatives, or allocate time for a custom renderer.

4. **Ink 5 + React 19 compatibility.** Ink 5 targets React 18. React 19 is listed in dependencies. Verify compatibility -- Ink's `render()` may use deprecated React APIs.

---

## 4. Modern Agentic CLI Patterns

### What the plan gets right

- **Streaming sliding-window:** `<Static>` for completed blocks, dynamic area for live block -- matches Claude Code's pattern exactly.
- **Collapsible tool calls:** `ToolCallDisplay` component with expand/collapse -- matches Claude Code, Codex.
- **HITL prompts inline:** `permission.requested` triggers inline `[y/N/always]` -- follows Claude Code's permission model.
- **`--json` for machine output:** NDJSON streaming mode, pipeable to `jq` -- essential for CI/CD.
- **Layered config:** 5-layer precedence with env vars, project config, user config -- matches Claude Code's `.claude/` conventions.
- **Zustand stores matching web:** Reduces cognitive load for developers working on both.

### What is missing from modern patterns

**4a. Shell completions.** Not mentioned anywhere. Claude Code, GitHub CLI, and every serious CLI ship with `completion` subcommand that generates bash/zsh/fish completions. This is a force-multiplier for power users.

**Action:** Add `generatorai completion [bash|zsh|fish|powershell]` to Phase 7. Commander has plugins for this.

**4b. Update notifications.** No mention of version checking or update prompts. Claude Code and GitHub CLI check for new versions periodically.

**Action:** Add a lightweight version check on startup (cached, non-blocking) that prints "A new version is available" if behind.

**4c. Telemetry/analytics opt-in.** Not mentioned. Modern CLIs (Vercel, Turbo, Claude Code) include anonymous usage telemetry with opt-out. Important for understanding which commands are used.

**4d. Compact/verbose mode for streaming.** The plan has `streamVerbosity: minimal|normal|verbose` in config but doesn't describe what each level shows/hides. Define:
- `minimal`: final output only, no thinking, no tool calls
- `normal`: thinking collapsed, tool calls one-line summary
- `verbose`: everything expanded, timing info, token usage

**4e. Progress spinners for non-streaming commands.** The plan mentions `Spinner` component but doesn't describe a pattern for wrapping async HTTP calls. Every CRUD command should show a spinner while awaiting the server response.

---

## 5. Missing Cross-Cutting Concerns

### 5a. Auth flow
The CLAUDE.md says "No auth. The server has zero user/session authentication." The plan includes `--api-key` flag and `GENERATORAI_API_KEY` env var, which suggests auth is coming. But there's no description of:
- How the API key is validated server-side (the server currently has no auth middleware except webhook HMAC)
- Token refresh or expiration
- Interactive login flow

**Recommendation:** Either remove `--api-key` from the plan (since the server doesn't support it) or add a note that this is forward-looking and will be a no-op until server auth is implemented. Avoid building auth plumbing that has no backend.

### 5b. Error recovery
Phase 7 mentions "Error handling: graceful failures, network drops, auth errors" as a bullet point. This needs expansion:
- **Network drops during streaming:** Does the CLI show "Connection lost, reconnecting..." or silently retry?
- **Server 5xx errors:** Does the CLI retry with exponential backoff or fail immediately?
- **Partial failures in multi-step operations:** e.g., `workflow import-template` creates the definition but fails on stage creation. Is there rollback? A clear error message with the partial state?
- **Rate limiting (429):** No mention. Should implement `Retry-After` header handling.

### 5c. Offline mode / Direct mode scope
The `--direct` flag is mentioned but its UX is underspecified:
- How does the CLI discover that no server is running? (health check on startup?)
- Does it auto-fallback to direct mode, or require explicit `--direct`?
- Which data persists between direct-mode sessions? (SQLite DB location?)

### 5d. CI/CD scripting use cases
The plan mentions CI/CD integration as a motivation but doesn't describe:
- **Exit codes:** Which codes for which failure types? (0=success, 1=error, 2=usage, etc.)
- **`--quiet` flag:** Suppress all output except errors (for scripts that only check exit code)
- **`--wait` flag for async operations:** `run start` returns 202 immediately. For CI, you need `generatorai run start <id> --wait --timeout 600` that blocks until completion.
- **Idempotency for scripts:** e.g., `workflow create --name X` should be idempotent (return existing if name matches) or at least have `--if-not-exists`.

### 5e. Plugin/extension system
Not mentioned. Not critical for v1, but worth noting as a future consideration. Commands like `generatorai plugin install <name>` would allow community extensions.

### 5f. Log file output
No mention of `--log-file <path>` for debugging. When users report issues, having a debug log file is essential. The plan has `--verbose` but that goes to stderr mixed with output.

### 5g. Signal handling
Phase 7 mentions "Graceful shutdown (Ctrl+C cleanup)" but doesn't describe:
- SIGINT during a streaming chat: Should it cancel the server-side operation or just disconnect?
- SIGINT during `run watch`: Should it leave the run going or cancel it?
- Double SIGINT: Force-exit without cleanup?

---

## 6. Plan Quality: What is Good

1. **The command tree is well-organized.** `<noun> <verb>` pattern is consistent, subcommand nesting is logical, global options are sensible.

2. **The reuse inventory (Section 9) is specific and actionable.** Listing exact files with line counts and copy/adapt strategy reduces estimation risk.

3. **The TUI layout and keybinding design is thoughtful.** Single-letter nav keys, context-dependent `n` for "new", view stack with `Esc` back -- all match terminal UX conventions.

4. **HITL section is thorough.** Both command-mode and TUI-mode HITL flows are described with the correct API endpoints.

5. **StreamBlock type design is clean.** The discriminated union with `type` field maps directly to the server's event kinds.

6. **The verification plan per phase is concrete.** Each phase has specific smoke test commands, and the end-to-end flow test is a realistic workflow.

---

## 7. Specific Actionable Recommendations

| Priority | Item | Where to Fix |
|---|---|---|
| **P0** | Add Orchestrator command group (20+ endpoints missing) | Section 2: Command Tree |
| **P0** | Add SSE reconnection protocol with REST replay fallback | Section 5: Streaming |
| **P1** | Adjust timeline to 12-14 weeks or cut TUI to 5-7 MVP views | Section 10: Phases |
| **P1** | Add `--wait` and `--timeout` flags for async commands in CI use cases | Section 2: `run start`, `automation trigger` |
| **P1** | Define exit code conventions | New section or append to Section 2 |
| **P1** | Add Ink ErrorBoundary component | Section 3: TUI Architecture |
| **P1** | Verify Ink 5 + React 19 compatibility | Section 1: Technology Stack |
| **P2** | Add shell completions command | Section 2: Command Tree |
| **P2** | Add `--quiet` flag for scripts | Section 2: Global Options |
| **P2** | Add `--log-file` flag for debug output | Section 2: Global Options |
| **P2** | Remove `--api-key` or mark as forward-looking (server has no auth) | Section 2 + Section 6 |
| **P2** | Document Direct mode command availability matrix | Section 4: Platform Client |
| **P2** | Add signal handling specification (SIGINT behavior per context) | Section 7 or new section |
| **P2** | Add missing endpoints: copilot conversations, session messages, codebase status, available-artifacts, MCP server update, workspace worktrees, automation token rotation | Section 2: Command Tree |
| **P3** | Define streamVerbosity levels (what each shows/hides) | Section 6: Config |
| **P3** | Evaluate dagre-to-ASCII feasibility; consider alternatives | Section 7: DAG Visualization |
| **P3** | Add version update notification on startup | Section 7 or config |

---

## 8. Deprecated CLI Location Discrepancy

The plan references the deprecated CLI at `apps/cli/src/` and proposes renaming it to `apps/cli_deprecated/`. However, the actual directory in the repo is already named `apps/cli_depricated/` (note the typo in the actual folder name). The plan should reference the correct path and note the typo. The new CLI can simply be `apps/cli/` since the old one is already moved.

---

## Verdict

**The plan is a strong foundation -- approximately 85% complete.** The architecture, technology choices, and UX design are sound. The main gaps are: (1) the Orchestrator route group is entirely missing from the command tree, (2) the SSE reconnection resilience is underspecified, (3) the timeline needs 3-5 more weeks, and (4) CI/CD scripting ergonomics (`--wait`, exit codes, `--quiet`) are absent.

Fix the P0 items before implementation begins. The P1 items can be addressed during Phase 1. P2/P3 items can be incorporated incrementally.

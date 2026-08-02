# Integrated Terminal — Phase 2 Detailed Plan

**Status:** Draft for user review • Do NOT start implementation until reviewed
**Depends on:** [INTEGRATED_TERMINAL_PLAN_FINAL.md](INTEGRATED_TERMINAL_PLAN_FINAL.md) (Phase 1, shipped in session 80)
**Author:** planning pass, GeneratorAI • 2026-07

> This document specifies the four Phase 2 capabilities called out in the shipped MVP:
>
> 1. **Sandbox-attached terminal** — run the user's terminal inside the run's docker container.
> 2. **Agent-typed commands with per-command confirm** — Cursor / Claude-Code style shell proposals.
> 3. **DB-backed persistence** — terminals + scrollback survive server restart.
> 4. **Session recording & playback** — asciinema-format capture of every session, for audit + debugging.
>
> Each section covers: user story, architecture, current-state delta, trade-offs, effort estimate. Suggested build order and rollback strategy at the end.

---

## 0 · Ground rules that apply to all four

- **Feature-flag every one** — a Phase-2 issue must never break the shipped Phase-1 MVP.
  - `GENERATORAI_TERMINAL_SANDBOX=1` — enables Sandbox-attached toggle
  - `GENERATORAI_TERMINAL_PROPOSALS=1` — enables agent-typed commands
  - `GENERATORAI_TERMINAL_PERSIST=1` — enables DB persistence
  - `GENERATORAI_TERMINAL_RECORD=1` — enables recording
- **No breaking changes** to the WS protocol or REST shape. New endpoints only; new event kinds only.
- **All persistence changes are additive** — the drizzle migration adds tables without touching existing ones.
- **Security-first defaults** — off by default when the toggle carries a real risk (proposals auto-approve, recording, persistence).
- **Same test coverage as MVP** — smoke script + Playwright UI test + WS protocol test for each phase.

---

## Phase 2.1 · Sandbox-attached terminal

### 2.1.A · What the user experiences

**Where it appears:** Workflow Run page only. Chats have no run, so no sandbox to attach to.

**Header addition:** next to the existing Pipeline / Graph / Side-pane buttons on `/workflows/:defId/runs/:runId`:

```
┌─────────────────────────────────────────────────────────┐
│  🐳  Shell target                                        │
│     ○ Host  (agent + user diverge)                       │
│     ● Sandbox  (matches the agent's view)                │
│                                                          │
│     Sandbox: genai-run-abc123 · 4h uptime                │
└─────────────────────────────────────────────────────────┘
```

**Behaviour:**

- Toggle is **disabled** when the run has no active sandbox (no run has started yet, or the run wasn't sandboxed at all).
- Toggle state is stored per-run in localStorage — user gets to choose per-run, not one setting for all.
- **Existing terminal tabs are not modified.** A new tab respects the current toggle at spawn time. To move an existing session to the sandbox, close it and open a fresh Terminal tab. (Simple mental model.)
- When a sandbox-attached tab is active:
  - Terminal header renders with a purple ring + banner *"Sandbox-attached — commands run inside `genai-run-abc123`"* (banner CSS already exists in [TerminalPanel.tsx](apps/web/src/components/terminal/TerminalPanel.tsx)).
  - The `[cd]` worktree dropdown lists **container paths** (`/workspace/source/frontend`), not host paths.
  - The `pty` badge switches to `sandbox`.
- **Lifecycle:** if the sandbox is destroyed mid-session (run cancelled, run completed with auto-destroy on), the WS emits `{ t: 'exit', code: -1, signal: 'sandbox_destroyed' }`. The tab shows the standard exit banner.

### 2.1.B · What's already in place vs. what needs adding

| Piece | Status | Change needed |
|---|---|---|
| `SandboxPtyHost` — spawns `docker exec -it` wrapped in host node-pty | ✅ shipped in Phase 1 | none |
| Host chain includes it (before `NodePtyHost`) when a sandbox provider exists | ✅ shipped | none |
| `TerminalSpawnOptions.attachToSandbox` + `.runId` fields | ✅ shipped | none |
| **Server: sandbox lookup by workspaceId** | ❌ | new helper `SandboxLifecycleManager.getSessionByWorkspace(workspaceId)` that walks `activeSandboxes` and finds the entry whose run owns that workspace |
| **Server: mark sessions as sandbox-destroyed when container dies** | ❌ | subscribe to `SandboxLifecycleManager.destroyForRun` and call `TerminalService.killAllForRun(runId, 'sandbox_destroyed')` |
| **REST: accept `attachToSandbox` in POST body → resolve runId server-side** | 🟡 partial | `routes/terminals.ts` already accepts the flag; must derive runId from workspace lookup, refuse with HTTP 409 if no sandbox |
| **Web: toggle UI in the workflow-run RightPane** | ❌ | new small component `SandboxAttachToggle` in the RightPane header for the Terminal tab (or the run header) |
| **Web: pass `attachToSandbox: true` from `TerminalPanel` when toggle is on** | ❌ | read localStorage key `generatorai:terminal:attachToSandbox:<runId>` and add to `createSession` body |
| **Web: adapt worktree paths for container** | ❌ | `useRunWorkspace` must return `containerPath` in addition to `worktreePath` — small backend field + one field passed through to `TerminalPanel.worktrees` |

### 2.1.C · Detailed spec

**New port method:**
```ts
// packages/core/src/services/SandboxLifecycleManager.ts
getSessionByWorkspace(workspaceId: string): SandboxSession | undefined
```
Implementation walks `activeSandboxes: Map<runId, {session, createdAt}>` and matches against a `runId → workspaceId` lookup. We already do this indirectly via `workflowRun.workspaceId`; the cleanest form is to inject `IWorkflowRunRepository` into `SandboxLifecycleManager` — but that creates a circular dependency risk. Alternative: cache `workspaceId` on `SandboxSession` when we call `createForRun`. **Preferred**: extend `SandboxSession` with a `workspaceId?: string` field, set at creation time.

**New composition-root wiring:** after `terminalService` is built, subscribe to a new `SandboxLifecycleManager.on('destroyed', ...)` event emitter (currently `SandboxLifecycleManager` is not an EventEmitter — that's a small refactor). Handler calls `terminalService.killAllForRun(runId, 'sandbox_destroyed')`.

**New service method:**
```ts
// packages/core/src/services/TerminalService.ts
async killAllForRun(runId: string, reason: string): Promise<void>
```

**REST change in `routes/terminals.ts`:**
```ts
if (parsed.data.attachToSandbox) {
  const sandbox = sandboxLifecycleManager?.getSessionByWorkspace(workspaceId);
  if (!sandbox) {
    return res.status(409).json({
      error: { code: 'NO_SANDBOX', message: 'This workspace has no active sandbox' }
    });
  }
  parsed.data.runId = sandbox.runId;   // needs to be added to SandboxSession
}
```

**Web toggle component** (WorkflowRunPageV2, next to Side pane):
```tsx
<SandboxAttachToggle
  runId={runId}
  hasSandbox={!!runData?.sandboxName}
  value={attachToSandbox}
  onChange={setAttachToSandbox}
/>
```
`attachToSandbox` state syncs to `localStorage:generatorai:terminal:attachToSandbox:${runId}` and is passed into `TerminalPanel` via context or a new prop.

**TerminalPanel change:** the `createSession` call now includes `attachToSandbox`. When the response header shows `host === 'sandbox'`, render the purple banner (CSS already there).

**RunWorkspaceInfo enrichment** (server side):
```ts
worktrees?: Array<{
  alias: string;
  worktreePath: string;      // host path (existing)
  containerPath?: string;    // NEW — e.g. `/workspace/source/frontend`
  files: string[];
  kind?: 'linked' | 'generated';
}>;
```
Populated when the run is sandboxed. `TerminalPanel.worktrees` accepts either; when sandbox-attached, use `containerPath`, else `worktreePath`.

### 2.1.D · Trade-offs

| Question | Options | Recommendation |
|---|---|---|
| Existing host tabs when user flips the toggle | (a) auto-migrate (b) leave untouched (c) show warning | **(b) untouched** — least surprising, matches "one tab = one shell" mental model |
| What if `docker` isn't on PATH on the host | Toggle is disabled with tooltip / silently fall back | **Disabled with tooltip** — surprising fallbacks hide bugs |
| Sandbox destroyed while user is typing | Exit banner + option to reattach when new sandbox starts | **Exit banner only in Phase 2.1**; auto-reattach is a nice-to-have for later |
| Multiple runs in same workspace at same time | Race — which sandbox owns the workspace? | Not possible today (workspaces are 1:1 with runs during execution) — assert this invariant in the lookup helper |

### 2.1.E · Files touched

**New**
- `apps/web/src/components/terminal/SandboxAttachToggle.tsx`

**Edited**
- `packages/core/src/services/SandboxLifecycleManager.ts` — add `workspaceId` to `SandboxSession`, add `getSessionByWorkspace`, emit destroy events
- `packages/core/src/services/TerminalService.ts` — add `killAllForRun`
- `apps/server/src/composition-root.ts` — subscribe destroy events
- `apps/server/src/routes/terminals.ts` — resolve sandbox in POST body
- `apps/web/src/pages/WorkflowRunPageV2.tsx` — render toggle, thread state to `TerminalPanel`
- `apps/web/src/components/terminal/TerminalPanel.tsx` — accept `attachToSandbox` prop, thread to `createSession`
- `packages/shared/src/types/WorkflowOrchestrator.ts` — add `containerPath` to `RunWorkspaceInfo.worktrees`
- `apps/server/src/routes/workflowRuns.ts` — compute container paths when returning run workspace info

### 2.1.F · Effort estimate

**Small.** Most of the plumbing shipped in Phase 1. ~8 files, one new component, no DB migration.

---

## Phase 2.2 · Agent-typed commands with per-command confirm

### 2.2.A · What the user experiences

**Where it appears:** inside any Terminal tab when the agent is running.

**The interaction:**

1. Agent (Copilot or Claude) invokes a new tool `terminal.propose` (instead of the sandbox-exec tool it uses today).
2. A **card renders inline in the terminal**, above the current prompt:

```
──────────────────────────────────────────────────────────
  🤖  Agent wants to run:

      pnpm install
      cwd: ~/…/executions/abc123
      shell: pwsh 7
      rationale: "Add the new @xterm dependencies you asked for"

  [ Run once ]   [ Auto-approve pnpm install ▾ ]   [ Reject ]

  Auto-runs in 30s if you don't respond    ⏱ 28
──────────────────────────────────────────────────────────
```

3. **User options:**
   - **Run once** → command types into the PTY (user sees the exact chars), output streams, agent gets stdout + exit code.
   - **Auto-approve ▾** → dropdown to pick scope:
     - `exact: "pnpm install"` — only this command
     - `startsWith: "pnpm install"` — any variant
     - `startsWith: "pnpm "` — all pnpm commands
     - `startsWith: "git status"` — read-only variants
     Any future proposal matching the rule skips the confirm. Rules expire after `N days` (default 7).
   - **Reject** → command doesn't run; agent gets `decision: 'reject'` and can plan differently.

4. **Panic button** in Settings → *"Revoke all terminal auto-approve rules"*. One-click nuke.

### 2.2.B · Architecture pieces

**New shared event kinds** ([packages/shared/src/types/AgentEvent.ts](packages/shared/src/types/AgentEvent.ts)):

```ts
| { kind: 'terminal.proposal_requested'; data: {
    proposalId: string;
    workspaceId: string;
    command: string;
    argv: string[];
    cwd: string;
    rationale?: string;
    sourceSessionId: string;    // owning terminal (agent picks one)
    autoResolveAfterMs?: number;
  } }
| { kind: 'terminal.proposal_resolved'; data: {
    proposalId: string;
    decision: 'approve' | 'auto_approve' | 'reject' | 'timeout';
    matchedRuleId?: string;
    exitCode?: number;
    truncatedStdout?: string;
    truncatedStderr?: string;
  } }
```

**New agent tool** registered in both harnesses (packages/agent-harness-providers, both Copilot and ClaudeAgent adapters). Tool definition:

```ts
{
  name: 'terminal.propose',
  description: 'Propose a terminal command for the user to approve and run.',
  params: {
    command: string,          // free-form or argv[0]
    argv?: string[],
    cwd?: string,             // must resolve inside workspace root (server-checked)
    rationale?: string,       // short human-readable why
    timeoutMs?: number
  }
}
```
Behaviour: the tool call **doesn't execute anything itself**. It emits `terminal.proposal_requested` on the EventBus and returns a Promise that resolves once the SPA resolves the proposal (approve / reject / timeout). The tool's return payload is `terminal.proposal_resolved.data`.

**New service `TerminalProposalService`** in `packages/core/src/services/`:

```ts
export class TerminalProposalService {
  // proposalId → in-flight resolver
  private pending = new Map<string, {
    proposal: ProposalRequest;
    resolve: (r: ProposalResolution) => void;
    timer: NodeJS.Timeout;
  }>();

  async propose(req: ProposalRequest): Promise<ProposalResolution>;
  approve(proposalId: string, targetSessionId: string): Promise<ProposalResolution>;
  reject(proposalId: string, reason?: string): void;
  cancel(proposalId: string): void;
}
```

`approve()` flow:
1. Look up target session via `TerminalService`.
2. `handle.write(command + '\r')` — types the command as if the user did.
3. Watch output — hard case: knowing when the command "finished". Two approaches:
   - **Sentinel wrapping**: instead of `pnpm install`, actually type `pnpm install; echo __GENAI_END_${proposalId}__=$?` and wait for the sentinel line. Rock-solid but adds visible clutter.
   - **Prompt detection**: match `descriptor.shell`'s known prompt regex. Fragile.
   - **Preferred:** sentinel wrapping, but make it invisible by capturing the sentinel line and filtering it from the scrollback broadcast. Server-side only; xterm shows the natural output.
4. Once sentinel captured, snapshot last N KB of output (default 8 KB stdout tail), resolve.

**Auto-approve rule store**:

```ts
// packages/db/schema.ts (new table)
export const terminalApprovalRule = sqliteTable('terminal_approval_rule', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  match: text('match', { enum: ['exact', 'startsWith'] }).notNull(),
  pattern: text('pattern').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
```

Rules are **workspace-scoped**, never global. Even if the agent proposes `rm -rf /`, it can only auto-run if a rule matches in *that specific workspace*.

**Rule check flow** (in `TerminalProposalService.propose`):
1. Load matching rules for `workspaceId`.
2. If any rule matches AND `Date.now() < expiresAt`:
   - Emit `terminal.proposal_resolved` with `decision: 'auto_approve'` and `matchedRuleId`.
   - Immediately proceed to the approve() flow, targeting… **which session?** — the agent must specify `sourceSessionId` in the propose call. If not, we pick the newest one for the workspace. If none exist, we create one on-the-fly (fresh Terminal tab; UI auto-focuses).
3. If no rule matches, emit `terminal.proposal_requested` and wait.

**New REST**:
```
GET    /workspaces/:id/terminals/proposals              → list pending proposals
POST   /workspaces/:id/terminals/proposals/:pid/approve → body: { targetSessionId, autoApprove?: { match, pattern, ttlDays } }
POST   /workspaces/:id/terminals/proposals/:pid/reject  → body: { reason? }
GET    /workspaces/:id/terminals/approval-rules
DELETE /workspaces/:id/terminals/approval-rules/:ruleId
DELETE /workspaces/:id/terminals/approval-rules         → revoke all (panic button)
```

**UI**: `TerminalProposalCard` overlaid in the xterm viewport (absolute-positioned above the prompt row using xterm's `registerDecoration` API). Cannot steal input focus while the user is typing.

Timeout UX: 30-second countdown ring around the "Run once" button. If it hits zero, proposal resolves as `timeout` and the agent knows to try a different approach.

### 2.2.C · Two-step delivery

Because auto-approve rules are the security-sensitive part, ship in two steps:

**Step A (safe MVP)** — one-shot approvals only, no rules:
- Tool + event kinds + service (without rule check).
- REST: approve / reject / list pending. **No** rule endpoints yet.
- UI: card renders, user clicks Approve or Reject. No "Auto-approve" dropdown.
- Ships behind `GENERATORAI_TERMINAL_PROPOSALS=1`.

**Step B (rules + Settings)** — after Step A stabilises:
- Add drizzle migration for `terminal_approval_rule`.
- Add rule endpoints.
- Add "Auto-approve ▾" dropdown in the card.
- Add Settings → Terminal → "Auto-approve rules" table (view, edit, delete individual, revoke all).
- Rule expiry sweeper (piggyback on `EventRetentionService`).

### 2.2.D · Trade-offs

| Question | Options | Recommendation |
|---|---|---|
| Where to render the card | Inline (xterm decoration) / floating modal / side pane | **Inline** — matches Cursor/Claude Code; no context switch |
| Sentinel wrapping vs. prompt detection | Sentinel wrapping / prompt regex / timeout only | **Sentinel wrapping** — deterministic across shells |
| Default timeout | 15s / 30s / 60s / no timeout | **30s**, configurable per proposal |
| Rule scope | Per-workspace / per-project / global | **Per-workspace** — smallest blast radius |
| Rule TTL default | 1 day / 7 days / 30 days / no expiry | **7 days** — balance friction vs. safety |
| Which harness is source of truth for the tool | Both Copilot + Claude-Agent get parallel tool | Yes — this is a first-class agent capability, not a Claude-only thing |
| Log every proposal decision | Yes, for audit / no | **Yes** — persist to event log with TTL matching retention |

### 2.2.E · Files touched

**New**
- `packages/core/src/services/TerminalProposalService.ts`
- `packages/core/src/tools/terminalPropose.ts` (tool definition)
- `apps/server/src/routes/terminalProposals.ts`
- `apps/web/src/components/terminal/TerminalProposalCard.tsx`
- `apps/web/src/hooks/useTerminalProposals.ts` (SSE subscription to `terminal.proposal_requested`)
- **Step B only:**
  - `packages/db/migrations/000X_terminal_approval_rules.sql`
  - `packages/db/src/schema/terminalApprovalRule.ts`
  - `packages/db/src/repositories/DrizzleTerminalApprovalRuleRepository.ts`
  - `apps/web/src/pages/Settings.tsx` (new "Auto-approve rules" card)

**Edited**
- `packages/shared/src/types/AgentEvent.ts` — new event kinds
- `packages/agent-harness-providers/**/CopilotProvider.ts` — register tool
- `packages/agent-harness-providers/**/ClaudeAgentProvider.ts` — register tool
- `packages/core/src/services/TerminalService.ts` — add `injectCommand(sid, cmd, opts)` helper that wraps sentinel + captures output
- `apps/server/src/composition-root.ts` — wire `TerminalProposalService`
- `apps/server/src/routes/index.ts` — mount proposal routes
- `apps/web/src/components/terminal/TerminalPanel.tsx` — mount `useTerminalProposals` + render `TerminalProposalCard`

### 2.2.F · Effort estimate

**Medium** for Step A, **medium+** for Step B. Together ~2–3× Phase 2.1.

---

## Phase 2.3 · DB-backed persistence

### 2.3.A · What the user experiences

**Before Phase 2.3:** Server restarts → terminals gone. Fresh prompts on page reload.

**After Phase 2.3:**
- Terminals appear on reload with a banner:
  ```
  ⚠ This shell's process is no longer running (server restarted at 2026-07-10 05:14).
     [ Restart in same cwd ]   [ Close ]
  ```
- **Full scrollback preserved** — user can search / copy / share history.
- **Restart button** spawns a fresh PTY with the same `cwd`, `cols`, `rows`, `shell`. Old scrollback stays as a "before restart" divider line above the new content.
- **Off by default**, opt-in via `GENERATORAI_TERMINAL_PERSIST=1` env or Settings toggle.

### 2.3.B · Architecture

**Two new drizzle tables:**

```sql
CREATE TABLE terminal_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_id TEXT,                     -- non-null when sandbox-attached
  host TEXT NOT NULL,              -- 'node-pty' | 'sandbox' | 'fallback-child-process'
  shell TEXT NOT NULL,
  cwd TEXT NOT NULL,
  cols INTEGER NOT NULL,
  rows INTEGER NOT NULL,
  pid INTEGER,
  exit_code INTEGER,
  exit_signal TEXT,
  exit_reason TEXT,                -- 'user_close' | 'workspace_deleted' | 'server_crash' | 'idle_timeout' | 'sandbox_destroyed'
  created_at INTEGER NOT NULL,     -- ms epoch
  last_activity_at INTEGER NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES execution_workspaces(id) ON DELETE CASCADE
);

CREATE INDEX ix_terminal_sessions_workspace ON terminal_sessions(workspace_id);

CREATE TABLE terminal_scrollback_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,       -- append order within session
  bytes BLOB NOT NULL,             -- raw PTY output
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES terminal_sessions(id) ON DELETE CASCADE
);

CREATE INDEX ix_scrollback_session_seq ON terminal_scrollback_chunks(session_id, sequence);
```

**Why chunked scrollback:**
- Append is O(1).
- Retention delete of "oldest 100 KB" is `DELETE FROM ... WHERE session_id = ? AND sequence < ?` — O(deleted rows).
- SQLite handles millions of BLOB rows without pain.
- If a single session lives for 8 hours producing 50 MB of log, that's ~500 chunks at 100 KB each — trivial.

**Persistence wrapper** — decorate the current in-memory scrollback:

```ts
// packages/core/src/services/PersistentScrollback.ts
class PersistentScrollback {
  private memBuffer: Buffer;   // hot cache — same 4 MB ring as today
  private pendingChunk: Buffer[];
  private lastFlushAt: number;
  private lastSequence: number;

  constructor(private sessionId: string, private repo: ITerminalSessionRepository) { … }

  append(bytes: Buffer): void {
    this.memBuffer = trim(concat(this.memBuffer, bytes), MAX_MEM);
    this.pendingChunk.push(bytes);
    if (totalPending() >= FLUSH_BYTES || now() - this.lastFlushAt >= FLUSH_MS) {
      this.flush();
    }
  }

  async loadOnResume(): Promise<Buffer> {
    // Fetch all chunks in sequence order; concat; return the last MAX_MEM.
  }
}
```

`FLUSH_BYTES = 32 KB`, `FLUSH_MS = 500` — both env-configurable.

**Recovery flow** on server boot ([StartupRecoveryService](packages/core/src/services/StartupRecoveryService.ts)):

```
recoverTerminals():
  const orphans = await repo.findWithNullExitCode();
  for (const row of orphans) {
    await repo.markExited(row.id, {
      exitCode: -1,
      exitReason: 'server_crash',
      exitSignal: null,
    });
  }
```

We deliberately don't try to reconnect PTYs — the OS PIDs are gone, the shell processes were reaped by the kernel when the server died.

**New REST**:
```
POST /workspaces/:id/terminals/:sid/restart
     body: { cols?, rows?, shell? }
     → spawns a fresh PTY inheriting cwd from the exited row; returns new descriptor
```

The **client-side sid stays valid** — localStorage still points to it. `TerminalPanel` on mount does `describeSession(sid)`:
- If `exitCode === null` → session is live, connect WS.
- If `exitCode !== null && exit_reason === 'server_crash'` → render **"Restart"** banner.
- If `exitCode !== null && exit_reason === 'user_close'` → forget the sid, spawn fresh.

**Retention** (env-configurable):
- `GENERATORAI_TERMINAL_SCROLLBACK_PER_SESSION_KB` = 10240 (10 MB per session)
- `GENERATORAI_TERMINAL_SCROLLBACK_SERVER_MAX_MB` = 500
- `GENERATORAI_TERMINAL_RETAIN_DAYS` = 7 (delete exited sessions older than this)

The existing `EventRetentionService` pattern extends cleanly — copy-paste and adapt.

### 2.3.C · Trade-offs

| Question | Options | Recommendation |
|---|---|---|
| Chunk flush cadence | 500 ms / 32 KB / whichever first / configurable | **Whichever first, configurable** |
| Preserve sid across restart | Yes / assign new sid | **Yes** — client localStorage still points to it, restart flow uses same sid |
| Scrollback size cap | Per-session only / server-wide only / both | **Both** — belt and suspenders |
| Sandbox-attached sessions after restart | Container may or may not still exist | Check `SandboxLifecycleManager.getSession(runId)` on restart; if gone, show *"Sandbox destroyed, can't restart"* variant of the banner |
| DB write pressure | Batched (default) / write-through / off | **Batched** — 500 ms flush is invisible latency-wise, keeps SQLite happy |
| Deleted workspace → cascade delete rows | Yes / lazy sweeper | **Yes, ON DELETE CASCADE** — foreign key already in schema |

### 2.3.D · Files touched

**New**
- `packages/db/migrations/000X_terminal_sessions.sql`
- `packages/db/src/schema/terminalSession.ts`
- `packages/db/src/schema/terminalScrollbackChunk.ts`
- `packages/db/src/repositories/DrizzleTerminalSessionRepository.ts`
- `packages/core/src/domain/ports/ITerminalSessionRepository.ts`
- `packages/core/src/services/PersistentScrollback.ts`
- `packages/core/src/services/TerminalRetentionService.ts`

**Edited**
- `packages/core/src/services/TerminalService.ts` — plug `PersistentScrollback` when persist flag set; add `restart(sid)`
- `packages/core/src/services/StartupRecoveryService.ts` — add `recoverTerminals`
- `apps/server/src/routes/terminals.ts` — add `POST /:sid/restart`
- `apps/server/src/composition-root.ts` — wire the repo + retention service; call `recoverTerminals` in `initialize`
- `apps/web/src/components/terminal/TerminalPanel.tsx` — handle `exit_reason === 'server_crash'` variant, render Restart button

### 2.3.E · Effort estimate

**Medium.** Biggest chunk is the drizzle migration + repo + flush plumbing. UI change is small.

---

## Phase 2.4 · Session recording & playback

### 2.4.A · What the user experiences

**Two use cases:**

1. **Audit** — admin opens a workspace, sees a **Recordings** list, plays back exactly what happened in a terminal (character-by-character with timing).
2. **Debugging** — user says "the agent broke my repo", you open their run, click **Play**, watch the terminal replay, scrub to the moment things went wrong.

**Where it appears:**

- Settings → Terminal → toggle **Record all sessions** (off by default).
- Terminal header: **red dot** next to the shell badge when recording is on for the current session.
- New **Recordings** tab on the Workflow Run page (or a dedicated route `/workspaces/:id/recordings` for the chat case).
- Recording list shows: `sid · duration · shell · size · started_at`. Click → opens the player in a modal.

**Player UI:**

```
┌─ Recording: pwsh 7 · 12m 34s · 4.2 MB ────── [× Close] ─┐
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  PS C:\Users\...\executions\abc123>                │  │
│  │  ls                                                │  │
│  │  artifacts  config  output  scripts  source        │  │
│  │  PS C:\Users\...\executions\abc123>                │  │
│  │  █                                                 │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ▶ ⏸  ─────────────●───────────────  4:32 / 12:34        │
│  Speed: 1x   [Command index ▾]  [Copy transcript]        │
└──────────────────────────────────────────────────────────┘
```

- **Command index** panel: extracted list of every input line with timestamps. Click a command → scrubber jumps there.

### 2.4.B · Architecture

**Recording format: asciinema v2** (industry standard, MIT `asciinema-player` plays it in any browser):

```
{"version": 2, "width": 184, "height": 42, "timestamp": 1783623000, "env": {"TERM": "xterm-256color", "SHELL": "pwsh.exe"}}
[0.037, "o", "\u001b[?25hPS C:\\Users\\...\\> "]
[1.284, "i", "l"]
[1.291, "o", "l"]
[1.343, "i", "s\r"]
[1.401, "o", "ls\r\n"]
[1.412, "o", "artifacts config output scripts source\r\n"]
[1.502, "o", "PS C:\\Users\\...\\> "]
```

Line format: `[deltaSec, "i"|"o", data]`. Delta = seconds since session start.

**Storage: workspace artifacts.** Recordings land in `<workspaceRoot>/recordings/<sid>.cast`, tracked in the existing `workspace_artifact` table with `artifactType: 'terminal_recording'`. Same lifecycle as browser screenshots — auto-cleaned when the workspace is deleted.

**New recorder observer** for `TerminalService`:

```ts
// packages/core/src/services/TerminalRecorder.ts
class TerminalRecorder implements TerminalObserver {
  onSessionCreated(sid: string, descriptor: TerminalSessionDescriptor): void {
    // Write header line
    fs.writeFile(path, `${JSON.stringify({version: 2, width: cols, height: rows, ...})}\n`);
  }
  onInput(sid: string, data: string): void {
    const line = `[${deltaSec(sid)}, "i", ${JSON.stringify(data)}]\n`;
    // Redact secrets before write:
    const redacted = redactSecrets(line);
    appendFile(path, redacted);
  }
  onOutput(sid: string, bytes: Buffer): void {
    // Same pattern
  }
  onSessionClosed(sid: string): void {
    // Track total size in workspace_artifact row
  }
}
```

`TerminalService` gains an `addObserver(obs)` API; the recorder registers itself when the feature flag is on.

**Redaction patterns** (server-side, before writing to disk):

```
AWS_SECRET_ACCESS_KEY=...       → AWS_SECRET_ACCESS_KEY=**REDACTED**
sk-proj-...                     → sk-**REDACTED**
ghp_...                         → ghp_**REDACTED**
JWT: eyJ...                     → JWT: **REDACTED**
password: ...                   → password: **REDACTED**
```

Configurable list via `GENERATORAI_TERMINAL_RECORD_REDACT_PATTERNS` (JSON array of regexes).

**Playback** — new npm dep: [`asciinema-player`](https://github.com/asciinema/asciinema-player) (MIT). React wrapper:

```tsx
// apps/web/src/components/terminal/RecordingPlayer.tsx
import * as AsciinemaPlayer from 'asciinema-player';
import 'asciinema-player/dist/bundle/asciinema-player.css';

export function RecordingPlayer({ src }: { src: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const player = AsciinemaPlayer.create(src, ref.current, {
      autoPlay: true, speed: 1.0, theme: 'monokai',
    });
    return () => player.dispose();
  }, [src]);
  return <div ref={ref} />;
}
```

**Command index** — a small server-side pass over the `.cast` file that emits every `[t, "i", data]` line where data contains `\r` or `\n`, plus the accumulated line up to that point. Stored as a sibling `<sid>.commands.json`.

**New REST**:
```
GET  /workspaces/:id/terminals/recordings                → list
GET  /workspaces/:id/terminals/recordings/:sid           → .cast (application/x-asciicast)
GET  /workspaces/:id/terminals/recordings/:sid/commands  → parsed command index
```

**New shared type:**
```ts
// packages/shared/src/types/Terminal.ts
export interface TerminalRecordingSummary {
  sessionId: string;
  workspaceId: string;
  shell: string;
  durationMs: number;
  sizeBytes: number;
  startedAt: number;
  commandCount: number;
}
```

### 2.4.C · Trade-offs

| Question | Options | Recommendation |
|---|---|---|
| Storage location | Artifacts (drizzle) / plain files / S3 | **Artifacts** — reuses lifecycle |
| Enable scope | Per-session / per-workspace / global | **Per-workspace toggle in Settings** |
| Redaction | Client / server / both | **Server** — client is bypassable |
| Size caps | 50 MB / recording, 500 MB / workspace, 5 GB / server | Yes, all three — env-configurable |
| Live "shoulder surf" streaming to a viewer | Include / defer | **Defer** — not needed for audit |
| Compress recordings | gzip / brotli / none | **None initially** — asciinema files are small text; compression complicates streaming |
| Include env + prompt + user in header | Yes / minimal | **Include** — audit needs context |

### 2.4.D · Files touched

**New**
- `packages/core/src/services/TerminalRecorder.ts`
- `packages/core/src/services/TerminalRecordingRetentionService.ts`
- `apps/server/src/routes/terminalRecordings.ts`
- `apps/web/src/components/terminal/RecordingPlayer.tsx`
- `apps/web/src/pages/Recordings.tsx` (or a tab inside the workflow-run page)
- Redaction pattern config file

**Edited**
- `packages/shared/src/types/Terminal.ts` — add `TerminalRecordingSummary`
- `packages/shared/src/types/Workspace.ts` — add `'terminal_recording'` to `WorkspaceArtifactType` union
- `packages/core/src/services/TerminalService.ts` — add `addObserver` / `removeObserver`
- `apps/server/src/composition-root.ts` — wire recorder + retention
- `apps/server/src/routes/index.ts` — mount recording routes
- `apps/web/src/pages/Settings.tsx` — add recording toggle to terminal card

### 2.4.E · Effort estimate

**Medium+.** Recording infra is small; playback UI is the big chunk.

---

## Suggested build order

Ordered by increasing complexity and dependency:

1. **Phase 2.1 — Sandbox-attached terminal** (small, plumbing done, immediate user value)
2. **Phase 2.3 — DB persistence** (medium, unblocks 2.4)
3. **Phase 2.2A — Agent proposals, one-shot only** (medium, introduces tool + event kinds)
4. **Phase 2.4 — Recording & playback** (medium+, depends on 2.3 for retention infra)
5. **Phase 2.2B — Auto-approve rules + Settings** (medium+, security-sensitive)

Each phase ships behind its own env flag and can be reverted without touching the others.

---

## Rollback strategy per phase

| Phase | Rollback | Data cleanup |
|---|---|---|
| 2.1 Sandbox-attached | Unset `GENERATORAI_TERMINAL_SANDBOX`. UI hides toggle. Server ignores `attachToSandbox` field. | none needed |
| 2.2 Agent proposals | Unset `GENERATORAI_TERMINAL_PROPOSALS`. Tool is not registered; agents get "tool not available". Existing shells unaffected. | Step B: drop `terminal_approval_rule` table (or leave, unused) |
| 2.3 Persistence | Unset `GENERATORAI_TERMINAL_PERSIST`. In-memory scrollback resumes. Old DB rows can be swept by retention. | Old rows expire naturally via retention |
| 2.4 Recording | Unset `GENERATORAI_TERMINAL_RECORD`. Recorder observer detaches. Existing `.cast` files remain in artifacts. | Manual cleanup if needed (delete `WorkspaceArtifact` rows with `artifactType='terminal_recording'`) |

---

## Testing strategy per phase

Each phase gets:

1. **Unit tests** for the new service (vitest under `packages/core/src/**/*.test.ts`).
2. **REST/WS smoke** — new `.mjs` scripts under `agent-tests/` following the `terminal-ws-smoke.mjs` pattern.
3. **Playwright UI test** where a UI is added — extend the existing `terminal-desktop-smoke.mjs` pattern.
4. **Typecheck sweep** — `pnpm -r --if-present run typecheck` must remain clean.

Explicit acceptance criteria for each phase are listed in the trade-off tables above.

---

## Open questions for you before we start

1. **Order** — is `2.1 → 2.3 → 2.2A → 2.4 → 2.2B` the right sequence, or do you want to reprioritise?
2. **Feature flag defaults** — should each Phase 2 feature default to ON once shipped, or stay opt-in indefinitely?
3. **Sandbox-attached MVP scope** (Phase 2.1) — should we ship just the toggle + spawn, or also the auto-reattach-on-sandbox-restart flow?
4. **Auto-approve rules TTL** (Phase 2.2B) — 7 days okay, or shorter (1 day) / longer (30 days) default?
5. **Persistence retention** (Phase 2.3) — 7 days / 500 MB server-wide default sane, or different numbers?
6. **Recording redaction patterns** (Phase 2.4) — start with the built-in list only, or ship a Settings UI to add custom patterns from day 1?
7. **Any Phase 2 items you'd like to drop entirely** — none of these are hard commitments.

Once you answer these + sign off on the plan, I'll drop into implementation on Phase 2.1.

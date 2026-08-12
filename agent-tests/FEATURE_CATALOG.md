# GeneratorAI — Exhaustive Feature & Config Catalog

> Built for end-to-end browser testing via the `playwright-cli` skill. Web UI at http://localhost:5173 (proxies `/api` → :3100). Generated 2026-06-12.

---

## 0. Navigation (Sidebar)
`apps/web/src/components/layout/Sidebar.tsx` — Dashboard · Projects · Chats · **Agents** · Workflows · Scripts · Automations · Settings. Sidebar collapses/expands.

---

## 1. Workflow Builder (`WorkflowBuilderPage.tsx`, `DAGCanvas.tsx`)

### Workflow-level config (`WorkflowConfigPanel.tsx` + `settings/*Tab.tsx`)
| Setting | Values | Tab |
|---|---|---|
| Name (req) / Description | text / textarea | General |
| Session Mode | `auto` \| `single` \| `per-stage` | General |
| Variables | type ∈ `string\|number\|boolean\|choice\|text`; name, label, description, required, default, options | Variables |
| Tags / Metadata | string list | Tags |
| Harness | model, streaming, reasoningEffort `low\|medium\|high\|xhigh`, MCP servers, custom agents | — |
| Project / Codebases | projectId, git repos {url,branch,alias,subdir}, auto-commit, auto-create-PR | Project/Codebases |
| Workflow Hooks | 15 phases (see §3) | Hooks |

### DAG canvas interactions
Drag to reposition · drag handle→handle to connect (default edge `on_success`) · Delete/Backspace removes · Ctrl+Z / Ctrl+Shift+Z undo/redo · auto-layout button (LR) · zoom/pan · minimap. Node testid: `rf__wrapper`.

### Edge types (handoff / conditional) — `StageEdge.tsx`
| Type | Color | Label |
|---|---|---|
| `on_success` | green | Success |
| `on_failure` | red | Failure |
| `on_completion` | blue | Complete |
| `always` | violet | Always |

---

## 2. Stage Config (`StagePropertiesPanel.tsx`) — Properties + Execution tabs

**Properties tab:** Name, Description · Template dropdown · Model override (`Workflow default` + list) · Reasoning effort (`low\|medium\|high\|xhigh`) · Prompts sub-tabs **Inline / Files / Agent** (inline: label, text, waitForCompletion) · Skills toggles · MCP server toggles · Variables key-value.

**Execution tab:**
| Field | Values |
|---|---|
| Run Condition | `always` \| `on_success` \| `on_failure` \| `expression` (+ expr text e.g. `stages.build.status === "completed"`) |
| Timeout | 0–3600 s, step 30 |
| Context from predecessors | `summary-only` \| `full` \| `none` |
| Retry policy | enable toggle → maxRetries 1–10, backoff 100–60000ms, multiplier 1–10 ×0.5 |
| Result validation rules | `contains`\|`not_contains`\|`min_length`\|`max_length`\|`regex`\|`custom_script` + failure message |
| Stage hooks | 6 phases (see §3) |

---

## 3. Hooks (`settings/HooksTab.tsx` workflow; `HookEditor` in panel for stage)
- **Workflow phases (15):** on_run_start/complete/failed/cancelled, pre/post_clone, pre/post_commit, on_pr_created, on_preprocessing_complete, on_postprocessing_start, on_all_stages_scheduled, on_stage_completed, on_stage_failed, on_parallel_join.
- **Stage phases (6):** pre_run, post_run, pre_prompt, post_prompt, on_error, on_cancel.
- **Type:** `script` (command) \| `http` (url, POST) \| `function` (handler name + JSON args).
- **Failure policy:** `abort` \| `continue` \| `skip`. Name + enabled toggle. Upload via `.hooks.json`.

---

## 4. Run Controls & Lifecycle (`RunControls.tsx`, `StageRunControls.tsx`)
**Run status:** created→starting→running⇄paused→completed/failed/cancelled (+cancelling). Buttons: Start (created), Pause (running), Resume (paused), Cancel (running/paused, confirm dialog), Retry (failed/cancelled).
**Stage status (9):** pending, queued, running, paused, completed, failed, cancelled, skipped, awaiting_input (+sleeping). Per-stage icon buttons: Pause/Resume/Retry/Cancel when run active.

---

## 5. HITL / Permission Modes (`HitlPanel.tsx`)
| Mode | Label | Poll |
|---|---|---|
| `bypassPermissions` | Auto-approve (default) | 15s |
| `default` | Ask for unmatched requests | 2s |
| `acceptEdits` | Auto-approve file edits only | 2s |
| `plan` | Plan mode (approve every tool call) | 2s |
Pending interrupts queue → Approve (green) / Reject (red) per `awaiting_input` stage.

---

## 6. Streaming & Runtime Render (`StreamingMessage.tsx`, `WorkflowMessages.tsx`, `StageOutput.tsx`, `RuntimeDAGCanvas.tsx`)
**Block types:** thinking (Brain, expandable), text (markdown + blinking cursor), tool_call (Wrench, name+args+result), system (error/subagent/debug grouped).
**Stream status:** pending→thinking→streaming→complete/error. Loading: "Analyzing your request…" / "Generating response…" + shimmer. Usage stats (model, ↑in ↓out tokens, duration) on complete.
**Runtime DAG node colors:** pending gray, queued/running blue (pulse), paused amber, completed green, failed red, cancelled gray, awaiting_input amber. Progress bar if totalSteps>1. Step `(step c/t)`. Retry `#n`.
**Timeline (`RunTimeline.tsx`):** per-event icon+timestamp+label+duration; click event → select stage.

---

## 7. Variable Input Modal (`VariableInputModal.tsx`)
Pre-run dialog: type-specific inputs (string/number/boolean checkbox/choice dropdown/text textarea), required asterisk, codebase/branch selectors if linked. "Run Workflow" disabled until required filled.

---

## 8. Templates (`TemplateExplorer.tsx`)
System templates: code-generation-v1, code-review-v1, test-generation-v1, refactoring-v1, e2e-testing-v1 (+ playwright-cli E2E). Search; grid cards; "Use Template" → `POST /api/workflows/from-template/:id` → builder.

---

## 9. Automations (`AutomationsPage/DetailPage/CreateAutomationPage.tsx`)
- **Triggers:** `manual` · `schedule` (cron, default `0 9 * * *`) · `webhook` (token).
- **Input modes:** `single` · `loop` (loopVariable, loopItems, maxConcurrency 1–10, onError continue/stop) · `batch` (csv/json/jsonl, column mapping, preview) · `script` (command, output json_array/csv/jsonl, timeout, env, Test button).
- Workflow IDs multi-select, base variables JSON, project scope. Actions: Run now, enable/disable, delete, rotate webhook token.

---

## 10. Chats (`ChatPage.tsx`, `ChatsListPage.tsx`, `CreateChatDialog.tsx`)
Create: name(req), description, model, **agent (`agentRef`) + "Customize capabilities" → `agentOverrides`**, orchestrate mode, tags(≤20), project+codebases(≤3), local folder path. Input: textarea (Ctrl+Enter), model selector, **agent chip when bound**, reasoning effort, attachments, Stop/Send. SSE streaming keyed by sessionId. List: search, status filter all/active/archived, bulk select+delete, archive.

---

## 10a. Agents (`AgentsListPage.tsx`, `AgentEditorPage.tsx`, `components/agents/*`)
**Catalog**: card grid, search (name/slug/description/tag), scope filter (Built-in/Global/Project), role filter (Agent/Orchestrator), Import (`.agent.md`, ≤256 KB), per-card Export + Delete. Built-in agents are read-only (synced from `templates/system/artifacts/agents/`).

**Editor** (`/agents/new`, `/agents/:id`): Identity (name, slug — immutable after create, description ≥10 chars, scope, project, tags, enabled) · Instructions (instructions with byte counter, 8 KB warn / 32 KB reject; projection append∣replace) · Role (agent∣orchestrator) · Skills · MCP servers · Capabilities (tri-state on/inherit/off × 8 groups; `orchestration` locked on for orchestrators) · Team (orchestrator only) · Runtime (provider, model, effort, context tier, permission mode, max turns) · sticky **Effective capabilities** panel driven by `POST /api/agents/resolve-preview` with an unsaved `draft`.

**Binding surfaces**: New Chat dialog picker + capability chips; Stage Properties → Prompts & Context → **Agent** tab (`AgentBindingSection`); Settings → Agents (read-only overview).

---

## 11. Projects (`ProjectsListPage/DetailPage/CreateProjectPage.tsx`)
Create: name(req), description, defaultModel, sessionMode (single/per-stage/auto), worktreeRetention (immediate/24h/72h/manual). Tabs: **Codebases** (git-remote/git-local/local-dir; status pending/cloning/ready/error/stale; fetch/delete), **Artifacts** (skill/prompt/agent/mcp upload+edit), **Settings** (model, session mode, max codebases, retention, auto-fetch interval, copilot config).

---

## 12. Settings (`Settings.tsx`)
Tabs: **General** (theme light/dark/system, about), **Provider** (copilot / anthropic / claude-agent switch), **Agents** (read-only catalog + "Manage agents"), **Skills**, **MCP Servers**, **Templates**, **Copilot** (connection state, models), **Advanced** (health, sandbox config).

---

## 13. Dashboard (`DashboardPage.tsx`)
4 stat cards (Active Chats, Workflows, Active Runs, Completed). Quick actions (New Chat, New Workflow, Browse Workflows). Recent chats/runs/workflows panels.

---

## E2E Test Scenario Matrix (priority for live run)
0. **Agent union algebra** — create an agent with N skills, bind it to a chat/stage and add M more; the effective projection must show **N + M** (the removals list wins over an add). Verify in the UI preview AND in `chats.agent_snapshot`.
0a. **Agent lifecycle** — boot syncs 7 built-ins from disk; export → edit slug → import round-trips; delete is refused (409) while bound and `--force` soft-disables; tri-state capability editor and the effective panel agree for every group.
1. **Build complex multi-stage DAG** — ≥4 stages, mixed edge types (success/failure/completion/always), conditional expression edge, retry policy, validation rule, per-stage hook.
2. **Run + streaming** — start run, watch thinking/text/tool_call blocks render live, status transitions, per-stage progress, timeline.
3. **Handoff** — verify predecessor context passes; stage transitions on correct edge type.
4. **Conditional trigger** — expression edge gates a stage (skipped vs run).
5. **Validation** — stage with validation rule fails correctly; failure message shown.
6. **HITL** — switch to `plan` mode, approve/reject pending interrupt.
7. **Lifecycle** — pause/resume/cancel/retry at run and stage level.
8. **Template → workflow**, **Automation create (each mode)**, **Chat stream**, **Project + codebase**, **Settings provider switch**.

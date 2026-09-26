Excellent! Now I have a comprehensive understanding of the codebase. Let me compile the detailed test-planning inventory:

## COMPREHENSIVE TEST-PLANNING INVENTORY FOR WEB UI (APPS/WEB)

---

### 1. EXISTING PLAYWRIGHT COVERAGE

**File:** `c:\Users\sidmishra\Desktop\New folder (2)\GeneratorAI\agent-tests\browser-ui-e2e.spec.ts`

**Existing Test Scenarios (by describe block):**

| Test Group | Covered Scenarios |
|---|---|
| **1. Navigation & Layout** | ✓ Dashboard loads ✓ Navigate to all main pages (Workflows, Chats, Automations, Templates, Settings, Projects, Dashboard) ✓ Sidebar collapse/expand |
| **2. Workflows Page** | ✓ Workflows list loads ✓ Create new workflow (nav to builder) |
| **3. Workflow Builder** | ✓ Builder page loads with React Flow canvas (rf__wrapper) ✓ Stage node visible ✓ Save button exists |
| **4. Workflow Run Page** | ✓ Run page shows running/completed state ✓ Stage appears in DAG canvas ✓ Messages panel shows Prompt/Response ✓ Messages persist after refresh ✓ Messages & Files tabs visible |
| **5. Chats Page** | ✓ Chats page loads ✓ Chat detail shows messages (SSE connection with `load` waitstate) |
| **6. Automations Page** | ✓ Automations list loads ✓ New Automation button visible ✓ Automation detail loads |
| **7. Projects Page** | ✓ Projects page loads |
| **8. Templates Page** | ✓ Templates page loads |
| **9. Settings Page** | ✓ Settings page loads |
| **10. Full Workflow Lifecycle** | ✓ Create → Start → Run → Verify messages (via API) → Cleanup |

**playwright.config.ts settings (NOT YET FOUND - does not exist in agent-tests):**
- Expected but absent; would normally define baseURL, workers, timeouts, reporters

**package.json scripts:**
```json
{
  "test": "playwright test",
  "test:ui": "playwright test --ui",
  "report": "playwright show-report test-results/html-report"
}
```

**Coverage Gaps:**
- ❌ Workflow Builder: Create stages, drag connections, test edge types (success/failure/completion/always)
- ❌ Workflow Builder: Edit stage properties, prompts, execution conditions, retries, validation rules
- ❌ Workflow Builder: Undo/redo, keyboard shortcuts (Ctrl+Z, Delete key), auto-layout
- ❌ Workflow Run: Streaming message blocks (thinking, text, tool calls) rendering in real-time
- ❌ Workflow Run: Stage status transitions, progress bars, per-stage controls (pause/resume/cancel/retry)
- ❌ Workflow Run: Timeline interactions, run controls (pause/resume/cancel/retry at workflow level)
- ❌ Workflow Run: HITL panel (permission modes, approve/reject interrupts)
- ❌ Chat: Send message, file attachments, model selection, streaming responses
- ❌ Chat: Chat list filtering, archiving, bulk operations
- ❌ Automations: Create automation (all trigger types: manual, schedule, webhook)
- ❌ Automations: Create automation (all input modes: single, loop, batch, script)
- ❌ Automations: Trigger automation, enable/disable, delete
- ❌ Projects: Create, link codebases, view artifacts, manage settings
- ❌ Projects: Codebase status transitions, fetch/delete actions
- ❌ Templates: Browse, search, use template
- ❌ Settings: Theme switching, provider selection, health checks
- ❌ Variables: Variable input modal with required/optional fields, defaults, type-specific inputs
- ❌ Error states: Validation errors, loading skeletons, error toasts
- ❌ Edge cases: Empty states, bulk operations, pagination, search/filter

---

### 2. FULL WEB UI SCENARIO LIST FOR E2E SUITE

#### **A. DASHBOARD (`/`)**
`apps/web/src/pages/DashboardPage.tsx`

**User Flows:**
1. Load dashboard → display stat cards (Active Chats, Workflows, Active Runs, Completed Runs)
2. View recent chats list (last 5, sorted by updatedAt desc)
3. View recent workflow definitions (last 6)
4. View recent runs (last 5)
5. Click quick action: "New Chat" → open CreateChatDialog
6. Click quick action: "New Workflow" → navigate to `/workflows/new`
7. Click quick action: "Browse Workflows" → navigate to `/workflows`
8. Click recent chat → navigate to `/chats/:id`
9. Click recent workflow → navigate to `/workflows/:id`
10. Click recent run → navigate to `/workflows/:id/runs/:runId`

**Interactive Controls:**
- 4 stat cards with loading skeletons
- 3 quick action cards (clickable)
- 3 "recent" panels (chats, workflows, runs) with clickable rows
- No form inputs; purely navigational

**Edge Cases:**
- Empty state: No chats, workflows, or runs exist
- Loading state: Data queries in flight (show skeletons)
- Stat cards: Display 0 values for empty categories

---

#### **B. WORKFLOWS LIST (`/workflows`)**
`apps/web/src/pages/WorkflowListPage.tsx`

**User Flows:**
1. Load list → display all workflow definitions in grid (default) or list (toggle)
2. Search by name/description/tags
3. Filter by tag (if UI present) — check spec
4. Toggle view mode: grid ↔ list
5. Click "New Workflow" button → navigate to `/workflows/new` (or builder)
6. Click workflow card → navigate to `/workflows/:id` (definition page)
7. Click "Edit" → navigate to `/workflows/:id/edit`
8. Click "Run" → open VariableInputModal (if variables) or start run directly
9. Click "Delete" → confirm dialog → delete
10. Bulk select: toggle all, select individual, bulk delete
11. Import workflow from JSON file (Upload button)
12. Use template: Browse templates, click "Use Template" → create from template

**Interactive Controls:**
- Search input (text)
- View toggle buttons (grid/list icons)
- Bulk select checkbox (header), individual checkboxes per row
- New Workflow button
- Per-workflow actions: Edit, Run, Delete buttons
- Upload/Import buttons
- Cards/rows are clickable

**Edge Cases:**
- Empty state: No workflows exist (show empty prompt)
- Loading: Skeleton grid/list while fetching
- Search: No matches found
- Bulk selection: Select all, deselect all actions
- File upload: Validation (JSON format, file size limit 5MB)
- Transition: Newly created workflows appear in list

---

#### **C. WORKFLOW BUILDER (`/workflows/:id/edit` or `/workflows/new`)**
`apps/web/src/pages/WorkflowBuilderPage.tsx`, `apps/web/src/components/workflow/DAGCanvas.tsx`, `apps/web/src/components/workflow/StagePropertiesPanel.tsx`

**User Flows — Workflow-Level:**
1. Load builder → display empty DAG canvas or existing stages/edges
2. Edit workflow name, description (WorkflowConfigPanel → GeneralTab)
3. Select session mode: auto | single | per-stage (GeneralTab)
4. Manage variables: Add/edit/delete variables with types, defaults, descriptions (VariablesTab)
5. Add tags/metadata (TagsMetadataTab)
6. Configure project & codebases (ProjectCodebasesTab)
7. Manage hooks: Add/edit/delete workflow-level hooks (on_run_start, on_run_complete, on_run_failed, etc.) (HooksTab)
8. Save workflow → POST /api/workflow-definitions (or PATCH)
9. Click "Run Workflow" button → open VariableInputModal
10. Navigate back to list

**User Flows — Stage-Level (Canvas Interaction):**
1. Add new stage: Click "Add Stage" button (bottom-center) or "+ Add Stage" (top-center empty state)
2. Select stage on canvas → properties panel opens (right sidebar)
3. Edit stage name, description
4. Select template dropdown
5. Override model (Workflow default | list)
6. Set reasoning effort (low | medium | high | xhigh)
7. Edit prompts:
   - Switch prompt type: Inline / Files / Agent
   - Add/edit/delete inline prompts (label, text)
   - Upload prompt files
   - Select pre-defined agents
8. Enable/disable skills (toggles)
9. Enable/disable MCP servers (toggles)
10. Add/edit/delete stage variables (key-value pairs)
11. Switch to Execution tab:
    - Set run condition: always | on_success | on_failure | expression (+ text field)
    - Set timeout (0-3600s, step 30)
    - Context from predecessors: summary-only | full | none
    - Toggle retry policy → set maxRetries, backoff, multiplier
    - Add/edit/delete result validation rules (contains, not_contains, min_length, max_length, regex, custom_script)
    - Manage stage hooks (pre_run, post_run, pre_prompt, post_prompt, on_error, on_cancel)
12. Close properties panel

**User Flows — Canvas Interactions:**
1. Drag stage node to reposition
2. Drag handle → handle to create edge (default edge type: on_success)
3. Click edge → edge properties open (edge type selector: on_success | on_failure | on_completion | always)
4. Delete edge: Click edge, press Delete or Backspace
5. Delete stage: Select stage, press Delete or Backspace
6. Undo (Ctrl+Z), Redo (Ctrl+Shift+Z)
7. Auto-layout: Click button (top-right) → arranges stages LR
8. Zoom/pan: Scroll to zoom, drag background to pan
9. MiniMap: Click/drag to reposition visible area
10. Copy stage node (duplicate)
11. Keyboard navigation: Tab to select stages, Enter to open properties

**Interactive Controls (Canvas):**
- React Flow canvas with drag, zoom, pan
- "Add Stage" button (floating, bottom-center)
- Auto-layout button (top-right)
- MiniMap (bottom-right)
- Controls (zoom, fit-to-view) (bottom-left)
- Stage nodes (draggable, clickable, handles for connections)
- Edges (selectable, deletable)
- Empty state panel (when no stages)

**Interactive Controls (Properties Panel):**
- Name input (text)
- Description textarea
- Template dropdown
- Model override select
- Reasoning effort select
- Prompt tabs (Inline | Files | Agent)
- Prompt list (add/edit/delete buttons)
- Skills toggles (list)
- MCP server toggles (list)
- Variables section (add/edit/delete)
- Properties/Execution tab toggle
- All Execution tab controls (selects, inputs, toggles)
- Close button (X)

**Edge Cases:**
- Empty canvas: No stages exist (show empty state)
- Add stage when canvas is empty vs. when stages exist
- Drag node outside visible area
- Create circular dependency (if validation prevents it)
- Edge types: Ensure color coding and labels match (on_success=green, on_failure=red, etc.)
- Validation errors: Invalid timeout value, invalid regex, etc.
- Undo/redo stack: Multiple operations, then undo/redo
- Save without changes (should succeed)
- Simultaneous edits (if multi-user — probably out of scope)

---

#### **D. WORKFLOW RUN PAGE (`/workflows/:id/runs/:runId`)**
`apps/web/src/pages/WorkflowRunPage.tsx`, `apps/web/src/components/workflow/RuntimeDAGCanvas.tsx`, `apps/web/src/components/workflow/WorkflowMessages.tsx`

**User Flows — Run Monitoring:**
1. Load run page → display header with breadcrumb, run name, status badge, elapsed time
2. Left side: RuntimeDAGCanvas with live status updates
   - Stage nodes: color-coded by status (pending gray, queued/running blue, paused amber, completed green, failed red, cancelled gray, awaiting_input amber)
   - Progress bars (if totalSteps > 1)
   - Step counter (step c/t)
   - Retry counter (#n if retried)
   - Click stage → select stage (right panel updates)
3. Right side (tabbed):
   - **Artifacts tab:** Show run artifacts (if any), download links
   - **Messages tab:** Show all messages from all stages, expandable per-stage sections
     - Stage section: Stage name, status badge, timing (started/completed)
     - Message blocks: Thinking (expandable), text (markdown), tool_calls (name+args+result), system (error/debug)
     - Streaming message: Live render with blinking cursor, shimmer loading
     - Usage stats: model, tokens in/out, duration
4. Bottom: Collapsible timeline (RunTimeline)
   - Per-event icon, timestamp, label, duration
   - Click event → select corresponding stage
5. Header controls:
   - Start (created state)
   - Pause (running state) / Resume (paused state)
   - Cancel (running/paused) — confirm dialog
   - Retry (failed/cancelled) — confirm dialog
6. HITL Panel (fixed location on page, initially quiet):
   - Permission mode selector (Auto-approve | Ask for unmatched | Auto-approve edits | Plan mode)
   - Pending approvals queue (if mode != bypassPermissions)
   - Approve/Reject buttons per pending stage
7. Auto-scroll: Scroll to latest message as stream progresses
8. Refresh page: Data persists (SSE reconnects)
9. Leave page → SSE disconnects cleanly

**Streaming Behavior:**
- Stream blocks arrive out-of-order; UI must consolidate by blockId + sequencing
- Thinking blocks: Show "Brain" icon, toggle expandable
- Text blocks: Markdown rendering with blinking caret during stream
- Tool call blocks: Show "Wrench" icon, name, args (collapsible), result
- System blocks: Grouped by category (error, debug, subagent)
- Status transitions: pending → thinking → streaming → complete/error
- Loading shimmer during stream: "Analyzing your request…" / "Generating response…"
- Live updates to runtime DAG: Node colors change as stage status changes

**Interactive Controls (Run Page):**
- Breadcrumb (clickable links back)
- Run controls: Start, Pause, Resume, Cancel, Retry (conditional visibility)
- Tab buttons: Artifacts, Messages (toggle active tab)
- Timeline toggle (expand/collapse)
- HITL panel: Mode selector dropdown, Approve/Reject buttons
- Message blocks: Expandable sections, markdown content
- Canvas: Click stage nodes to select

**Edge Cases:**
- Run created but not started: Show created state, Start button enabled
- Run in progress: Show running state, streaming messages, live status updates
- Run paused: Show paused state, Resume/Cancel buttons enabled
- Run completed: Show completed state, messages finalized, all blocks rendered
- Run failed: Show failed state, Retry button enabled
- Run cancelled: Show cancelled state
- Concurrent parallel stages: Ensure DAG shows all stages, timeline shows overlaps
- Long-running stages: Progress bar, step counter updates, timeout handling
- Stream lag: Ensure UI doesn't flicker or show out-of-order content
- Page refresh during run: SSE reconnects, state syncs
- Interrupts (HITL): Stage transitions to awaiting_input, approval UI appears
- Permission mode changes: UI updates without requiring page refresh
- Empty messages: Stage with no output (should still render with status)

---

#### **E. CHATS LIST (`/chats`)**
`apps/web/src/pages/ChatsListPage.tsx`

**User Flows:**
1. Load list → display all chats
2. Search by name or tags
3. Filter by status: all | active | archived
4. Click "New Chat" button → open CreateChatDialog
5. Click chat row → navigate to `/chats/:id`
6. Click "Archive" button → archive chat (if active)
7. Click "Delete" button → confirm dialog → delete
8. Bulk select: toggle all, select individual chats, bulk delete
9. Transition: Newly created chat appears in list

**Interactive Controls:**
- Search input
- Status filter buttons (all/active/archived)
- New Chat button
- Create Chat Dialog (modal)
- Per-chat actions: Archive, Delete (with confirm)
- Bulk select: Header checkbox, individual checkboxes
- Chat rows: Clickable name, icon, updated timestamp

**Edge Cases:**
- Empty state: No chats exist
- Search: No matches
- Archive action: Chat moves out of active filter
- Bulk operations: Select all, partial selection, deselect

---

#### **F. CHAT DETAIL PAGE (`/chats/:id`)**
`apps/web/src/pages/ChatPage.tsx`, `apps/web/src/components/chat/ChatInput.tsx`, `apps/web/src/components/chat/ChatMessageList.tsx`, `apps/web/src/components/chat/StreamingMessage.tsx`

**User Flows:**
1. Load chat → display message history (empty or populated)
2. Show chat info header (breadcrumb, chat name, created date)
3. Bottom: ChatInput with:
   - Textarea for user message (auto-resize, Ctrl+Enter to send)
   - Send button (disabled if empty or streaming)
   - Stop button (visible if streaming)
   - Model selector (dropdown)
   - Reasoning effort selector (low/medium/high)
   - Codebase picker (read-only if linked, or selector if project linked)
   - Git repo display (if local paths configured)
   - Attach files button (file input)
   - Files panel toggle button
4. Message list:
   - User messages (left-aligned, avatar)
   - Assistant messages (right-aligned, avatar)
   - Streaming message blocks (thinking, text, tool_calls, system)
   - Optimistic user message (show pending state)
   - Auto-scroll to latest message
5. Files panel (right sidebar, toggle):
   - List attached files
   - Preview file content
   - Remove file button
6. Send message → streaming starts (SSE connection)
7. Stream updates: Blocks arrive, UI renders live
8. Stream complete: Final message in history
9. Edit chat properties (if UI exists):
   - Name (input)
   - Description (textarea)
   - Model (select)
   - Tags (input, up to 20)
10. Close chat (archive or nav away)

**Streaming Behavior (Chat):**
- SSE connection keyed by sessionId (not chatId)
- Stream status: idle → pending → thinking → streaming → complete
- Blinking cursor during text streaming
- Markdown rendering
- Live token/usage stats on complete
- Graceful handling of connection loss/reconnect

**Interactive Controls (Chat Input):**
- Textarea (grows on input, max 200px height)
- Send button (with loading spinner during send)
- Stop button (visible during streaming)
- Model selector dropdown
- Reasoning effort selector
- Codebase picker (project-linked repos)
- File attachment button
- Files panel toggle

**Edge Cases:**
- Empty chat: No messages yet
- Streaming: Long-running message, network delay
- File attachment: Large file, multiple files, remove file
- Model change: Mid-conversation, should update next message
- Connection loss: SSE reconnect, resume streaming
- Disabled input: While streaming, before chat loads
- Auto-scroll: Ensure user sees new messages as they arrive
- Optimistic updates: User message shows immediately (pending), assistant response streams in
- Chat archived: Readonly state (input disabled)

---

#### **G. AUTOMATIONS PAGE (`/automations`)**
`apps/web/src/pages/AutomationsPage.tsx`

**User Flows:**
1. Load list → display all automations
2. Click "New Automation" button → navigate to `/automations/new`
3. Click automation row → navigate to `/automations/:id`
4. Toggle automation enabled/disabled (via toggle button)
5. Click "Trigger Now" button → trigger automation immediately
6. Click "Delete" button → confirm dialog → delete
7. View automation metadata: trigger type icon/label, last run timestamp, run count

**Interactive Controls:**
- New Automation button
- Per-automation: Status toggle, Trigger button, Delete button
- Automation rows: Clickable to view detail
- Icons: Manual (hand), Schedule (clock), Webhook (webhook)

**Edge Cases:**
- Empty state: No automations exist
- Trigger automation: Show success/error toast
- Enable/disable: Show loading spinner, update UI on success
- Delete: Confirm dialog with automation name

---

#### **H. AUTOMATION CREATE PAGE (`/automations/new`)**
`apps/web/src/pages/CreateAutomationPage.tsx`

**User Flows:**
1. Load form → display empty fields
2. Enter automation name (text input, required)
3. Enter description (textarea, optional)
4. Select project (dropdown, optional) — filters workflow list
5. Select trigger type: manual | schedule | webhook
   - **manual:** No additional fields
   - **schedule:** Cron expression input (default `0 9 * * *`)
   - **webhook:** Auto-generated token display, copy button
6. Select input mode: single | loop | batch | script
   - **single:** No additional fields
   - **loop:**
     - Loop variable name (text input)
     - Loop items (JSON array textarea, e.g., `["item1", "item2"]`)
   - **batch:**
     - Batch data format: csv | json | jsonl
     - Batch data (textarea)
     - Column mapping (auto-inferred or manual)
     - Preview table
   - **script:**
     - Script command (text input)
     - Timeout (number input, default 60000ms)
     - Output format: json_array | csv | jsonl
     - Environment variables (JSON textarea)
     - Test button → execute script, show preview results
7. Select workflows (multi-select, required, at least 1)
   - Add workflow button, remove per-workflow button
8. Base variables (JSON textarea, optional)
9. Max concurrency (number input, for loop/batch, 1-10)
10. On error behavior: continue | stop (for loop/batch)
11. Submit → Create automation → Navigate to detail page

**Interactive Controls:**
- Form fields: text inputs, textareas, dropdowns, multi-select
- Project dropdown (filters workflow list)
- Workflow multi-select (add/remove buttons per workflow)
- Tab/section toggles for trigger type, input mode
- Test button (script mode)
- Submit button (disabled if required fields missing or validation errors)
- Cancel button (nav back)

**Validation:**
- Automation name required
- At least one workflow selected
- Cron expression required for schedule trigger
- Valid cron expression syntax
- Loop variable name and items if loop mode
- Batch data valid for selected format
- JSON validity (variables, loop items, env)
- Script command non-empty if script mode
- Max concurrency 1-10

**Edge Cases:**
- Empty state: No workflows available
- Test script: Show result/error toast
- Batch data parsing: Show column mapping UI or error
- Workflow filtering by project: List updates when project selected
- Form validation: Show error messages per field
- Cron syntax validation: Provide helper or validation message

---

#### **I. AUTOMATION DETAIL PAGE (`/automations/:id`)**
`apps/web/src/pages/AutomationDetailPage.tsx`

**User Flows:**
1. Load detail → display automation config (read-only display of form fields)
2. Edit automation: Enter edit mode (if UI supports), modify fields, save
3. Trigger automation: Button → execute immediately
4. View run history (if UI shows runs linked to automation)
5. Enable/disable toggle
6. Delete automation: Confirm dialog

**Interactive Controls:**
- Same as create form, but potentially read-only initially
- Edit button (if applicable)
- Save button (if in edit mode)
- Trigger button
- Enable/disable toggle
- Delete button

---

#### **J. PROJECTS LIST (`/projects`)**
`apps/web/src/pages/ProjectsListPage.tsx`

**User Flows:**
1. Load list → display all projects (active status)
2. Search by name or description
3. Click "New Project" button → navigate to `/projects/new`
4. Click project card → navigate to `/projects/:id`
5. Click "Delete" button → confirm dialog → delete
6. View project metadata: name, description, codebases count, default model, created/updated date

**Interactive Controls:**
- Search input
- New Project button
- Per-project: Settings button, Delete button
- Project cards: Clickable to view detail
- Card content: Name, description, stats (codebase count, etc.), timestamps

**Edge Cases:**
- Empty state: No projects exist
- Search: No matches
- Delete: Confirm with project name

---

#### **K. PROJECT CREATE PAGE (`/projects/new`)**
`apps/web/src/pages/CreateProjectPage.tsx`

**User Flows:**
1. Load form → display empty fields
2. Enter project name (text input, required)
3. Enter description (textarea, optional)
4. Select default model (dropdown, from available models)
5. Select session mode: single | per-stage | auto
6. Select worktree retention: immediate | 24h | 72h | manual
7. Submit → Create project → Navigate to detail page

**Interactive Controls:**
- Form fields: text inputs, dropdowns
- Submit button (disabled if required fields missing)
- Cancel button

**Validation:**
- Project name required
- Valid model selected (or optional)
- Valid session mode
- Valid retention option

---

#### **L. PROJECT DETAIL PAGE (`/projects/:id`)**
`apps/web/src/pages/ProjectDetailPage.tsx`

**User Flows — Codebases Tab:**
1. Load tab → display linked codebases with status
   - Status: pending | cloning | ready | error | stale
2. Add codebase: Click "Add Codebase" button → CodebaseLinker UI
   - URL input (git remote, local path, or local directory)
   - Alias input (display name)
   - Branch selector (for git)
   - Submit → Link codebase (status → cloning)
3. Monitor clone progress: Status updates (polling every 3s while cloning)
4. Fetch codebase: Refresh button → fetch latest code
5. Delete codebase: Confirm dialog → unlink
6. View clone error: Click codebase → show error logs in modal

**User Flows — Artifacts Tab:**
1. Load tab → display artifact categories: Skills | Prompts | Agents | MCP
2. Select category → show available artifacts for category
3. Upload artifact:
   - Skills: Folder upload (with SKILL.md validation)
   - Prompts: File upload
   - Agents: File upload
   - MCP: Form to add server (name, command, env vars)
4. Preview artifact: Click artifact → show content in modal
5. Edit artifact: Click edit button → edit form → save
6. Delete artifact: Confirm dialog → delete

**User Flows — Settings Tab:**
1. Load tab → display project settings
2. Edit default model (dropdown)
3. Edit session mode (select)
4. Edit max codebases (number input)
5. Edit retention policy (select)
6. Edit auto-fetch interval (number input, ms)
7. Edit copilot config (if present)
8. Save changes → PATCH /api/projects/:id

**Interactive Controls (Codebases):**
- Add Codebase button
- Per-codebase: Status badge, Refresh button, Delete button, Error log button
- CodebaseLinker modal: URL input, Alias input, Branch selector, Submit button

**Interactive Controls (Artifacts):**
- Category buttons (Skills, Prompts, Agents, MCP)
- Upload button (per category)
- File input (hidden)
- Per-artifact: Preview button, Edit button, Delete button
- Preview modal: Content display (syntax highlighting for code)
- Edit modal: Form fields, Save button

**Interactive Controls (Settings):**
- Form fields: dropdowns, number inputs
- Save button

**Edge Cases:**
- Clone in progress: Show spinner, disable delete, show progress
- Clone error: Show error badge, error logs modal
- Artifact validation: SKILL.md required for skills
- Empty artifact categories: Show "No artifacts" message
- File upload: Size limits, format validation
- Codebase stale: Show indicator, Refresh button

---

#### **M. TEMPLATES PAGE (`/templates`)**
`apps/web/src/pages/TemplateExplorer.tsx`

**User Flows:**
1. Load page → display template cards in grid
   - Name, description, category icon, variables count
2. Search templates by name or description
3. Click "Use Template" button → Create workflow from template → Navigate to `/workflows/:id`
4. View template details (on card or in modal)
5. Filter by category (if UI present)

**Interactive Controls:**
- Search input
- Per-template: "Use Template" button
- Template cards: Show metadata, icon

**Edge Cases:**
- Empty state: No templates (unlikely, but handle)
- Search: No matches
- Create from template: Workflow pre-populated with template config

---

#### **N. SETTINGS PAGE (`/settings`)**
`apps/web/src/pages/Settings.tsx`

**User Flows:**
1. Load page → display settings tabs: General | Provider | Copilot | Advanced
2. **General tab:**
   - Theme selector: Light | Dark | System
   - About section: Version, runtime info
3. **Provider tab:**
   - Provider selector: Copilot | Anthropic | Claude Agent
   - Provider status: Connected/Disconnected with indicator
   - Provider description and config options
4. **Copilot tab:**
   - Copilot connection state
   - Available models list
   - Refresh button
5. **Advanced tab:**
   - Health check: API connectivity, database, cache
   - Sandbox config (if editable)
   - Advanced settings (if any)
6. Click provider → switch provider (with confirmation if applicable)

**Interactive Controls:**
- Tab buttons
- Theme selector buttons
- Provider selector buttons/radio
- Refresh button (models, health)
- Status indicators (connected/disconnected icons)
- Model list (read-only)

**Edge Cases:**
- Provider switch: Show loading, update models list
- Connection error: Show error state, retry button
- Health check failure: Show error details

---

#### **O. VARIABLE INPUT MODAL (Workflow Pre-Run)**
`apps/web/src/components/workflow/VariableInputModal.tsx`

**User Flows:**
1. Open modal before starting workflow run
2. Display all required variables with asterisk
3. Render type-specific inputs:
   - **string:** Text input
   - **number:** Number input
   - **boolean:** Checkbox
   - **choice:** Dropdown (from options)
   - **text:** Textarea
4. Auto-fill git variables from linked project codebases (if applicable)
5. Validate on submit:
   - Required fields must be filled
   - Type validation (number is numeric, etc.)
6. Optional: File uploads (prompts, skills, agents categories)
7. Optional: Stage overrides (skip stage, per-stage variable overrides)
8. Submit → Start run with variables
9. Cancel → Close modal

**Interactive Controls:**
- Form fields (type-specific)
- Upload section: Category selector, upload button, file list with remove
- Stage overrides section: Collapsible, per-stage checkboxes, variable inputs
- Run button (disabled until required fields filled)
- Cancel button

**Validation:**
- Required field validation (show error message)
- Type validation (numeric for number, etc.)
- File upload validation (optional)

**Edge Cases:**
- No variables: Show simple "Run Workflow" confirmation
- All optional: "Run" button always enabled
- Pre-filled defaults: Show default values in inputs
- Git variables auto-filled: Readonly or prefilled inputs
- Upload validation: Show error if file missing required content

---

### 3. STABLE SELECTOR AUDIT (CRITICAL FOR DETERMINISM)

**Search Results:** 
- **CRITICAL FINDING:** NO `data-testid` attributes found in the entire apps/web/src codebase. Zero matches across 147 component files.
- This is a **MAJOR BLOCKER** for deterministic E2E testing.

**Elements Currently Relying on Unstable Selectors:**

| Element | Current Selector (UNSTABLE) | Component | Location | Recommendation |
|---|---|---|---|---|
| React Flow Canvas | `rf__wrapper` (React Flow internal) | DAGCanvas | ~line 169 | ✓ WORKS but undocumented; add data-testid="workflow-canvas" anyway |
| Stage Nodes | `text=Stage Name` (text content) | StageNode | Entire component | ADD: data-testid="stage-node-{stageId}" or `data-testid="stage-node" data-stage-id="{id}"` |
| Edge Connections | Click/drag handles (Position.Left/Right) | StageNode | Handles section | ADD: data-testid="handle-target-{id}", data-testid="handle-source-{id}" |
| Save Button | `button:has-text("Save")` (fragile text search) | WorkflowBuilderPage | Header | ADD: data-testid="save-workflow" |
| Add Stage Button | `button:has-text("Add Stage")` or `Plus` icon | DAGCanvas | Floating panel | ADD: data-testid="add-stage-button" |
| Auto-Layout Button | `button:has-text("Auto-Layout")` | DAGCanvas | Top-right panel | ADD: data-testid="auto-layout-button" |
| Stage Properties Panel | Panel contains form, no stable ID | StagePropertiesPanel | Right sidebar | ADD: data-testid="stage-properties-panel" |
| Property Tabs | `role="tab"` with aria-selected (fragile) | StagePropertiesPanel | Tab bar ~line 120 | ADD: data-testid="stage-properties-tab-{tabName}" (properties/execution) |
| Stage Name Input | Input in properties panel | StagePropertiesPanel (PropertiesTab) | Dynamic form | ADD: data-testid="stage-name-input" |
| Template Dropdown | StyledSelect component | StagePropertiesPanel | Properties tab | ADD: data-testid="template-select" |
| Model Override Select | StyledSelect component | StagePropertiesPanel | Properties tab | ADD: data-testid="model-override-select" |
| Prompt Type Tabs | Inline/Files/Agent tabs | StagePropertiesPanel (PropertiesTab) | Prompt section | ADD: data-testid="prompt-type-tab-{type}" |
| Prompt Editor | PromptEditor component | PromptEditor | Dynamic form | ADD: data-testid="prompt-editor" |
| Prompts List | List of added prompts | StagePropertiesPanel (PropertiesTab) | Inline prompts section | ADD: data-testid="prompt-list-item-{index}" |
| Skill Toggles | Checkbox toggles in list | StagePropertiesPanel (PropertiesTab) | Skills section | ADD: data-testid="skill-toggle-{skillName}" |
| MCP Server Toggles | Checkbox toggles in list | StagePropertiesPanel (PropertiesTab) | MCP section | ADD: data-testid="mcp-toggle-{serverName}" |
| Variables Key-Value | Input pairs | StagePropertiesPanel (PropertiesTab) | Variables section | ADD: data-testid="variable-input-{key}", data-testid="variable-value-{key}" |
| Execution Tab Fields | All execution inputs | StagePropertiesPanel (ExecutionTab) | Execution tab | ADD data-testid to each: condition-select, timeout-input, retry-toggle, retry-maxRetries, etc. |
| Run Condition Select | StyledSelect | ExecutionTab | Execution tab | ADD: data-testid="run-condition-select" |
| Expression Text Input | Textarea for expression | ExecutionTab | Execution tab | ADD: data-testid="run-condition-expression" |
| Timeout Input | NumberStepper | ExecutionTab | Execution tab | ADD: data-testid="timeout-stepper" |
| Retry Toggle | ToggleSwitch | ExecutionTab | Execution tab | ADD: data-testid="retry-policy-toggle" |
| Retry Config (maxRetries, backoff, multiplier) | NumberStepper inputs | ExecutionTab | Retry section | ADD: data-testid="retry-{fieldName}" |
| Validation Rules List | Dynamic list of rules | ExecutionTab | Validation section | ADD: data-testid="validation-rule-{index}" |
| Validation Rule Type Select | StyledSelect | ExecutionTab | Per rule | ADD: data-testid="rule-type-select-{index}" |
| Validation Rule Params | Input fields per rule type | ExecutionTab | Per rule | ADD: data-testid="rule-param-{ruleType}-{paramName}-{index}" |
| Stage Hooks Section | Hooks editor UI | ExecutionTab / HookEditor | Stage hooks section | ADD: data-testid="stage-hooks-editor" |
| Runtime DAG Canvas | rf__wrapper (React Flow internal) | RuntimeDAGCanvas | ~line 150+ | ✓ WORKS; add data-testid="run-canvas" anyway |
| Runtime Stage Nodes | Text content, Status colors | RuntimeStageNode | Dynamic nodes | ADD: data-testid="runtime-stage-node-{stageRunId}" |
| Stage Run Controls | Per-stage buttons (Pause/Resume/Retry/Cancel) | StageRunControls (if exists) | Per node or sidebar | ADD: data-testid="stage-run-button-{action}" where action=pause/resume/cancel/retry |
| Workflow Run Controls | Run-level buttons | RunControls | Header | ADD: data-testid="run-control-{action}" (start/pause/resume/cancel/retry) |
| Run Timeline | CollapsibleSection | RunTimeline | Bottom panel | ADD: data-testid="run-timeline" |
| Timeline Events | Per-event rows | RunTimeline | Timeline list | ADD: data-testid="timeline-event-{eventId}" or data-testid="timeline-event-{stageId}" |
| Messages Tab Button | `button:has-text("Workflow Messages")` | WorkflowRunPage | Right panel tabs | ADD: data-testid="messages-tab" |
| Artifacts Tab Button | `button:has-text("Files")` or "Artifacts" | WorkflowRunPage | Right panel tabs | ADD: data-testid="artifacts-tab" |
| Stage Message Sections | Expandable sections per stage | WorkflowMessages | Right panel | ADD: data-testid="stage-messages-{stageRunId}" |
| Message Blocks | Thinking/Text/ToolCall blocks | StreamingMessage, AssistantMessage | Message list | ADD: data-testid="message-block-{blockId}" or data-testid="message-block-{type}-{index}" |
| Thinking Block Expand Toggle | Chevron button | ThinkingBlock (inside StreamingMessage) | Per thinking block | ADD: data-testid="thinking-expand-{blockId}" |
| Chat Input Textarea | textarea | ChatInput | Chat page bottom | ADD: data-testid="chat-input-textarea" |
| Chat Send Button | button with Send text/icon | ChatInput | Chat input area | ADD: data-testid="chat-send-button" |
| Chat Stop Button | button with Stop text | ChatInput | Chat input area (when streaming) | ADD: data-testid="chat-stop-button" |
| Model Selector (Chat) | Dropdown in ChatInput | ChatInput | Top of input toolbar | ADD: data-testid="chat-model-selector" |
| Reasoning Effort Selector | Dropdown in ChatInput | ChatInput | Top of input toolbar | ADD: data-testid="chat-reasoning-effort-selector" |
| Codebase Picker | Dropdown/multi-select | ChatInput | Top of input toolbar | ADD: data-testid="chat-codebase-picker" |
| File Attachment Button | Button with Paperclip icon | ChatInput | Input toolbar | ADD: data-testid="chat-attach-files-button" |
| Files Panel Toggle | Button with icon | ChatInput | Input toolbar | ADD: data-testid="chat-files-panel-toggle" |
| Chat Message List | Container | ChatMessageList | Message history area | ADD: data-testid="chat-message-list" |
| User Message | Per-message row | UserMessage | Message list | ADD: data-testid="chat-message-user-{messageId}" or data-testid="chat-message-user-{index}" |
| Assistant Message | Per-message row | AssistantMessage | Message list | ADD: data-testid="chat-message-assistant-{messageId}" or data-testid="chat-message-assistant-{index}" |
| Streaming Message Block | Live rendering | StreamingMessage | During stream | ADD: data-testid="chat-streaming-message" |
| Workflow List Search | Input | WorkflowListPage | Header | ADD: data-testid="workflow-search-input" |
| Workflow List View Toggle | Grid/List buttons | WorkflowListPage | Header | ADD: data-testid="workflow-view-mode-toggle-grid", data-testid="workflow-view-mode-toggle-list" |
| Workflow List New Button | Button | WorkflowListPage | Header | ADD: data-testid="new-workflow-button" |
| Workflow Card | Clickable card | WorkflowListPage | Grid/List | ADD: data-testid="workflow-card-{workflowId}" |
| Workflow Edit Button | Button on card | WorkflowListPage | Per card | ADD: data-testid="workflow-edit-{workflowId}" |
| Workflow Run Button | Button on card | WorkflowListPage | Per card | ADD: data-testid="workflow-run-{workflowId}" |
| Workflow Delete Button | Button on card | WorkflowListPage | Per card | ADD: data-testid="workflow-delete-{workflowId}" |
| Workflows Bulk Select All | Checkbox in header | WorkflowListPage | Header | ADD: data-testid="workflow-select-all-checkbox" |
| Workflows Individual Checkbox | Checkbox per card | WorkflowListPage | Per card | ADD: data-testid="workflow-select-checkbox-{workflowId}" |
| Automation List | Container | AutomationsPage | Page body | ADD: data-testid="automations-list" |
| Automation Card/Row | Per automation | AutomationsPage | List | ADD: data-testid="automation-row-{automationId}" |
| Automation Trigger Button | Play icon button | AutomationsPage | Per automation | ADD: data-testid="automation-trigger-{automationId}" |
| Automation Enable/Disable Toggle | Toggle button | AutomationsPage | Per automation | ADD: data-testid="automation-toggle-{automationId}" |
| Automation Delete Button | Trash icon button | AutomationsPage | Per automation | ADD: data-testid="automation-delete-{automationId}" |
| New Automation Button | Button | AutomationsPage | Header | ADD: data-testid="new-automation-button" |
| Chat List Search | Input | ChatsListPage | Header | ADD: data-testid="chat-search-input" |
| Chat Status Filter | Button group | ChatsListPage | Header | ADD: data-testid="chat-status-filter-{status}" (all/active/archived) |
| Chat Card/Row | Per chat | ChatsListPage | List | ADD: data-testid="chat-row-{chatId}" |
| Chat Archive Button | Button | ChatsListPage | Per chat | ADD: data-testid="chat-archive-{chatId}" |
| Chat Delete Button | Button | ChatsListPage | Per chat | ADD: data-testid="chat-delete-{chatId}" |
| Projects List Search | Input | ProjectsListPage | Header | ADD: data-testid="project-search-input" |
| Project Card | Per project | ProjectsListPage | Grid | ADD: data-testid="project-card-{projectId}" |
| Project Settings Button | Gear icon | ProjectsListPage | Per card | ADD: data-testid="project-settings-{projectId}" |
| Project Delete Button | Trash icon | ProjectsListPage | Per card | ADD: data-testid="project-delete-{projectId}" |
| New Project Button | Button | ProjectsListPage | Header | ADD: data-testid="new-project-button" |
| Create Automation Form | Form container | CreateAutomationPage | Page body | ADD: data-testid="create-automation-form" |
| Automation Name Input | Input | CreateAutomationPage | Form | ADD: data-testid="automation-name-input" |
| Trigger Type Select | Select/radio | CreateAutomationPage | Form | ADD: data-testid="automation-trigger-type-select" |
| Cron Expression Input | Input | CreateAutomationPage | Form (schedule trigger) | ADD: data-testid="automation-cron-input" |
| Input Mode Select | Select/radio | CreateAutomationPage | Form | ADD: data-testid="automation-input-mode-select" |
| Loop Variable Input | Input | CreateAutomationPage | Form (loop mode) | ADD: data-testid="automation-loop-variable-input" |
| Loop Items Textarea | Textarea | CreateAutomationPage | Form (loop mode) | ADD: data-testid="automation-loop-items-textarea" |
| Batch Data Textarea | Textarea | CreateAutomationPage | Form (batch mode) | ADD: data-testid="automation-batch-data-textarea" |
| Script Command Input | Input | CreateAutomationPage | Form (script mode) | ADD: data-testid="automation-script-command-input" |
| Script Test Button | Button | CreateAutomationPage | Form (script mode) | ADD: data-testid="automation-script-test-button" |
| Workflow Multi-Select | Custom UI | CreateAutomationPage | Form | ADD: data-testid="automation-workflow-multi-select", data-testid="automation-workflow-add-{workflowId}", data-testid="automation-workflow-remove-{workflowId}" |
| Create Automation Submit | Button | CreateAutomationPage | Form | ADD: data-testid="create-automation-submit" |
| Project Codebases Tab | Tab button | ProjectDetailPage | Tab bar | ADD: data-testid="project-tab-codebases" |
| Project Artifacts Tab | Tab button | ProjectDetailPage | Tab bar | ADD: data-testid="project-tab-artifacts" |
| Project Settings Tab | Tab button | ProjectDetailPage | Tab bar | ADD: data-testid="project-tab-settings" |
| Add Codebase Button | Button | ProjectDetailPage | Codebases tab | ADD: data-testid="project-add-codebase-button" |
| Codebase Row | Per codebase | ProjectDetailPage | Codebases list | ADD: data-testid="codebase-row-{codebaseId}" |
| Codebase Refresh Button | Button | ProjectDetailPage | Per codebase | ADD: data-testid="codebase-refresh-{codebaseId}" |
| Codebase Delete Button | Button | ProjectDetailPage | Per codebase | ADD: data-testid="codebase-delete-{codebaseId}" |
| Codebase Error Log Button | Button | ProjectDetailPage | Per codebase | ADD: data-testid="codebase-error-log-{codebaseId}" |
| Artifact Category Buttons | Button group | ProjectDetailPage | Artifacts tab | ADD: data-testid="artifact-category-{categoryKey}" (skill/prompt/agent/mcp) |
| Artifact Upload Button | Button | ProjectDetailPage | Per category | ADD: data-testid="artifact-upload-{category}" |
| Artifact List | Container | ProjectDetailPage | Per category | ADD: data-testid="artifact-list-{category}" |
| Artifact Row | Per artifact | ProjectDetailPage | Artifact list | ADD: data-testid="artifact-row-{artifactId}" |
| Artifact Preview Button | Button | ProjectDetailPage | Per artifact | ADD: data-testid="artifact-preview-{artifactId}" |
| Artifact Edit Button | Button | ProjectDetailPage | Per artifact | ADD: data-testid="artifact-edit-{artifactId}" |
| Artifact Delete Button | Button | ProjectDetailPage | Per artifact | ADD: data-testid="artifact-delete-{artifactId}" |
| HITL Panel | Container | HitlPanel | Run page | ADD: data-testid="hitl-panel" |
| HITL Mode Selector | Select | HitlPanel | Panel header | ADD: data-testid="hitl-mode-select" |
| HITL Pending Queue | List | HitlPanel | Panel body | ADD: data-testid="hitl-pending-queue" |
| HITL Pending Stage Row | Per stage | HitlPanel | Queue list | ADD: data-testid="hitl-pending-stage-{stageRunId}" |
| HITL Approve Button | Button | HitlPanel | Per pending stage | ADD: data-testid="hitl-approve-{stageRunId}" |
| HITL Reject Button | Button | HitlPanel | Per pending stage | ADD: data-testid="hitl-reject-{stageRunId}" |
| Variable Input Modal | Modal container | VariableInputModal | Modal | ADD: data-testid="variable-input-modal" |
| Variable Input (per variable) | Input (type-specific) | VariableInputModal | Form | ADD: data-testid="variable-input-{variableName}" |
| Variable Submit Button | Button | VariableInputModal | Modal footer | ADD: data-testid="variable-input-submit" |
| Toast Notification | Toast container | Toast | Portal (fixed) | ADD: data-testid="toast-{toastId}" or data-testid="toast-{variant}" where variant=success/error/warning/info |
| Toast Dismiss Button | Button | Toast | Toast item | ADD: data-testid="toast-dismiss-{toastId}" |
| Dashboard Stats Cards | Cards | DashboardPage | Stats grid | ADD: data-testid="stats-card-{label}" (activeChats/workflows/activeRuns/completed) |
| Dashboard Quick Action Cards | Cards | DashboardPage | Actions grid | ADD: data-testid="quick-action-{title}" (New Chat/New Workflow/Browse Workflows) |
| Dashboard Recent Chats Panel | Container | DashboardPage | Recent section | ADD: data-testid="dashboard-recent-chats" |
| Dashboard Recent Workflows Panel | Container | DashboardPage | Recent section | ADD: data-testid="dashboard-recent-workflows" |
| Dashboard Recent Runs Panel | Container | DashboardPage | Recent section | ADD: data-testid="dashboard-recent-runs" |
| Settings Tab Buttons | Button | Settings | Tab bar | ADD: data-testid="settings-tab-{tabName}" (general/provider/copilot/advanced) |
| Theme Selector Buttons | Button group | Settings (GeneralSettings) | General tab | ADD: data-testid="theme-selector-{themeName}" (light/dark/system) |
| Provider Selector Buttons | Button group | Settings (ProviderSettings) | Provider tab | ADD: data-testid="provider-selector-{providerType}" (copilot/anthropic/claude-agent) |
| Templates Search | Input | TemplateExplorer | Header | ADD: data-testid="template-search-input" |
| Template Card | Per template | TemplateExplorer | Grid | ADD: data-testid="template-card-{templateId}" |
| Template Use Button | Button | TemplateExplorer | Per card | ADD: data-testid="template-use-{templateId}" |
| Confirm Dialog | Modal | ConfirmDialog | Modal | ADD: data-testid="confirm-dialog", data-testid="confirm-dialog-confirm", data-testid="confirm-dialog-cancel" |
| Sidebar Nav Item | Button | Sidebar | Nav list | ADD: data-testid="sidebar-nav-{label}" (Dashboard/Projects/Chats/Workflows/Scripts/Automations/Templates/Settings) |
| Header Breadcrumb | Navigation | Breadcrumb | Header | ADD: data-testid="breadcrumb-{depth}" or data-testid="breadcrumb-link-{label}" |
| Create Chat Dialog | Modal | CreateChatDialog | Modal | ADD: data-testid="create-chat-dialog" |
| Chat Dialog Name Input | Input | CreateChatDialog | Form | ADD: data-testid="create-chat-name-input" |
| Chat Dialog Description Input | Textarea | CreateChatDialog | Form | ADD: data-testid="create-chat-description-input" |
| Chat Dialog Model Select | Select | CreateChatDialog | Form | ADD: data-testid="create-chat-model-select" |
| Chat Dialog Submit Button | Button | CreateChatDialog | Form | ADD: data-testid="create-chat-submit" |

---

### 4. DETERMINISM HAZARDS & MITIGATION STRATEGIES

| Hazard | Component | Root Cause | Risk Level | Deterministic Strategy |
|---|---|---|---|---|
| **SSE/Streaming Long-Lived Connections** | ChatPage, WorkflowRunPage | `page.waitForLoadState('networkidle')` won't settle; SSE keeps connection open | CRITICAL | Use `page.waitForLoadState('load')` instead (waits for DOMContentLoaded, not network idle). Assert on specific page elements or DOM state, not network idle. Example: `await expect(page.locator('[data-testid="chat-message-list"]')).toBeVisible()` |
| **Non-Deterministic Streaming Content (AI Runs)** | StreamingMessage, WorkflowRunPage, ChatPage | LLM outputs vary per run; cost + time variance | CRITICAL | Do NOT assert on exact message content. Instead: (1) Mock `/api` routes to return deterministic responses for E2E (use route interception or test fixtures). (2) Assert on status transitions (pending → streaming → complete), block types received, usage stats structure. (3) Use `waitForRunComplete(runId)` helper to poll for completion status, not message content. |
| **React Flow Async Layout** | DAGCanvas, RuntimeDAGCanvas | Layout engine renders async; nodes may not be positioned immediately | HIGH | After adding stages, use `waitForTimeout(300-500ms)` to allow fitView + layout to settle. Or: Explicitly check for element visibility with specific `{ timeout: 10000 }` rather than relying on immediate positioning. Use `rf__wrapper` visible check before interacting with nodes. |
| **Toast Auto-Dismiss** | Toast.tsx | Toasts dismiss after 4-8 seconds by default (configurable); test may check for toast after it's gone | HIGH | Immediately after action that triggers toast, check for toast presence before timeout. Pass custom `duration: 0` for test toasts (persistence). Use data-testid to target toast by ID and dismiss manually in test if needed. Assert toast before it auto-dismisses. |
| **Optimistic Updates (Chats, Run Controls)** | ChatInput, RunControls | UI updates immediately (optimistic), real API call completes later | MEDIUM | Distinguish between: (1) Optimistic user message (show pending class/style immediately), (2) Real message in history (after API success). Assert on presence in DOM (optimistic), THEN wait for real API response. Or: Intercept API calls with `page.route()` to control timing. |
| **Modal Dialogs Timing** | VariableInputModal, ConfirmDialog, etc. | Dialog render, overlay appear, then mount/focus; keyboard focus steals from page | MEDIUM | After triggering modal open, wait for modal overlay or close button visible: `await expect(page.locator('[data-testid="variable-input-modal"]')).toBeVisible()`. Use `page.waitForLoadState('load')` before interacting with modal (not 'networkidle'). |
| **Bulk Select State Sync** | WorkflowListPage, ChatsListPage | Select all/deselect all affects checkbox UI and internal state; flicker risk | MEDIUM | Use data-testid on header checkbox and verify visual state (checked/unchecked class). Wait for individual checkboxes to render before asserting count. Click once and wait for state update (short timeout ~100ms) before verifying. |
| **Form Validation Timing** | CreateAutomationPage, CreateProjectPage, etc. | Validation errors may appear async (after field blur or submit); button disabled state changes | MEDIUM | After filling form, click submit → wait for error or success message using data-testid. Don't assume submit button disabled state immediately. Use `.toBeDisabled()` with explicit wait. |
| **File Upload Handling** | ProjectDetailPage (skill upload), WorkflowListPage (JSON import) | File dialog / input[type=file] interaction is non-standard; browser may delay | MEDIUM | Use `page.setInputFiles()` to set file directly on input[type=file]; avoid simulating file picker dialog. Wait for success message or element update after file set. Avoid using actual file dialogs. |
| **Search/Filter Debounce** | WorkflowListPage (search), ChatsListPage (search), TemplateExplorer (search) | Search input may debounce (100-300ms typical); results update async | MEDIUM | After typing in search input, wait for results to update: `await page.waitForTimeout(300)` or polling check for specific result element. Use data-testid on result list and check for expected items. Avoid asserting on DOM immediately after typing. |
| **Dropdown/Select Async Render** | Stage properties selects (template, model, condition, etc.), project select | Dropdown options may load async or are virtualized; scroll-to-find needed | MEDIUM | After clicking dropdown trigger, use `page.waitForSelector('[role="option"]:visible')` to wait for options to appear. Use arrow keys to navigate and Enter to select (keyboard navigation is most reliable). Avoid assuming dropdown opens instantly. |
| **Pagination / Lazy Loading** | Workflow list, Chat list (if large), Project list | Lists may paginate or virtualize; scrolling needed to reveal items | MEDIUM | If testing item at bottom of list, scroll to it: `await page.locator('[data-testid="workflow-card-{id}"]').scrollIntoViewIfNeeded()`. Use explicit waits for item visibility. Check for "Load More" button if pagination present. |
| **Session State Sync** | ChatPage (sessionId key), StreamStore, WorkflowRunStore | Store/context state may lag behind API; render uses stale data initially | MEDIUM | Use `page.goto(url)` with `waitForLoadState('load')` to ensure API call completes. Query API directly (via fetch helper in test) to verify server state separately from UI render. Assert UI updates after API confirms. |
| **Animation/Transition Timing** | All interactive elements (buttons, modals, panels) | CSS transitions/animations (entrance, exit) take 200-300ms; DOM may exist but invisible | MEDIUM | Use `.toBeVisible()` instead of checking element existence. Pass explicit `{ timeout: 5000 }` to visibility checks. Avoid checking computed styles directly; rely on visibility and element presence. |
| **Button Disabled State Race** | Run controls (Start, Pause, Cancel, Retry), Action buttons | Button may transition from enabled → loading/disabled as API call in flight; fast click may fire twice | MEDIUM | After clicking action button, immediately wait for state change (loading spinner or disabled class) to confirm action started. Avoid clicking again until state settles. Use `disabled` attribute check: `await expect(button).toBeDisabled()`. |
| **Edge Creation (DAG Canvas)** | DAGCanvas | Drag handle → handle to create edge is timing-sensitive; may fail if drag timing is off | MEDIUM | Use explicit waits around drag operations. After drag completes, check for edge in DOM: `await expect(page.locator('[data-testid="edge-{edgeId}"]')).toBeVisible()`. Consider using keyboard shortcuts for edge creation (if available) as more reliable. |
| **React Key Instability** | Message lists, Artifact lists, Stage lists | Lists re-key if items re-render; old test selectors may break | MEDIUM | Always use data-testid with unique IDs (stageId, messageId, etc.), not index. Avoid nth-child selectors. Use stable identifiers from backend (id fields). |
| **Theme/Dark Mode Timing** | SettingsPage (theme switch) | Theme toggle may re-render entire app; CSS custom properties update async | LOW | After toggling theme, wait for color change on known element or CSS class update. Use explicit timeout (~500ms) to allow re-render. Check for 'dark' class on html/body element. |
| **Network Latency Variation** | All API-driven pages | Test environment network may vary; API responses take 50-500ms | MEDIUM | Always use explicit timeouts on API-dependent waits (e.g., `{ timeout: 10000 }` for slow CI). Avoid hardcoded `waitForTimeout(100)` in favor of polling. Mock slow API responses in tests if testing timeout behavior. |
| **Keyboard Focus & Tab Order** | Form inputs, Navigation | Tab focus may be complex; unclear which element receives focus after action | LOW | Don't rely on focus for assertions unless specifically testing accessibility. Use data-testid to target elements explicitly. If testing keyboard nav, manually verify tab order is correct. |
| **Hover States (Tooltips, Dropdowns)** | Tooltips, Hover-to-reveal buttons | Hover-triggered UI may not appear on headless / mobile; not reliable | LOW | Avoid hover-based interactions. Use click or keyboard shortcuts instead. If testing tooltip, click element or use keyboard (e.g., focus) to trigger. |

---

### 5. TEST DATA / SETUP

**API Base URL:** `http://localhost:3100` (configurable via `API_URL` env var in tests)

**Setup Approach:** Tests use **direct API calls** to seed data before UI tests. This is the most reliable approach for this architecture:

1. **Create Workflow Definition (for builder, run, and list tests):**
   ```javascript
   const { data } = await api('POST', '/api/workflow-definitions', {
     name: `Test Workflow ${Date.now()}`,
     sessionMode: 'single',
     description: 'Test description',
     variables: [{ name: 'input', type: 'string', required: true }],
   });
   const defId = data.id;
   ```

2. **Create Stage(s):**
   ```javascript
   await api('POST', `/api/workflow-definitions/${defId}/stages`, {
     name: 'Test Stage',
     order: 0,
     prompts: [{ label: 'Prompt 1', text: 'Say hello' }],
   });
   ```

3. **Create Workflow Run:**
   ```javascript
   const { data: run } = await api('POST', '/api/workflow-runs', {
     workflowDefinitionId: defId,
     variables: { input: 'test' },
   });
   const runId = run.id;
   ```

4. **Start Run:**
   ```javascript
   await api('POST', `/api/workflow-runs/${runId}/start`);
   ```

5. **Wait for Run Completion (blocking):**
   ```javascript
   // Existing helper in browser-ui-e2e.spec.ts
   const status = await waitForRunComplete(runId, 90000);
   // Returns 'completed' or 'failed'
   ```

6. **Create Chat:**
   ```javascript
   const { data } = await api('POST', '/api/chats', {
     name: `Test Chat ${Date.now()}`,
     model: 'claude-sonnet-4',
   });
   const chatId = data.id;
   ```

7. **Create Automation:**
   ```javascript
   const { data } = await api('POST', '/api/automations', {
     name: `Test Automation ${Date.now()}`,
     triggerType: 'manual',
     workflowIds: [defId],
     inputMode: 'single',
   });
   const automationId = data.id;
   ```

8. **Create Project:**
   ```javascript
   const { data } = await api('POST', '/api/projects', {
     name: `Test Project ${Date.now()}`,
     sessionMode: 'single',
   });
   const projectId = data.id;
   ```

9. **Link Codebase to Project:**
   ```javascript
   await api('POST', `/api/projects/${projectId}/codebases`, {
     url: 'https://github.com/example/repo.git',
     branch: 'main',
     alias: 'test-repo',
     codebaseType: 'git-remote',
   });
   ```

10. **Create Template (for template tests) — likely pre-exist, query list:**
    ```javascript
    const { data: templates } = await api('GET', '/api/templates');
    ```

**Cleanup (test.afterAll or afterEach):**
```javascript
await api('DELETE', `/api/workflow-definitions/${defId}`);
await api('DELETE', `/api/chats/${chatId}`);
await api('DELETE', `/api/automations/${automationId}`);
await api('DELETE', `/api/projects/${projectId}`);
```

**Route Mocking Strategy (for non-deterministic AI runs):**
Instead of calling live AI APIs, mock responses:
```javascript
// Mock a workflow run's streaming responses
await page.route('/api/sessions/*/chat', async (route) => {
  await route.abort(); // Or return fixture data
});
```

Or intercept and slow down responses to test timeout behavior:
```javascript
await page.route('/api/workflow-runs/*', async (route) => {
  await new Promise(r => setTimeout(r, 5000)); // Delay 5s
  await route.continue();
});
```

---

### 6. PRIORITIZED GAP LIST

#### **HIGH PRIORITY (Blocks major feature coverage)**

1. **Workflow Builder: Stage Creation & Canvas Interaction**
   - [HI-001] Create new stage on empty canvas (Add Stage button → prompt for name) 
   - [HI-002] Add multiple stages sequentially; verify all appear on canvas
   - [HI-003] Drag stage node to reposition; verify layout persists on save
   - [HI-004] Create edge (drag handle → handle); verify edge type dropdown
   - [HI-005] Change edge type (on_success → on_failure, etc.); verify color/label change
   - [HI-006] Delete edge (select edge + Delete key); verify edge removed
   - [HI-007] Delete stage (select stage + Delete key); verify cascading edge cleanup
   - [HI-008] Duplicate stage; verify copy has unique ID but same config
   - [HI-009] Undo (Ctrl+Z) after stage delete; verify stage restored
   - [HI-010] Redo (Ctrl+Shift+Z) after undo; verify stage deleted again
   - [HI-011] Auto-layout button; verify stages arrange in LR flow
   - [HI-012] Zoom/pan canvas; verify fitView works after add stage

2. **Workflow Builder: Stage Properties & Execution Config**
   - [HI-013] Open stage properties panel; verify tabs (Properties/Execution)
   - [HI-014] Edit stage name in properties; save; verify persists on reload
   - [HI-015] Set session mode (single/per-stage/auto); save; verify in definition
   - [HI-016] Add variable to workflow; fill in name/type/default; save; verify in definition
   - [HI-017] Edit prompt (inline): add label, text; save; verify
   - [HI-018] Add second prompt to same stage; save; verify both render in messages after run
   - [HI-019] Set run condition to on_success; set follow-up stage; verify second stage only runs if first succeeds (in actual run)
   - [HI-020] Set run condition to expression; enter `stages.first.status === "completed"`; verify stage evaluates condition
   - [HI-021] Set timeout to 300s; verify in definition and enforced in run (timeout behavior test)
   - [HI-022] Enable retry policy; set maxRetries=2; save; verify in run after failure
   - [HI-023] Add result validation rule (regex match); save; verify rule enforced in run
   - [HI-024] Add stage hook (pre_run type); save; verify hook executes before stage runs (test dependent on hook support)
   - [HI-025] Model override dropdown; select non-default model; save; verify in definition

3. **Workflow Run Page: Streaming & Messages**
   - [HI-026] Start run with prompt → watch streaming message blocks arrive live
   - [HI-027] Verify thinking block renders with Brain icon, expandable
   - [HI-028] Verify text block renders with markdown, blinking cursor during stream
   - [HI-029] Verify tool_call block shows name, args (collapsible), result
   - [HI-030] Verify system/debug block grouped and rendered correctly
   - [HI-031] Stage status transitions in DAG: pending → running → completed (verify color changes)
   - [HI-032] Progress bar updates for multi-step stage; verify step counter (step c/t)
   - [HI-033] Per-stage message block visible on right panel; expandable/collapsible
   - [HI-034] Usage stats appear after completion: model, tokens in/out, duration
   - [HI-035] Parallel stages: two stages run simultaneously; timeline shows overlap
   - [HI-036] Message history persists after page refresh
   - [HI-037] Click timeline event → selects corresponding stage
   - [HI-038] Auto-scroll to latest message during streaming

4. **Workflow Run Page: Lifecycle Controls**
   - [HI-039] Click Start button (created run); run transitions to starting → running
   - [HI-040] Click Pause button (running run); run transitions to paused
   - [HI-041] Click Resume button (paused run); run resumes
   - [HI-042] Click Cancel button (running run); confirm dialog → run transitions to cancelling → cancelled
   - [HI-043] Click Retry button (failed run); run re-executes
   - [HI-044] Per-stage Pause button (in DAG node, if available); pause single stage
   - [HI-045] Per-stage Resume button; resume single stage
   - [HI-046] Per-stage Retry button (failed stage); re-run stage
   - [HI-047] Per-stage Cancel button; cancel single stage

5. **Chat Page: Streaming & Input**
   - [HI-048] Send message in chat → streaming starts, message appears optimistically
   - [HI-049] Watch streaming message blocks render live
   - [HI-050] Verify blinking cursor during text stream
   - [HI-051] Stop button appears and works during streaming
   - [HI-052] Message appears in history after stream completes
   - [HI-053] Multi-message conversation: send message 1 → complete → send message 2 → complete
   - [HI-054] Change model selector mid-conversation; next message uses new model
   - [HI-055] Attach file → file appears in preview → send message → file included
   - [HI-056] Page refresh → message history persists, chat reconnects SSE

6. **Automations: Create & Trigger**
   - [HI-057] Create automation (manual trigger, single input mode); minimal config
   - [HI-058] Create automation (schedule trigger, cron `0 9 * * *`)
   - [HI-059] Create automation (loop mode); loop variable, loop items; verify runs once per item
   - [HI-060] Create automation (batch mode, CSV); batch data, column mapping; verify runs once per row
   - [HI-061] Create automation (script data source); script command, test button; verify runs once per output item
   - [HI-062] Trigger automation now; verify run starts
   - [HI-063] Enable/disable automation toggle; verify state persists
   - [HI-064] Delete automation; confirm dialog; verify deleted from list

7. **Projects: Codebases & Artifacts**
   - [HI-065] Create project; save; navigate to detail
   - [HI-066] Add codebase (git-remote URL); status: cloning → ready
   - [HI-067] Fetch codebase (refresh); verify updated
   - [HI-068] Delete codebase; confirm; verify removed
   - [HI-069] Codebase clone error; view error logs in modal
   - [HI-070] Upload artifact (skill folder with SKILL.md); verify listed
   - [HI-071] Upload artifact (prompt file); verify listed
   - [HI-072] Upload artifact (agent file); verify listed
   - [HI-073] Preview artifact; show content in modal
   - [HI-074] Edit artifact; modify, save; verify updated
   - [HI-075] Delete artifact; confirm; verify removed

8. **HITL (Human-in-the-Loop) Approval**
   - [HI-076] Set permission mode to 'plan'; trigger run
   - [HI-077] Stage transitions to awaiting_input; approval UI appears
   - [HI-078] Approve interrupt → stage resumes
   - [HI-079] Reject interrupt → stage fails with rejection reason
   - [HI-080] Mode change (plan → auto-approve); pending queue clears (or approval UI dismisses)

---

#### **MEDIUM PRIORITY (Enhances coverage, not blocking)**

1. **Workflow Builder: Advanced Config**
   - [M-001] Workflow hooks: Add on_run_start hook; save; verify in definition
   - [M-002] Workflow variables: Add choice variable; verify dropdown in VariableInputModal
   - [M-003] Tags/metadata: Add tags; filter workflows by tag; verify search
   - [M-004] Project/codebase linking in workflow: Select project; verify codebases show in run
   - [M-005] Import workflow from JSON file; verify loads in builder

2. **Workflow Run Page: Advanced**
   - [M-006] Multi-prompt stage: Run with stage containing 2+ prompts; verify all prompts appear in messages
   - [M-007] Conditional edge: Two-branch DAG (success → path A, failure → path B); run with success → verify path A executes, path B skipped
   - [M-008] Conditional edge: Run with failure → verify path B executes, path A skipped
   - [M-009] Context filter: Set context from predecessors to summary-only vs. full; verify in run messages
   - [M-010] Template stage: Use template in stage; verify pre-filled prompts/config
   - [M-011] Validation rule failure: Stage with regex validation that fails; verify error shown, stage fails
   - [M-012] Validation rule success: Stage with validation that passes; verify stage completes normally
   - [M-013] Retry after failure: Stage fails, user clicks Retry; stage re-executes
   - [M-014] Parallel execution: DAG with multiple independent stages; all start together; verify overlapping in timeline
   - [M-015] File artifacts: Run produces files; verify in Artifacts tab

3. **Chat: Advanced**
   - [M-016] Chat model change; verify next message uses new model (via API or output)
   - [M-017] Chat with codebase: Attach files from linked codebase; verify context in AI response (if possible without mocking)
   - [M-018] Archive chat; verify moves to archived filter
   - [M-019] Delete chat; confirm; verify removed from list
   - [M-020] Chat with large token count; verify usage stats accurate

4. **Automations: Advanced**
   - [M-021] Loop automation: Run with 3 items; verify 3 parallel runs start
   - [M-022] Batch automation (CSV): Parse CSV with 5 rows; verify 5 runs
   - [M-023] Script data source: Execute script returning JSON array; verify parsed and runs created
   - [M-024] Max concurrency limit: Set to 2; batch with 5 items; verify only 2 run concurrently
   - [M-025] On error behavior: Loop with one failing item; continue mode → rest run; stop mode → all stop

5. **Projects: Advanced**
   - [M-026] Project settings: Edit default model, session mode, retention; save; verify persists
   - [M-027] Worktree retention: Set to manual; verify retention behavior (likely test-dependent)
   - [M-028] MCP server in project: Add MCP server; verify listed and available in workflows

6. **Templates**
   - [M-029] Browse templates; search by name; verify filtered
   - [M-030] Use template; create workflow from template; verify pre-populated with template config
   - [M-031] Template with variables: Use template; VariableInputModal shows template variables

7. **Settings**
   - [M-032] Theme switch (light/dark/system); verify UI theme changes
   - [M-033] Provider switch (Copilot → Anthropic); verify models list updates
   - [M-034] Health check: Verify API connectivity indicator

8. **Error & Edge Cases**
   - [M-035] Delete workflow with running runs; verify error or cleanup behavior
   - [M-036] Browser back/forward during streaming; verify graceful state recovery
   - [M-037] Network interruption during stream; verify reconnect logic
   - [M-038] Very large workflow DAG (20+ stages); verify UI performance, no lag
   - [M-039] Very large message history (100+ messages); verify scroll performance
   - [M-040] Rapid button clicks (double-click on Start); verify idempotency, no duplicate runs

---

#### **LOW PRIORITY (Nice-to-have, test framework improvement)**

1. **Accessibility**
   - [L-001] Tab navigation through form fields; verify order correct
   - [L-002] ARIA labels present on all interactive elements; screen reader test (if relevant)
   - [L-003] Focus visible on keyboard navigation

2. **Performance / Load Testing**
   - [L-004] Load workflow list with 100+ workflows; verify search/filter responsive
   - [L-005] Load chat history with 200+ messages; verify scroll smooth
   - [L-006] Long-running workflow (30+ min); verify UI stays responsive

3. **Reporting & Observability**
   - [L-007] Test report generation; verify HTML report readable
   - [L-008] Screenshot on failure; verify image captured
   - [L-009] Video recording (if Playwright config includes); verify video playable

4. **Cross-Browser**
   - [L-010] Run E2E tests on Chrome, Firefox, Safari (if feasible in CI)

---

### 7. IMPLEMENTATION RECOMMENDATIONS

**Phase 1 (Immediate):**
1. Add `data-testid` attributes to all HIGH priority components (see selector audit table).
2. Create 12-15 HIGH priority test cases covering workflow builder, run page, chat, automations.
3. Establish determinism patterns: mock AI responses, use API-based setup, assert on structure not content.

**Phase 2 (Weeks 2-3):**
4. Add remaining selector audit data-testid attributes (MEDIUM/LOW priority).
5. Implement 15-20 MEDIUM priority test cases.
6. Create test fixtures / API helper library for common setup flows.

**Phase 3 (Weeks 4+):**
7. Implement LOW priority tests, accessibility checks, performance tests.
8. Expand coverage for edge cases and error scenarios.
9. Integrate with CI/CD pipeline; enable parallel test execution.

**Test File Organization:**
```
agent-tests/
├── browser-ui-e2e.spec.ts (existing — refactor & extend)
├── workflow-builder.spec.ts (NEW — stages, edges, properties, execution)
├── workflow-run.spec.ts (NEW — streaming, controls, lifecycle)
├── chat.spec.ts (NEW — input, streaming, history)
├── automations.spec.ts (NEW — create, trigger, input modes)
├── projects.spec.ts (NEW — codebase, artifacts)
├── hitl.spec.ts (NEW — approval workflow)
├── settings.spec.ts (NEW — theme, provider)
├── error-cases.spec.ts (NEW — validation, errors, edge cases)
├── helpers/
│   ├── api.ts (API calls, setup/cleanup)
│   ├── selectors.ts (data-testid constants)
│   ├── fixtures.ts (test data)
│   └── assertions.ts (custom assertions)
└── playwright.config.ts (NEW — baseURL, workers, timeouts, reporters)
```

---

## SUMMARY

This comprehensive test-planning inventory provides:

1. **Exact coverage map** of existing tests vs. gaps (6 covered scenarios, 50+ gaps)
2. **Detailed selector audit** identifying zero data-testid attributes and recommending 100+ additions (CRITICAL for determinism)
3. **Determinism strategies** for 13 hazards (streaming, AI non-determinism, async layout, toasts, modals, validation, file upload, search debounce, selects, pagination, session sync, animations, button states)
4. **API-driven test setup** with examples (create workflows, stages, runs, chats, projects, automations; cleanup)
5. **80+ prioritized gap scenarios** (24 HIGH, 45 MEDIUM, 11 LOW) broken down by page/feature
6. **Implementation roadmap** (3 phases) with test file structure and phasing

**Next Step:** Begin Phase 1 by adding data-testid attributes to HIGH priority components and implementing the 12-15 HIGH priority test scenarios. Use the API-based setup and determinism strategies outlined above to ensure test reliability.

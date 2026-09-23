# GeneratorAI desktop audit and fixes

Audit: 19–20 September 2026. Baseline: `db714ce`. Changes are uncommitted and unstaged.

The evidence set contains **192 screenshots** (183 in the curated gallery). The running macOS Electron application was exercised with an isolated profile, database, and workspaces. Every top-level module and all 15 settings pages were visited. Complex greenfield and brownfield chats, a three-stage workflow, uploaded and built-in skills, a background worker, an interactive widget, manual automation, and a script workflow were exercised through the desktop interface. This is a substantial functional and visual audit, **not a claim that every integration or configuration combination has passed**. The coverage matrix and remaining gaps below define the actual scope.

The most consequential fixes restore reliable file/skill delivery, prevent premature stream termination during quiet tools, restore widgets after relaunch, and make the right pane and designer usable at constrained widths. The existing visual language is retained with more consistent spacing, accessible controls, and fewer competing scroll areas.

- [Remaining-gaps follow-up and new fixes](GAPS-FOLLOWUP.md)
- [Architecture and feature inventory](INVENTORY.md)
- [Screenshot gallery](gallery.html), including before/failure states and final retests
- [Capture methodology and exceptions](evidence/README.md)
- [Navigation measurements](performance.json)
- [Validation record](VALIDATION.md)

## Environment and method

The desktop ran its built React renderer and authenticated local Node server, native browser surface, and terminal. UI automation used Playwright's Electron connection, actual clicks, typing, file selection, and native window resizing. Later evidence uses Electron `capturePage` at native DPR 2, including native browser content. Source inspection, component/service tests, and independent tests of generated projects supplemented these journeys; they are identified separately.

The primary window sizes were 1280 × 800 and 860 × 600. Light and dark appearances, overflow, long titles, nested scrolling, splitter keyboard controls, form labels, loading/empty/error states, and tab overflow were reviewed. Screenshot sidecars record route, viewport, document overflow, and scroll owners where available. No document-level horizontal or vertical overflow was measured in these captures; that does not imply every embedded code block or generated document has zero internal overflow.

The user's existing desktop instance was left intact. Audit fixtures live under `/tmp/gai-desktop-audit`; this directory contains local credentials and is deliberately excluded from the report. No GeneratorAI repository commits, staging, pushes, or PRs were made. The application creates private checkpoints in isolated test workspaces during normal execution.

## Coverage by module

“Live” means the specified interaction was performed in the running desktop. “Configuration” means the screen and controls were inspected, without claiming the external integration executed successfully.

| Module / page | Live coverage and result | Limits / evidence |
|---|---|---|
| Shell and dashboard | Sidebar routes, dashboard, native window resizing, command palette/search, New Chat shortcut, breadcrumbs, light/dark appearance | Native menu entry exercised. Installer, updater, pairing and remote mode not tested. Screens 01, 63, 78–83, 99, 112 |
| Chats list | Create, search, archived filter, select row, navigate, archive confirmation | Bulk delete not executed; no Restore action found. 04, 118–120 |
| Chat creation | Codex, GPT-5.6 Sol, high reasoning; managed workspace; orchestration; attachments; source-control options | Provider alternatives inspected, not all authenticated. Auto-commit/push disabled. 02, 100–101 |
| Chat conversation | Multi-turn greenfield/brownfield work; streamed text, code and tool groups; plans, completion, follow-up, attachment consumption; copy transcript and fork | Voice, every slash command, all permission/retry paths and model switches during a live turn not exhaustively exercised. 33, 49, 85, 106, 118, 125 |
| Changes | File expansion, unified/split diff, settings, Keep and Unkeep, checkpoint list and Compare, line-anchored review comment and send-to-chat | File Undo/checkpoint Rewind and keyboard review/deletion subsequently passed. 34–35, 86–87, 129–138, 150–153, 166–167 |
| Files | Tree navigation, README/code preview, file tab, editor-launch control inspected | External editor integration not launched. 36, 85, 88 |
| Terminal | Actual command execution, generated server launch, output, find marker, resize and file attachment interaction | Shell matrix and long-session stress not tested. Correct native-scale evidence: 89–90 |
| Browser | Native embedded local application, navigation, charts, filtering/reset, complex form validation/create, brownfield UI and invalid CSV preview | Agent browser-bridge attachment timed out; manual native browser worked. Valid CSV export/import and two-editor conflict recovery subsequently passed. 46–47, 114–116, 141–143 |
| Plan | Open, edit and save a plan revision | 48 |
| Background tasks | One real adversarial-review worker, live status, completion, Open Worker Chat | Worker API exposes no reasoning-effort parameter; requested Sol and rigorous analysis, without claiming a high-effort setting was enforced. 103, 111 |
| Widget | Actual designer rendered; checklist interaction/reset, Code/Preview, relaunch recovery; compact Design/Versions/Activity and wide layout | Keyboard version restore additionally tested in browser regression. Generated inner HTML still has minimum-width behavior at a 301 px preview. 104–110, 117, 121–124 |
| Computer pane | Configuration and consent surface inspected | Native automation permissions unavailable; no computer-control execution claimed |
| Projects | Create, save settings, add local codebase, details, customization, file tree/preview, worktrees and PR empty states | No remote Git authentication, branch checkout, PR creation/review/merge or push. 05, 11–17 |
| Agents | Create/edit instructions, tags, skills, runtime provider/model/reasoning, save and effective preview; provider/model round trip | Export subsequently verified; team composition and all tool-policy combinations remain untested. 06, 18–19, 64, 126–127, 159 |
| Workflow list/definition | List, open definition, read-only canvas, completed run navigation | 07, 50, 65, 128 |
| Workflow builder | Three-stage DAG, dependencies, stage configuration, variables, approval, project context, hooks form, duplicate/select/undo | Every graph operation, hook implementation and source-context combination not executed. 23–31, 54, 91 |
| Workflow execution | Three stages completed; approval feedback, graph/timeline and Inspector Files/Output/Hooks/Tools; completed answer replay | Retry/failure policy permutations not exhaustive. 51–54, 128 |
| Workflow skills/uploads | Uploaded unique skill consumed by agent; explicit built-in documentation/test skills materialized and read; stage override and dependent skip | Plain prompt uploads subsequently fixed and verified through a file-only marker; plain skill/agent combinations still need coverage. 94, 97–98, 107–108, 113, 158, 165 |
| Scripts | Discovery, detail, profiles, variables and run; stage completion, pause/resume/cancel and skipped stage | Isolated `GENERATORAI_ALLOW_WORKFLOW_SCRIPTS=true`; production default unchanged. Script defaults used Claude Sonnet 5. Upload/edit not separately tested. 71–75 |
| Automations | Create, schema and dataset validation, preview, enable/disable, manual execution/history, row expansion, cancel; deletion confirmation cancelled | Loop and mapped scheduled batch subsequently passed. Webhook, script dataset and retry-exhaustion campaigns remain. 55–70, 145–146, 168–170 |

### Settings coverage

Each linked page was opened and visually inspected. Saving every field or performing the external action is not implied.

| Settings page | Verified / limitation |
|---|---|
| [General](evidence/10-settings-general.png) | Settings layout and controls |
| [Appearance](evidence/79-appearance-light.png) | Theme changes, narrow window and light appearance; dark appearance also visited |
| [Model Providers](evidence/10-settings-providers.png) | Provider configuration/status; Codex and Claude used in live runs; Copilot not connected, OpenCode/ACP unavailable |
| [Agents](evidence/10-settings-agents.png) | Defaults/configuration; saved custom agent tested separately |
| [Skills](evidence/76-skill-detail.png) | Catalog, detail and preview; selected skills consumed by actual workflow agent |
| [MCP Servers](evidence/10-settings-mcp.png) | Configuration surface; no third-party MCP authentication/tool execution |
| [Templates](evidence/10-settings-templates.png) | Catalog/configuration; full template matrix not run |
| [Source Control](evidence/10-settings-source-control.png) | Configuration; no external credentials/push/PR mutation |
| [Browser & Terminal](evidence/10-settings-browser-terminal.png) | Configuration plus actual integrated browser and terminal journeys |
| [Computer Use](evidence/10-settings-computer-use.png) | Configuration; native permission-dependent execution unavailable |
| [Audio](evidence/10-settings-audio.png) | Configuration; microphone, recognition and synthesis not exercised |
| [Extensions](evidence/10-settings-extensions.png) | Catalog/configuration; built-in web designer used live |
| [Security & Devices](evidence/80-security-minimum-light.png) | Connection/status layout at minimum size; no pairing/revocation action |
| [Storage](evidence/10-settings-storage.png) | Configuration; destructive cleanup not executed |
| [Diagnostics](evidence/10-settings-diagnostics.png) | Diagnostic surface; no fault-injection or export campaign |

## Complex scenarios and observed outcomes

### Greenfield and brownfield Atlas Release Console

Chat `466b7da8-9a33-412d-a3e7-ca746a2143af` used Codex GPT-5.6 Sol with high reasoning. The application agent generated a dependency-free Node ESM project: release records, dependency DAG validation, state transitions, REST API, atomic JSON persistence, accessible SVG charts, filtering, forms, activity history and CSV handling.

The actual desktop terminal launched the generated server. In the native Browser pane, charts rendered, filters produced an empty result and reset correctly, an invalid form was rejected, and record `AUDIT-9001` was created and found. A brownfield turn then added record versions, optimistic conflicts, bounded idempotency keys, CSV dry-run row diagnostics, transactional import failure handling and accessible draft-preserving forms. Existing audit data survived. Independent `node:test` execution passed **19 tests** after the brownfield update.

The agent's own browser bridge failed to attach to the scoped tab; this is recorded rather than treating its static checks as browser success. The audit separately used the actual native browser to verify the updated dashboard and rejected CSV row. The first valid CSV attempt was interrupted by a native-dialog driver failure. The gap follow-up subsequently completed CSV export/import with seven verified records and the two-editor draft-preserving conflict/recovery journey in actual native Browser tabs ([141–143](GAPS-FOLLOWUP.md)).

### Three-stage risk workflow

Definition `4969ab11-7d70-494e-be42-ee62ea1cc44d`, run `c89fedba-22f6-47fa-ab65-10c3a17be10a`: design a backwards-compatible risk policy, implement validation/risk bands/dependency DAG behavior, then independently review and test adversarial cases. All three stages completed after human approval. The resulting local brownfield project passed **21 tests** independently. [Completed run](evidence/128-completed-three-stage-workflow.png).

Two focused live reruns verified fixes that a visual inspection could miss:

- Uploaded skill run `d72794be-4f08-4bd2-9f71-cb7a4d7b7c79`: The agent read the uploaded `risk-review/SKILL.md` and returned its file-only marker `ATLAS_UPLOAD_4729`. Stage overrides and dependent skipping were exercised.
- Built-in skill run `fb5c27ba-935e-4754-be5f-4705232fe500`: documentation and test-generation were explicitly selected, staged as valid skill documents, read by the agent, and confirmed before approval/completion.

### Attachments, orchestration, worker and widget

Chat `19498ef3-f0be-4a6f-b68c-ff126de78c8f` exercised orchestration with an attached acceptance checklist. After the provider fix, Codex read the uploaded file and returned `ATLAS_ATTACHMENT_8314`, a marker never included in the request text. A background worker completed three adversarial DAG cases and its conversation opened from the task panel.

An interactive release-review widget was created through the extension's documented action, used for checklist progress/reset, and reopened successfully after the desktop selected a new widget-server port. Narrow and wide layouts were tested in the actual app. A 70-second silent tool completed and returned `QUIET_TOOL_7031`; the entire quiet interval was not continuously observed because navigation occurred during the run. Fake-clock regression tests separately verify that silence and unreachable health checks do not falsely terminate active chat streams.

A line-anchored review comment was also sent to the Atlas agent, which updated conflict handling and passed 19 tests again. This exposed a stale “awaiting agent” state for aliased repositories. After fixing checkpoint selection and reconciliation, a second README-only review completed and changed to **Addressed** automatically in the live UI ([135](evidence/135-review-addressed-automatically.png)). The earlier submitted comment retains its old missing baseline; no retroactive state migration is claimed.

Manual automation and the bundled script workflow were separately started through the UI. Automation cancellation appeared in history. The script progressed through stages and supported pause/resume/cancel. The gap follow-up subsequently completed a two-item loop and a two-row scheduled batch, inspecting each output. Webhook and other external triggers remain unverified.

## Implemented fixes and design rationale

| Finding | Change | Why this improves the experience / verification |
|---|---|---|
| Right pane squeezed the transcript when the sidebar consumed available width | Observe the content host; use a dismissible full-width pane below 760 px available space; reserve transcript width when docked | Decisions follow actual content space. Native narrow/wide retests, Escape and splitter tests. [95](evidence/95-narrow-pane-sheet-fixed.png), [96](evidence/96-narrow-transcript-fixed.png) |
| Splitter required a pointer and lacked a meaningful accessible value | Arrow/Home/End resizing, visible focus and min/max/current width semantics | Keyboard access follows the [WAI-ARIA window splitter pattern](https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/). Unit and live checks |
| Long chat titles and header actions crowded narrow content | Container-aware compact actions, truncating breadcrumb/title, stable icon button names and editor label | Preserves readable content and reachable controls. [112](evidence/112-narrow-header-fixed.png) |
| Short skills/MCP/capability lists created unnecessary nested scrolling | Short lists participate in the form's main scroll; long lists remain bounded | Reduces scroll competition without unbounded large catalogs. Native agent form measured one scroll owner. [127](evidence/127-agent-single-scroll-form.png) |
| Widget designer kept three fixed columns inside a small dock | Compact Design/Versions/Activity views, flexible preview height, wrapped controls, native version buttons, labels/focus/reduced-motion styles | Keeps every function reachable while giving the preview useful width. Native screenshots 121–124 and responsive keyboard browser test |
| Agent editor/config schemas disagreed about supported providers and reasoning | Shared provider/reasoning definitions across relevant schemas/core/provider/UI; model choices filtered by provider and incompatible selection cleared | Prevents plausible-looking invalid configurations. Provider-switch/save round trip and schema tests. [126](evidence/126-agent-provider-model-fixed.png) |
| File selection could disappear when the input was reset | Snapshot selected files before clearing input in chat and workflow forms | Preserves a user's attachment reliably. Picker regression and live marker probes |
| Orchestrated workflow started before uploaded capabilities were staged | Send config/files together; initialize validated canonical files before discovery/start; forward stage overrides | Removes the race instead of delaying the UI. Containment/symlink tests and actual uploaded-skill run |
| Skill switches implied selection without staging the selected skills | Explicit additive stage overrides; resolve overrides even without a bound agent; resolve project skill paths; wrap plain skill markdown with required metadata | Selection now matches agent input. Resolver/staging tests and actual built-in-skill run |
| Codex non-image attachments were stored but not delivered as readable file references | Deliver structured name/path text with a read instruction; retain image handling | File-only marker was returned by the actual agent; provider contract regression added |
| Widgets blocked by CSP or stale asset port after restart | Allow only configured isolated HTTP(S) widget origin/loopback aliases on its port; refresh current widget metadata after replay without blocking streams | Restores functionality while retaining script/frame protections. CSP/security tests and native relaunch check |
| Quiet tools could be marked interrupted after empty stream replays | Check authoritative chat liveness, keep unknown/unreachable states active, guard against a newer turn/event racing the health response | Silence is not completion. Active/unreachable/stopped regression tests and long-tool completion |
| Completed workflow output could be replaced by stale partial stream state | Prefer persisted terminal/approval answers; show streaming only for running stages; correct stage numbering | Replay accurately reflects completed work. Run-view regression and completed-run inspection |
| Duplicate workflow stage overlapped its source / read-only view exposed mutation actions | Offset by node width plus gap, select the duplicate, hide duplicate/delete in read-only mode | Predictable editing and truthful read-only affordances. Duplicate/Undo live test and store regression |
| Command-palette New Chat did not open creation | Route to the list with a consumed creation intent; add agent destinations | Shortcut completes its stated action. Native palette retest [99](evidence/99-palette-new-chat-fixed.png) |
| Several forms/controls lacked clear names or selection semantics | Label project/workflow/automation inputs, selection cards and modal headings; guard nested row actions | Supports keyboard/assistive use and reliable focus targeting; live form validation and component tests |
| Automation deletion had no reviewable confirmation/state handling | Application confirmation dialog, pending/error handling; preserve entity on Cancel | Reduces accidental deletion and communicates progress. Live Cancel test [67](evidence/67-automation-delete-confirmation.png) |
| Review feedback remained “awaiting agent” after the file changed | Select the submission checkpoint per repository alias; reconcile live workspace snapshots as well as checkpoint events; poll submitted feedback until reconciliation lands | Covers managed `main` and multi-repository batches. Three route regressions and a second real agent review passed. [135](evidence/135-review-addressed-automatically.png) |
| HTTP test requests occasionally reached another local application | Match Supertest request family to the fixture listener; explicitly bind native WebSocket/SSE fixtures to IPv4 loopback | An isolated 1,200-request probe reproduced a foreign response on a port simultaneously owned by an IPv4 editor process. The correction is test-only and preserves all security assertions. |
| Security connection badge wrapped at minimum width | Keep the badge label on one line without shrinking | Stable status hierarchy at narrow size. [80](evidence/80-security-minimum-light.png) |

These choices use the established components and semantic theme tokens. Contained two-dimensional scrolling remains appropriate for code/diffs and diagrams; page-level overflow and accidental nested form scrolling were the targets, consistent with [WCAG reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html). Labels, focus and keyboard behavior were reviewed using [WCAG 2.2](https://www.w3.org/TR/WCAG22/) principles; this was not a formal conformance or screen-reader certification. [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/) informed desktop hierarchy/window conventions. No mobile Liquid Glass redesign is claimed in this desktop pass.

## Performance and validation

Actual-window navigation, three rounds across seven routes, measured **51–123 ms** from link click to expected heading visible; median **66 ms**. No tasks over 50 ms or renderer errors were recorded during that short sample. This measures navigation responsiveness, not complete backend-data readiness, sustained frame rate, memory leakage, or startup on other machines. Electron process snapshots exclude backend/provider child processes. Measurement and targeted changes follow [Electron performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance).

The production bundle passed its budget: **305.7 KB gzip initial assets**, **225.7 KB largest lazy chunk**. Web, server (554 tests), desktop, shared and client-core suites passed; focused provider/core tests and the widget browser regression also passed. [Full validation details](VALIDATION.md).

The design-system gate now passes after the gap follow-up, without relaxing its baseline: raw buttons 42/44, raw inputs 40/40, ad hoc spinners 5/6, native confirms 0/0, and palette matches 299/314. This is budget compliance, not removal of all existing design debt. See the [follow-up](GAPS-FOLLOWUP.md) for the additional provider-failure, prompt-upload, final-answer and keyboard-review fixes and their live retests.

## Remaining gaps and review priorities

The [gap follow-up](GAPS-FOLLOWUP.md) records completed recovery, CSV/conflict, loop/scheduled-batch, agent-export, prompt-upload and keyboard-review journeys. The current priorities are:

1. External credentials and platform environments: remote Git/PR, third-party MCP/providers, voice/computer permissions, pairing/remote mode, installers/updaters, Windows/Linux.
2. Automation recovery: webhooks, script datasets, retry exhaustion/backoff and recovery after process loss.
3. Safe archive restoration across provider sessions, retained workspaces and expired storage.
4. The agent's scoped browser attachment timeout and the generated widget's inner responsive HTML.
5. Screen-reader, zoom/contrast, large-catalog and sustained performance checks; third-party diff-gutter accessible naming.
6. The remaining plain-upload skill/agent matrix, agent teams, scripts editing/upload UI, and every template/hook/command or permission branch.

Earlier failed audit records remain as evidence. The follow-up fixes do not rewrite historic run statuses or answers.

The screenshot set intentionally preserves earlier defects as well as successful retests. Use the report's linked final evidence when evaluating the changes; an early capture is not the current implementation.

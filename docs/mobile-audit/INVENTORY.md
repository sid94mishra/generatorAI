# Project and mobile inventory — 19 September 2026

Baseline static inventory, checked against the source tree; additions from this audit are described in AUDIT.md. Presence is not a claim of live verification. See AUDIT.md for the evidence matrix.

## Applications

| Application | Role |
|---|---|
| `agent-host` | Isolated agent provider processes |
| `browser-host` | Managed browser process host |
| `cli` | CLI and terminal UI; automation, device pairing and developer workflows |
| `cua-host` | Computer-use host and consent boundary |
| `desktop` | Electron shell; embeds server and web client; host integration |
| `mobile` | Expo SDK 57 / React Native 0.86; native iOS and Android, web preview |
| `pty-host` | Persistent shell process host |
| `relay` | Optional remote access transport |
| `server` | REST, SSE, multiplexed streams, browser/terminal/voice WebSockets; composition root |
| `web` | React SPA; full workflow/agent/project authoring and execution UI |

## Shared packages

| Package | Internal dependencies |
|---|---|
| `agent-harness-providers` | `core`, `shared` |
| `auth` | `secrets`, `shared` |
| `changes` | `shared`, `git` |
| `checkpoints` | `shared`, `git` |
| `cli-core` | `client-core`, `client-runtime`, `client-transport`, `secrets`, `shared` |
| `client-core` | `client-transport`, `shared` |
| `client-runtime` | `relay-protocol`, `shared` |
| `client-transport` | `relay-protocol` |
| `core` | `changes`, `checkpoints`, `git`, `review`, `secrets`, `shared`, `source-control` |
| `db` | `auth`, `core`, `checkpoints`, `review`, `shared` |
| `design-tokens` | None |
| `git` | `shared` |
| `mcp-server` | `core`, `sdk`, `shared` |
| `relay-protocol` | None |
| `review` | `shared` |
| `sdk` | `shared`, `core`, `db`, `agent-harness-providers` |
| `secrets` | `shared` |
| `shared` | None |
| `source-control` | `shared` |
| `tui-kit` | `cli-core`, `design-tokens`, `shared` |

## Mobile routes

Layouts and the root redirect are included so no route file is silently omitted.

- `(tabs)/_layout.tsx`
- `(tabs)/chats.tsx`
- `(tabs)/index.tsx`
- `(tabs)/projects.tsx`
- `(tabs)/runs.tsx`
- `_layout.tsx`
- `approvals.tsx`
- `automations/[id].tsx`
- `changes/[workspaceId]/file.tsx`
- `changes/[workspaceId]/index.tsx`
- `chats/[id]/gate/[interactionId].tsx`
- `chats/[id]/plan/[planId].tsx`
- `chats/[id].tsx`
- `index.tsx`
- `pair.tsx`
- `projects/[id]/codebases/[cid]/file.tsx`
- `projects/[id]/codebases/[cid]/files.tsx`
- `projects/[id]/codebases/[cid]/pull-requests/[number].tsx`
- `projects/[id]/codebases/[cid].tsx`
- `projects/[id]/pull-requests.tsx`
- `projects/[id].tsx`
- `revoked.tsx`
- `runs/[id]/stages/[stageRunId].tsx`
- `runs/[id].tsx`
- `scope-request.tsx`
- `scripts/[id].tsx`
- `search.tsx`
- `settings/about.tsx`
- `settings/accessibility.tsx`
- `settings/appearance.tsx`
- `settings/capabilities.tsx`
- `settings/diagnostics.tsx`
- `settings/extensions.tsx`
- `settings/index.tsx`
- `settings/notifications.tsx`
- `settings/providers.tsx`
- `settings/security.tsx`
- `settings/source-control.tsx`
- `settings/tools.tsx`
- `terminal/[workspaceId].tsx`
- `workflows/[id].tsx`

## Component families

### brand (1 components)

- `VendorIcons.tsx`
### changes (7 components)

- `ChangesList.tsx`
- `CommitBar.tsx`
- `DiffLine.tsx`
- `FileDiff.tsx`
- `FileDiffPane.tsx`
- `HunkHeader.tsx`
- `Toolbar.tsx`
### chat (37 components)

- `ChatHeader.tsx`
- `ChatMenuSheet.tsx`
- `Composer.tsx`
- `GateScroll.tsx`
- `ModelSheet.tsx`
- `NewChatSheet.tsx`
- `PermissionCard.tsx`
- `PlanCard.tsx`
- `QuestionCard.tsx`
- `RenameSheet.tsx`
- `RewindSheet.tsx`
- `TurnOptionsSheet.tsx`
- `UsageFooter.tsx`
- `composer/AttachmentChips.tsx`
- `composer/ComposerBanners.tsx`
- `composer/GaugeSheet.tsx`
- `composer/HistorySheet.tsx`
- `composer/SuggestionStrip.tsx`
- `composer/VoicePill.tsx`
- `panes/ChangesTray.tsx`
- `panes/ComputerPane.tsx`
- `panes/InspectorSection.tsx`
- `panes/LockedPane.tsx`
- `panes/MoreSheet.tsx`
- `panes/SessionPanes.tsx`
- `timeline/InlineDiff.tsx`
- `timeline/RowFrame.tsx`
- `timeline/ScmResultRow.tsx`
- `timeline/TimelineActions.tsx`
- `timeline/TimelineRow.tsx`
- `timeline/UserMessageRow.tsx`
- `workbench/BrowserSection.tsx`
- `workbench/ChangesSection.tsx`
- `workbench/FilesSection.tsx`
- `workbench/PlanSection.tsx`
- `workbench/TasksSection.tsx`
- `workbench/TerminalSection.tsx`
### common (3 components)

- `ConnectionStrip.tsx`
- `FeatureLocked.tsx`
- `States.tsx`
### devices (3 components)

- `EditScopesSheet.tsx`
- `PairDeviceSheet.tsx`
- `QrCode.tsx`
### diff (1 components)

- `DiffRowView.tsx`
### home (4 components)

- `ApprovalsQueue.tsx`
- `DecisionCard.tsx`
- `HealthCard.tsx`
- `OperationCard.tsx`
### markdown (3 components)

- `CodeBlock.tsx`
- `Markdown.tsx`
- `MarkdownImage.tsx`
### projects (6 components)

- `AddCodebaseSheet.tsx`
- `CodebaseWorktrees.tsx`
- `CreateProjectSheet.tsx`
- `ProjectActions.tsx`
- `ProjectArtifacts.tsx`
- `ProjectSettingsForm.tsx`
### review (3 components)

- `CheckpointsSheet.tsx`
- `PlanSheet.tsx`
- `ReviewCommentsSheet.tsx`
### runs (6 components)

- `ApprovalCard.tsx`
- `FeedbackSheet.tsx`
- `PermissionModeSheet.tsx`
- `RunRow.tsx`
- `StageTimeline.tsx`
- `StatusGlyph.tsx`
### scm (3 components)

- `ConflictSheet.tsx`
- `ConnectGitHubSheet.tsx`
- `ScmFlowSheet.tsx`
### search (1 components)

- `SearchResultRow.tsx`
### ui (24 components)

- `ActionSheet.tsx`
- `Button.tsx`
- `Chip.tsx`
- `ContextMenu.tsx`
- `Form.tsx`
- `GlassSurface.ios.tsx`
- `GlassSurface.tsx`
- `KeyboardSticky.tsx`
- `ListItem.tsx`
- `ListRow.tsx`
- `Pager.tsx`
- `ProgressRing.tsx`
- `Screen.tsx`
- `SegmentedControl.tsx`
- `SettingsButton.tsx`
- `Sheet.tsx`
- `Skeleton.tsx`
- `States.tsx`
- `SwipeableRow.tsx`
- `Toast.tsx`
- `Touchable.tsx`
- `gallery.tsx`
- `primitives.tsx`
- `windowInsets.tsx`
### work (8 components)

- `AgentDetailSheet.tsx`
- `ExecutionSheet.tsx`
- `ScriptRow.tsx`
- `StartRunSheet.tsx`
- `StickyActionBar.tsx`
- `TemplatePickerSheet.tsx`
- `TriggerInputSheet.tsx`
- `cards.tsx`

## API modules

- `agents`
- `auth`
- `automations`
- `browser`
- `chats`
- `computer`
- `copilot`
- `editor`
- `extensions`
- `fs`
- `harness`
- `health`
- `hooks`
- `index`
- `internal-browser`
- `internal-computer`
- `internal-desktop`
- `openapi`
- `orchestrator`
- `projects`
- `review`
- `scopeRequests`
- `security`
- `sessions`
- `sourceControl`
- `stream`
- `system`
- `templates`
- `terminals`
- `webhooks`
- `widgets`
- `workflowDefinitions`
- `workflowRuns`
- `workflowScripts`
- `workspaces`

## Core services

- `AdmissionController`
- `AgentHostClient`
- `AgentInteractionService`
- `AgentResolver`
- `AgentService`
- `AgentStagingService`
- `ArtifactCatalog`
- `ArtifactService`
- `AutomationRecoveryService`
- `AutomationService`
- `BrowserService`
- `ChatManagementService`
- `CodebaseService`
- `ComputerService`
- `ConfigResolver`
- `DAGScheduler`
- `DataSourceResolver`
- `DeltaLog`
- `DurableExecutionEngine`
- `DurableSleepService`
- `ErrorHandler`
- `ExtensionApi`
- `ExtensionManager`
- `HitlService`
- `HookExecutor`
- `HookInterceptor`
- `InterruptedTurnRecoveryService`
- `IterationPlanner`
- `MountService`
- `OrphanProcessReaper`
- `PathResolver`
- `PlanService`
- `ProjectConfigService`
- `ProjectService`
- `PtyHostAdapter`
- `PtyHostClient`
- `ResultValidator`
- `SandboxLifecycleManager`
- `SessionAllocator`
- `SessionService`
- `SourceControlService`
- `StageExecutionService`
- `StartupRecoveryService`
- `StreamBroker`
- `StreamWriteBatcher`
- `SystemArtifactService`
- `TemplateRegistry`
- `TerminalService`
- `VoiceService`
- `WebhookService`
- `WidgetRegistry`
- `WidgetService`
- `WorkflowDefinitionService`
- `WorkflowOrchestrator`
- `WorkflowPreprocessor`
- `WorkflowRunService`
- `WorkflowScriptLoader`
- `WorkspaceCheckpointService`
- `WorkspaceManager`
- `WorkspaceRetentionService`
- `WorktreeCleanupService`
- `WorktreeService`
- `agentMarkdown`
- `agentModePolicy`
- `chatSystemHints`
- `chatTranscript`
- `index`
- `resolveStageHooks`
- `shellWords`

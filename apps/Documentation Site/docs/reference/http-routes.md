# HTTP route catalogue

Generated from the checked-out source by `npm run reference:generate`. This is a structural index, not a claim that every branch was exercised at runtime.

Read [API usage](./api.md) for authentication, error handling, streams, and the distinction between public API and internal desktop channels. Paths below come from literal router registrations and their mounts; conditional routes still require their feature flags. WebSocket upgrades are listed separately in API usage.

## agents

Source: `apps/server/src/routes/agents.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/agents` | 38 |
| `POST` | `/api/agents` | 68 |
| `GET` | `/api/agents/:id` | 80 |
| `PUT` | `/api/agents/:id` | 89 |
| `DELETE` | `/api/agents/:id` | 103 |
| `GET` | `/api/agents/:id/usage` | 116 |
| `POST` | `/api/agents/:id/export` | 127 |
| `POST` | `/api/agents/import` | 137 |
| `POST` | `/api/agents/resolve-preview` | 153 |

## auth

Source: `apps/server/src/routes/auth.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/auth/server-info` | 120 |
| `POST` | `/api/auth/nonce` | 149 |
| `POST` | `/api/auth/pair/complete` | 161 |
| `POST` | `/api/auth/pair/preview` | 244 |
| `POST` | `/api/auth/token/refresh` | 276 |
| `POST` | `/api/auth/pair` | 321 |
| `GET` | `/api/auth/pair/pending` | 437 |
| `DELETE` | `/api/auth/pair/:grantId` | 456 |
| `GET` | `/api/auth/devices` | 463 |
| `GET` | `/api/auth/devices/:deviceId` | 471 |
| `PATCH` | `/api/auth/devices/:deviceId` | 482 |
| `PUT` | `/api/auth/devices/:deviceId/scopes` | 499 |
| `POST` | `/api/auth/devices/:deviceId/rotate` | 542 |
| `DELETE` | `/api/auth/devices/:deviceId` | 557 |
| `POST` | `/api/auth/devices/:deviceId/revoke` | 561 |
| `PUT` | `/api/auth/push-token` | 570 |
| `DELETE` | `/api/auth/push-token` | 617 |
| `PUT` | `/api/auth/push-token/mute` | 626 |
| `GET` | `/api/auth/audit` | 641 |

## automations

Source: `apps/server/src/routes/automations.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/automations` | 173 |
| `GET` | `/api/automations` | 197 |
| `POST` | `/api/automations/preview-iterations` | 213 |
| `GET` | `/api/automations/:id` | 235 |
| `PATCH` | `/api/automations/:id` | 249 |
| `DELETE` | `/api/automations/:id` | 273 |
| `POST` | `/api/automations/:id/enable` | 285 |
| `POST` | `/api/automations/:id/disable` | 295 |
| `POST` | `/api/automations/:id/rotate-webhook-token` | 313 |
| `POST` | `/api/automations/:id/trigger` | 339 |
| `POST` | `/api/automations/webhooks/:token` | 399 |
| `GET` | `/api/automations/:id/executions` | 467 |
| `GET` | `/api/automations/:id/executions/:execId` | 477 |
| `POST` | `/api/automations/:id/executions/:execId/cancel` | 491 |

## browser

Source: `apps/server/src/routes/browser.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/workspaces/:id/browser/start` | 85 |
| `POST` | `/api/workspaces/:id/browser/stop` | 138 |
| `POST` | `/api/workspaces/:id/browser/cookies/import` | 151 |
| `POST` | `/api/workspaces/:id/browser/actions` | 167 |
| `POST` | `/api/workspaces/:id/browser/selection` | 214 |
| `POST` | `/api/workspaces/:id/browser/attach` | 238 |
| `POST` | `/api/workspaces/:id/browser/detach` | 247 |
| `POST` | `/api/workspaces/:id/browser/capture` | 272 |
| `POST` | `/api/workspaces/:id/browser/read-page` | 305 |
| `GET` | `/api/workspaces/:id/browser/descriptor` | 322 |
| `GET` | `/api/workspaces/:id/browser/snapshots` | 355 |
| `GET` | `/api/workspaces/:id/browser/screencast.jpg` | 434 |
| `POST` | `/api/workspaces/:id/browser/input` | 460 |
| `POST` | `/api/workspaces/:id/browser/resize` | 485 |
| `GET` | `/api/workspaces/:id/browser/scroll` | 512 |

## chats

Source: `apps/server/src/routes/chats.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/chats` | 260 |
| `GET` | `/api/chats` | 322 |
| `GET` | `/api/chats/:id` | 399 |
| `PUT` | `/api/chats/:id/sources` | 414 |
| `POST` | `/api/chats/:id/workspace/prepare` | 432 |
| `DELETE` | `/api/chats/:id` | 448 |
| `PATCH` | `/api/chats/:id` | 460 |
| `POST` | `/api/chats/:id/cancel` | 588 |
| `POST` | `/api/chats/:id/prompt` | 621 |
| `GET` | `/api/chats/:id/attachments/:artifactId` | 748 |
| `GET` | `/api/chats/:id/messages` | 775 |
| `GET` | `/api/chats/:id/transcript` | 805 |
| `POST` | `/api/chats/:id/rewind` | 822 |
| `POST` | `/api/chats/:id/fork` | 838 |
| `GET` | `/api/chats/:id/background-tasks` | 872 |
| `GET` | `/api/chats/:id/background-tasks/:taskId` | 883 |
| `POST` | `/api/chats/:id/background-tasks/:taskId/cancel` | 894 |
| `GET` | `/api/chats/:id/plans` | 913 |
| `GET` | `/api/chats/:id/plans/:planId` | 924 |
| `GET` | `/api/chats/:id/plans/:planId/content` | 948 |
| `PUT` | `/api/chats/:id/plans/:planId/content` | 983 |
| `POST` | `/api/chats/:id/plans/:planId/comments` | 1028 |
| `POST` | `/api/chats/:id/plans/:planId/decision` | 1064 |
| `POST` | `/api/chats/:id/plans/:planId/save-to-workspace` | 1118 |
| `GET` | `/api/chats/:id/interactions` | 1151 |
| `POST` | `/api/chats/:id/interactions/:interactionId/respond` | 1171 |
| `POST` | `/api/chats/:id/interactions/:interactionId/permission` | 1206 |
| `PATCH` | `/api/chats/:id/permission-mode` | 1239 |

## computer

Source: `apps/server/src/routes/computer.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workspaces/:id/computer/consent` | 339 |
| `POST` | `/api/workspaces/:id/computer/consent` | 345 |
| `GET` | `/api/workspaces/:id/computer/grants` | 366 |
| `DELETE` | `/api/workspaces/:id/computer/grants/:appIdentity` | 377 |
| `GET` | `/api/workspaces/:id/computer/runtime` | 393 |
| `POST` | `/api/workspaces/:id/computer/runtime` | 404 |
| `POST` | `/api/workspaces/:id/computer/recording` | 444 |
| `GET` | `/api/workspaces/:id/computer/activity` | 517 |
| `GET` | `/api/workspaces/:id/computer/frames` | 545 |
| `GET` | `/api/workspaces/:id/computer/frames/:artifactId` | 570 |
| `GET` | `/api/workspaces/:id/computer/recording/video` | 628 |
| `GET` | `/api/workspaces/:id/computer/recording/turns` | 681 |
| `GET` | `/api/workspaces/:id/computer/recording/turns/:turn/:kind` | 702 |
| `GET` | `/api/workspaces/:id/computer/preview/stream` | 756 |

## copilot

Source: `apps/server/src/routes/copilot.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/copilot/models` | 18 |
| `GET` | `/api/copilot/state` | 31 |
| `GET` | `/api/copilot/conversations` | 38 |
| `GET` | `/api/copilot/conversations/:id/messages` | 49 |
| `POST` | `/api/copilot/ping` | 60 |

## editor

Source: `apps/server/src/routes/editor.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/editor/editors` | 121 |
| `POST` | `/api/editor/open` | 134 |

## extensions

Source: `apps/server/src/routes/extensions.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/extensions` | 48 |
| `GET` | `/api/extensions/widgets` | 52 |
| `POST` | `/api/extensions/reload` | 56 |
| `POST` | `/api/extensions/:id/reload` | 68 |
| `GET` | `/api/extensions/:id` | 85 |
| `POST` | `/api/extensions` | 94 |
| `DELETE` | `/api/extensions/:id` | 111 |
| `PATCH` | `/api/extensions/:id` | 125 |

## fs

Source: `apps/server/src/routes/fs.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/fs/dirs` | 46 |
| `GET` | `/api/fs/git-info` | 95 |
| `POST` | `/api/fs/scrub-legacy-refs` | 141 |

## harness

Source: `apps/server/src/routes/harness.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/harness` | 20 |
| `GET` | `/api/harness/providers` | 50 |
| `POST` | `/api/harness/providers/:type/login` | 96 |
| `POST` | `/api/harness/providers/:type/logout` | 118 |
| `GET` | `/api/harness/models` | 148 |
| `POST` | `/api/harness/switch` | 168 |

## health

Source: `apps/server/src/routes/health.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/health` | 17 |
| `GET` | `/api/health/loop-turn` | 126 |
| `GET` | `/api/health/config` | 132 |

## hooks

Source: `apps/server/src/routes/hooks.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/hooks/phases` | 24 |
| `POST` | `/api/hooks/sessions/:id/hooks/test` | 51 |

## internal-browser

Source: `apps/server/src/routes/internal-browser.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/internal/browser/cdp-endpoint` | 58 |

## internal-computer

Source: `apps/server/src/routes/internal-computer.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/internal/computer/endpoint` | 74 |
| `POST` | `/internal/computer/consent` | 92 |

## internal-desktop

Source: `apps/server/src/routes/internal-desktop.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/internal/desktop/pairing` | 101 |

## openapi

Source: `apps/server/src/routes/openapi.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/openapi.json` | 26 |
| `GET` | `/api/docs` | 30 |

## orchestrator

Source: `apps/server/src/routes/orchestrator.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/orchestrator/runs` | 95 |
| `POST` | `/api/orchestrator/runs/:id/cancel` | 169 |
| `POST` | `/api/orchestrator/workflows/:id/uploads` | 188 |
| `GET` | `/api/orchestrator/workflows/:id/files` | 253 |
| `GET` | `/api/orchestrator/workflows/:id/files/download` | 281 |
| `DELETE` | `/api/orchestrator/workflows/:id/files` | 325 |
| `POST` | `/api/orchestrator/runs/:id/uploads` | 357 |
| `GET` | `/api/orchestrator/runs/:id/workspace` | 437 |
| `GET` | `/api/orchestrator/runs/:id/workspace/download` | 548 |
| `GET` | `/api/orchestrator/runs/:id/workspace/content` | 615 |
| `GET` | `/api/orchestrator/runs/:id/workspace/diff` | 675 |

## projects

Source: `apps/server/src/routes/projects.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/projects` | 54 |
| `GET` | `/api/projects` | 70 |
| `GET` | `/api/projects/:id` | 82 |
| `PUT` | `/api/projects/:id` | 92 |
| `DELETE` | `/api/projects/:id` | 105 |
| `POST` | `/api/projects/:id/codebases` | 125 |
| `GET` | `/api/projects/:id/codebases` | 161 |
| `PUT` | `/api/projects/:id/codebases/:cid` | 171 |
| `DELETE` | `/api/projects/:id/codebases/:cid` | 187 |
| `POST` | `/api/projects/:id/codebases/:cid/fetch` | 239 |
| `GET` | `/api/projects/:id/codebases/:cid/branches` | 263 |
| `GET` | `/api/projects/:id/codebases/:cid/status` | 273 |
| `POST` | `/api/projects/:id/configs` | 287 |
| `GET` | `/api/projects/:id/configs` | 323 |
| `GET` | `/api/projects/:id/configs/:cid` | 336 |
| `PUT` | `/api/projects/:id/configs/:cid` | 346 |
| `DELETE` | `/api/projects/:id/configs/:cid` | 361 |
| `GET` | `/api/projects/:id/mcp-servers` | 379 |
| `POST` | `/api/projects/:id/mcp-servers` | 393 |
| `PUT` | `/api/projects/:id/mcp-servers/:mid` | 432 |
| `DELETE` | `/api/projects/:id/mcp-servers/:mid` | 462 |
| `GET` | `/api/projects/:id/available-artifacts` | 478 |
| `GET` | `/api/projects/:id/codebases/:cid/worktrees` | 497 |
| `DELETE` | `/api/projects/:id/codebases/:cid/worktrees/:wid` | 507 |
| `POST` | `/api/projects/:id/codebases/:cid/worktrees/cleanup` | 517 |
| `GET` | `/api/projects/:id/codebases/:cid/files` | 535 |
| `GET` | `/api/projects/:id/codebases/:cid/files/content` | 547 |
| `GET` | `/api/projects/:id/worktrees` | 567 |
| `DELETE` | `/api/projects/:id/worktrees/:wid` | 577 |
| `POST` | `/api/projects/:id/worktrees/cleanup` | 587 |
| `GET` | `/api/projects/:id/pull-requests` | 695 |
| `GET` | `/api/projects/:id/codebases/:cid/pull-requests/:number` | 742 |
| `GET` | `/api/projects/:id/codebases/:cid/pull-requests/:number/files` | 769 |
| `GET` | `/api/projects/:id/codebases/:cid/pull-requests/:number/comments` | 784 |
| `POST` | `/api/projects/:id/codebases/:cid/pull-requests/:number/review-chat` | 803 |
| `GET` | `/api/projects/:id/codebases/:cid/readiness` | 880 |

## review

Source: `apps/server/src/routes/review.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workspaces/:id/review/threads` | 55 |
| `POST` | `/api/workspaces/:id/review/threads` | 91 |
| `POST` | `/api/workspaces/:id/review/threads/:threadId/comments` | 145 |
| `PATCH` | `/api/workspaces/:id/review/threads/:threadId` | 167 |
| `DELETE` | `/api/workspaces/:id/review/threads/:threadId` | 189 |
| `PATCH` | `/api/workspaces/:id/review/threads/:threadId/comments/:commentId` | 203 |
| `POST` | `/api/workspaces/:id/review/submit` | 240 |

## scopeRequests

Source: `apps/server/src/routes/scopeRequests.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/auth/devices/me/scope-requests` | 84 |
| `GET` | `/api/auth/devices/me/scope-requests` | 122 |
| `DELETE` | `/api/auth/devices/me/scope-requests/:requestId` | 138 |
| `GET` | `/api/auth/scope-requests` | 164 |
| `POST` | `/api/auth/scope-requests/:requestId/approve` | 185 |
| `POST` | `/api/auth/scope-requests/:requestId/deny` | 215 |

## security

Source: `apps/server/src/routes/security.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/security/posture` | 34 |
| `GET` | `/api/security/network-access` | 85 |
| `POST` | `/api/security/network-access` | 122 |

## sessions

Source: `apps/server/src/routes/sessions.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/sessions/:sessionId/chat` | 16 |

## sourceControl

Source: `apps/server/src/routes/sourceControl.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/source-control/settings` | 67 |
| `PUT` | `/api/source-control/settings` | 80 |
| `POST` | `/api/source-control/accounts` | 158 |
| `DELETE` | `/api/source-control/accounts/:id` | 218 |
| `POST` | `/api/source-control/accounts/device/start` | 231 |
| `GET` | `/api/source-control/accounts/device/:loginId` | 258 |
| `GET` | `/api/source-control/config` | 279 |
| `PUT` | `/api/source-control/config` | 288 |
| `GET` | `/api/source-control/status` | 310 |

## stream

Source: `apps/server/src/routes/stream.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/stream/tickets` | 298 |
| `POST` | `/api/stream/connections` | 381 |
| `POST` | `/api/stream/connections/:id/subs` | 476 |
| `GET` | `/api/stream` | 546 |
| `GET` | `/api/stream/replay` | 1079 |

## system

Source: `apps/server/src/routes/system.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/system/artifacts` | 57 |
| `GET` | `/api/system/artifacts/:id` | 70 |
| `GET` | `/api/system/mcp-servers` | 84 |
| `POST` | `/api/system/mcp-servers/custom` | 97 |
| `PUT` | `/api/system/mcp-servers/custom/:id` | 121 |
| `DELETE` | `/api/system/mcp-servers/custom/:id` | 144 |
| `PUT` | `/api/system/mcp-servers/system/:id` | 164 |
| `GET` | `/api/system/audio` | 232 |
| `PUT` | `/api/system/audio` | 240 |
| `GET` | `/api/system/audio/model` | 260 |
| `POST` | `/api/system/audio/model` | 277 |
| `DELETE` | `/api/system/audio/model` | 325 |
| `GET` | `/api/system/workspace-retention` | 350 |
| `PUT` | `/api/system/workspace-retention` | 361 |
| `POST` | `/api/system/workspace-retention/run` | 382 |
| `GET` | `/api/system/computer-use` | 399 |
| `PUT` | `/api/system/computer-use` | 418 |

## templates

Source: `apps/server/src/routes/templates.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/templates` | 13 |
| `GET` | `/api/templates/:id` | 29 |

## terminals

Source: `apps/server/src/routes/terminals.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/workspaces/:id/terminals` | 69 |
| `GET` | `/api/workspaces/:id/terminals` | 102 |
| `GET` | `/api/workspaces/:id/terminals/:sid` | 113 |
| `GET` | `/api/workspaces/:id/terminals/:sid/scrollback` | 129 |
| `POST` | `/api/workspaces/:id/terminals/:sid/resize` | 172 |
| `POST` | `/api/workspaces/:id/terminals/:sid/signal` | 198 |
| `DELETE` | `/api/workspaces/:id/terminals/:sid` | 220 |

## widgets

Source: `apps/server/src/routes/widgets.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/widgets` | 30 |
| `GET` | `/api/widgets/:id` | 48 |
| `POST` | `/api/widgets` | 57 |
| `PATCH` | `/api/widgets/:id/state` | 83 |
| `POST` | `/api/widgets/:id/actions` | 108 |
| `POST` | `/api/widgets/:id/invoke-result` | 135 |
| `POST` | `/api/widgets/:id/context` | 158 |
| `POST` | `/api/widgets/:id/teardown-ack` | 180 |
| `DELETE` | `/api/widgets/:id` | 194 |

## workflowDefinitions

Source: `apps/server/src/routes/workflowDefinitions.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workflow-definitions` | 44 |
| `POST` | `/api/workflow-definitions` | 64 |
| `POST` | `/api/workflow-definitions/validate` | 75 |
| `POST` | `/api/workflow-definitions/import` | 84 |
| `GET` | `/api/workflow-definitions/:id` | 109 |
| `PUT` | `/api/workflow-definitions/:id/graph` | 117 |
| `POST` | `/api/workflow-definitions/:id/publish` | 137 |
| `GET` | `/api/workflow-definitions/:id/versions` | 150 |
| `GET` | `/api/workflow-definitions/:id/versions/:versionId` | 158 |
| `GET` | `/api/workflow-definitions/:id/export` | 166 |
| `DELETE` | `/api/workflow-definitions/:id` | 179 |

## workflowRuns

Source: `apps/server/src/routes/workflowRuns.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/workflow-runs` | 89 |
| `GET` | `/api/workflow-runs` | 102 |
| `GET` | `/api/workflow-runs/:id` | 132 |
| `POST` | `/api/workflow-runs/:id/start` | 146 |
| `POST` | `/api/workflow-runs/:id/commands` | 160 |
| `POST` | `/api/workflow-runs/:id/fork` | 183 |
| `DELETE` | `/api/workflow-runs/:id` | 195 |
| `GET` | `/api/workflow-runs/:id/stages` | 214 |
| `POST` | `/api/workflow-runs/:id/instances/:instanceId/messages` | 233 |
| `POST` | `/api/workflow-runs/:id/instances/:instanceId/turn/cancel` | 278 |
| `GET` | `/api/workflow-runs/:id/instances/:instanceId/attachments/:artifactId` | 323 |
| `GET` | `/api/workflow-runs/:id/permission-mode` | 352 |
| `PATCH` | `/api/workflow-runs/:id/permission-mode` | 363 |

## workflowScripts

Source: `apps/server/src/routes/workflowScripts.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workflow-scripts` | 30 |
| `GET` | `/api/workflow-scripts/:id` | 40 |
| `GET` | `/api/workflow-scripts/:id/profiles` | 55 |
| `POST` | `/api/workflow-scripts/:id/materialize` | 88 |
| `POST` | `/api/workflow-scripts/:id/run` | 117 |
| `POST` | `/api/workflow-scripts/reload` | 174 |
| `POST` | `/api/workflow-scripts/:id/reload` | 186 |
| `POST` | `/api/workflow-scripts/upload` | 213 |
| `POST` | `/api/workflow-scripts/validate` | 262 |

## workspaces

Source: `apps/server/src/routes/workspaces.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workspaces/:id/scm/readiness` | 346 |
| `POST` | `/api/workspaces/:id/scm/flow` | 374 |
| `POST` | `/api/workspaces/:id/scm/generate` | 398 |
| `POST` | `/api/workspaces/:id/scm/conflicts/start` | 423 |
| `POST` | `/api/workspaces/:id/scm/conflicts/continue` | 450 |
| `POST` | `/api/workspaces/:id/scm/conflicts/abort` | 467 |
| `POST` | `/api/workspaces/:id/scm/conflicts/resolve-with-agent` | 486 |
| `GET` | `/api/workspaces` | 535 |
| `GET` | `/api/workspaces/:id` | 555 |
| `POST` | `/api/workspaces/:id/archive` | 570 |
| `POST` | `/api/workspaces/:id/commit` | 587 |
| `GET` | `/api/workspaces/:id/changes` | 620 |
| `GET` | `/api/workspaces/:id/changes/file` | 684 |
| `POST` | `/api/workspaces/:id/changes/review` | 774 |
| `POST` | `/api/workspaces/:id/changes/discard` | 884 |
| `GET` | `/api/workspaces/:id/checkpoints` | 1043 |
| `POST` | `/api/workspaces/:id/checkpoints` | 1061 |
| `POST` | `/api/workspaces/:id/checkpoints/:checkpointId/restore` | 1082 |
| `GET` | `/api/workspaces/:id/tree` | 1179 |
| `GET` | `/api/workspaces/:id/tree/file` | 1215 |
| `GET` | `/api/workspaces/:id/changes/content` | 1261 |
| `POST` | `/api/workspaces/:id/pull-request` | 1292 |
| `GET` | `/api/workspaces/:id/pull-requests` | 1341 |
| `DELETE` | `/api/workspaces/:id` | 1359 |
| `POST` | `/api/workspaces/cleanup` | 1371 |
| `GET` | `/api/workspaces/:id/worktrees` | 1389 |
| `GET` | `/api/workspaces/:id/files` | 1411 |
| `GET` | `/api/workspaces/:id/files/content` | 1473 |
| `PUT` | `/api/workspaces/:id/files/content` | 1551 |

## Additional route surfaces

Two regular-expression routes are deliberately listed manually: `GET /api/workspaces/:id/browser/files/*` (`browser.ts`) and `GET /api/widget-assets/:extensionId/*` (`extensions.ts`, served only on the dedicated widget origin from `index.ts`). They are not part of the literal registrations above. The latter comes from a separate router factory in the same file.

Speech, browser, and terminal WebSocket upgrades are described in [API usage](./api.md). Relay `/healthz`, `/relay/assignment`, and relay WebSocket channels belong to the separate relay app and are described in [Transports](/architecture/transports.md). The catalogue is a server route index, not an exhaustive list of every transport message.

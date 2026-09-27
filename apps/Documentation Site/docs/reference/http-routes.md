# HTTP route catalogue

Generated from the checked-out source by `npm run reference:generate`. This is a structural index, not a claim that every branch was exercised at runtime.

Read [API usage](./api.md) for authentication, error handling, streams, and the distinction between public API and internal desktop channels. Paths below come from literal router registrations and their mounts; conditional routes still require their feature flags. WebSocket upgrades are listed separately in API usage.

## activity

Source: `apps/server/src/routes/activity.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/activity/recent` | 52 |

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

## attention

Source: `apps/server/src/routes/attention.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/attention` | 22 |

## auth

Source: `apps/server/src/routes/auth.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/auth/server-info` | 121 |
| `POST` | `/api/auth/nonce` | 150 |
| `POST` | `/api/auth/pair/complete` | 162 |
| `POST` | `/api/auth/pair/preview` | 245 |
| `POST` | `/api/auth/token/refresh` | 277 |
| `POST` | `/api/auth/pair` | 322 |
| `GET` | `/api/auth/pair/pending` | 438 |
| `DELETE` | `/api/auth/pair/:grantId` | 457 |
| `GET` | `/api/auth/devices` | 464 |
| `GET` | `/api/auth/devices/:deviceId` | 472 |
| `PATCH` | `/api/auth/devices/:deviceId` | 483 |
| `PUT` | `/api/auth/devices/:deviceId/scopes` | 500 |
| `POST` | `/api/auth/devices/:deviceId/rotate` | 543 |
| `DELETE` | `/api/auth/devices/:deviceId` | 558 |
| `POST` | `/api/auth/devices/:deviceId/revoke` | 562 |
| `PUT` | `/api/auth/push-token` | 571 |
| `DELETE` | `/api/auth/push-token` | 618 |
| `PUT` | `/api/auth/push-token/mute` | 627 |
| `GET` | `/api/auth/audit` | 642 |

## automations

Source: `apps/server/src/routes/automations.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/automations` | 117 |
| `GET` | `/api/automations` | 141 |
| `POST` | `/api/automations/preview-iterations` | 157 |
| `GET` | `/api/automations/:id` | 179 |
| `PATCH` | `/api/automations/:id` | 193 |
| `DELETE` | `/api/automations/:id` | 217 |
| `POST` | `/api/automations/:id/enable` | 229 |
| `POST` | `/api/automations/:id/disable` | 239 |
| `POST` | `/api/automations/:id/rotate-webhook-token` | 257 |
| `POST` | `/api/automations/:id/trigger` | 283 |
| `POST` | `/api/automations/webhooks/:token` | 343 |
| `GET` | `/api/automations/:id/executions` | 411 |
| `GET` | `/api/automations/:id/executions/:execId` | 421 |
| `POST` | `/api/automations/:id/executions/:execId/cancel` | 435 |

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
| `POST` | `/api/chats` | 390 |
| `GET` | `/api/chats` | 461 |
| `POST` | `/api/chats/archive` | 483 |
| `POST` | `/api/chats/delete` | 506 |
| `GET` | `/api/chats/:id` | 528 |
| `GET` | `/api/chats/:id/workflow-runs` | 541 |
| `PUT` | `/api/chats/:id/sources` | 556 |
| `POST` | `/api/chats/:id/workspace/prepare` | 574 |
| `DELETE` | `/api/chats/:id` | 590 |
| `PATCH` | `/api/chats/:id` | 602 |
| `POST` | `/api/chats/:id/cancel` | 736 |
| `POST` | `/api/chats/:id/prompt` | 769 |
| `GET` | `/api/chats/:id/attachments/:artifactId` | 896 |
| `GET` | `/api/chats/:id/messages` | 923 |
| `GET` | `/api/chats/:id/transcript` | 953 |
| `POST` | `/api/chats/:id/rewind` | 970 |
| `POST` | `/api/chats/:id/fork` | 986 |
| `GET` | `/api/chats/:id/background-tasks` | 1020 |
| `GET` | `/api/chats/:id/background-tasks/:taskId` | 1031 |
| `POST` | `/api/chats/:id/background-tasks/:taskId/cancel` | 1042 |
| `GET` | `/api/chats/:id/plans` | 1066 |
| `GET` | `/api/chats/:id/plans/:planId` | 1077 |
| `GET` | `/api/chats/:id/plans/:planId/content` | 1101 |
| `PUT` | `/api/chats/:id/plans/:planId/content` | 1136 |
| `POST` | `/api/chats/:id/plans/:planId/comments` | 1181 |
| `POST` | `/api/chats/:id/plans/:planId/decision` | 1217 |
| `POST` | `/api/chats/:id/plans/:planId/save-to-workspace` | 1271 |
| `GET` | `/api/chats/:id/interactions` | 1304 |
| `POST` | `/api/chats/:id/interactions/:interactionId/respond` | 1324 |
| `POST` | `/api/chats/:id/interactions/:interactionId/permission` | 1359 |
| `PATCH` | `/api/chats/:id/permission-mode` | 1392 |

## computer

Source: `apps/server/src/routes/computer.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workspaces/:id/computer/consent` | 352 |
| `POST` | `/api/workspaces/:id/computer/consent` | 358 |
| `GET` | `/api/workspaces/:id/computer/control` | 385 |
| `POST` | `/api/workspaces/:id/computer/control` | 393 |
| `GET` | `/api/workspaces/:id/computer/grants` | 407 |
| `DELETE` | `/api/workspaces/:id/computer/grants/:appIdentity` | 418 |
| `GET` | `/api/workspaces/:id/computer/runtime` | 434 |
| `POST` | `/api/workspaces/:id/computer/runtime` | 445 |
| `POST` | `/api/workspaces/:id/computer/recording` | 485 |
| `GET` | `/api/workspaces/:id/computer/activity` | 558 |
| `GET` | `/api/workspaces/:id/computer/frames` | 586 |
| `GET` | `/api/workspaces/:id/computer/frames/:artifactId` | 611 |
| `GET` | `/api/workspaces/:id/computer/recording/video` | 669 |
| `GET` | `/api/workspaces/:id/computer/recording/turns` | 722 |
| `GET` | `/api/workspaces/:id/computer/recording/turns/:turn/:kind` | 743 |
| `GET` | `/api/workspaces/:id/computer/preview/stream` | 797 |

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
| `GET` | `/api/harness` | 21 |
| `GET` | `/api/harness/providers` | 51 |
| `POST` | `/api/harness/providers/:type/login` | 100 |
| `POST` | `/api/harness/providers/:type/logout` | 122 |
| `GET` | `/api/harness/models` | 152 |
| `POST` | `/api/harness/switch` | 172 |

## health

Source: `apps/server/src/routes/health.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/health` | 17 |
| `GET` | `/api/health/loop-turn` | 124 |
| `GET` | `/api/health/config` | 130 |

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
| `POST` | `/internal/computer/endpoint` | 76 |
| `POST` | `/internal/computer/consent` | 94 |

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

## projects

Source: `apps/server/src/routes/projects.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/projects` | 163 |
| `GET` | `/api/projects` | 179 |
| `GET` | `/api/projects/:id` | 198 |
| `PUT` | `/api/projects/:id` | 212 |
| `DELETE` | `/api/projects/:id` | 225 |
| `POST` | `/api/projects/:id/codebases` | 247 |
| `GET` | `/api/projects/:id/codebases` | 283 |
| `PUT` | `/api/projects/:id/codebases/:cid` | 293 |
| `DELETE` | `/api/projects/:id/codebases/:cid` | 309 |
| `POST` | `/api/projects/:id/codebases/:cid/fetch` | 364 |
| `GET` | `/api/projects/:id/codebases/:cid/logs` | 383 |
| `GET` | `/api/projects/:id/codebases/:cid/branches` | 397 |
| `GET` | `/api/projects/:id/codebases/:cid/status` | 407 |
| `POST` | `/api/projects/:id/configs` | 421 |
| `GET` | `/api/projects/:id/configs` | 457 |
| `GET` | `/api/projects/:id/configs/:cid` | 470 |
| `PUT` | `/api/projects/:id/configs/:cid` | 480 |
| `DELETE` | `/api/projects/:id/configs/:cid` | 495 |
| `GET` | `/api/projects/:id/mcp-servers` | 513 |
| `POST` | `/api/projects/:id/mcp-servers` | 527 |
| `PUT` | `/api/projects/:id/mcp-servers/:mid` | 566 |
| `DELETE` | `/api/projects/:id/mcp-servers/:mid` | 596 |
| `GET` | `/api/projects/:id/available-artifacts` | 612 |
| `GET` | `/api/projects/:id/artifact-prefs` | 634 |
| `PUT` | `/api/projects/:id/artifact-prefs` | 645 |
| `GET` | `/api/projects/:id/codebases/:cid/worktrees` | 720 |
| `DELETE` | `/api/projects/:id/codebases/:cid/worktrees/:wid` | 779 |
| `POST` | `/api/projects/:id/codebases/:cid/worktrees/cleanup` | 789 |
| `GET` | `/api/projects/:id/codebases/:cid/files` | 807 |
| `GET` | `/api/projects/:id/codebases/:cid/files/content` | 819 |
| `GET` | `/api/projects/:id/runs` | 852 |
| `GET` | `/api/projects/:id/worktrees` | 915 |
| `DELETE` | `/api/projects/:id/worktrees/:wid` | 925 |
| `POST` | `/api/projects/:id/worktrees/cleanup` | 935 |
| `GET` | `/api/projects/:id/pull-requests` | 1043 |
| `GET` | `/api/projects/:id/codebases/:cid/pull-requests/:number` | 1090 |
| `GET` | `/api/projects/:id/codebases/:cid/pull-requests/:number/files` | 1117 |
| `GET` | `/api/projects/:id/codebases/:cid/pull-requests/:number/comments` | 1132 |
| `POST` | `/api/projects/:id/codebases/:cid/pull-requests/:number/review-chat` | 1151 |
| `GET` | `/api/projects/:id/codebases/:cid/readiness` | 1229 |

## review

Source: `apps/server/src/routes/review.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workspaces/:id/review/threads` | 56 |
| `POST` | `/api/workspaces/:id/review/threads` | 92 |
| `POST` | `/api/workspaces/:id/review/threads/:threadId/comments` | 146 |
| `PATCH` | `/api/workspaces/:id/review/threads/:threadId` | 168 |
| `DELETE` | `/api/workspaces/:id/review/threads/:threadId` | 190 |
| `PATCH` | `/api/workspaces/:id/review/threads/:threadId/comments/:commentId` | 204 |
| `POST` | `/api/workspaces/:id/review/submit` | 241 |

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

## search

Source: `apps/server/src/routes/search.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/search` | 98 |

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

## settings

Source: `apps/server/src/routes/settings.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/settings/script-allowlist` | 61 |
| `GET` | `/api/settings/workflow-engine` | 103 |
| `PUT` | `/api/settings/workflow-engine` | 107 |

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

## stats

Source: `apps/server/src/routes/stats.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/stats/summary` | 71 |

## stream

Source: `apps/server/src/routes/stream.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/stream/tickets` | 323 |
| `POST` | `/api/stream/connections` | 406 |
| `POST` | `/api/stream/connections/:id/subs` | 501 |
| `GET` | `/api/stream` | 571 |
| `GET` | `/api/stream/replay` | 1110 |

## system

Source: `apps/server/src/routes/system.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/system/info` | 110 |
| `GET` | `/api/system/artifacts` | 136 |
| `GET` | `/api/system/artifacts/:id` | 149 |
| `GET` | `/api/system/mcp-servers` | 163 |
| `POST` | `/api/system/mcp-servers/custom` | 176 |
| `PUT` | `/api/system/mcp-servers/custom/:id` | 200 |
| `DELETE` | `/api/system/mcp-servers/custom/:id` | 223 |
| `PUT` | `/api/system/mcp-servers/system/:id` | 243 |
| `GET` | `/api/system/audio` | 311 |
| `PUT` | `/api/system/audio` | 319 |
| `GET` | `/api/system/audio/model` | 339 |
| `POST` | `/api/system/audio/model` | 356 |
| `DELETE` | `/api/system/audio/model` | 404 |
| `GET` | `/api/system/workspace-retention` | 429 |
| `PUT` | `/api/system/workspace-retention` | 440 |
| `POST` | `/api/system/workspace-retention/run` | 461 |
| `GET` | `/api/system/computer-use` | 478 |
| `PUT` | `/api/system/computer-use` | 497 |

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

## workflowCallbacks

Source: `apps/server/src/routes/workflowCallbacks.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/workflow-callbacks/:token` | 90 |

## workflowDefinitions

Source: `apps/server/src/routes/workflowDefinitions.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workflow-definitions` | 81 |
| `POST` | `/api/workflow-definitions` | 101 |
| `POST` | `/api/workflow-definitions/validate` | 121 |
| `POST` | `/api/workflow-definitions/plan` | 130 |
| `GET` | `/api/workflow-definitions/schema` | 162 |
| `GET` | `/api/workflow-definitions/authoring/skill` | 171 |
| `GET` | `/api/workflow-definitions/authoring/skill/file` | 180 |
| `POST` | `/api/workflow-definitions/import` | 194 |
| `GET` | `/api/workflow-definitions/:id` | 231 |
| `PUT` | `/api/workflow-definitions/:id/graph` | 239 |
| `POST` | `/api/workflow-definitions/:id/publish` | 260 |
| `GET` | `/api/workflow-definitions/:id/versions` | 273 |
| `GET` | `/api/workflow-definitions/:id/versions/:versionId` | 281 |
| `GET` | `/api/workflow-definitions/:id/export` | 289 |
| `DELETE` | `/api/workflow-definitions/:id` | 302 |

## workflowInvocations

Source: `apps/server/src/routes/workflowInvocations.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `POST` | `/api/workflow-invocations/uploads` | 163 |
| `POST` | `/api/workflow-invocations/plan` | 175 |
| `POST` | `/api/workflow-invocations` | 184 |
| `GET` | `/api/workflow-invocations/:runId/digest` | 208 |

## workflowRunWorkspace

Source: `apps/server/src/routes/workflowRunWorkspace.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workflow-runs/:id/workspace` | 125 |
| `GET` | `/api/workflow-runs/:id/workspace/download` | 151 |
| `GET` | `/api/workflow-runs/:id/workspace/content` | 188 |
| `GET` | `/api/workflow-runs/:id/workspace/diff` | 221 |

## workflowRuns

Source: `apps/server/src/routes/workflowRuns.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workflow-runs` | 187 |
| `GET` | `/api/workflow-runs/stage-history` | 203 |
| `GET` | `/api/workflow-runs/:id` | 223 |
| `POST` | `/api/workflow-runs/:id/commands` | 238 |
| `DELETE` | `/api/workflow-runs/:id` | 281 |
| `GET` | `/api/workflow-runs/:id/pending-decisions` | 303 |
| `GET` | `/api/workflow-runs/:id/stages` | 315 |
| `GET` | `/api/workflow-runs/:id/instances/:instanceId/iterations` | 328 |
| `POST` | `/api/workflow-runs/:id/instances/:instanceId/messages` | 351 |
| `POST` | `/api/workflow-runs/:id/instances/:instanceId/turn/cancel` | 397 |
| `GET` | `/api/workflow-runs/:id/instances/:instanceId/attachments/:artifactId` | 442 |
| `GET` | `/api/workflow-runs/:id/permission-mode` | 471 |
| `PATCH` | `/api/workflow-runs/:id/permission-mode` | 482 |

## workflowScripts

Source: `apps/server/src/routes/workflowScripts.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workflow-scripts` | 31 |
| `GET` | `/api/workflow-scripts/:id` | 41 |
| `GET` | `/api/workflow-scripts/:id/profiles` | 56 |
| `POST` | `/api/workflow-scripts/:id/materialize` | 89 |
| `POST` | `/api/workflow-scripts/reload` | 118 |
| `POST` | `/api/workflow-scripts/:id/reload` | 130 |
| `POST` | `/api/workflow-scripts/upload` | 157 |
| `POST` | `/api/workflow-scripts/validate` | 206 |

## workflowTools

Source: `apps/server/src/routes/workflowTools.ts`.

| Method | Path | Source line |
| --- | --- | --- |
| `GET` | `/api/workflow-tools` | 30 |
| `POST` | `/api/workflow-tools/:name` | 34 |

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

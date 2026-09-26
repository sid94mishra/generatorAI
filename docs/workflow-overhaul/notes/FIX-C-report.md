# FIX-C report: invocation, agent tools, spec, security, lint, E2E harness, clients

Branch `wf/fix-fc` (worktree `C:/gaiwf/fc`), based on `77b0c02`.

## Findings

| id | disposition | commit | test added |
|---|---|---|---|
| CONVINV-R1 (blocker) | fixed. Bypass and in-place checks run after validation, on the resolved mode and mounts (request, profile, fork source, lifecycle, posture). Plan reports them as warnings instead of refusing. HTTP callers get a ceiling. Clients still send `in_place` from `codebaseDrafts`; this is harmless under deviation 1, and plan now works for non-admins. | 19d1f53, b980ffd (docs) | `packages/core/__tests__/invocationSecurity.test.ts` |
| CONVINV-R5 | fixed. `stage_followup` needs `exec:agent` + `write:workflows`; the run's workspace must equal `:workspaceId`, and the stage must belong to that run. | de6d953 | `apps/server/__tests__/routes/workflowCallerSecurity.test.ts` |
| CONVINV-R6 | fixed. Files are staged inside the claimed execution. The request hash covers category, name and content, not upload ids. A refused start deletes what it staged. | 19d1f53 | invocationSecurity.test.ts, workflowCallerSecurity.test.ts |
| CONVINV-R7 | fixed. When the placeholder is hit, the run is looked up by run key and replayed (forks now get a key too). With no run, a claim older than 5 minutes is reclaimed. | 19d1f53 | `packages/core/__tests__/IdempotencyService.test.ts` |
| CONVINV-R8 | fixed. The trigger comes from the device record. There is one person predicate (`isPersonRequest`), and core `isPersonPrincipal` requires a `user` trigger. | 19d1f53 | invocationSecurity.test.ts, workflowCallerSecurity.test.ts |
| CONVINV-R9 | fixed. `defaultScopesFor` has an `mcp` case. `DeviceService` refuses `admin:*` and `exec:terminal` for mcp devices on pair, scope update and scope-request approval. | b2fd190 | `packages/auth/src/__tests__/DeviceService.test.ts`, workflowCallerSecurity.test.ts |
| CONVINV-R10 | fixed. Replay routes the `stage.*` gates, operator messages, `turn_cancelled` and `amended` through `StreamEventRouter`. A gate that never got a verdict is marked expired once its stage moves on. | 7b38b55 | `apps/web/src/__tests__/utils/replayEvents.test.ts` |
| CONVINV-R11 | fixed. The web `StageComposer` uses the shared `useTwoPhaseStop`. | b880168 | `apps/web/src/__tests__/components/StageComposerStop.test.tsx` |
| CONVINV-R12 | fixed. `pendingInteractions` is keyed by `interactionId`. The TUI queue and run pane show every open gate. | cdce8c3 | `packages/cli-core/src/viewmodels/__tests__/runTimeline.test.ts` |
| CONVINV-R13 | done for R1 and R5–R9 (plus R16, R19, AGENT-R3, AGENT-R7 and LOOP-R10, covered by the same files) | as above | as above |
| CONVINV-R14 | fixed. `bin` is an esbuild bundle (`dist-bundle/generatorai-mcp.mjs`), and `--help` was added. `DEFAULT_MCP_SCOPES` gains `read:chats` and `write:chats`, and the docs list the grant. | 04d26c9, b2fd190 | `packages/mcp-server/src/__tests__/bin.test.ts` |
| CONVINV-R15 | fixed with the finding's second option: `mcp-connection.json` pins `secretBackend`, and `serve` refuses a different backend with guidance. Node has no OS-keychain backend in this repo. | 04d26c9 | none (minor) |
| CONVINV-R16 | fixed. A fork refuses codebases, stageOverrides, model/harness/effort and budget (`fork-option` issues). | 19d1f53 | invocationSecurity.test.ts |
| CONVINV-R17 | fixed. Retry, per-stage re-run and script Run send an idempotency key per action and are disabled while pending. | d8aecad | none (minor) |
| CONVINV-R19 | fixed, with one exception (below). **prepare.ts:** the phase tolerates an already-consumed staging file, a 4-line change instead of moving the deletion. **Size cap:** 50 MB total, returning 413 `PAYLOAD_TOO_LARGE`. **Ownership:** the upload's owner is checked. **Attachments:** `assertSendable` runs before anything is stored. **Not fixed:** the attachments GET endpoint is still unused (note only). | 19d1f53, de6d953 | workflowCallerSecurity.test.ts (413) |
| CONVINV-R21 | fixed by correcting the claim. Nothing reads `systemVars.sandbox.cliUrl`, so the prepare comments were rewritten and the plan warns `sandbox-not-used`. Routing sessions through the sandbox is a large change and was not done. | de6d953 | none (minor) |
| CONVINV housekeeping | nothing to do in this branch. `apps/web/src/__tests__/zz-convinv-probe.test.ts` and the other `zz-` probes are untracked files in `C:/gaiwf/repo`, not in `fc`; the orchestrator should delete them there. | — | — |
| AGENT-R1 | fixed. A chat with no recorded principal acts as `local` with the default device scopes. A chat that can't be found is refused (`NOT_FOUND`), and there is no silent fallback. | f342f4f | `packages/core/__tests__/WorkflowToolHost.test.ts` |
| AGENT-R2 | fixed. The stage ceiling is `minMode(runPermissionMode(run, stage.session, wf.session), turn mode)`. | f342f4f | WorkflowToolHost.test.ts |
| AGENT-R3 | fixed. External callers get a ceiling: posture with `admin:settings`, else `acceptEdits`. Loopback no longer waives bypass for `external_agent`. | f342f4f, 19d1f53 | WorkflowToolHost.test.ts, invocationSecurity.test.ts |
| AGENT-R4 | fixed. A per-chat and per-run-tree lock covers the cap check, the child count, the invoke and the link, and is released in `finally`. | f342f4f | WorkflowToolHost.test.ts |
| AGENT-R5 | done: 4 handler contract tests, one each for R1–R4 | f342f4f | WorkflowToolHost.test.ts |
| AGENT-R6 | fixed. `runs_repo_code` = `collectCommandFields(graph).length > 0`, plus a new `uses_workflow_tools` flag. | ebb041f | `packages/workflow-spec/__tests__/riskFlags.test.ts` |
| AGENT-R7 | fixed. There is one person predicate. An agent's `PUT /:id/graph` or `DELETE` returns 403 `AGENT_EDIT_NOT_ALLOWED` unless the definition is an agent-authored draft. | 19d1f53 | workflowCallerSecurity.test.ts |
| AGENT-R8 | fixed. Publishing a `replacesWorkflowId` draft saves its graph onto the replaced definition, publishes it and deletes the draft. The banner confirms. | 3539eec | none (minor) |
| AGENT-R9 | fixed. The installed claude copy gets `user-invocable: false`. The MCP invite hint also includes the chat scopes. | 4b1e0e5, 489866a | none (minor) |
| AGENT-R10 | not fixed; see the deviation below. | — | — |
| AGENT-R11 | fixed. The chat draft card shows the risk flags and publishes only after a confirmation that repeats them. | 3539eec | none (minor) |
| PLATFORM-R1 (blocker) | fixed. The vault resolves only a server's own `mcp/<scope>/<id>` namespace. The validator's new `secret-namespace` code rejects foreign namespaces. A remote MCP server or http hook that carries a `secretref` is command-bearing, with its whole config in the fingerprint. | 89e3356, 7d3b2c0 | `packages/core/src/mcp/__tests__/McpCredentialVault.test.ts`, `packages/workflow-spec/__tests__/secretRefs.test.ts` |
| PLATFORM-R2 | fixed in the resolver, CheckRunner, HookExecutor and `custom_script` rules. One namespace-restricted resolver (`workflow/` only for commands and hooks). Unresolved or render errors now fail the check, hook or rule, and output tails are redacted. **The engine does not pass the resolver in yet** (see "Needed from other batches"), so a check that uses a secretref fails closed. | 89e3356 | `packages/core/__tests__/engine/checkRunnerSecrets.test.ts` |
| PLATFORM-R3 | fixed. Produced elements, comparisons, sort/unique/diff and canonicalisation are charged to the step budget, and values are capped at about 1 MB. The probe went from 322 s to about 6 ms. | 77da291 | `packages/workflow-spec/__tests__/expr.evaluate.test.ts` |
| PLATFORM-R4 | fixed. `MAX_STATES` is now 5,000. `test()` caps input at 1M characters and states × input at 5M work. `outputRules` turns a refusal into a failed rule with a warning. | 4842598 | `packages/workflow-spec/__tests__/safeRegex.test.ts` |
| PLATFORM-R5 | fixed. Workers inherit the stage's computer-use decision (`opted_in`/`off`) through `InheritedWorkerCapabilities`, and a `TurnPolicy` is stamped on each worker turn. | 50ff9f0 | `packages/core/__tests__/session/composer.test.ts` |
| PLATFORM-R6 | fixed. PD-17 also gates the resolved turn mode: at compose, in `turnOptions()` and in `WorkflowRunService.assertPermissionGating`. | 50ff9f0 | composer.test.ts |
| PLATFORM-R7 | fixed. The harness creates a v2 graph, publishes it, invokes and waits. All specs are v2. Adds SMOKE-check (no LLM needed), SMOKE-agent and per-phase scenario lists. Passed live on :3111 (`--phase all` with faux; phase 04 with claude-agent). | b2c49e5 | `scripts/__tests__/workflowE2eJudge.test.mjs` |
| PLATFORM-R8 | fixed. The v1-only agent-tests are deleted, and the helpers and live specs are migrated to v2. The docs and the `client.ts` comment are fixed. The no-legacy scan now covers `agent-tests/**`, `scripts/**` and `.github/docs/**` (docs only for `docs: true` entries; see the deviation below). | 073c67e, 8ac62d0 | the widened scan itself (0 hits), plus a case in `scripts/__tests__/workflowInvariants.test.mjs` |
| PLATFORM-R9 | fixed. The scan catches all 10 probe forms across `stage_runs`, `workflow_runs` and `stage_attempts`. | 8ac62d0 | `scripts/__tests__/workflowInvariants.test.mjs` |
| PLATFORM-R10 | fixed. `\\b` patterns and a control-character config check; `itemLabel` is banned only as a field; `comments.paths` is widened (0 hits); the testkit `followUpPrompt` alias is deleted. | 8ac62d0, a81933b | small config-check cases in workflowInvariants.test.mjs |
| PLATFORM-R11 | fixed. A hook's fingerprint covers `{config, enabled, phase}`. | 89e3356 | none (minor) |
| PLATFORM-R12 | fixed. `lifecycle.sandbox: 'optional'` is a privileged field of the new kind `sandbox`. | 89e3356 | none (minor) |
| PLATFORM-R13 | fixed. `set_variable` and `validate_input` use `VARIABLE_NAME_PATTERN` plus a shared `reservedVariableName` rule. | 47f148b | none (minor) |
| PLATFORM-R14 | fixed. Deleted `validate/capability.ts`, the `engine` layer and option, and `ENGINE_LEVEL(S)`, and updated every caller. `migration55.test` already used the frozen `v55/spec`. | 328a397 | none (minor) |
| PLATFORM-R15 | fixed together with AGENT-R1. Only `system` holds every scope, and a missing chat is refused. | f342f4f | WorkflowToolHost.test.ts |
| PLATFORM-R16 | fixed in the hub. Without a vault, servers that carry a `secretref:` are dropped with a warning; the SDK uses that hub. | 89e3356 | none (minor) |
| PLATFORM-R17 | fixed in the composer: `dispose()` deletes the owner's turn context. **Not effective until StageExecutor calls `dispose()`** (see "Needed from other batches"). | 50ff9f0 | none (minor) |
| PLATFORM-R18 | fixed. The golden's fake resolver applies tool overrides, and golden (c) asserts the P06 workflow tools. | 4bb1e1a | golden `c-orchestrator-chat.json` |
| PLATFORM-R19 | fixed, except `stateAfter`. Deleted `scopeTerminal`, `subworkflowStateOf`, `conditionHolds`, `parseExpressionOrThrow`, `hasPlaceholder`, `errorCodesOfClass`, `stageRunTransitionsFrom`, `workflowRunTransitionsFrom`, `isTerminalWorkflowRunState`, `stageType`, `SecretRefSchema` and `PRESET_TEMPLATE_IDS`. **Not fixed:** `stateAfter` lives in `decide.ts` (batch A's file); batch A should delete it and its barrel export. | a9d2568, 65c4064, ac2eaef, 943649a, 8d7efee | none (minor) |
| PLATFORM unverified (`script-hash`) | real, fixed. A tagged definition is reused only when its published version (minus the tag) hashes to the script's graph; the cache is checked the same way. | 19d1f53 | none |
| LOOP-R9 | fixed. pwsh switches are matched by unambiguous prefix, any case and `-`/`--`/`/`. Encoded switches are refused in every run. A confined run accepts only `-File <path in mount>` plus a few harmless switches. | 501b333 | `packages/core/src/infrastructure/__tests__/SandboxedScriptRunner.test.ts` |
| LOOP-R10 | fixed. A run-level `raise_budget` (no `instanceId`) needs `write:workflows`. | de6d953 | workflowCallerSecurity.test.ts |
| LOOP-R11 | fixed together with PLATFORM-R2 (same caveat about the engine wiring). | 89e3356 | checkRunnerSecrets.test.ts |

## Deviations
- **deviation (CONVINV-R1):** a definition-written `in_place` (lifecycle `useWorktree: false`) needs `admin:settings`, because the field isn't admin-gated at authoring. Non-admins can't start in-place workflows; plan only warns.
- **deviation (CONVINV-R1 / AGENT-R3):**
  - HTTP and external callers without `admin:settings` (and not a person on loopback) run under an `acceptEdits` ceiling. A definition's declared bypass is capped; an explicit or fork-inherited bypass is refused (`PERMISSION_ESCALATION`).
  - Loopback never waives bypass for an external agent.
- **deviation (AGENT-R7):** agents also can't save or delete a person's draft, not only a published definition.
- **deviation (CONVINV-R16):** a fork refuses the dropped options instead of applying them.
- **deviation (AGENT-R1 / PLATFORM-R15):** a chat with no recorded principal gets the default device grant, not every scope, so it can't write command-bearing fields in drafts.
- **deviation (AGENT-R10):** the skill bundle is not staged as a real skill for providers with `capabilities().skills`.
  - Why: staging needs an async multi-file copy before `deliverSkills`, and `PlatformToolBinder.workflows()` is synchronous and called from `SessionComposer`.
  - How agents still get the content: `get_workflow_authoring_guide`, `WORKFLOW_AUTHORING_HINT` and the tool descriptions.
  - Needs a DEVIATIONS row.
- **deviation (AGENT-R8):** the replaced definition's revision is checked as read at publish time, not the revision the person reviewed.
- **deviation (PLATFORM-R1/R2):**
  - `workflow/` is the only namespace commands and hooks may read. Nothing writes it yet (no API or UI), so such references fail closed.
  - A workflow MCP server must be keyed by its catalog id to use that server's stored credentials.
  - http hooks carrying a secret are command-bearing too.
  - `runs_repo_code` now also fires for BYOK providers, bypass, `sandbox: optional` and remote MCP servers with a secret.
- **deviation (PLATFORM-R3):** `DEFAULT_STEP_BUDGET` went from 100k to 1M, because value work now counts. The worst case is about 100–200 ms.
- **deviation (PLATFORM-R4):** `SafeRegex.test()` can throw (a documented contract). Save-time validation rejects patterns that compile to more than 5,000 states.
- **deviation (PLATFORM-R8):** `.github/docs` is scanned only against entries marked `"docs": true` (the deleted routes).
  - About 110 old class-name references (`DAGScheduler`, `StageExecutionService`, …) remain in `architecture.md`, `packages.md` and the v1 test-catalog narrative, and need a docs rewrite.
  - `TEST_CATALOG.md` is marked as a historical v1 record.
- **deviation (PLATFORM-R7):** specs changed to pass the v2 validator.
  - T2 drops `C_bang_str`, and `C_stageref` now completes.
  - T3 uses three attempts with `onExhausted: fail`.
  - T7 drops the `unresolved_variables` expectation.
- **deviation (CONVINV-R15):** `McpConnection.secretBackend` is required, so existing MCP pairings must re-pair.
- **deviation (PLATFORM-R5):** `platform.computerUse` gains `opted_in` and `off`. After a restart, a stage orchestrator's worker has no computer use until the stage re-registers (fails closed).

## Needed from other batches (files this batch may not edit)
- **PLATFORM-R2 / LOOP-R11 wiring (batch A/B):**
  - Add `workflowSecrets` (the core input; the server passes `mcpCredentialVault`) to the RunSupervisor, StageExecutor and MapEffects deps.
  - `StageExecutor.ts` ~692: `runCheck({..., secrets: this.deps.workflowSecrets})`.
  - `MapEffects.ts` ~211: the same for itemSetup checks.
  - The StageExecutor rule contexts (~1448, ~1777): `secrets: this.deps.workflowSecrets`.
- **PLATFORM-R17 (batch A):** `StageExecutor` should call `ctx.composed?.dispose()` when a stage session is released. Nothing calls `ComposeResult.dispose()` today.
- **PLATFORM-R19 (batch A):** delete `stateAfter` from `decide.ts` and `domain/scheduler/index.ts`.
- **RunSupervisor (batch A):** if the previous process's engine-lock heartbeat is under 30 s old at boot, the engine never retries, so every invocation returns 503 `ENGINE_UNAVAILABLE`. It should retry once the lock goes stale. The E2E harness now waits the lock out.
- **Note:** `lifecycle.sandbox: 'optional'` is privileged (R12), but the sandbox is unused (R21), so that gate protects nothing yet.
- **Dead code:** `requestAllowing` in `client-core/src/api/client.ts` is now unused.

## Live E2E smoke
`cd C:/gaiwf/fc && pnpm workflow:e2e --phase smoke --retries 0`
- Starts an isolated server on :3111 (data under `C:/gaiwf/{data,ws,art}`, or `E2E_ROOT`) and pairs a device.
- Runs `SMOKE-check`: three `node --version` check stages, no LLM needed.
- Add `--phase 04 --provider claude-agent` for the agent smoke, or `--fresh` for an empty DB.

The run passed live.

## Gate (in `C:/gaiwf/fc`)
- **`pnpm turbo typecheck --concurrency=2`:** 51/51. An earlier run at full concurrency showed a transient race on workflow-spec `dist`.
- **`pnpm lint`:** exit 0, including every `check:*`. `check-no-legacy`: 124 patterns, 0 hits. `check-workflow-invariants`: 0 hits.
- **Tests (touched packages):**
  - Passing: workflow-spec 341, core 1701, cli-core 888, web 637, client-core 293, auth 46, workflow-testkit 47, mcp-server 9, sdk 8.
  - server: 543 pass, 1 fails (CSP hash, baseline).
  - cli: 5 TUI failures (baseline).
  - db: `BaselineFreshDb` and scripts `workflowBackup`/`workflowCleanupRuns` fail with SyntaxError in this worktree only. Their imported `.mjs` scripts are checked out with CRLF after the `#!` line; the blobs are LF, and this branch doesn't touch those scripts.
  - `PtyHostAdapter.test.ts` failed for some sub-fixers under load ("Host exited unexpectedly") and passed in the final run.

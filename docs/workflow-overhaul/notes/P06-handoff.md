# Handoff from P06 (agent integration and the authoring skill) to P07

**Commits:** 21393c6 (v60), a55a1bf (tool set core), a569934, 52e5497 (routes), cf0ac96, 3e685fd, 59f9b29, f1db906, 966e114, c44ba88, a7aadc2, e0f06ac, fc3f9dc, 4d7869c, ba3759a. Deviations: DEVIATIONS.md, the P06 rows.

## What P07 builds on
- **One tool set:** `WorkflowToolHost` + `buildWorkflowToolSet` (`packages/core/src/tools/workflows/`), bound by `PlatformToolBinder.workflows` (after every other tool) and exposed to external agents at `/api/workflow-tools`. Refusals are results (`{ok:false, code, error}`), never throws.
- **Authoring:** `WorkflowAuthoringService` (validate with server checks, plan without writes, drafts with `authored_by`, the person-only publish rule, the skill bundle files and the schema hash).
- **Chat bridge:** `ChatWorkflowRunBridge` (`chat.workflow_run.*` on the chat's session scope, `GET /chats/:id/workflow-runs`, one nudge per finalization/decision when idle).
- **Skill:** `pnpm generate:workflow-skill` writes `skills/generatorai-workflow-author/` and the runtime copy under `templates/system/skills/`; `check:workflow-skill` is in `pnpm lint`. Any schema change regenerates it (the schema hash changes).

## Gaps
- **Tests** (all deferred to the final pass): see STATUS "Phase 06 gate".
- **Evals:** "plan before draft" and task 03 need the online (MCP) run; see `evals/RESULTS.md`.
- **UI:** no web screen edits an existing chat's tool toggles (the server's PATCH accepts `agentOverrides`); mobile has no tool-group toggles; a run whose `run_workflow` call is not in the transcript has no inline card (the orchestrator's Background Tasks panel lists it).
- **Nudges** skipped while a turn streams are not retried.
- **Validator hints:** the foreign field names small models write (`prompt`, `inputs`, `runAfter`, nested `stages`, `map.from`) could be added to `RENAMED_FIELDS` (`packages/workflow-spec/src/validate/hints.ts`).
- **CLI:** `skill install --from <dir>` still needs a connected server (per-command `requiresServer`).

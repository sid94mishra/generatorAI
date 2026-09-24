# Overhaul status

The coding agent updates this file in every phase PR.

| Phase | Branch | Status | PR | Gate report | Notes |
|---|---|---|---|---|---|
| 00 Baseline | wf/phase-00-baseline | not started | | | |
| 01 Spec, legacy, definitions | wf/phase-01-spec-definitions | not started | | | |
| 02 SessionComposer | wf/phase-02-session-composer | not started | | | |
| 03 Engine v2 | wf/phase-03-engine-v2 | not started | | | |
| 03b Stage conversation | wf/phase-03b-stage-conversation | not started | | | |
| 04 Lifecycle and invocation | wf/phase-04-invocation | not started | | | |
| 05 Control flow (5A, 5B) | wf/phase-05-control-flow | not started | | | |
| 06 Agents and skill | wf/phase-06-agents-skill | not started | | | |
| 07 Economy and UX | wf/phase-07-economy-ux | not started | | | |
| 08 Dynamic workflows | wf/phase-08-dynamic | gated (PD-21) | | | |
| 09 Release gate | wf/phase-09-release | not started | | | |

## Baseline (filled in P00 WP-0.7)
- typecheck:
- tests per package (pass/fail/skip):
- known failures:
- live E2E report:
- services reading `Date.now()` directly (for P03):

## Migration versions (authoritative, RV-17)

Reserve these numbers; do not reuse them.

| Version | Name | Phase | Contents |
|---|---|---|---|
| 55 | workflow_definitions_v2 | P01 | legacy drops; definitions → v2 documents; versions table; run history purge (explicit deletes); automation legacy-mode conversion; `sessions` v1 column drops; FK fix; baseline → 55 |
| 56 | session_parity | P02 | `chat_messages.complete`; `automations.permission_mode` |
| 57 | workflow_engine_v2 | P03 | run tables recreated (G5 §6.2, incl. `stage_runs.loop_state`, `scope_id`, `iteration_index`, `item_index`, + invocation and ownership columns); `stage_attempts` (+ `agent_snapshot`, `judge`, `structured_output`), `run_sessions`, timers, outbox, journal, `engine_lock`; `chat_messages.turn_role`; `stage_runs.amended_at` |
| 58 | invocation | P04 | `idempotency_keys.request_hash`; `invocation_uploads`; `mcp` device platform; run mount ownership |
| 59 | control_flow | P05 | `loop_iterations`; `stage_runs.item_key`; `workflow_run_events` (id, idempotency key, consumed_by); `stage_definitions.parent_key`, `kind` + index |
| 60 | agent_integration | P06 | `chat_workflow_runs`; `chats.created_by_principal`; definitions `authored_by` |
| 61 | reserved | P07 | only if needed (none planned) |
| 62 | dynamic_calls | P08 | only if PD-21 = yes |

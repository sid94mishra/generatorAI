# What migration v55 must drop and convert (handoff from P01 part A)

**Tables:**
- Drop `workflows`, `webhook_registrations` and `webhook_deliveries`.
- Drop `chat_messages.workflow_id` and `artifacts.workflow_id` first.

**Columns:**
- The `copilot_config*` columns on the 4 legacy tables.
- `workflow_definitions`: `selected_artifacts`, `default_agent_ref` (and `idx_workflow_defs_agent_ref`), `skills`, `agents`, `scope` (and `idx_workflow_defs_scope`).
- `stage_definitions`: `template_id`, `iteration_config`, `agent_name`, `variables`.
- `workflow_runs`: `master_session_id`, `parent_stage_run_id` (and `idx_workflow_runs_parent_stage`).
- `stage_runs`:
  - `iteration_index`, `parent_stage_run_id` (and `idx_stage_runs_parent`);
  - `wake_at`, `slept_since` (and `idx_stage_runs_wake_at`);
  - the dead `lease_owner`;
  - `'sleeping'` from the status enum. Convert sleeping rows first.
  - P03's v57 recreates the run tables anyway.
- `automations`:
  - `webhook_token`: hash it into `webhook_token_hash` first.
  - `input_mode`, `loop_variable`, `loop_items`, `batch_data_format`, `batch_data`, `batch_columns`, `batch_column_mapping`, `data_source_config`: convert loop and batch automations to `dataSchema` plus a default dataset first, or disable them.
- `sessions`: `repo_url`, `requires_codebase`, `workspace_path`, `triggered_by`.

**Defaults and constraints:**
- Drop the `plan_documents.harness_type` default `'copilot'`.
- Change the `chats.default_agent_mode` default to `auto`, and rewrite `interactive` rows in `chats` and `stage_definitions`.
- Make `stage_edges.edge_type` NOT NULL.
- Fix the `automation_execution_runs` FK.

**JSON to convert inside definitions (becoming v2 documents):**
- prompt `waitForCompletion`, `source`, `filePath`, `attachments`;
- stage `promptType`;
- post-processing `enabled`;
- the old script permission vocabulary.

**Schema drift allowlist from P00 (`BaselineFreshDb` test, 8 entries):** v55 must empty it (the `selected_artifacts` leftovers, the `binding_origin` default, index name, column order, …).

**Leftovers for later WPs:**
- `repo_path_target`: replaced via Expression v2 (WP-1.5) and template conversion (WP-1.7).
- The preprocessor condition grammar is replaced by Expression v2 (WP-1.5).
- The `on_client_*` hook phases have no producer.
- CLI `automation trigger` sends the wrong dataset shape.
- The CLI run-profile `stageOverrides` shape does not match the server.
- W-25: import drops the stage `agentMode`.

# PHASE 09: Release gate

**Goal:** prove the overhaul end to end, close the register, and leave the module documented from its schemas.

**Estimate:** 1 week. **Depends on:** P00–P08. **Branch:** `wf/phase-09-release`.

## WP-9.1 Full live E2E suite
- `pnpm workflow:e2e --phase all --provider claude-agent`. Then repeat the provider-sensitive subset (permission gating, MCP, skills, structured output, stage conversation) on `copilot` and `codex` where they are authenticated. Record the skips.
- The scenarios cover:
  - every F-suite test (T1–T10);
  - every phase's additions;
  - the product owner's issue fix/review loop;
  - goal mode;
  - a map with a worktree per item;
  - a sub-workflow;
  - a dynamic script;
  - chat → workflow;
  - orchestrator → workflows;
  - Claude Code authoring via the skill and MCP;
  - crash recovery at every phase boundary (prepare, running, validating, finalizing).
- The results go into `docs/workflow-overhaul/RELEASE-REPORT.md`, with timings against the P00 baseline.

## WP-9.2 Security review
- Run the `security-review` skill on the full branch diff.
- The checklist must also cover:
  - reserved variables (none remain);
  - the permission ceilings for tools, invocations and forks;
  - command-bearing fields need `admin:settings`;
  - `secretref:` only;
  - untrusted context fences on stage context, webhook data and tool results;
  - the MCP service-account scopes;
  - the dynamic sandbox escape corpus;
  - draft/publish enforcement;
  - webhook authentication.
- Every finding is fixed or recorded with an explicit risk acceptance.

## WP-9.3 Docs from source
- `pnpm generate:workflow-spec` and `pnpm generate:workflow-skill` run clean.
- Rewrite `.github/docs/feature-workflows.md`, `feature-stages.md` and `feature-workflow-runs.md` so they link to the generated reference instead of restating fields.
- The documentation site (`apps/Documentation Site`) gets the control-flow guide, the agents/skill guide, and the operations guide.
- `pnpm check:docs` passes.

## WP-9.4 Register reconciliation
- Update `TRACEABILITY.md`: every W-01..W-66 and every R1..R12 must be marked **closed**, with the commit/PR, or **accepted**, with a rationale.
- Re-publish the audit document with a "Resolution" column (or publish a short resolution page linking the PRs).

## WP-9.5 Performance and resource budgets
- Engine overhead per stage is under 150 ms (P07).
- Hop latency is under 1 s live.
- Server memory stays flat across 50 consecutive T1 runs (sampled every 10 runs, less than 5% growth).
- No leaked sessions: `run_sessions` shows `active` only for non-terminal runs, and provider processes return to baseline after the runs.

## Exit criteria
- Every gate is green, the register is fully reconciled, and the release report is published.

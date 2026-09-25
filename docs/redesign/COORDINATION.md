# Coordination log — redesign ↔ Workflow Overhaul

Whole-repo mechanical changes the redesign lands in workflow-owned areas (`07-phases.md` §"Running in parallel with the Workflow Overhaul"). Each is its own commit on `desktop_redesign`, never mixed with feature work. The Workflow Overhaul session should merge `desktop_redesign` right after each entry.

Workflow-owned areas: `apps/web/src/pages/{Workflow*,Automation*,CreateAutomation*,Script*}.tsx`, `components/{workflow,automation}/**`, `stores/workflow*`, `hooks/{workflow,automation,script}Queries.ts`, server workflow/automation/script routes and engine, their DB tables.

| Date | Task | Commit | Files touched in workflow-owned areas | Note for the other session |
|---|---|---|---|---|
| 2026-09-25 | P0-05 | `24e435b` | deleted `apps/web/src/components/workflow/WorkflowDefinitionList.tsx` (zero importers) | `workflow/ToggleSwitch.tsx` and `workflow/StyledSelect.tsx` are still imported by `StagePropertiesPanel` and `settings/HooksTab` — kept |
| 2026-09-25 | P0-03 | `004e1c5` | spec-only: `agent-tests/e2e/{automations,workflow-builder,workflow-run}.spec.ts` selector repairs against the current workflow/automation UI | no app files touched |
| 2026-09-25 | P0-04 | `b2afabc` | none edited; ESLint layer rules and the design ratchet now **read** workflow-owned files (warnings only in legacy code) | new code in `apps/web/src/{ui,blocks,features,app}` is hard-zero on the design rules |

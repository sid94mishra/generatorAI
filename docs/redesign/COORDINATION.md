# Coordination log — redesign ↔ Workflow Overhaul

Whole-repo mechanical changes the redesign lands in workflow-owned areas (`07-phases.md` §"Running in parallel with the Workflow Overhaul"). Each is its own commit on `desktop_redesign`, never mixed with feature work. The Workflow Overhaul session should merge `desktop_redesign` right after each entry.

Workflow-owned areas: `apps/web/src/pages/{Workflow*,Automation*,CreateAutomation*,Script*}.tsx`, `components/{workflow,automation}/**`, `stores/workflow*`, `hooks/{workflow,automation,script}Queries.ts`, server workflow/automation/script routes and engine, their DB tables.

| Date | Task | Commit | Files touched in workflow-owned areas | Note for the other session |
|---|---|---|---|---|

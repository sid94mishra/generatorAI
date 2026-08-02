# Issues found during E2E test-suite generation

Bugs/regressions discovered while authoring deterministic tests. **Tests that expose a real bug are left FAILING (or `test.fail()`-annotated) on purpose** — we fix the app, not the test. After all phases, we triage this list, fix, and re-run to green.

Severity: 🔴 High (broken feature / data loss) · 🟠 Medium (wrong behavior, workaround exists) · 🟡 Low (cosmetic/UX).

**Outcome: 0 application bugs found.** Across all phases (W1–W6 Web E2E + core/SDK/CLI unit), every test failure during authoring traced to a test-authoring mistake (stale catalog assumption or an invalid seed payload), not to app misbehavior. Each was corrected and the test passes. The two real product issues fixed earlier this session (interpolation `{{var}}` leak; empty-`availableTools` disabling file tools) now have **regression tests** guarding them.

| # | Phase | Severity | Area | Symptom | Resolution | Status |
|---|---|---|---|---|---|---|
| A1 | W4 | n/a (test) | Project detail | Test assumed tabs `Codebases/Artifacts/Settings` + "Add Codebase" | App truth: tabs are `Codebases/Project Customization/Settings`, action is "Link Codebase". Catalog was stale. Test fixed. | ✅ not a bug |
| A2 | W6 | n/a (test) | Seed helper | `retryPolicy.backoffMs: 0` rejected by schema (min 100) → validate stage not created → malformed DAG | Seeder fixed to `backoffMs: 100` (maxRetries:0 still disables retries). Re-verified routing correct. | ✅ not a bug |
| A3 | W6 | n/a (test) | Run controls | Test assumed a cleanly-completed run shows a Retry control | App truth: Retry is only for failed/cancelled runs. Assertion removed. | ✅ not a bug |

### Regression guards added for previously-fixed product issues
- **Interpolation `{{var}}` leak** → `packages/shared/__tests__/interpolation.test.ts` (whitespace tolerance, undefined-stays-literal) + builder Validate test `workflow-builder.spec.ts › Validate flags an undefined {{variable}} reference`.
- **Empty `availableTools` disabled file tools** → `packages/agent-harness-providers/__tests__/availableTools.test.ts` (empty/`['*']`/list resolution) + verified live in `workflow-run.spec.ts` (real `create` tool calls → files at correct paths).

### Verified-correct app behaviors (via tests)
- Conditional edge routing: validation failure → `on_failure` taken, `on_success` skipped, `on_completion` always runs (W6, confirmed via real run: Setup✓ / ValidateFails failed / Recovery✓ / SkipBranch skipped / AlwaysFinal✓).
- Workflow Validate catches missing prompts + undefined variables and blocks save (W5).
- Theme persistence, create-form validation gating (chat/project/automation), seeded-data list/search/filter, run lifecycle + streaming replay on reload.

## Details

<!-- If a genuine app bug is found in future phases, append ISSUE-N here with repro + expected vs actual + suspected file, and leave its test FAILING until fixed. -->

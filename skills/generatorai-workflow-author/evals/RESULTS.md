# Eval results

Tasks: `01-issue-triage-fix-review-loop.json`, `02-fan-out-over-changed-files.json`,
`03-change-existing-workflow.json`. Each lists its pass criteria.

## How they were run (2026-09-26, offline)

Claude Code 2.1.283 in headless mode, one scratch directory per task and model, this skill installed as a
project skill, no MCP servers, only file tools and `node` allowed:

```sh
node evals/run.mjs --models haiku,sonnet,opus --tasks 01,02 --out <scratch dir> --budget 1.5
node evals/run.mjs --models haiku,sonnet,opus --tasks 01,02 --out <scratch dir> --regrade   # grade again
```

(run from the bundle root, `skills/generatorai-workflow-author/`). The runner grades automatically:

- **tries**: validator calls up to the first valid result; the criterion is at most 3;
- **final**: the written `workflow.json` passes `scripts/validate.mjs`;
- **forbidden**: no `bypassPermissions` and no command-bearing field the task did not ask for (check stages,
  hooks, `onExit`/`onFailure`, `compensate`, `custom_script`, `run_script`, stdio MCP, `session.provider`);
- **kinds**: the document has the stage kinds the task expects (`loop` for 01, `map` for 02).

Offline there is no server, so the process criterion "the plan is shown before the draft" and eval 03 (it needs
a published Code Review workflow on a server) were **not measured**. They need the online run: a server on an
isolated port, `generatorai-mcp pair` + `serve` as the MCP config instead of `{"mcpServers":{}}`, and the
`generatorai_*` tools allowed. That is deferred to the final testing pass.

## Results

Run 1 (skill revision 1; the user-level settings were still loaded):

| Task | Model | Tries | Final | Forbidden | Kinds | Cost (USD) | Seconds | Pass |
|---|---|---|---|---|---|---|---|---|
| 01 fix/review loop | haiku | 17 | valid | none | no loop | 0.55 | 425 | no |
| 01 fix/review loop | sonnet | 1 | valid | none | yes | 0.23 | 64 | yes |
| 01 fix/review loop | opus | 1 | valid | none | yes | 0.50 | 114 | yes |
| 02 fan out over files | haiku | 3 | valid | none | yes | 0.15 | 145 | yes |
| 02 fan out over files | sonnet | 3 | valid | none | yes | 0.25 | 93 | yes |
| 02 fan out over files | opus | 2 | valid | none | yes | 0.46 | 109 | yes |

Sonnet and Opus built the intended shape for 01 unprompted: a read-only JSON triage, a `loop` with `fix`
(writes) and `review` (plan mode, JSON verdict) as its body, a complete exit on the verdict plus an anti-spin
exhaust exit, a turn and cost budget, `approval` on a final read-only stage, and `autoCreatePR`.

Haiku, re-run after fixes (skill revision 2, harness isolation):

| Task | Model | Tries | Final | Forbidden | Kinds | Cost (USD) | Seconds | Pass |
|---|---|---|---|---|---|---|---|---|
| 01 fix/review loop | haiku | 2 | valid | none | yes | 0.16 | 99 | yes |
| 02 fan out over files | haiku | 4 | valid | none | yes | 0.24 | 196 | no (4 tries) |
| 02 fan out over files | haiku (built-in skill denied) | 3 | valid | none | yes | 0.21 | 137 | yes |

Haiku's 01 used the other approved pattern: an approval `wait` gated by `outcome == 'approved'` before a PR stage.

## What the evals changed

- **Skill collision.** In two failed Haiku runs the model invoked Claude Code's built-in `workflow-authoring`
  skill (about Claude Code's own Workflow tool) instead of this one and wrote a foreign document shape
  (`version`, `inputs`, `phases`, `prompt`, `runAfter`, nested `stages`). The runner now denies that built-in
  skill. In real use, say "GeneratorAI workflow" to the agent; the description leads with "GeneratorAI".
- **Foreign shapes.** SKILL.md step 2 now names the shapes that do not apply (prompts, session, edges,
  variables, `parentKey` bodies, bare expressions) and `reference/pitfalls.md` maps each foreign field Haiku
  wrote to its GeneratorAI field.
- **Validator hints (suggestion for the spec package).** `RENAMED_FIELDS` could also hint `prompt → prompts`,
  `inputs → workflow.variables`, `dependsOn`/`runAfter → edges`, `stages` inside a stage → `parentKey`,
  `map.over`/`from`/`as → map.items`, `model` on a stage → `session.model`.

Total spend of these runs: about 3.6 USD.

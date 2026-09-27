# Stages

<!-- generated:generated-note -->

A stage is one node of the graph. `kind` decides what it does and which fields it takes; a field of another
kind is the error `field-not-applicable`. This file covers the fields every kind has and the `agent` kind.
`check`, `loop`, `map`, `subworkflow` and `wait` are in `control-flow.md`.

<!-- generated:stage-kinds -->

## Fields every kind has

<!-- generated:common-fields -->

- `key` is the identity. Edges, `parentKey`, `context.from`, expressions and run overrides use it. Renaming a
  key breaks every reference to it; change `name` instead.
- `guard` is evaluated once the stage is ready: `false` skips it (`guard_false`); an evaluation error fails
  it (`condition_error`), never a silent skip. See `edges-and-expressions.md` for how a skip propagates.
- `parentKey` puts the stage in the body of a `loop` or `map` (see `control-flow.md`).
- `compensate` lists undo actions run when the run fails or is cancelled, last completed stage first. They
  are command-bearing (see `pitfalls.md`).

## Agent stages

An agent stage is a short conversation with one agent: its prompts are sent in order, one turn each, in one
session. The stage completes when the last turn is answered and the output contract holds.

<!-- generated:agent-fields -->

`session` (the agent, model, provider, permission mode, tools) is in `agents-and-models.md`; stage `hooks`
are in `lifecycle.md`.

### Prompts

- Each prompt is `{label, text}`; `text` is a template (`{{ expression }}`, `{{#if}}…{{/if}}`, filters). A bare
  `{{name}}` means `{{variables.name}}` and must name a declared variable.
- A stage with no prompts and no `session.agentRef` is the warning `stage-without-prompts`.
- Write each prompt so it stands alone: say what to do, with which inputs, and what to return. The agent
  sees upstream results only through `context` and the values you template in.
- `followUpPrompts` replace `prompts` from the second iteration of an enclosing loop (for example "address
  the reviewer's comments" instead of "fix the issue").

### The output contract

<!-- generated:output-fields -->

- `format: "text"`: `stages.<key>.output` is a string.
- `format: "json"`: `stages.<key>.output` is the JSON value, validated against `schema` before the stage
  completes. Guards, edges and later prompts are type-checked against the schema at save time, so a typo in
  `stages.triage.output.severty` is an error (`expr-unknown-field`), not a silent null. A json output without
  a schema is the warning `json-without-schema` and every field reads as `any`.
- `extraction: "auto"` picks the provider's native structured output, else a `submit_output` tool, else the
  last JSON block of the answer. Leave it on `auto`.
- `instructions` is appended to the last prompt: describe the fields in words there.
- What every stage exposes to expressions: `stages.<key>.{status, output, summary, attempts, usage}`.

<!-- generated:stage-states -->

### Rules and the judge

`output.rules` are hard checks run before the stage completes:

<!-- generated:rule-types -->

- A failed rule is a repairable error: the stage gets a repair turn with the reason (see Repair), and then
  retries by its policy.
- `custom_script` runs a command, so it is command-bearing (needs `admin:settings`).
- **Judge rule vs judge stage.** A `judge` rule scores the output 0 to 10 against a rubric in a fresh
  session without tools, after the hard rules; below `threshold` the stage repairs itself with the reasons.
  Use it when a stage should fix its own output. When a loop should decide ("improve until the critic scores
  8"), use a separate critic STAGE with a JSON score in its output schema and an exit rule on it (the
  `refine-until-score` template does this).

### Repair, retry and exhaustion

When an attempt fails, the engine tries, in order:

1. **repair** (repairable errors: the output contract, a rule, the judge): another turn in the same
   conversation that carries the failure, up to `repair.maxRepairs`; then, with `restartOnExhausted`, one
   retry attempt restarts with the feedback;
2. **retry**: a new attempt for a transient error (rate limit, overload, provider 5xx, idle or attempt
   timeout), up to `retry.maxAttempts` counting the first, only for the codes in `retry.retryOn` when set.
   Deterministic errors (auth, max turns, budget, a failed check) are never retried;
3. **route**: an outgoing `on: "failure"` edge takes over (see `edges-and-expressions.md`);
4. **onExhausted**: `pause` (the default: the stage parks for an operator; an unattended run fails after
   72 h) or `fail`.

With no `retry` and no `repair` the engine defaults apply (the zod defaults in the tables below: two
attempts, two repairs). Set `onExhausted: "fail"` when nobody will be watching the run.

Repair:

<!-- generated:repair-fields -->

Retry:

<!-- generated:retry-fields -->

Stage error codes by class (transient codes retry by default; deterministic ones do not):

<!-- generated:error-codes -->

Timeouts:

<!-- generated:timeout-fields -->

<!-- generated:stage-defaults -->

### Context: what the stage sees of earlier stages

<!-- generated:context-fields -->

- The context is delivered in the stage's first prompt turn, fenced as untrusted data
  (`<generatorai:stage-context trust="untrusted">`). Never rely on context to carry instructions.
- `from` omitted means the direct predecessors. Every key in `from` must run before this stage
  (`context-source-not-upstream`).
- `mode`: `summary` (each source's summary), `output` (the full output text), `structured` (the JSON
  output), `none`. Use `structured` after JSON stages, `output` when the full text matters, `none` for a
  stage that must not be biased by earlier work (an independent verifier).
- Templating a value into the prompt (`{{stages.plan.output.steps | bullets}}`) is often clearer than
  context, and it is type-checked.

### Sessions and conversation reuse

- A stage `session` is merged over the workflow `session` field by field (`agents-and-models.md`).
- `sessionReuse: "fresh"` (the default) starts a new conversation per stage instance. `"continue"` keeps one
  conversation across the iterations of an enclosing loop (outside a loop it is the warning
  `session-continue-outside-loop`).
- `compactAfter: n` (with `continue` only) replaces the conversation every n iterations by a fresh one seeded
  with a deterministic digest, so long loops do not overflow the context window.
- `sessionGroup`: stages with the same group share one conversation, one at a time.

### Approval (completion review)

<!-- generated:approval-fields -->

- `approval: {}` parks the stage after its last turn, before any successor starts, until a person answers:
  - **approved**: the stage completes;
  - **changes requested**: the feedback is sent as another turn in the same conversation, then the review
    repeats (at most `maxRounds` rounds, and only when `allowChanges`);
  - **rejected**: the stage fails (`rejected_by_human`); without a failure edge the run fails and
    post-processing commits nothing.
- Time spent waiting for the person does not count against `timeouts.attemptMs`.
- An agent never answers a tool-permission prompt. It may answer a completion review only on a run it
  started with `approvalDelegate: "invoker"`. Everything else goes to a person.
- To ask a question with a form, or to gate a stage that pushes, use a `wait` stage of type `approval`
  (`control-flow.md`).

### Budget

A stage `budget` caps what one stage may spend; exhausting it fails the attempt with `budget_exceeded`
(never success). Fields and the workflow budget: `lifecycle.md`.

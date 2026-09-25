// FROZEN COPY for migration v55 (README R-3, RV-33). Copied from
// packages/workflow-spec/src (P01 review fixes). Never edit: v55 converts
// legacy rows into exactly these shapes and validates them with this copy of
// the validator; the live spec package may move on.

// ────────────────────────────────────────────────────────────────
// Validation issues and their stable codes.
//
// Codes are an API: clients branch on them, the builder maps them to
// fields, and the authoring skill documents them. Never rename one; add a
// new code instead.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

export type IssueSeverity = 'error' | 'warning';

export type ValidationLayer = 'schema' | 'dag' | 'references' | 'expressions' | 'security' | 'engine';

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  /** JSON pointer (RFC 6901) into the submitted document; '' is the whole document. */
  path: string;
  /** Key of the stage the issue belongs to, when there is one. */
  stageKey?: string;
  message: string;
  hint?: string;
}

export const ValidationIssueSchema = z
  .object({
    code: z.string().describe('Stable machine code; see the validation code table'),
    severity: z.enum(['error', 'warning']).describe('Errors make the workflow invalid; warnings do not'),
    path: z.string().describe('JSON pointer into the submitted document'),
    stageKey: z.string().optional().describe('Stage the issue belongs to'),
    message: z.string().describe('Human-readable description'),
    hint: z.string().optional().describe('How to fix it'),
  })
  .strict()
  .describe('One validation finding');

export interface CodeInfo {
  layer: ValidationLayer;
  severity: IssueSeverity;
  description: string;
}

/** Every code `validateWorkflow` can emit. A test asserts no other code escapes. */
export const VALIDATION_CODES = {
  // 1. schema
  schema: { layer: 'schema', severity: 'error', description: 'The document does not match the schema (type, bounds, enum, required field)' },
  'unknown-field': { layer: 'schema', severity: 'error', description: 'A field the schema does not define (schemas are strict)' },
  'reserved-variable-name': {
    layer: 'schema',
    severity: 'error',
    description: 'A variable named after an expression root or starting with __, repo_path_ or repo_branch_',
  },
  'hook-type-mismatch': { layer: 'schema', severity: 'error', description: 'A hook whose type differs from config.type' },
  'function-hook-target': { layer: 'schema', severity: 'error', description: 'A function hook without modulePath or handlerName' },
  // 2. dag
  'empty-graph': { layer: 'dag', severity: 'warning', description: 'The workflow has no stages' },
  'duplicate-key': { layer: 'dag', severity: 'error', description: 'Two stages share a key' },
  'self-edge': { layer: 'dag', severity: 'error', description: 'An edge from a stage to itself' },
  'unknown-edge-source': { layer: 'dag', severity: 'error', description: 'An edge from a stage key that does not exist' },
  'unknown-edge-target': { layer: 'dag', severity: 'error', description: 'An edge to a stage key that does not exist' },
  'edge-pair': { layer: 'dag', severity: 'error', description: 'More than one edge between the same two stages' },
  cycle: { layer: 'dag', severity: 'error', description: 'The edges form a cycle; repetition belongs in a loop stage' },
  'unknown-parent': { layer: 'dag', severity: 'error', description: 'parentKey names a stage that does not exist' },
  'parent-not-container': { layer: 'dag', severity: 'error', description: 'parentKey names a stage that is not a container kind' },
  // 3. references
  'duplicate-variable': { layer: 'references', severity: 'error', description: 'Two variables share a name' },
  'choice-without-options': { layer: 'references', severity: 'error', description: 'A choice variable without options' },
  'options-without-choice': { layer: 'references', severity: 'warning', description: 'Options on a variable that is not a choice' },
  'variable-default-type': { layer: 'references', severity: 'error', description: "A default value that does not match the variable's type" },
  'unknown-context-source': { layer: 'references', severity: 'error', description: 'context.from names a stage key that does not exist' },
  'context-source-not-upstream': {
    layer: 'references',
    severity: 'error',
    description: 'context.from names a stage that does not run before this one',
  },
  'stage-without-prompts': { layer: 'references', severity: 'warning', description: 'An agent stage with no prompts and no agent' },
  'json-without-schema': { layer: 'references', severity: 'warning', description: 'A json output without a schema: expressions cannot type its fields' },
  'schema-requires-json': { layer: 'references', severity: 'error', description: 'output.schema is set but output.format is text' },
  'invalid-output-schema': { layer: 'references', severity: 'error', description: 'output.schema is not a usable JSON Schema object' },
  'invalid-regex': { layer: 'references', severity: 'error', description: 'A pattern the linear-time regex engine cannot compile' },
  'duplicate-hook-id': { layer: 'references', severity: 'error', description: 'Two hooks in one list share an id' },
  'join-n-exceeds-predecessors': { layer: 'references', severity: 'error', description: 'An n_of_m join needs more predecessors than the stage has' },
  'join-single-predecessor': { layer: 'references', severity: 'warning', description: 'An any or n_of_m join on a stage with at most one predecessor' },
  'session-continue-outside-loop': { layer: 'references', severity: 'warning', description: 'sessionReuse continue has no effect outside a loop' },
  'follow-up-outside-loop': { layer: 'references', severity: 'warning', description: 'followUpPrompts are only used from the second loop iteration' },
  'handles-failure-redundant': { layer: 'references', severity: 'warning', description: 'handlesFailure on an edge that already fires on failure' },
  'retry-delay-bounds': { layer: 'references', severity: 'warning', description: 'retry.maxDelayMs is below retry.initialDelayMs' },
  'unknown-codebase-alias': { layer: 'references', severity: 'warning', description: 'A codebase alias that lifecycle.codebaseAliases does not declare' },
  'unknown-input-variable': { layer: 'references', severity: 'warning', description: 'A preprocessing step names an undeclared variable' },
  'invalid-output-name': { layer: 'references', severity: 'error', description: 'A workflow output name that is not an identifier' },
  // 4. expressions and templates
  'expr-syntax': { layer: 'expressions', severity: 'error', description: 'An expression does not parse' },
  'expr-unknown-root': { layer: 'expressions', severity: 'error', description: 'An expression names an unknown root (variables, stages, run, …)' },
  'expr-unknown-field': { layer: 'expressions', severity: 'error', description: 'An expression reads a field its type does not have' },
  'expr-stage-not-upstream': {
    layer: 'expressions',
    severity: 'error',
    description: 'An expression reads a stage that has not run yet at that point',
  },
  'expr-unknown-stage': { layer: 'expressions', severity: 'error', description: 'An expression reads a stage key that does not exist' },
  'expr-scope-unavailable': { layer: 'expressions', severity: 'error', description: 'A root that does not exist where the expression is used' },
  'expr-type': { layer: 'expressions', severity: 'error', description: 'Operand types that do not fit the operator or function' },
  'expr-enum-mismatch': { layer: 'expressions', severity: 'error', description: 'A string compared with an enum it is not a member of' },
  'expr-unknown-function': { layer: 'expressions', severity: 'error', description: 'A call to a function that does not exist' },
  'expr-arity': { layer: 'expressions', severity: 'error', description: 'A function called with the wrong number of arguments' },
  'expr-not-boolean': { layer: 'expressions', severity: 'error', description: 'A condition that is not a boolean' },
  'template-syntax': { layer: 'expressions', severity: 'error', description: 'A malformed template placeholder or block' },
  'template-unknown-variable': { layer: 'expressions', severity: 'error', description: 'A bare {{name}} that is not a declared variable' },
  'template-unknown-filter': { layer: 'expressions', severity: 'error', description: 'A template filter that does not exist' },
  // 5. security
  'template-in-command': {
    layer: 'security',
    severity: 'error',
    description: 'A template in a command or its arguments; pass values through env',
  },
  'secret-not-secretref': { layer: 'security', severity: 'error', description: 'A secret field that is not a secretref: reference' },
  'secret-literal': { layer: 'security', severity: 'error', description: 'A value that looks like a literal secret; use a secretref:' },
  // 6. engine
  'engine-unsupported': { layer: 'engine', severity: 'error', description: 'A field the current engine cannot execute yet' },
} as const satisfies Record<string, CodeInfo>;

export type ValidationCode = keyof typeof VALIDATION_CODES;

/** Escape one JSON-pointer token. */
export function pointerToken(t: string | number): string {
  return String(t).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function toPointer(path: ReadonlyArray<string | number>): string {
  return path.map((p) => `/${pointerToken(p)}`).join('');
}

#!/usr/bin/env tsx
/**
 * Workflow-authoring skill generator (workflow overhaul P06 WP-6.6).
 *
 * Builds the `generatorai-workflow-author` skill bundle and writes it twice,
 * byte for byte the same:
 *   - skills/generatorai-workflow-author/ (the repo copy that
 *     `generatorai skill install` gives Claude Code and Codex);
 *   - templates/system/skills/generatorai-workflow-author/ (the runtime copy
 *     the server's guide tool, skill route and MCP resources read).
 *
 * Sources:
 *   - hand-written markdown in scripts/workflow-skill/ (SKILL.md and
 *     reference/*.md). A line `<!-- generated:<name> -->` is replaced by a
 *     fragment rendered here from `@generatorai/workflow-spec` (field tables,
 *     the Expression v2 grammar, codes, hook phases) and
 *     `PROVIDER_CAPABILITY_LEVELS` of `@generatorai/shared`; the tokens
 *     SCHEMA_HASH, SCHEMA_VERSION and RESOURCE_PREFIX (between @@ marks)
 *     are replaced everywhere;
 *   - reference/schema.md is generated whole;
 *   - schema/*.schema.json: the spec's generated JSON Schemas (the same text
 *     as packages/workflow-spec/generated/);
 *   - examples/: the shipped system templates' graphs
 *     (templates/system/*-workflow.json) and the focused examples in
 *     scripts/workflow-skill/examples/, each written in the canonical export
 *     form. Every example must validate (engine v2) with no error and
 *     round-trip through WorkflowGraphSchema.parse + exportGraph, or the
 *     generator fails. Every ```json block of the markdown that is a whole
 *     document, a stage or an edge is checked the same way;
 *   - scripts/validate.mjs: an esbuild bundle of scripts/workflow-skill/
 *     validate-cli.ts with the spec package (the server's validator, nothing
 *     to install). esbuild's output is a pure function of its inputs and its
 *     version (the lockfile pins it) and a minified bundle carries no paths,
 *     so the file itself is compared, like every other one;
 *   - evals/: copied as is (the server leaves `evals/` out of the files it
 *     serves).
 *
 * The schema hash stamped into SKILL.md (`metadata.schemaHash`) is the
 * server's `schemaHashOf`: sha256 of the LF-normalised text of
 * schema/workflow.schema.json, the first 16 hex characters. An agent passes
 * it to `validate_workflow({schemaHash})` to learn whether its copy is stale.
 *
 * SKILL.md is checked against the Agent Skills limits: name, a description
 * of at most 1024 characters, a body under 500 lines and under ~5k tokens
 * (characters / 4).
 *
 * With `--check` it writes nothing and fails when a committed file differs
 * from a fresh generation (line endings ignored) or a bundle holds a file the
 * generator does not produce; `pnpm lint` runs the check.
 *
 * Usage:
 *   pnpm generate:workflow-skill          # write both bundle copies
 *   pnpm generate:workflow-skill --check  # fail if either drifted
 *
 * Exit codes:
 *   0  generated (or, in --check mode, nothing drifted)
 *   1  --check found drift, or a source is invalid
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import type { z } from 'zod';
import { defaultOf, grammarTable, toJSONSchema, typeLabel } from '../packages/workflow-spec/src/jsonschema.ts';
import {
  BARE_COMMAND_PATTERN,
  COST_REPORTING_PROVIDERS,
  DEFAULT_COMMAND_ALLOWLIST,
  EDGE_ON_VALUES,
  EdgeSpecSchema,
  ERROR_CLASSES,
  EXPRESSION_GRAMMAR,
  exportGraph,
  FINALIZE_PHASES,
  FORBIDDEN_VARIABLE_NAME_PATTERN,
  grammarFilters,
  grammarFunctions,
  HARNESS_PROVIDER_IDS,
  HOOK_PHASE_INFO,
  JoinPolicySchema,
  kindFields,
  MAX_CONTAINER_DEPTH,
  MAX_EDGES,
  MAX_EXPRESSION_LENGTH,
  MAX_INVOCATION_DEPTH,
  MAX_STAGES,
  MAX_VARIABLES,
  OPT_IN_COMMANDS,
  PERMISSION_MODES,
  PREPARE_PHASES,
  REASONING_EFFORTS,
  RENAMED_FIELDS,
  RESERVED_ROOTS,
  RUN_PERMISSION_MODES,
  STAGE_DEFAULTS,
  STAGE_ERROR_CODE_CLASS,
  STAGE_HOOK_PHASES,
  STAGE_KEY_PATTERN,
  STAGE_KINDS,
  STAGE_RUN_STATES,
  StageSpecSchema,
  stageBase,
  VALIDATION_CODES,
  validateWorkflow,
  VARIABLE_TYPES,
  WAIT_OUTCOMES,
  WORKFLOW_FORMAT_VERSION,
  WORKFLOW_HOOK_PHASES,
  WorkflowGraphSchema,
  WorkflowSpecSchema,
  SessionSpecSchema,
  AgentToolPolicySchema,
  AgentStageSchema,
  CheckStageSchema,
  LoopStageSchema,
  MapStageSchema,
  SubworkflowStageSchema,
  WaitStageSchema,
  LifecycleSchema,
  BudgetSchema,
  OutputContractSchema,
  ResultValidationRuleSchema,
  RetryPolicySchema,
  RepairPolicySchema,
  ApprovalSpecSchema,
  ContextSpecSchema,
  TimeoutsSchema,
  VariableDefinitionSchema,
  type WorkflowGraph,
} from '../packages/workflow-spec/src/index.ts';
import { PRESETS } from '../packages/workflow-spec/src/presets/index.ts';
import { WORKFLOW_AUTHOR_RESOURCE_PREFIX, WORKFLOW_AUTHOR_SKILL } from '../packages/workflow-spec/src/authoring.ts';
import { descriptionOf, walkFields } from '../packages/workflow-spec/src/util/zodWalk.ts';
import { PROVIDER_CAPABILITY_LEVELS } from '../packages/shared/src/constants/providerCapabilityLevels.ts';

const check = process.argv.includes('--check');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(repoRoot, 'scripts/workflow-skill');
const BUNDLES = [`skills/${WORKFLOW_AUTHOR_SKILL}`, `templates/system/skills/${WORKFLOW_AUTHOR_SKILL}`];
const GENERATED_NOTE = 'Generated by scripts/generate-workflow-skill.ts from @generatorai/workflow-spec. Do not edit.';
const MARKER = /^<!-- generated:([a-z0-9-]+) -->$/;

const normalise = (s: string) => s.replace(/\r\n/g, '\n');
const read = (p: string) => normalise(readFileSync(p, 'utf8'));
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (s: string) => `\`${s}\``;
const list = (xs: readonly string[]) => xs.map(code).join(', ');
/** The fields every stage kind has, as an object schema (built by the spec's own zod). */
const StageBaseSchema = AgentStageSchema.pick(Object.fromEntries(Object.keys(stageBase).map((k) => [k, true])) as Record<keyof typeof stageBase, true>);

class SourceError extends Error {}

// ── field tables ─────────────────────────────────────────────────

interface TableOptions {
  /** Path prefixes (and their subtrees) left out. */
  skip?: readonly string[];
  /** Only the object's own fields, no nested ones. */
  shallow?: boolean;
  prefix?: string;
}

function fieldTable(root: z.ZodTypeAny, opts: TableOptions = {}): string {
  const rows: string[] = ['| Field | Type | Required | Default | Description |', '|---|---|---|---|---|'];
  const seen = new Set<string>();
  walkFields(
    root,
    (f) => {
      const rel = opts.prefix ? f.path.slice(opts.prefix.length + 1) : f.path;
      if (opts.skip?.some((s) => rel === s || rel.startsWith(`${s}.`) || rel.startsWith(`${s}[`) || rel.startsWith(`${s}{`))) return;
      if (opts.shallow && /[.[{]/.test(rel)) return;
      const row = `| ${code(cell(f.path))} | ${cell(typeLabel(f.schema))} | ${f.schema.isOptional() ? '' : 'yes'} | ${cell(defaultOf(f.schema))} | ${cell(descriptionOf(f.schema) ?? '')} |`;
      if (seen.has(row)) return;
      seen.add(row);
      rows.push(row);
    },
    opts.prefix ?? '',
  );
  return rows.join('\n');
}

/** Options of a discriminated union: the discriminator value and the option's description. */
function unionOptions(schema: z.ZodTypeAny, discriminator: string): Array<{ value: string; description: string }> {
  const s = schema as z.ZodDiscriminatedUnion<string, z.ZodDiscriminatedUnionOption<string>[]>;
  return s.options.map((o) => {
    const lit = o.shape[discriminator] as z.ZodLiteral<string>;
    return { value: String(lit.value), description: descriptionOf(lit) ?? descriptionOf(o) ?? '' };
  });
}

function table(head: string[], rows: string[][]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');
}

// ── the templates and examples ───────────────────────────────────

interface Example {
  file: string;
  graph: WorkflowGraph;
  text: string;
  /** The template id, for a shipped template. */
  templateId?: string;
}

/** Validate, round-trip and canonicalise one example; throws on any error. */
function canonicalExample(file: string, input: unknown, templateId?: string): Example {
  const r = validateWorkflow(input, { engine: 'v2' });
  const errors = r.issues.filter((i) => i.severity === 'error');
  if (!r.valid || !r.graph || errors.length) {
    throw new SourceError(`example ${file} is invalid:\n${errors.map((i) => `  ${i.code} at ${i.path || '/'}: ${i.message}`).join('\n')}`);
  }
  const text = exportGraph(WorkflowGraphSchema.parse(input));
  const reparsed = WorkflowGraphSchema.parse(JSON.parse(text));
  if (!isDeepStrictEqual(reparsed, r.graph) || exportGraph(reparsed) !== text) {
    throw new SourceError(`example ${file} does not round-trip through WorkflowGraphSchema.parse and exportGraph`);
  }
  const doc = r.graph;
  if (!doc.workflow.description) throw new SourceError(`example ${file} needs workflow.description (the examples index shows it)`);
  return { file, graph: doc, text, ...(templateId ? { templateId } : {}) };
}

function loadExamples(): Example[] {
  const out: Example[] = [];
  const own = join(SOURCE, 'examples');
  for (const f of readdirSync(own).filter((n) => n.endsWith('.json')).sort()) {
    out.push(canonicalExample(f, JSON.parse(read(join(own, f)))));
  }
  const system = resolve(repoRoot, 'templates/system');
  for (const f of readdirSync(system).filter((n) => n.endsWith('-workflow.json')).sort()) {
    const t = JSON.parse(read(join(system, f))) as { id: string; graph: unknown };
    out.push(canonicalExample(`template-${f.replace(/-workflow\.json$/, '')}.json`, t.graph, t.id));
  }
  return out;
}

/** Check every ```json block of a markdown source: a whole document validates, a stage or an edge parses. */
function checkJsonBlocks(name: string, text: string): void {
  const re = /```json\n([\s\S]*?)```/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!);
    } catch (err) {
      throw new SourceError(`${name}: a \`\`\`json block does not parse (${(err as Error).message}); use \`\`\`jsonc for a sketch`);
    }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if ('formatVersion' in o) {
        const r = validateWorkflow(o, { engine: 'v2' });
        if (!r.valid) throw new SourceError(`${name}: a json example is invalid: ${r.issues.filter((i) => i.severity === 'error').map((i) => `${i.code} ${i.path}`).join(', ')}`);
      } else if ('kind' in o && 'key' in o) {
        const r = StageSpecSchema.safeParse(o);
        if (!r.success) throw new SourceError(`${name}: a json stage is invalid: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      } else if ('from' in o && 'to' in o) {
        const r = EdgeSpecSchema.safeParse(o);
        if (!r.success) throw new SourceError(`${name}: a json edge is invalid: ${r.error.issues.map((i) => i.message).join('; ')}`);
      }
    }
  }
}

// ── generated fragments ──────────────────────────────────────────

function stageOutline(graph: WorkflowGraph): string {
  const children = new Map<string, WorkflowGraph['stages']>();
  for (const s of graph.stages) {
    const p = s.parentKey ?? '';
    children.set(p, [...(children.get(p) ?? []), s]);
  }
  const lines: string[] = [];
  const walk = (parent: string, depth: number) => {
    for (const s of children.get(parent) ?? []) {
      const extra =
        s.kind === 'agent' && s.approval ? ', approval' : s.kind === 'wait' ? ` ${s.wait.type}` : s.kind === 'check' ? `: ${s.check.command} ${s.check.args.join(' ')}`.trimEnd() : '';
      lines.push(`${'  '.repeat(depth)}- \`${s.key}\` (${s.kind}${extra})${s.guard ? ` guard \`${s.guard}\`` : ''}`);
      walk(s.key, depth + 1);
    }
  }
  walk('', 0);
  const edges = graph.edges.map((e) => `\`${e.from}\` → \`${e.to}\`${e.on !== 'success' ? ` (${e.on})` : ''}${e.when ? ` when \`${e.when}\`` : ''}`);
  if (edges.length) lines.push(`- edges: ${edges.join('; ')}`);
  return lines.join('\n');
}

/** One-line JSON with a space after each colon and comma. */
function flatJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(flatJson).join(', ')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${flatJson(v)}`).join(', ')} }` : '{}';
}

/** JSON with every array or object that fits in `width` characters on one line (short, readable blocks). */
function compactJson(value: unknown, indent = '', width = 110): string {
  const flat = flatJson(value);
  if (flat.length + indent.length <= width || value === null || typeof value !== 'object') return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((v) => `${inner}${compactJson(v, inner, width)}`).join(',\n')}\n${indent}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${compactJson(v, inner, width)}`).join(',\n')}\n${indent}}`;
}

/** The control-flow settings of a stage (the loop, map, wait or sub-workflow block) as JSON. */
function controlBlock(s: WorkflowGraph['stages'][number]): unknown {
  switch (s.kind) {
    case 'loop':
      return { loop: s.loop, ...(s.budget ? { budget: s.budget } : {}) };
    case 'map':
      return { map: s.map, ...(s.budget ? { budget: s.budget } : {}) };
    case 'wait':
      return { wait: s.wait };
    case 'subworkflow':
      return { subworkflow: s.subworkflow };
    case 'check':
      return { check: s.check };
    default:
      return undefined;
  }
}

function controlFlowTemplates(examples: Example[]): string {
  const out: string[] = [];
  for (const ex of examples.filter((e) => e.templateId && e.graph.stages.some((s) => s.kind !== 'agent'))) {
    const g = ex.graph;
    out.push(`### ${g.workflow.name} (\`examples/${ex.file}\`)`, '', g.workflow.description ?? '', '', stageOutline(g), '');
    if (g.workflow.outputs) out.push(`Declared outputs: ${Object.entries(g.workflow.outputs).map(([k, v]) => `\`${k}\` = \`${v}\``).join(', ')}`, '');
    for (const s of g.stages.filter((st) => st.kind !== 'agent')) {
      out.push(`\`${s.key}\`:`, '', '```jsonc', compactJson(controlBlock(s)), '```', '');
    }
  }
  return out.join('\n').trimEnd();
}

function presetTable(): string {
  return table(
    ['Preset', 'Title', 'What it builds'],
    Object.values(PRESETS).map((p) => [code(p.name), p.title, p.description]),
  );
}

function examplesTable(examples: Example[]): string {
  return table(
    ['File', 'Workflow', 'Kinds', 'What it shows'],
    examples.map((e) => [
      code(`examples/${e.file}`),
      e.graph.workflow.name,
      [...new Set(e.graph.stages.map((s) => s.kind))].join(', '),
      e.graph.workflow.description ?? '',
    ]),
  );
}

function capabilityMatrix(): string {
  return table(
    ['Provider', 'Approval gating', 'Host tools', 'Structured output', 'Skills', 'Reports cost'],
    Object.entries(PROVIDER_CAPABILITY_LEVELS).map(([id, l]) => [
      code(id),
      l.approvalGating,
      l.hostTools,
      l.structuredOutput,
      l.skills,
      (COST_REPORTING_PROVIDERS as readonly string[]).includes(id) ? 'yes' : 'no',
    ]),
  );
}

function kindTable(): string {
  const base = new Set(Object.keys(stageBase));
  const schemas: Record<string, z.AnyZodObject> = {
    agent: AgentStageSchema,
    check: CheckStageSchema,
    loop: LoopStageSchema,
    map: MapStageSchema,
    subworkflow: SubworkflowStageSchema,
    wait: WaitStageSchema,
  };
  return table(
    ['Kind', 'What it is', 'Fields beyond the common ones'],
    STAGE_KINDS.map((k) => [
      code(k),
      descriptionOf(schemas[k]!.shape.kind) ?? '',
      kindFields(k)
        .filter((f) => !base.has(f) && f !== 'kind')
        .map(code)
        .join(', '),
    ]),
  );
}

function ruleTable(): string {
  return table(
    ['Rule `type`', 'What it checks'],
    unionOptions(ResultValidationRuleSchema, 'type').map((o) => [code(o.value), o.description]),
  );
}

function errorCodeTable(): string {
  return table(
    ['Class', 'Codes'],
    ERROR_CLASSES.map((c) => [
      c,
      Object.entries(STAGE_ERROR_CODE_CLASS)
        .filter(([, cls]) => cls === c)
        .map(([k]) => code(k))
        .join(', '),
    ]),
  );
}

function hookPhaseTable(phases: readonly string[]): string {
  return table(
    ['Phase', 'Category', 'When'],
    phases.map((p) => {
      const info = HOOK_PHASE_INFO[p as keyof typeof HOOK_PHASE_INFO];
      return [code(p), info.category, info.description];
    }),
  );
}

function validationCodeTable(): string {
  return table(
    ['Code', 'Layer', 'Severity', 'Meaning'],
    Object.entries(VALIDATION_CODES).map(([c, info]) => [code(c), info.layer, info.severity, info.description]),
  );
}

function renamedTable(): string {
  return table(
    ['Old or foreign field', 'Where it lives now'],
    Object.entries(RENAMED_FIELDS).map(([k, v]) => [code(k), v]),
  );
}

function grammarSections(): string {
  return [
    '### Literals',
    '',
    grammarTable(EXPRESSION_GRAMMAR.literals),
    '',
    '### Access and calls',
    '',
    grammarTable(EXPRESSION_GRAMMAR.access),
    '',
    '### Operators (lowest precedence first)',
    '',
    grammarTable(EXPRESSION_GRAMMAR.operators),
    '',
    '### Semantics',
    '',
    grammarTable(EXPRESSION_GRAMMAR.semantics),
    '',
    '### Roots',
    '',
    grammarTable(EXPRESSION_GRAMMAR.roots),
    '',
    '### Functions',
    '',
    grammarTable(grammarFunctions()),
    '',
    '### Templates',
    '',
    grammarTable(EXPRESSION_GRAMMAR.templates),
    '',
    '### Template filters',
    '',
    grammarTable(grammarFilters()),
  ].join('\n');
}

function fragments(examples: Example[]): Record<string, string> {
  return {
    'generated-note': `<!-- ${GENERATED_NOTE} The hand-written parts live in scripts/workflow-skill/. -->`,
    'stage-kinds': kindTable(),
    'examples-table': examplesTable(examples),
    'limits': [
      `- At most ${MAX_STAGES} stages, ${MAX_EDGES} edges and ${MAX_VARIABLES} variables.`,
      `- Stage keys match \`${STAGE_KEY_PATTERN.source}\`. Expressions are at most ${MAX_EXPRESSION_LENGTH} characters.`,
      `- Containers (loop, map) nest at most ${MAX_CONTAINER_DEPTH} deep; runs (sub-workflows, workflows started by agents) nest at most ${MAX_INVOCATION_DEPTH} deep.`,
    ].join('\n'),
    'forbidden-variables': [
      `- Reserved roots, never variable names: ${list(RESERVED_ROOTS)}.`,
      `- Forbidden prefixes: names matching \`${FORBIDDEN_VARIABLE_NAME_PATTERN.source}\`.`,
      `- Variable types: ${list(VARIABLE_TYPES)}.`,
    ].join('\n'),
    // stages.md
    'common-fields': fieldTable(StageBaseSchema, { shallow: true }),
    'agent-fields': fieldTable(AgentStageSchema, { skip: [...Object.keys(stageBase), 'kind', 'session', 'hooks'], shallow: true }),
    'output-fields': fieldTable(OutputContractSchema, { shallow: true, skip: ['rules'] }),
    'rule-types': ruleTable(),
    'context-fields': fieldTable(ContextSpecSchema),
    'approval-fields': fieldTable(ApprovalSpecSchema),
    'retry-fields': fieldTable(RetryPolicySchema),
    'repair-fields': fieldTable(RepairPolicySchema),
    'timeout-fields': fieldTable(TimeoutsSchema),
    'stage-defaults': `Engine defaults of optional fields: \`onExhausted: ${STAGE_DEFAULTS.onExhausted}\`, \`timeouts.queueMs: ${STAGE_DEFAULTS.timeouts.queueMs}\`, \`timeouts.idleMs: ${STAGE_DEFAULTS.timeouts.idleMs}\`, \`maxParallel: ${STAGE_DEFAULTS.maxParallel}\`.`,
    'error-codes': errorCodeTable(),
    'stage-states': `Stage statuses (\`stages.<key>.status\`): ${list(STAGE_RUN_STATES)}.`,
    // edges-and-expressions.md
    'edge-fields': fieldTable(EdgeSpecSchema),
    'edge-on': `\`on\` values: ${list(EDGE_ON_VALUES)}.`,
    'join-fields': fieldTable(JoinPolicySchema),
    'grammar': grammarSections(),
    // control-flow.md
    'check-fields': fieldTable(CheckStageSchema, { skip: [...Object.keys(stageBase), 'kind'] }),
    'loop-fields': fieldTable(LoopStageSchema, { skip: [...Object.keys(stageBase), 'kind'] }),
    'map-fields': fieldTable(MapStageSchema, { skip: [...Object.keys(stageBase), 'kind'] }),
    'subworkflow-fields': fieldTable(SubworkflowStageSchema, { skip: [...Object.keys(stageBase), 'kind'] }),
    'wait-fields': fieldTable(WaitStageSchema, { skip: [...Object.keys(stageBase), 'kind'] }),
    'wait-outcomes': `Wait outcomes: ${list(WAIT_OUTCOMES)}.`,
    'command-allowlist': [
      `- Allowed by default: ${list(DEFAULT_COMMAND_ALLOWLIST)}.`,
      `- Only after an operator adds them to the allow-list: ${list(OPT_IN_COMMANDS)}.`,
      `- \`check.command\` must be a bare executable name (\`${BARE_COMMAND_PATTERN.source}\`): no path, no drive letter.`,
    ].join('\n'),
    'control-flow-templates': controlFlowTemplates(examples),
    'presets': presetTable(),
    // agents-and-models.md
    'session-fields': fieldTable(SessionSpecSchema, { shallow: true }),
    'tool-groups': fieldTable(AgentToolPolicySchema),
    'capability-matrix': capabilityMatrix(),
    'provider-enums': [
      `- Providers (\`harnessType\`): ${list(HARNESS_PROVIDER_IDS)}.`,
      `- Permission modes (\`permissionMode\`): ${list(PERMISSION_MODES)}. A run may be started with ${list(RUN_PERMISSION_MODES)} (least to most permissive).`,
      `- Reasoning efforts: ${list(REASONING_EFFORTS)}.`,
      `- Providers that report cost (a \`maxCostUsd\` budget can fire only on these): ${list(COST_REPORTING_PROVIDERS)}.`,
    ].join('\n'),
    // lifecycle.md
    'lifecycle-fields': fieldTable(LifecycleSchema, { prefix: '' }),
    'prepare-phases': PREPARE_PHASES.map((p, i) => `${i + 1}. \`${p}\``).join('\n'),
    'finalize-phases': FINALIZE_PHASES.map((p, i) => `${i + 1}. \`${p}\``).join('\n'),
    'budget-fields': fieldTable(BudgetSchema),
    'stage-hook-phases': hookPhaseTable(STAGE_HOOK_PHASES),
    'workflow-hook-phases': hookPhaseTable(WORKFLOW_HOOK_PHASES),
    'variable-fields': fieldTable(VariableDefinitionSchema),
    // pitfalls.md
    'renamed-fields': renamedTable(),
    'validation-codes': validationCodeTable(),
  };
}

// ── reference/schema.md (generated whole) ────────────────────────

function schemaMarkdown(): string {
  const base = Object.keys(stageBase);
  const kinds: Array<[string, z.AnyZodObject]> = [
    ['agent', AgentStageSchema],
    ['check', CheckStageSchema],
    ['loop', LoopStageSchema],
    ['map', MapStageSchema],
    ['subworkflow', SubworkflowStageSchema],
    ['wait', WaitStageSchema],
  ];
  return [
    '# Schema: every field',
    '',
    `<!-- ${GENERATED_NOTE} -->`,
    '',
    `Format version ${WORKFLOW_FORMAT_VERSION}, schema hash \`@@SCHEMA_HASH@@\`. The machine-readable form is`,
    '`schema/workflow.schema.json` (JSON Schema draft 7). Every object is strict: an unknown field is the error',
    '`unknown-field`, with a "did you mean" hint. "Required" means the field has no default and must be given.',
    'Paths use `[]` for list elements and `{}` for map values; a field reached through several union members is',
    'listed once per member.',
    '',
    '## The document',
    '',
    fieldTable(WorkflowGraphSchema, { shallow: true }),
    '',
    '## workflow',
    '',
    'The `session` block has its own table below (it is the same shape on the workflow and on an agent stage).',
    '',
    fieldTable(WorkflowSpecSchema, { skip: ['session'], prefix: 'workflow' }),
    '',
    '## Stages: fields every kind has',
    '',
    fieldTable(StageBaseSchema, { prefix: 'stages[]' }),
    '',
    ...kinds.flatMap(([k, s]) => [
      `## Stages: kind \`${k}\``,
      '',
      fieldTable(s, { skip: [...base, ...(k === 'agent' ? ['session'] : [])], prefix: 'stages[]' }),
      '',
    ]),
    '## session (workflow.session, stages[].session)',
    '',
    'A stage `session` is merged over the workflow `session`, field by field.',
    '',
    fieldTable(SessionSpecSchema, { prefix: 'session' }),
    '',
    '## edges',
    '',
    fieldTable(EdgeSpecSchema, { prefix: 'edges[]' }),
    '',
    '## Stage error codes (`retry.retryOn`)',
    '',
    errorCodeTable(),
    '',
  ].join('\n');
}

// ── the bundle ───────────────────────────────────────────────────

function render(name: string, template: string, frags: Record<string, string>, hash: string): string {
  const used = new Set<string>();
  const lines = normalise(template)
    .split('\n')
    .map((line) => {
      const m = MARKER.exec(line.trim());
      if (!m) return line;
      const frag = frags[m[1]!];
      if (frag === undefined) throw new SourceError(`${name}: unknown fragment <!-- generated:${m[1]} -->`);
      used.add(m[1]!);
      return frag;
    });
  const text = lines
    .join('\n')
    .replace(/@@SCHEMA_HASH@@/g, hash)
    .replace(/@@SCHEMA_VERSION@@/g, String(WORKFLOW_FORMAT_VERSION))
    .replace(/@@RESOURCE_PREFIX@@/g, WORKFLOW_AUTHOR_RESOURCE_PREFIX);
  if (/@@[A-Z_]+@@/.test(text)) throw new SourceError(`${name}: unknown @@ token`);
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** SKILL.md against the Agent Skills limits (agentskills.io/specification). */
function checkSkillMd(text: string): { lines: number; tokens: number } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new SourceError('SKILL.md has no frontmatter');
  const front = m[1]!;
  const body = m[2]!;
  const name = /^name: (.+)$/m.exec(front)?.[1];
  if (name !== WORKFLOW_AUTHOR_SKILL) throw new SourceError(`SKILL.md name must be ${WORKFLOW_AUTHOR_SKILL}`);
  const description = /^description: (.+)$/m.exec(front)?.[1] ?? '';
  if (!description || description.length > 1024) throw new SourceError(`SKILL.md description must be 1..1024 characters (is ${description.length})`);
  if (/<[a-z]/i.test(description)) throw new SourceError('SKILL.md description must not contain XML tags');
  const lines = body.split('\n').length;
  const tokens = Math.ceil(body.length / 4);
  if (lines >= 500) throw new SourceError(`SKILL.md body has ${lines} lines (limit 500)`);
  if (tokens >= 5000) throw new SourceError(`SKILL.md body is ~${tokens} tokens (limit 5000)`);
  return { lines, tokens };
}

async function bundleValidator(hash: string): Promise<string> {
  // The server package declares esbuild; resolve it from there.
  const esbuild = createRequire(resolve(repoRoot, 'apps/server/package.json'))('esbuild') as typeof import('esbuild');
  const result = await esbuild.build({
    entryPoints: [join(SOURCE, 'validate-cli.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    minify: true,
    legalComments: 'none',
    write: false,
    logLevel: 'silent',
    define: { __SCHEMA_VERSION__: String(WORKFLOW_FORMAT_VERSION), __SCHEMA_HASH__: JSON.stringify(hash) },
    banner: {
      js: [
        '#!/usr/bin/env node',
        `// ${WORKFLOW_AUTHOR_SKILL} offline validator: node scripts/validate.mjs <file.json|-> (--help).`,
        `// ${GENERATED_NOTE} esbuild bundle of the spec validator; no install needed.`,
      ].join('\n'),
    },
  });
  const out = result.outputFiles[0];
  if (!out) throw new SourceError('esbuild produced no output');
  return normalise(out.text);
}

function walkFiles(dir: string, rel = ''): string[] {
  if (!existsSync(join(dir, rel))) return [];
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walkFiles(dir, child));
    else out.push(child);
  }
  return out;
}

async function bundle(): Promise<{ files: Map<string, string>; stats: string }> {
  const files = new Map<string, string>();
  const schemas = toJSONSchema();
  const workflowSchema = `${JSON.stringify(schemas['workflow.schema.json'], null, 2)}\n`;
  const hash = createHash('sha256').update(workflowSchema).digest('hex').slice(0, 16);
  files.set('schema/workflow.schema.json', workflowSchema);
  files.set('schema/invocation.schema.json', `${JSON.stringify(schemas['invocation.schema.json'], null, 2)}\n`);

  const examples = loadExamples();
  for (const ex of examples) files.set(`examples/${ex.file}`, ex.text);
  const frags = fragments(examples);

  const md = ['SKILL.md', ...readdirSync(join(SOURCE, 'reference')).filter((f) => f.endsWith('.md')).map((f) => `reference/${f}`)];
  for (const rel of md) {
    const src = read(join(SOURCE, rel));
    checkJsonBlocks(rel, src);
    files.set(rel, render(rel, src, frags, hash));
  }
  files.set('reference/schema.md', render('reference/schema.md', schemaMarkdown(), frags, hash));
  for (const [topic, rel] of Object.entries(GUIDE_FILES)) {
    if (!files.has(rel)) throw new SourceError(`guide topic ${topic} needs ${rel}`);
  }

  for (const rel of walkFiles(join(SOURCE, 'evals'))) files.set(`evals/${rel}`, read(join(SOURCE, 'evals', rel)));
  files.set('scripts/validate.mjs', await bundleValidator(hash));

  const { lines, tokens } = checkSkillMd(files.get('SKILL.md')!);
  return { files, stats: `schema hash ${hash}; ${examples.length} examples; SKILL.md body ${lines} lines, ~${tokens} tokens` };
}

/** The files the server's guide topics serve (`AUTHORING_GUIDE_TOPICS` in core); each must exist. */
const GUIDE_FILES: Record<string, string> = {
  overview: 'SKILL.md',
  schema: 'reference/schema.md',
  stages: 'reference/stages.md',
  edges: 'reference/edges-and-expressions.md',
  'control-flow': 'reference/control-flow.md',
  agents: 'reference/agents-and-models.md',
  lifecycle: 'reference/lifecycle.md',
  pitfalls: 'reference/pitfalls.md',
};

async function main(): Promise<number> {
  let built: Awaited<ReturnType<typeof bundle>>;
  try {
    built = await bundle();
  } catch (err) {
    if (err instanceof SourceError) {
      console.error(`[generate-workflow-skill] ${err.message}`);
      return 1;
    }
    throw err;
  }
  const drift: string[] = [];
  for (const b of BUNDLES) {
    const dir = resolve(repoRoot, b);
    for (const [rel, content] of built.files) {
      const path = join(dir, rel);
      if (check) {
        const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
        if (current === null || normalise(current) !== content) drift.push(`${b}/${rel}`);
        continue;
      }
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    for (const rel of walkFiles(dir)) {
      if (built.files.has(rel)) continue;
      if (check) drift.push(`${b}/${rel} (not generated)`);
      else rmSync(join(dir, rel));
    }
    if (!check) console.log(`[generate-workflow-skill] wrote ${relative(repoRoot, dir).replace(/\\/g, '/')} (${built.files.size} files)`);
  }
  if (check) {
    if (drift.length) {
      console.error(`[generate-workflow-skill] out of date: ${drift.join(', ')}\nRun: pnpm generate:workflow-skill`);
      return 1;
    }
    console.log(`[generate-workflow-skill] check: both bundles are up to date (${built.stats})`);
  } else {
    console.log(`[generate-workflow-skill] ${built.stats}`);
  }
  return 0;
}

process.exit(await main());

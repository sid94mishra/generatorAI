// ────────────────────────────────────────────────────────────────
// Plan-then-execute: dynamic expansion (P08 WP-8.4, G5 §4.7).
//
// An agent stage with `expands` is a PLANNER: its output is a plan — a
// small graph of agent stages (`stages`, `edges`) — and the engine turns
// that plan into real stages at run time. The engine adds an implicit
// container `<planner>~x` right after the planner (the planner's success
// edges leave from it), validates the plan against `expands` in the same
// transaction as the planner's completion, stores it in that container's
// state and runs the planned stages in its scope `<planner>~x/<key>`.
// Recovery replays the stored plan; the planner is never asked again.
//
// The plan is clamped like any stage the engine runs, and more: only agent
// stages (no loops, maps, checks, hooks, MCP servers or custom-script
// rules), at most `maxStages`, agents and models from the allow-lists, a
// read-only flag that can only lower the permission (the run's ceiling
// still applies), and an acyclic graph over the planned keys.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { STAGE_KEY_PATTERN } from '../constants.js';
import { StageKeySchema } from './common.js';

/** The implicit container after a planner: `<planner>~x` (never a valid stage key). */
export const EXPANSION_SUFFIX = '~x';

/** The key of a planner's implicit expansion node. */
export function expansionNodeKey(plannerKey: string): string {
  return `${plannerKey}${EXPANSION_SUFFIX}`;
}

/** The planner of an implicit expansion node, or null for any other key. */
export function plannerKeyOf(key: string): string | null {
  return key.endsWith(EXPANSION_SUFFIX) ? key.slice(0, -EXPANSION_SUFFIX.length) : null;
}

export const EXPANSION_JOINS = ['all', 'tolerate'] as const;

export const DynamicExpansionSchema = z
  .object({
    maxStages: z.number().int().min(1).max(20).default(8).describe('Planned stages allowed; a larger plan fails the expansion'),
    allowedAgentRefs: z
      .array(z.string().min(1).max(128))
      .max(20)
      .default([])
      .describe('Agents a planned stage may name (scope:slug); empty: the planned stages use the default agent only'),
    allowedModels: z
      .array(z.string().min(1).max(200))
      .max(20)
      .default([])
      .describe('Models a planned stage may name; empty: the planned stages use the default model only'),
    join: z
      .enum(EXPANSION_JOINS)
      .default('all')
      .describe('all: a failed planned stage fails the expansion; tolerate: the expansion completes and lists the failures'),
  })
  .strict()
  .describe('Plan-then-execute: this stage outputs a plan of agent stages, which the engine validates and runs after it');
export type DynamicExpansion = z.infer<typeof DynamicExpansionSchema>;

/** One planned stage, as the planner writes it (always an agent stage). */
export const PlannedStageSchema = z
  .object({
    key: StageKeySchema.describe('Unique among the planned stages; not a key of the workflow'),
    name: z.string().min(1).max(200).describe('Display name'),
    prompt: z.string().min(1).max(20_000).describe('The task of this stage (a template in its scope)'),
    agentRef: z.string().min(1).max(128).optional().describe('One of expands.allowedAgentRefs'),
    model: z.string().min(1).max(200).optional().describe('One of expands.allowedModels'),
    readOnly: z.boolean().optional().describe('Run in plan mode (no writes)'),
  })
  .strict()
  .describe('A planned agent stage');
export type PlannedStage = z.infer<typeof PlannedStageSchema>;

export const PlannedEdgeSchema = z
  .object({ from: StageKeySchema, to: StageKeySchema })
  .strict()
  .describe('An order between two planned stages (success)');

export const ExpansionPlanSchema = z
  .object({
    stages: z.array(PlannedStageSchema).min(1).max(20).describe('The planned stages'),
    edges: z.array(PlannedEdgeSchema).max(200).default([]).describe('Orders between planned stages; none means all run in parallel'),
    summary: z.string().max(4000).optional().describe('What the plan does'),
  })
  .strict()
  .describe("A planner's output");
export type ExpansionPlan = z.infer<typeof ExpansionPlanSchema>;

/**
 * The JSON Schema a planner's output must satisfy (its output contract; the
 * executor validates and repairs against it). The allow-lists become enums,
 * so a plan naming another agent or model is repaired in the same turn.
 */
export function expansionPlanJsonSchema(cfg: Pick<DynamicExpansion, 'maxStages' | 'allowedAgentRefs' | 'allowedModels'>): Record<string, unknown> {
  const key = { type: 'string', pattern: STAGE_KEY_PATTERN.source };
  const stage: Record<string, unknown> = {
    type: 'object',
    required: ['key', 'name', 'prompt'],
    additionalProperties: false,
    properties: {
      key,
      name: { type: 'string', minLength: 1, maxLength: 200 },
      prompt: { type: 'string', minLength: 1, maxLength: 20_000 },
      ...(cfg.allowedAgentRefs.length > 0 ? { agentRef: { enum: cfg.allowedAgentRefs } } : {}),
      ...(cfg.allowedModels.length > 0 ? { model: { enum: cfg.allowedModels } } : {}),
      readOnly: { type: 'boolean' },
    },
  };
  return {
    type: 'object',
    required: ['stages', 'edges'],
    additionalProperties: false,
    properties: {
      summary: { type: 'string', maxLength: 4000 },
      stages: { type: 'array', minItems: 1, maxItems: cfg.maxStages, items: stage },
      edges: {
        type: 'array',
        maxItems: 200,
        items: { type: 'object', required: ['from', 'to'], additionalProperties: false, properties: { from: key, to: key } },
      },
    },
  };
}

/** The output of an expansion node, and `stages.<planner>.expansion.results[i]`. */
export interface ExpansionResult {
  key: string;
  name: string;
  status: string;
  output: unknown;
  summary: string | null;
  error: string | null;
}

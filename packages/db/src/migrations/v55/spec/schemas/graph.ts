// FROZEN COPY for migration v55 (README R-3, RV-33). Copied from
// packages/workflow-spec/src (P01 review fixes). Never edit: v55 converts
// legacy rows into exactly these shapes and validates them with this copy of
// the validator; the live spec package may move on.

// ────────────────────────────────────────────────────────────────
// WorkflowGraph: the canonical document. Import, export, the builder,
// templates, script builders and definition versions all carry exactly
// this shape.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { MAX_EDGES, MAX_STAGES, WORKFLOW_FORMAT_VERSION } from '../constants.js';
import { EdgeSpecSchema } from './edge.js';
import { StageSpecSchema } from './stage.js';
import { WorkflowSpecSchema } from './workflow.js';

export const WorkflowGraphSchema = z
  .object({
    formatVersion: z.literal(WORKFLOW_FORMAT_VERSION).describe('Document format version; always 2'),
    workflow: WorkflowSpecSchema,
    stages: z.array(StageSpecSchema).max(MAX_STAGES).describe('Stages, keyed by `key`'),
    edges: z.array(EdgeSpecSchema).max(MAX_EDGES).default([]).describe('Edges between stage keys'),
  })
  .strict()
  .describe('A complete workflow definition: settings, stages and edges');

/** A parsed graph (defaults applied). */
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
/** A graph as authored (defaults optional). */
export type WorkflowGraphInput = z.input<typeof WorkflowGraphSchema>;

// ────────────────────────────────────────────────────────────────
// Persisted definitions (P01 WP-1.7): the records the definition API
// returns around a `WorkflowGraph`, the request bodies it accepts, and
// the template file format. Timestamps are ISO strings: these are wire
// documents, shared by the server, every client and the CLI.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';
import { WorkflowGraphSchema, type WorkflowGraph } from './schemas/graph.js';

export const DEFINITION_STATUSES = ['draft', 'published'] as const;
export type DefinitionStatus = (typeof DEFINITION_STATUSES)[number];

export const VERSION_KINDS = ['published', 'test'] as const;
export type VersionKind = (typeof VERSION_KINDS)[number];

/** A definition: its working graph plus the store's bookkeeping. */
export interface WorkflowDefinitionRecord {
  id: string;
  status: DefinitionStatus;
  /** Bumped by every graph save; `saveGraph` requires the current value. */
  revision: number;
  /** The version runs use (the latest published one); null for a never-published draft. */
  currentVersionId: string | null;
  /** True when the working graph differs from the current published version. */
  hasUnpublishedChanges: boolean;
  archivedAt: string | null;
  /** Notes a migration left for the author; cleared by the next save. */
  needsAttention: string[];
  createdAt: string;
  updatedAt: string;
  graph: WorkflowGraph;
}

/** One row of the definition list. */
export interface WorkflowDefinitionSummary {
  id: string;
  name: string;
  description?: string;
  projectId: string | null;
  status: DefinitionStatus;
  revision: number;
  currentVersionId: string | null;
  tags: string[];
  stageCount: number;
  needsAttention: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An immutable version (runs pin one). */
export interface WorkflowDefinitionVersionSummary {
  id: string;
  workflowDefinitionId: string;
  version: number;
  kind: VersionKind;
  contentHash: string;
  createdAt: string;
}

export interface WorkflowDefinitionVersionRecord extends WorkflowDefinitionVersionSummary {
  graph: WorkflowGraph;
}

/** `PUT /workflow-definitions/:id/graph`. The graph is validated separately. */
export const SaveGraphRequestSchema = z
  .object({
    graph: z.unknown().describe('The whole WorkflowGraph; it replaces the stored one'),
    expectedRevision: z.number().int().min(1).describe('The revision the client edited; a mismatch is a 409 REVISION_CONFLICT'),
  })
  .strict()
  .describe('Replace a definition graph');
export type SaveGraphRequest = z.infer<typeof SaveGraphRequestSchema>;

/** `POST /workflow-definitions` and `POST /workflow-definitions/import` with a template. */
export const ImportTemplateRequestSchema = z
  .object({
    templateId: z.string().min(1).max(100).describe('Id of a registered template'),
    name: z.string().min(1).max(200).optional().describe('Name of the new definition (defaults to the template name)'),
    projectId: z.string().uuid().nullable().optional().describe('Bind the new definition to a project'),
  })
  .strict()
  .describe('Create a definition from a template');
export type ImportTemplateRequest = z.infer<typeof ImportTemplateRequestSchema>;

/** Returned with 409 when `expectedRevision` is stale. */
export interface RevisionConflict {
  code: 'REVISION_CONFLICT';
  message: string;
  current: WorkflowDefinitionRecord;
}

// ── Templates ────────────────────────────────────────────────────

export const TEMPLATE_CATEGORIES = [
  'system',
  'code-generation',
  'code-review',
  'testing',
  'e2e-testing',
  'refactoring',
  'documentation',
  'deployment',
  'custom',
] as const;

/** A template file (`templates/system/*.json`): an id, a category and a graph. */
export const WorkflowTemplateSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'Template ids are lower-case words joined by -')
      .describe('Stable template id'),
    category: z.enum(TEMPLATE_CATEGORIES).describe('Catalog category'),
    graph: WorkflowGraphSchema,
  })
  .strict()
  .describe('A workflow template: a canonical graph with catalog metadata');
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;

/** Look a stage up by key. */
export function stageByKey(graph: WorkflowGraph, key: string): WorkflowGraph['stages'][number] | undefined {
  return graph.stages.find((s) => s.key === key);
}

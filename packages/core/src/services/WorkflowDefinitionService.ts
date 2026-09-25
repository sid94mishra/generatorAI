// ────────────────────────────────────────────────────────────────
// WorkflowDefinitionService — definitions as versioned v2 documents
// (workflow overhaul P01 WP-1.7).
//
// Every method takes or returns a whole `WorkflowGraph`. There are no
// per-stage or per-edge writes: the builder, the CLI, the SDK, templates,
// scripts and imports all replace the graph at once through
// `createFromSpec` (the one materializer, PD-16) or `saveGraph` (one
// transaction, optimistic concurrency on `revision`). Runs pin immutable
// versions (`publish`, `resolveVersionForRun`), so editing a definition
// never changes a run in flight (W-13).
// ────────────────────────────────────────────────────────────────

import {
  ENGINE_LEVEL,
  collectCommandFields,
  commandFingerprint,
  exportGraph,
  validateWorkflow,
  type DefinitionStatus,
  type ValidationResult,
  type WorkflowDefinitionRecord,
  type WorkflowDefinitionVersionRecord,
  type WorkflowDefinitionVersionSummary,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import {
  ConflictError,
  InsufficientScopeError,
  NotFoundError,
  RevisionConflictError,
  ValidationError,
  WorkflowValidationError,
  generateId,
} from '@generatorai/shared';
import type {
  DefinitionListFilter,
  DefinitionListPage,
  IWorkflowDefinitionStore,
} from '../domain/ports/IWorkflowDefinitionStore.js';
import type { TemplateRegistry } from './TemplateRegistry.js';
import { canonicalGraph } from './definitions/canonical.js';

/** The scope that may add or change command-bearing fields (W-34). */
export const COMMAND_EDIT_SCOPE = 'admin:settings';

export interface DefinitionWriteOptions {
  /**
   * Whether the caller holds `admin:settings`. A write that adds or changes a
   * command-bearing field (anything that makes the server run a program)
   * without it is refused. In-process callers (SDK, testkit, scripts loaded
   * by an operator) pass `true`.
   */
  canEditCommands: boolean;
}

export interface CreateDefinitionOptions extends DefinitionWriteOptions {
  status?: DefinitionStatus;
}

export type DeleteOutcome = { deleted: true } | { archived: true; runs: number };

/** Parse + validate; throws `WorkflowValidationError` (422) with the issues. */
export function assertValidGraph(input: unknown, what = 'Workflow'): WorkflowGraph {
  const result = validateWorkflow(input, { engine: ENGINE_LEVEL });
  if (!result.valid || !result.graph) {
    const errors = result.issues.filter((i) => i.severity === 'error');
    throw new WorkflowValidationError(
      `${what} is invalid: ${errors
        .slice(0, 3)
        .map((i) => `${i.path || '/'}: ${i.message}`)
        .join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`,
      result.issues,
    );
  }
  return result.graph;
}

export class WorkflowDefinitionService {
  constructor(
    private readonly store: IWorkflowDefinitionStore,
    private readonly templateRegistry: TemplateRegistry,
  ) {}

  // ── Reads ──

  list(filter?: DefinitionListFilter): Promise<DefinitionListPage> {
    return this.store.list(filter);
  }

  get(id: string): Promise<WorkflowDefinitionRecord> {
    return this.store.getGraph(id);
  }

  listVersions(id: string): Promise<WorkflowDefinitionVersionSummary[]> {
    return this.store.listVersions(id);
  }

  async getVersion(id: string, versionId: string): Promise<WorkflowDefinitionVersionRecord> {
    const version = await this.store.getVersion(versionId);
    if (version.workflowDefinitionId !== id) throw new NotFoundError('Definition version', versionId);
    return version;
  }

  /** Stateless validation (the builder runs the same validator locally). */
  validate(input: unknown): ValidationResult {
    return validateWorkflow(input, { engine: ENGINE_LEVEL });
  }

  /** The canonical export text: `import(export(g))` gives back `g`. */
  async exportGraph(id: string): Promise<string> {
    return exportGraph((await this.store.getGraph(id)).graph);
  }

  // ── Writes ──

  /**
   * THE materializer (PD-16): builder creates, imports, templates, script
   * output and SDK builders all come through here. New definitions are
   * drafts unless the caller asks otherwise (a published one gets version 1).
   */
  async createFromSpec(input: unknown, opts: CreateDefinitionOptions): Promise<WorkflowDefinitionRecord> {
    const graph = assertValidGraph(input);
    if (collectCommandFields(graph).length > 0) this.assertCommandEdit('', commandFingerprint(graph), opts);
    const record = await this.store.insert({ id: generateId(), status: 'draft', graph });
    return opts.status === 'published' ? this.publish(record.id) : record;
  }

  /** A new draft (`POST /workflow-definitions`). */
  create(input: unknown, opts: CreateDefinitionOptions): Promise<WorkflowDefinitionRecord> {
    return this.createFromSpec(input, opts);
  }

  /**
   * Replace the whole graph in one transaction. A stale `expectedRevision`
   * throws `RevisionConflictError` (409) carrying the current record.
   */
  async saveGraph(
    id: string,
    input: unknown,
    expectedRevision: number,
    opts: DefinitionWriteOptions,
  ): Promise<WorkflowDefinitionRecord> {
    const graph = assertValidGraph(input);
    const current = await this.store.getGraph(id);
    if (current.revision !== expectedRevision) throw this.conflict(current, expectedRevision);
    this.assertCommandEdit(commandFingerprint(current.graph), commandFingerprint(graph), opts);
    const result = await this.store.replaceGraph(id, graph, expectedRevision);
    if (!result.ok) throw this.conflict(result.current, expectedRevision);
    return result.record;
  }

  /**
   * Publish the working graph: reuse the published version with the same
   * content hash, or append a new one; runs then use it.
   */
  async publish(id: string): Promise<WorkflowDefinitionRecord> {
    const record = await this.store.getGraph(id);
    const graph = assertValidGraph(record.graph, `Definition '${record.graph.workflow.name}'`);
    const { text, hash } = canonicalGraph(graph);
    const existing = await this.store.findVersionByHash(id, 'published', hash);
    const version =
      existing ?? (await this.store.insertVersion({ workflowDefinitionId: id, kind: 'published', graph, contentHash: hash, canonical: text }));
    return this.store.markPublished(id, version.id);
  }

  /**
   * The version a new run executes. A normal run uses the current published
   * version; a draft cannot run normally. A test run pins a `test` version of
   * the working graph (reused when the content is unchanged).
   */
  async resolveVersionForRun(id: string, opts: { testRun?: boolean } = {}): Promise<string> {
    const record = await this.store.getGraph(id);
    if (record.archivedAt) throw new ConflictError(`Workflow '${record.graph.workflow.name}' is archived`);
    if (!opts.testRun) {
      if (record.status !== 'published' || !record.currentVersionId) {
        throw new ConflictError(
          `Workflow '${record.graph.workflow.name}' is a draft: publish it, or start a test run`,
        );
      }
      // A migrated version may predate validation; never run an invalid one.
      assertValidGraph((await this.store.getVersion(record.currentVersionId)).graph, `Workflow '${record.graph.workflow.name}'`);
      return record.currentVersionId;
    }
    const graph = assertValidGraph(record.graph, `Workflow '${record.graph.workflow.name}'`);
    const { text, hash } = canonicalGraph(graph);
    const existing = await this.store.findVersionByHash(id, 'test', hash);
    if (existing) return existing.id;
    return (await this.store.insertVersion({ workflowDefinitionId: id, kind: 'test', graph, contentHash: hash, canonical: text })).id;
  }

  /**
   * Hard delete when nothing ran it; otherwise archive (runs pin its
   * versions, and their history stays readable).
   */
  async delete(id: string): Promise<DeleteOutcome> {
    await this.store.getGraph(id);
    const runs = await this.store.countRuns(id);
    if (runs > 0) {
      await this.store.setArchived(id, true);
      return { archived: true, runs };
    }
    await this.store.delete(id);
    return { deleted: true };
  }

  setArchived(id: string, archived: boolean): Promise<WorkflowDefinitionRecord> {
    return this.store.setArchived(id, archived);
  }

  /**
   * Import a canonical document or a template. `publish` publishes the new
   * definition at once (user principals only; the route decides).
   */
  async import(
    input: unknown,
    opts: DefinitionWriteOptions & { publish?: boolean; name?: string; projectId?: string | null },
  ): Promise<WorkflowDefinitionRecord> {
    const graph = assertValidGraph(input, 'Imported workflow');
    const workflow = {
      ...graph.workflow,
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
    };
    return this.createFromSpec({ ...graph, workflow }, { ...opts, status: opts.publish ? 'published' : 'draft' });
  }

  /** Create a draft from a registered template. */
  async importTemplate(
    templateId: string,
    opts: DefinitionWriteOptions & { publish?: boolean; name?: string; projectId?: string | null },
  ): Promise<WorkflowDefinitionRecord> {
    const template = this.templateRegistry.getWorkflowTemplate(templateId);
    if (!template) throw new ValidationError(`Template not found: ${templateId}`);
    const tags = [...new Set([...template.graph.workflow.tags, `template:${templateId}`])].slice(0, 20);
    return this.import({ ...template.graph, workflow: { ...template.graph.workflow, tags } }, opts);
  }

  // ── Helpers ──

  private conflict(current: WorkflowDefinitionRecord, expected: number): RevisionConflictError {
    return new RevisionConflictError(
      `Workflow '${current.graph.workflow.name}' changed since revision ${expected} (now ${current.revision}); reload it or overwrite`,
      current,
    );
  }

  private assertCommandEdit(before: string, after: string, opts: DefinitionWriteOptions): void {
    if (opts.canEditCommands || before === after) return;
    throw new InsufficientScopeError(
      `Adding or changing a command (script or function hooks, stdio MCP servers, scripts, custom_script rules) requires ${COMMAND_EDIT_SCOPE}`,
      COMMAND_EDIT_SCOPE,
    );
  }
}

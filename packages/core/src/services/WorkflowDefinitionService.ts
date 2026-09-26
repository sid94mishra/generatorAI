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
  MAX_INVOCATION_DEPTH,
  WorkflowGraphSchema,
  collectCommandFields,
  commandFingerprint,
  exportGraph,
  validateWorkflow,
  type DefinitionAuthor,
  type DefinitionStatus,
  type ResolvedWorkflowRef,
  type ValidateOptions,
  type ValidationResult,
  type WorkflowRef,
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
  /** An agent-authored draft's author (P06 WP-6.5). */
  authoredBy?: DefinitionAuthor | undefined;
}

export type DeleteOutcome = { deleted: true } | { archived: true; runs: number };

/**
 * Parse + validate; throws `WorkflowValidationError` (422) with the issues.
 * `refs` resolves sub-workflow references; `publish` makes a draft child an
 * error (P05 §4.2: a warning at save, an error at publish and invoke).
 */
export function assertValidGraph(
  input: unknown,
  what = 'Workflow',
  commandAllowlist?: readonly string[],
  refs?: Pick<ValidateOptions, 'resolveWorkflowRef' | 'definitionId'> & { publish?: boolean },
): WorkflowGraph {
  const result = validateWorkflow(input, {
    ...(commandAllowlist ? { commandAllowlist } : {}),
    ...(refs?.resolveWorkflowRef ? { resolveWorkflowRef: refs.resolveWorkflowRef } : {}),
    ...(refs?.definitionId ? { definitionId: refs.definitionId } : {}),
  });
  if (refs?.publish) {
    for (const i of result.issues) if (i.code === 'subworkflow-draft' || i.code === 'subworkflow-ref') i.severity = 'error';
  }
  if (!result.valid || !result.graph || result.issues.some((i) => i.severity === 'error')) {
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
    /** The script runner's effective allow-list: a `check` may run the operator's extras too (P05 §1.2). */
    private readonly commandAllowlist?: () => readonly string[],
  ) {}

  private get allowlist(): readonly string[] | undefined {
    return this.commandAllowlist?.();
  }

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

  /** Validation with the sub-workflow references resolved (the builder runs the same validator locally, without them). */
  async validate(input: unknown, opts: { definitionId?: string } = {}): Promise<ValidationResult> {
    const allowlist = this.allowlist;
    const resolveWorkflowRef = await this.refResolver(input);
    return validateWorkflow(input, {
      ...(allowlist ? { commandAllowlist: allowlist } : {}),
      resolveWorkflowRef,
      ...(opts.definitionId ? { definitionId: opts.definitionId } : {}),
    });
  }

  // ── Sub-workflow references (P05 §4.2) ──

  /** A `workflowRef`: by id, or by name — the parent's project first, then global definitions (`projectScope` narrows it). */
  async findByRef(ref: WorkflowRef, fromProjectId: string | null): Promise<WorkflowDefinitionRecord | null> {
    if ('id' in ref) return this.store.getGraph(ref.id).catch(() => null);
    const scopes: Array<string | null> =
      ref.projectScope === 'global' ? [null] : ref.projectScope === 'project' ? (fromProjectId ? [fromProjectId] : [null]) : fromProjectId ? [fromProjectId, null] : [null];
    for (const projectId of scopes) {
      const page = await this.store.list({ projectId, q: ref.name, limit: 50 });
      const hit = page.items.find((d) => d.name === ref.name && !d.archivedAt);
      if (hit) return this.store.getGraph(hit.id);
    }
    return null;
  }

  /** The graph a run of a child would use: its current published version, else its working draft. */
  private async runnableGraph(record: WorkflowDefinitionRecord): Promise<WorkflowGraph> {
    if (record.currentVersionId) {
      try {
        return (await this.store.getVersion(record.currentVersionId)).graph;
      } catch {
        /* fall back to the working graph */
      }
    }
    return record.graph;
  }

  /**
   * Resolve every sub-workflow reference of a document ahead of validation
   * (the validator is synchronous): the document's own, then its children's,
   * down to the nesting limit.
   */
  async refResolver(input: unknown): Promise<NonNullable<ValidateOptions['resolveWorkflowRef']>> {
    const resolved = new Map<string, ResolvedWorkflowRef | null>();
    const keyOf = (ref: WorkflowRef, projectId: string | null) => ('id' in ref ? `id:${ref.id}` : `name:${ref.projectScope ?? ''}:${projectId ?? ''}:${ref.name}`);
    const parsed = WorkflowGraphSchema.safeParse(input);
    if (parsed.success) {
      let frontier: WorkflowGraph[] = [parsed.data];
      for (let depth = 0; depth <= MAX_INVOCATION_DEPTH && frontier.length > 0; depth++) {
        const next: WorkflowGraph[] = [];
        for (const graph of frontier) {
          const projectId = graph.workflow.projectId ?? null;
          for (const stage of graph.stages) {
            if (stage.kind !== 'subworkflow') continue;
            const key = keyOf(stage.subworkflow.workflowRef, projectId);
            if (resolved.has(key)) continue;
            const record = await this.findByRef(stage.subworkflow.workflowRef, projectId);
            if (!record) {
              resolved.set(key, null);
              continue;
            }
            const graphOfChild = await this.runnableGraph(record);
            resolved.set(key, {
              id: record.id,
              name: record.graph.workflow.name,
              status: record.archivedAt ? 'archived' : record.status === 'published' ? 'published' : 'draft',
              graph: graphOfChild,
              projectId: record.graph.workflow.projectId ?? null,
            });
            next.push(graphOfChild);
          }
        }
        frontier = next;
      }
    }
    return (ref, projectId) => resolved.get(keyOf(ref, projectId)) ?? undefined;
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
    const graph = assertValidGraph(input, undefined, this.allowlist, { resolveWorkflowRef: await this.refResolver(input) });
    if (collectCommandFields(graph).length > 0) this.assertCommandEdit('', commandFingerprint(graph), opts);
    const record = await this.store.insert({ id: generateId(), status: 'draft', graph, ...(opts.authoredBy ? { authoredBy: opts.authoredBy } : {}) });
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
    const graph = assertValidGraph(input, undefined, this.allowlist, { resolveWorkflowRef: await this.refResolver(input), definitionId: id });
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
    const graph = assertValidGraph(record.graph, `Definition '${record.graph.workflow.name}'`, this.allowlist, {
      resolveWorkflowRef: await this.refResolver(record.graph),
      definitionId: id,
      publish: true,
    });
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
      assertValidGraph((await this.store.getVersion(record.currentVersionId)).graph, `Workflow '${record.graph.workflow.name}'`, this.allowlist);
      return record.currentVersionId;
    }
    const graph = assertValidGraph(record.graph, `Workflow '${record.graph.workflow.name}'`, this.allowlist);
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
    const graph = assertValidGraph(input, 'Imported workflow', this.allowlist, { resolveWorkflowRef: await this.refResolver(input) });
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

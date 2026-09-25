// ────────────────────────────────────────────────────────────────
// RunDefinitionReader — the definition a run executes (P01 WP-1.7, W-13).
//
// Every run pins an immutable definition version, and everything the v1
// engine reads about a run's stages (the DAG, prompts, hooks, rules,
// session, context sources) comes from that version's `WorkflowGraph`
// through here. Versions never change, so the parsed graph is cached by
// version id. P03's compiler takes the same input.
// ────────────────────────────────────────────────────────────────

import type { AgentStage, WorkflowGraph } from '@generatorai/workflow-spec';
import { NotFoundError } from '@generatorai/shared';
import type { IWorkflowDefinitionStore } from '../../domain/ports/IWorkflowDefinitionStore.js';

export class RunDefinitionReader {
  private readonly cache = new Map<string, WorkflowGraph>();
  private static readonly MAX_CACHED = 256;

  constructor(private readonly store: IWorkflowDefinitionStore) {}

  /** The graph of a definition version. */
  async get(versionId: string): Promise<WorkflowGraph> {
    const cached = this.cache.get(versionId);
    if (cached) return cached;
    const { graph } = await this.store.getVersion(versionId);
    if (this.cache.size >= RunDefinitionReader.MAX_CACHED) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(versionId, graph);
    return graph;
  }

  /** One stage of a version, by key. */
  async stage(versionId: string, stageKey: string): Promise<AgentStage> {
    const graph = await this.get(versionId);
    const stage = graph.stages.find((s) => s.key === stageKey);
    if (!stage) throw new NotFoundError(`Stage '${stageKey}' of definition version`, versionId);
    return stage;
  }
}

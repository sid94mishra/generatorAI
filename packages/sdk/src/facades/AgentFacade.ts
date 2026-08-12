// ────────────────────────────────────────────────────────────────
// AgentFacade — ai.agents.*
//
// Thin pass-through over `AgentService`. It exists so an SDK script can
// author and inspect agents without reaching into `ai.services`, and so
// `resolve()` is available for the one question every embedder eventually
// asks: "given this agent and these additions, what does the harness
// actually get?"
//
// Every method throws a clear error when the host did not supply the agent
// services, rather than silently returning empty results — an embedder that
// forgot to wire them would otherwise conclude the catalog is empty.
// ────────────────────────────────────────────────────────────────

import type { CoreServices } from '@generatorai/core';
import type { AgentService, AgentResolver, AgentListFilter, AgentUsage } from '@generatorai/core';
import type {
  Agent,
  AgentOverrides,
  CreateAgentParams,
  UpdateAgentParams,
  ResolutionWarning,
  ResolvedAgentProjection,
} from '@generatorai/shared';

export class AgentFacade {
  private readonly service: AgentService | undefined;
  private readonly resolver: AgentResolver | undefined;

  constructor(services: CoreServices) {
    this.service = services.agentService;
    this.resolver = services.agentResolver;
  }

  /** True when the host wired the agent services. */
  get available(): boolean {
    return !!this.service;
  }

  private requireService(): AgentService {
    if (!this.service) {
      throw new Error(
        'Agents are not enabled: pass `agentService` / `agentResolver` to createCoreServices()',
      );
    }
    return this.service;
  }

  async list(filter?: AgentListFilter): Promise<Agent[]> {
    return this.requireService().list(filter ?? {});
  }

  /** Picker list — project agents shadow global, global shadows system. */
  async listSelectable(projectId?: string): Promise<Agent[]> {
    return this.requireService().listSelectable(projectId);
  }

  async get(idOrRef: string): Promise<Agent> {
    return this.requireService().get(idOrRef);
  }

  async create(params: CreateAgentParams): Promise<{ agent: Agent; warnings: ResolutionWarning[] }> {
    return this.requireService().create(params);
  }

  async update(
    id: string,
    params: UpdateAgentParams,
  ): Promise<{ agent: Agent; warnings: ResolutionWarning[] }> {
    return this.requireService().update(id, params);
  }

  /** Without `force` this rejects while the agent is still bound somewhere. */
  async delete(id: string, force = false): Promise<{ soft: boolean }> {
    return this.requireService().delete(id, force);
  }

  async usage(ref: string): Promise<AgentUsage> {
    return this.requireService().usage(ref);
  }

  async export(id: string): Promise<string> {
    return this.requireService().exportToMarkdown(id);
  }

  async import(
    markdown: string,
    options?: { scope?: 'global' | 'project'; projectId?: string; overwrite?: boolean },
  ): Promise<{ agent: Agent; warnings: ResolutionWarning[] }> {
    return this.requireService().importFromMarkdown(markdown, {
      scope: options?.scope ?? 'global',
      ...(options?.projectId ? { projectId: options.projectId } : {}),
      overwrite: options?.overwrite ?? false,
    });
  }

  /**
   * Effective capabilities for a binding: the UNION of the agent's own skills
   * and MCP servers with the additions, minus removals, with the tool-group
   * tri-state folded.
   *
   * NOTE: unlike the HTTP route this is NOT redacted — an in-process embedder
   * is already trusted with the MCP registry.
   */
  async resolve(input: {
    agentRef?: string;
    overrides?: AgentOverrides;
    projectId?: string;
    harnessType?: 'copilot' | 'claude-agent';
    scope?: 'chat' | 'stage' | 'worker';
  }): Promise<ResolvedAgentProjection> {
    if (!this.resolver) {
      throw new Error('Agents are not enabled: pass `agentResolver` to createCoreServices()');
    }
    return this.resolver.resolve({
      ...(input.agentRef ? { agentRef: input.agentRef } : {}),
      ...(input.overrides ? { overrides: input.overrides } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
      harnessType: input.harnessType ?? 'copilot',
      scope: input.scope ?? 'chat',
    });
  }
}

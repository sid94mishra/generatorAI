// ────────────────────────────────────────────────────────────────
// IAgentRepository — Port for Agent entity persistence
// ────────────────────────────────────────────────────────────────

import type { Agent, AgentRole, AgentScope } from '@generatorai/shared';

export interface AgentListFilter {
  scope?: AgentScope;
  /** '' matches system/global agents; a uuid matches one project. */
  projectId?: string;
  role?: AgentRole;
  enabledOnly?: boolean;
  /** Case-insensitive substring match on name / slug / description. */
  query?: string;
}

export interface AgentUsage {
  chats: Array<{ id: string; name: string }>;
  stages: Array<{ id: string; name: string; workflowDefinitionId: string }>;
  workflows: Array<{ id: string; name: string }>;
}

export interface IAgentRepository {
  create(agent: Agent): Promise<Agent>;
  getById(id: string): Promise<Agent>;
  /** Resolve by portable `scope:slug` ref. Returns null when unknown. */
  getByRef(ref: string): Promise<Agent | null>;
  list(filter?: AgentListFilter): Promise<Agent[]>;
  /** Applies the diff and bumps `version`. */
  update(id: string, updates: Partial<Agent>): Promise<Agent>;
  delete(id: string): Promise<void>;
  /** Where this agent is currently bound. Drives the delete-guard. */
  countUsage(ref: string): Promise<AgentUsage>;
}

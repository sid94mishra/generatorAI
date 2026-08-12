// ────────────────────────────────────────────────────────────────
// DrizzleAgentRepository — IAgentRepository impl (v26)
// ────────────────────────────────────────────────────────────────

import { and, eq, like, or, sql } from 'drizzle-orm';
import type { ZodTypeAny } from 'zod';
import type { IAgentRepository, AgentListFilter, AgentUsage } from '@generatorai/core';
import type { Agent, AgentRole, AgentScope } from '@generatorai/shared';
import { NotFoundError, StorageError, agentRef, parseAgentRef } from '@generatorai/shared';
import { agents, chats, stageDefinitions, workflowDefinitions } from '../schema.js';
import type { AppDatabase } from '../index.js';
import { safeJsonColumn } from '../utils/safeJsonColumn.js';
import { validateJsonColumn } from '../utils/validateJsonColumn.js';
import { jsonRecord, stringArray } from '../utils/jsonColumnSchemas.js';

/**
 * DB-03 — shared Zod guards for the JSON columns on `agents`, applied on both
 * the write (validateJsonColumn) and read (safeJsonColumn) paths.
 */
const agentJsonGuards: Record<string, ZodTypeAny> = {
  tags: stringArray,
  skillIds: stringArray,
  mcpServerIds: stringArray,
  tools: jsonRecord,
  runtime: jsonRecord,
  orchestration: jsonRecord,
};

export class DrizzleAgentRepository implements IAgentRepository {
  constructor(private db: AppDatabase) {}

  private validateAll(input: Partial<Agent>, only: boolean): void {
    for (const [key, schema] of Object.entries(agentJsonGuards)) {
      const value = (input as Record<string, unknown>)[key];
      if (only && value === undefined) continue;
      validateJsonColumn(value, schema, { column: key, table: 'agents' });
    }
  }

  async create(agent: Agent): Promise<Agent> {
    try {
      this.validateAll(agent, false);
      await this.db.insert(agents).values({
        id: agent.id,
        scope: agent.scope,
        projectId: agent.projectId ?? '',
        slug: agent.slug,
        name: agent.name,
        description: agent.description,
        instructions: agent.instructions,
        role: agent.role,
        projection: agent.projection,
        icon: agent.icon ?? null,
        color: agent.color ?? null,
        tags: agent.tags ?? [],
        enabled: agent.enabled,
        skillIds: agent.skillIds ?? [],
        mcpServerIds: agent.mcpServerIds ?? [],
        tools: agent.tools ?? {},
        runtime: agent.runtime ?? {},
        orchestration: agent.orchestration ?? null,
        version: agent.version,
        sourcePath: agent.sourcePath ?? null,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      });
      return agent;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE constraint failed')) {
        throw new StorageError(
          `An agent with slug '${agent.slug}' already exists in this scope`,
          err instanceof Error ? err : undefined,
        );
      }
      throw new StorageError(`Failed to create agent: ${msg}`, err instanceof Error ? err : undefined);
    }
  }

  async getById(id: string): Promise<Agent> {
    const rows = await this.db.select().from(agents).where(eq(agents.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Agent', id);
    return this.mapRow(row);
  }

  async getByRef(ref: string): Promise<Agent | null> {
    const parsed = parseAgentRef(ref);
    if (!parsed) return null;
    const rows = await this.db
      .select()
      .from(agents)
      .where(and(eq(agents.scope, parsed.scope), eq(agents.slug, parsed.slug)))
      .limit(2);
    // A project-scoped slug can repeat across projects; the caller narrows by
    // project when it needs to. Prefer a deterministic pick over throwing.
    const row = rows[0];
    return row ? this.mapRow(row) : null;
  }

  async list(filter?: AgentListFilter): Promise<Agent[]> {
    const conditions = [];
    if (filter?.scope) conditions.push(eq(agents.scope, filter.scope));
    if (filter?.projectId !== undefined) conditions.push(eq(agents.projectId, filter.projectId));
    if (filter?.role) conditions.push(eq(agents.role, filter.role));
    if (filter?.enabledOnly) conditions.push(eq(agents.enabled, true));
    if (filter?.query) {
      const q = `%${filter.query.toLowerCase()}%`;
      conditions.push(
        or(
          like(sql`lower(${agents.name})`, q),
          like(sql`lower(${agents.slug})`, q),
          like(sql`lower(${agents.description})`, q),
        )!,
      );
    }
    const rows = conditions.length
      ? await this.db.select().from(agents).where(and(...conditions)).orderBy(agents.name)
      : await this.db.select().from(agents).orderBy(agents.name);
    return rows.map((r) => this.mapRow(r));
  }

  async update(id: string, updates: Partial<Agent>): Promise<Agent> {
    const existing = await this.getById(id);
    this.validateAll(updates, true);

    const values: Record<string, unknown> = {};
    if (updates.slug !== undefined) values['slug'] = updates.slug;
    if (updates.name !== undefined) values['name'] = updates.name;
    if (updates.description !== undefined) values['description'] = updates.description;
    if (updates.instructions !== undefined) values['instructions'] = updates.instructions;
    if (updates.role !== undefined) values['role'] = updates.role;
    if (updates.projection !== undefined) values['projection'] = updates.projection;
    if (updates.icon !== undefined) values['icon'] = updates.icon ?? null;
    if (updates.color !== undefined) values['color'] = updates.color ?? null;
    if (updates.tags !== undefined) values['tags'] = updates.tags;
    if (updates.enabled !== undefined) values['enabled'] = updates.enabled;
    if (updates.skillIds !== undefined) values['skillIds'] = updates.skillIds;
    if (updates.mcpServerIds !== undefined) values['mcpServerIds'] = updates.mcpServerIds;
    if (updates.tools !== undefined) values['tools'] = updates.tools;
    if (updates.runtime !== undefined) values['runtime'] = updates.runtime;
    if (updates.orchestration !== undefined) values['orchestration'] = updates.orchestration ?? null;
    if (updates.scope !== undefined) values['scope'] = updates.scope;
    if (updates.projectId !== undefined) values['projectId'] = updates.projectId;
    if (updates.sourcePath !== undefined) values['sourcePath'] = updates.sourcePath ?? null;
    // Monotonic — the conversation binding key reads it to decide on a rebind.
    values['version'] = existing.version + 1;
    values['updatedAt'] = new Date();

    try {
      await this.db.update(agents).set(values).where(eq(agents.id, id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE constraint failed')) {
        throw new StorageError(
          `An agent with slug '${updates.slug ?? existing.slug}' already exists in this scope`,
          err instanceof Error ? err : undefined,
        );
      }
      throw new StorageError(`Failed to update agent: ${msg}`, err instanceof Error ? err : undefined);
    }
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(agents).where(eq(agents.id, id));
  }

  async countUsage(ref: string): Promise<AgentUsage> {
    const [chatRows, stageRows, workflowRows] = await Promise.all([
      this.db.select({ id: chats.id, name: chats.name }).from(chats).where(eq(chats.agentRef, ref)),
      this.db
        .select({
          id: stageDefinitions.id,
          name: stageDefinitions.name,
          workflowDefinitionId: stageDefinitions.workflowDefinitionId,
        })
        .from(stageDefinitions)
        .where(eq(stageDefinitions.agentRef, ref)),
      this.db
        .select({ id: workflowDefinitions.id, name: workflowDefinitions.name })
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.defaultAgentRef, ref)),
    ]);
    return { chats: chatRows, stages: stageRows, workflows: workflowRows };
  }

  private mapRow(row: typeof agents.$inferSelect): Agent {
    const scope = row.scope as AgentScope;
    return {
      id: row.id,
      scope,
      projectId: row.projectId ?? '',
      slug: row.slug,
      ref: agentRef(scope, row.slug),
      name: row.name,
      description: row.description,
      instructions: row.instructions,
      role: row.role as AgentRole,
      projection: row.projection as Agent['projection'],
      ...(row.icon ? { icon: row.icon } : {}),
      ...(row.color ? { color: row.color } : {}),
      tags: safeJsonColumn(row.tags, stringArray, { fallback: [] }) ?? [],
      enabled: row.enabled,
      skillIds: safeJsonColumn(row.skillIds, stringArray, { fallback: [] }) ?? [],
      mcpServerIds: safeJsonColumn(row.mcpServerIds, stringArray, { fallback: [] }) ?? [],
      tools: (safeJsonColumn(row.tools, jsonRecord, { fallback: {} }) ?? {}) as Agent['tools'],
      runtime: (safeJsonColumn(row.runtime, jsonRecord, { fallback: {} }) ?? {}) as Agent['runtime'],
      ...(row.orchestration
        ? {
            orchestration: safeJsonColumn(row.orchestration, jsonRecord, {
              fallback: undefined,
            }) as Agent['orchestration'],
          }
        : {}),
      version: row.version,
      ...(row.sourcePath ? { sourcePath: row.sourcePath } : {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

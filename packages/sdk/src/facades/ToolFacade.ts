// ────────────────────────────────────────────────────────────────
// ToolFacade — ai.tools.*
// ────────────────────────────────────────────────────────────────

import type { CoreServices, CustomToolRegistry, ToolDefinition as CoreToolDefinition } from '@generatorai/core';
import type { z } from 'zod';

export interface ToolConfig<TInput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  execute: (input: TInput) => Promise<unknown>;
}

export type ToolDefinition = CoreToolDefinition;

export class ToolFacade {
  private registry?: CustomToolRegistry;

  constructor(private services: CoreServices, registry?: CustomToolRegistry) {
    this.registry = registry;
  }

  /** Set the tool registry (late binding) */
  setRegistry(registry: CustomToolRegistry): void {
    this.registry = registry;
  }

  /** Register a custom tool */
  register(toolDef: ToolDefinition): void {
    if (!this.registry) throw new Error('Custom tool registry not initialized');
    this.registry.register(toolDef);
  }

  /** Unregister a tool */
  unregister(toolName: string): boolean {
    if (!this.registry) return false;
    return this.registry.unregister(toolName);
  }

  /** List registered tools */
  list(): ToolDefinition[] {
    if (!this.registry) return [];
    return this.registry.list();
  }

  /** Check if a tool is registered */
  has(toolName: string): boolean {
    if (!this.registry) return false;
    return this.registry.get(toolName) !== undefined;
  }
}

/** Helper to create a typed tool definition */
export function tool<TInput>(config: ToolConfig<TInput>): ToolDefinition {
  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    execute: config.execute as (input: unknown) => Promise<unknown>,
  } as unknown as ToolDefinition;
}

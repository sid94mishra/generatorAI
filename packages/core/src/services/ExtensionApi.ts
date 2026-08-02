// ────────────────────────────────────────────────────────────────
// ExtensionAPI — The `ai` handle passed to an extension's
// `loadExtension(ai)` factory. Each extension gets its own instance,
// bound to that extension's id/version/root. Registration methods
// stage contributions into an internal buffer; `ExtensionManager`
// commits them into the shared runtime registries after the factory
// resolves (transactional per extension).
//
// v2 authoring surface. See docs/EXTENSIONS_V2_PLAN.md §4.
// ────────────────────────────────────────────────────────────────

import { EventEmitter } from 'node:events';
import type {
  WidgetActionDef,
  WidgetPermission,
  WidgetSurface,
} from '@generatorai/shared';
import type { ILogger } from '@generatorai/shared';
import type { ToolDefinition } from '../domain/ports/IAgentHarness.js';

/** Staged widget descriptor input from `ai.registerWidget(...)`. */
export interface StagedWidgetInput {
  id: string;                                  // becomes `${extensionId}/${id}`
  title?: string;
  description?: string;
  entry: string;
  preferredSurface?: WidgetSurface;
  propsSchema?: Record<string, unknown>;
  stateSchema?: Record<string, unknown>;
  permissions?: WidgetPermission[];
  keywords?: string[];
  /** Typed action catalog the agent can invoke on a live instance. */
  actions?: WidgetActionDef[];
}

/** Staged tool input from `ai.registerTool(...)`. */
export interface StagedToolInput extends Omit<ToolDefinition, 'owner'> {
  /** v2: opt this tool into the always-active tier. Default `false`. */
  alwaysActive?: boolean;
  /** v2: one-liner appended to the "Available tools" section of the
   *  system prompt while this tool is active. */
  promptSnippet?: string;
  /** v2: bullets appended to the "Guidelines" section of the system
   *  prompt while this tool is active. */
  promptGuidelines?: string[];
}

/** Staged MCP server config from `ai.registerMcpServer(...)`. */
export interface StagedMcpServerInput {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  transport?: 'stdio' | 'http';
  url?: string;
  headers?: Record<string, string>;
}

/** Staged command from `ai.registerCommand(...)`. */
export interface StagedCommandInput {
  id: string;
  title?: string;
  description?: string;
  when?: string;
  category?: string;
  handler?: (args: string | undefined) => Promise<unknown> | unknown;
}

/** Staged hook from `ai.registerHook(...)`. */
export interface StagedHookInput {
  phase: string;
  type?: 'function' | 'script' | 'http';
  handler?: (event: unknown, ctx: unknown) => Promise<unknown> | unknown;
  command?: string;
  args?: string[];
  url?: string;
  priority?: number;
  timeoutMs?: number;
  failurePolicy?: 'continue' | 'abort' | 'skip_remaining';
}

/** Staged skill (markdown / file) from `ai.registerSkill(...)`. */
export interface StagedSkillInput {
  id: string;
  path: string;
  name?: string;
  description?: string;
}

/** Staged prompt template from `ai.registerPrompt(...)`. */
export interface StagedPromptInput {
  id: string;
  path: string;
  name?: string;
  description?: string;
}

/** A disposer returned by `loadExtension` — called on reload / uninstall. */
export type ExtensionDisposer = () => Promise<void> | void;

/** Aggregated, mutable staging bucket owned by one ExtensionAPI instance. */
export interface StagedContributions {
  widgets: StagedWidgetInput[];
  tools: StagedToolInput[];
  mcpServers: StagedMcpServerInput[];
  commands: StagedCommandInput[];
  hooks: StagedHookInput[];
  skills: StagedSkillInput[];
  prompts: StagedPromptInput[];
}

/**
 * The `ai` handle. Constructed by `ExtensionManager` and passed to the
 * extension's `loadExtension(ai)` factory. Contributions register
 * synchronously against `staged`; `ExtensionManager.commit()` reads
 * `staged` and pushes into the real registries.
 */
export class ExtensionAPI {
  /** Fully-qualified extension id (e.g. "acme.todo"). */
  readonly id: string;
  /** Semver from the manifest. */
  readonly version: string;
  /** Absolute path to the extension folder on disk. */
  readonly extensionDir: string;
  /** Contribution staging buffer — read by ExtensionManager after the
   *  factory resolves. */
  readonly staged: StagedContributions;
  /** Shared cross-extension event bus. */
  readonly events: EventEmitter;
  /** Per-extension logger prefixed with the extension id. */
  readonly log: ILogger;

  constructor(args: {
    id: string;
    version: string;
    extensionDir: string;
    logger: ILogger;
    events: EventEmitter;
  }) {
    this.id = args.id;
    this.version = args.version;
    this.extensionDir = args.extensionDir;
    this.events = args.events;
    this.staged = {
      widgets: [],
      tools: [],
      mcpServers: [],
      commands: [],
      hooks: [],
      skills: [],
      prompts: [],
    };
    // Prefer child() when available (Pino-backed) for structured logging,
    // otherwise fall back to prefixed messages.
    if (typeof args.logger.child === 'function') {
      this.log = args.logger.child({ extension: args.id });
    } else {
      const prefix = `[ext:${args.id}]`;
      this.log = {
        info: (msg, ctx) => args.logger.info(`${prefix} ${msg}`, ctx),
        warn: (msg, ctx) => args.logger.warn(`${prefix} ${msg}`, ctx),
        error: (msg, ctx) => args.logger.error(`${prefix} ${msg}`, ctx),
        debug: (msg, ctx) => args.logger.debug(`${prefix} ${msg}`, ctx),
        child: (b) => args.logger.child?.(b) ?? this.log,
      } as ILogger;
    }
  }

  // ── Registration methods (imperative) ─────────────────────────

  registerWidget(descriptor: StagedWidgetInput): void {
    if (!descriptor || typeof descriptor.id !== 'string' || !descriptor.id) {
      throw new Error(`[ext:${this.id}] registerWidget: id is required`);
    }
    // The final descriptor id is `${extensionId}/${id}` — so the component id
    // must be a bare segment. A `/` (or a leading namespace) would produce a
    // double-namespaced id like `user.foo/user.foo/bar`.
    if (descriptor.id.includes('/')) {
      throw new Error(
        `[ext:${this.id}] registerWidget(${descriptor.id}): id must be a bare component ` +
          `id without "/" — the extension namespace is added automatically.`,
      );
    }
    if (!descriptor.entry || typeof descriptor.entry !== 'string') {
      throw new Error(`[ext:${this.id}] registerWidget(${descriptor.id}): entry is required`);
    }
    if (descriptor.entry.includes('..')) {
      throw new Error(`[ext:${this.id}] registerWidget(${descriptor.id}): entry must be a safe relative path`);
    }
    this.staged.widgets.push(descriptor);
  }

  registerTool(definition: StagedToolInput): void {
    if (!definition || typeof definition.name !== 'string' || !definition.name) {
      throw new Error(`[ext:${this.id}] registerTool: name is required`);
    }
    // Copilot SDK constraint — tool names must match /^[a-zA-Z0-9_-]+$/
    if (!/^[a-zA-Z0-9_-]+$/.test(definition.name)) {
      throw new Error(
        `[ext:${this.id}] registerTool(${definition.name}): name must match /^[a-zA-Z0-9_-]+$/`,
      );
    }
    if (typeof definition.handler !== 'function') {
      throw new Error(`[ext:${this.id}] registerTool(${definition.name}): handler must be a function`);
    }
    this.staged.tools.push(definition);
  }

  registerMcpServer(config: StagedMcpServerInput): void {
    if (!config || typeof config.name !== 'string') {
      throw new Error(`[ext:${this.id}] registerMcpServer: name is required`);
    }
    this.staged.mcpServers.push(config);
  }

  registerCommand(id: string, options: Omit<StagedCommandInput, 'id'>): void {
    if (!id || typeof id !== 'string') {
      throw new Error(`[ext:${this.id}] registerCommand: id is required`);
    }
    this.staged.commands.push({ id, ...options });
  }

  registerHook(phase: string, handler: NonNullable<StagedHookInput['handler']>): void {
    if (!phase || typeof phase !== 'string') {
      throw new Error(`[ext:${this.id}] registerHook: phase is required`);
    }
    if (typeof handler !== 'function') {
      throw new Error(`[ext:${this.id}] registerHook(${phase}): handler must be a function`);
    }
    this.staged.hooks.push({ phase, type: 'function', handler });
  }

  registerSkill(spec: StagedSkillInput): void {
    if (!spec?.id || !spec?.path) {
      throw new Error(`[ext:${this.id}] registerSkill: id and path are required`);
    }
    this.staged.skills.push(spec);
  }

  registerPrompt(spec: StagedPromptInput): void {
    if (!spec?.id || !spec?.path) {
      throw new Error(`[ext:${this.id}] registerPrompt: id and path are required`);
    }
    this.staged.prompts.push(spec);
  }
}

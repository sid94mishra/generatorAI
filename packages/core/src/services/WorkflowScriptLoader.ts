// ────────────────────────────────────────────────────────────────
// WorkflowScriptLoader — Loads and validates .workflow.mjs scripts
//
// Responsibilities:
//   - Discover scripts from configured directories
//   - Dynamically import .workflow.mjs files via ESM import()
//   - Validate script output against Zod schemas
//   - Register inline hook functions in HookExecutor
//   - Cache loaded scripts for fast access
//   - Support hot-reload via cache-busting imports
// ────────────────────────────────────────────────────────────────

import { existsSync, realpathSync } from 'node:fs';
import { readdir, stat as fsStat, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  WorkflowScriptOutputSchema,
  ScriptRunProfileSchema,
} from '@generatorai/shared';
import type {
  WorkflowScriptOutput,
  WorkflowScriptExports,
  RunProfileConfig,
  IterationResolverContext,
  WorkflowHookHandler,
  StageHookHandler,
} from '@generatorai/shared';
import type { ILogger } from '@generatorai/shared';
import type { HookExecutor } from './HookExecutor.js';
import type { FunctionHookHandler } from './HookExecutor.js';

// ── Error Classes ──

export class ScriptLoadError extends Error {
  readonly scriptPath: string;
  constructor(message: string, opts: { cause?: unknown; scriptPath: string }) {
    super(message, { cause: opts.cause });
    this.name = 'ScriptLoadError';
    this.scriptPath = opts.scriptPath;
  }
}

export class ScriptValidationError extends Error {
  readonly scriptPath: string;
  readonly zodError?: unknown;
  constructor(message: string, opts: { scriptPath: string; zodError?: unknown }) {
    super(message);
    this.name = 'ScriptValidationError';
    this.scriptPath = opts.scriptPath;
    this.zodError = opts.zodError;
  }
}

export class ScriptTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptTimeoutError';
  }
}

export class ScriptSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScriptSecurityError';
  }
}

// ── Types ──

export interface ScriptMetadata {
  id: string;
  name: string;
  description?: string;
  filePath: string;
  lastModified: Date;
  variables: Array<{ name: string; type: string; label: string; required: boolean }>;
  stageCount: number;
  profileCount: number;
  tags: string[];
}

export interface LoadedScript {
  metadata: ScriptMetadata;
  output: WorkflowScriptOutput;
  profiles: RunProfileConfig[];
  resolveIterations?: (ctx: IterationResolverContext) => Promise<Record<string, unknown>[]>;
}

// ── Main Service ──

export class WorkflowScriptLoader {
  private loadedScripts = new Map<string, LoadedScript>();
  private readonly IMPORT_TIMEOUT_MS = 30_000;
  private hookUnregisters = new Map<string, () => void>();

  constructor(
    private readonly logger: ILogger,
    private readonly scriptDirs: string[],
    private readonly hookExecutor: HookExecutor,
  ) {}

  /**
   * Scan configured directories for .workflow.mjs files.
   * Called at boot (like TemplateRegistry) and on-demand for refresh.
   */
  async discoverScripts(): Promise<ScriptMetadata[]> {
    const metadata: ScriptMetadata[] = [];
    for (const dir of this.scriptDirs) {
      const resolved = resolve(dir);
      if (!existsSync(resolved)) {
        this.logger.debug(`[ScriptLoader] Directory does not exist, skipping: ${resolved}`);
        continue;
      }
      const files = await readdir(resolved);
      for (const file of files) {
        if (!file.endsWith('.workflow.mjs')) continue;
        try {
          const loaded = await this.loadScript(join(resolved, file));
          metadata.push(loaded.metadata);
        } catch (err) {
          this.logger.warn(`[ScriptLoader] Failed to load script: ${file}`, { err: String(err) });
        }
      }
    }
    this.logger.info(`[ScriptLoader] Discovered ${metadata.length} workflow script(s)`);
    return metadata;
  }

  /**
   * Dynamically import and validate a single .workflow.mjs script.
   */
  async loadScript(scriptPath: string): Promise<LoadedScript> {
    const resolvedPath = resolve(scriptPath);

    // 1. Security: Validate path is within allowed directories
    this.validateScriptPath(resolvedPath);

    // 2. Dynamic import with cache-busting for hot-reload support
    const fileUrl = pathToFileURL(resolvedPath).href;
    const importUrl = `${fileUrl}?t=${Date.now()}`;

    let moduleExports: Record<string, unknown>;
    const timeout = this.createTimeout(this.IMPORT_TIMEOUT_MS, resolvedPath);
    try {
      const imported = await Promise.race([
        import(importUrl),
        timeout.promise,
      ]);
      moduleExports = imported as Record<string, unknown>;
    } catch (err) {
      if (err instanceof ScriptTimeoutError) throw err;
      throw new ScriptLoadError(
        `Failed to import script: ${resolvedPath}`,
        { cause: err, scriptPath: resolvedPath },
      );
    } finally {
      timeout.cancel();
    }

    // 3. Resolve exports (handle default export pattern)
    const defaultExport = moduleExports['default'] as Record<string, unknown> | undefined;
    const workflow = (moduleExports['workflow'] ?? defaultExport?.['workflow']) as WorkflowScriptOutput | undefined;
    const profiles = (moduleExports['profiles'] ?? defaultExport?.['profiles'] ?? []) as RunProfileConfig[];
    const resolveIterations = (moduleExports['resolveIterations'] ?? defaultExport?.['resolveIterations']) as
      | ((ctx: IterationResolverContext) => Promise<Record<string, unknown>[]>)
      | undefined;

    if (!workflow) {
      throw new ScriptValidationError(
        'Script must export a "workflow" object (use WorkflowBuilder.build())',
        { scriptPath: resolvedPath },
      );
    }

    // 4. Validate workflow output against Zod schema (excluding inlineHooks which are functions)
    const dataForValidation = {
      id: workflow.id,
      definition: workflow.definition,
      stages: workflow.stages.map((s: { localId: string; config: unknown }) => ({
        localId: s.localId,
        config: s.config,
      })),
      edges: workflow.edges,
    };

    const parsed = WorkflowScriptOutputSchema.safeParse(dataForValidation);
    if (!parsed.success) {
      throw new ScriptValidationError(
        `Script output validation failed: ${parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        { scriptPath: resolvedPath, zodError: parsed.error },
      );
    }

    // 5. Validate profiles
    const validatedProfiles: RunProfileConfig[] = [];
    for (const profile of profiles) {
      const profileParsed = ScriptRunProfileSchema.safeParse(profile);
      if (!profileParsed.success) {
        this.logger.warn(
          `[ScriptLoader] Invalid profile '${profile?.name ?? 'unknown'}', skipping`,
          { scriptPath: resolvedPath, error: profileParsed.error.message },
        );
      } else {
        validatedProfiles.push(profileParsed.data as RunProfileConfig);
      }
    }

    // 6. Register inline hook functions
    if (workflow.inlineHooks) {
      for (const [hookId, handler] of workflow.inlineHooks) {
        const key = `script:${workflow.id}:${hookId}`;
        try {
          const unregister = this.hookExecutor.registerFunctionHandler(
            key,
              handler as unknown as FunctionHookHandler,
          );
          this.hookUnregisters.set(key, unregister);
          this.logger.debug(`[ScriptLoader] Registered inline hook: ${key}`);
        } catch {
          // Handler already registered (from a previous load) — skip
          this.logger.debug(`[ScriptLoader] Hook handler already registered, skipping: ${key}`);
        }
      }

      // Update hook configs with actual handler names
      for (const stage of workflow.stages) {
        if (stage.inlineHooks && stage.config.hooks) {
          for (const [hookId] of stage.inlineHooks) {
            const hookDef = stage.config.hooks.find((h: { id: string }) => h.id === hookId);
            if (hookDef && hookDef.config.type === 'function') {
              (hookDef.config as { handlerName?: string }).handlerName = `script:${workflow.id}:${hookId}`;
            }
          }
        }
      }
      // Update workflow-level hook configs
      if (workflow.definition.hooks) {
        for (const [hookId] of workflow.inlineHooks) {
          const hookDef = workflow.definition.hooks.find((h: { id: string }) => h.id === hookId);
          if (hookDef && hookDef.config.type === 'function') {
            (hookDef.config as { handlerName?: string }).handlerName = `script:${workflow.id}:${hookId}`;
          }
        }
      }
    }

    // 7. Build metadata and cache
    const fileStat = await fsStat(resolvedPath);
    const loaded: LoadedScript = {
      metadata: {
        id: workflow.id,
        name: workflow.definition.name,
        description: workflow.definition.description,
        filePath: resolvedPath,
        lastModified: fileStat.mtime,
        variables: workflow.definition.variables.map((v: { name: string; type: string; label: string; required: boolean }) => ({
          name: v.name,
          type: v.type,
          label: v.label,
          required: v.required,
        })),
        stageCount: workflow.stages.length,
        profileCount: validatedProfiles.length,
        tags: workflow.definition.tags,
      },
      output: workflow,
      profiles: validatedProfiles,
      resolveIterations,
    };

    this.loadedScripts.set(workflow.id, loaded);
    this.logger.info(
      `[ScriptLoader] Loaded workflow script: ${workflow.id}`,
      { stages: workflow.stages.length, profiles: validatedProfiles.length },
    );

    return loaded;
  }

  /** Get a previously loaded script by ID */
  getScript(id: string): LoadedScript | undefined {
    return this.loadedScripts.get(id);
  }

  /** Get all loaded scripts */
  getAllScripts(): LoadedScript[] {
    return Array.from(this.loadedScripts.values());
  }

  /** Get all script metadata (lightweight) */
  getAllMetadata(): ScriptMetadata[] {
    return Array.from(this.loadedScripts.values()).map(s => s.metadata);
  }

  /** Force reload a specific script (hot-reload) — safe: preserves old on failure */
  async reloadScript(id: string): Promise<LoadedScript> {
    const existing = this.loadedScripts.get(id);
    if (!existing) {
      throw new Error(`Script not found: ${id}`);
    }

    // Attempt to load new version FIRST, before removing old state
    let loaded: LoadedScript;
    try {
      loaded = await this.loadScript(existing.metadata.filePath);
    } catch (err) {
      // Preserve old version in cache — reload failed
      throw new ScriptLoadError(
        `Reload failed for script '${id}': ${(err as Error).message}. Previous version preserved.`,
        { cause: err, scriptPath: existing.metadata.filePath },
      );
    }

    // Success — now swap: unregister old hooks (new ones already registered by loadScript)
    this.unregisterScriptHooks(id);
    if (id !== loaded.metadata.id) {
      this.loadedScripts.delete(id);
    }
    return loaded;
  }

  /**
   * SCRIPT-1: Persist an uploaded `.workflow.mjs` source into the FIRST
   * configured script directory, then load it into the registry.
   *
   * SECURITY: scripts execute arbitrary JavaScript in-process with full server
   * privileges (dynamic `import()`), so this is effectively remote code
   * execution. The route layer MUST gate this behind an explicit operator
   * opt-in (env flag) — this method itself only enforces that the filename is a
   * safe, single-segment `*.workflow.mjs` and that the resolved path stays
   * within an allowed directory (defense-in-depth via validateScriptPath).
   *
   * @param filename desired file name (no path segments); must end in .workflow.mjs
   * @param source   the script source text
   * @returns the loaded script
   */
  async saveScript(filename: string, source: string): Promise<LoadedScript> {
    // Reject any path component — only a bare filename is allowed.
    const safeName = basename(filename);
    if (safeName !== filename || safeName.length === 0) {
      throw new ScriptSecurityError(`Invalid script filename (no path segments allowed): ${filename}`);
    }
    if (!safeName.endsWith('.workflow.mjs')) {
      throw new ScriptSecurityError(`Script filename must end with .workflow.mjs: ${safeName}`);
    }
    const targetDir = this.scriptDirs[0];
    if (!targetDir) {
      throw new ScriptLoadError('No script directory configured for uploads', { scriptPath: safeName });
    }
    const resolvedDir = resolve(targetDir);
    await mkdir(resolvedDir, { recursive: true });
    const targetPath = join(resolvedDir, safeName);
    // Defense-in-depth: ensure the final path is contained (also catches
    // symlinked script dirs pointing elsewhere).
    this.validateScriptPath(targetPath);
    await writeFile(targetPath, source, 'utf-8');
    this.logger.warn(
      `[ScriptLoader] Saved uploaded workflow script '${safeName}' to ${resolvedDir} (executes with server privileges)`,
    );
    return this.loadScript(targetPath);
  }

  /** Reload all scripts — safe: preserves old state on failure */
  async reloadAll(): Promise<ScriptMetadata[]> {
    // Attempt discovery first
    const newMetadata = await this.discoverScripts();
    // If discoverScripts succeeded, old state was already replaced during loading
    return newMetadata;
  }

  /** Validate a script path without loading it into the registry. */
  async validateScriptFile(scriptPath: string): Promise<{ valid: boolean; errors: string[] }> {
    try {
      const resolvedPath = resolve(scriptPath);

      // Security: Validate path is within allowed directories
      this.validateScriptPath(resolvedPath);

      // Temporarily load without registering hooks
      const fileUrl = pathToFileURL(resolvedPath).href;
      const importUrl = `${fileUrl}?t=${Date.now()}`;

      const timeout = this.createTimeout(this.IMPORT_TIMEOUT_MS, resolvedPath);
      let imported: Record<string, unknown>;
      try {
        imported = await Promise.race([
          import(importUrl),
          timeout.promise,
        ]) as Record<string, unknown>;
      } finally {
        timeout.cancel();
      }
      const moduleExports = imported;

      // Handle both export patterns: named export and default export
      const defaultExport = moduleExports['default'] as Record<string, unknown> | undefined;
      const workflow = (moduleExports['workflow'] ?? defaultExport?.['workflow']) as WorkflowScriptOutput | undefined;
      if (!workflow) {
        return { valid: false, errors: ['Script must export a "workflow" object (named export or default.workflow)'] };
      }

      const dataForValidation = {
        id: workflow.id,
        definition: workflow.definition,
        stages: workflow.stages.map((s: { localId: string; config: unknown }) => ({ localId: s.localId, config: s.config })),
        edges: workflow.edges,
      };

      const parsed = WorkflowScriptOutputSchema.safeParse(dataForValidation);
      if (!parsed.success) {
        return {
          valid: false,
          errors: parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => `${i.path.join('.')}: ${i.message}`),
        };
      }

      return { valid: true, errors: [] };
    } catch (err) {
      return {
        valid: false,
        errors: [(err as Error).message],
      };
    }
  }

  // ─── Private Helpers ───

  private validateScriptPath(scriptPath: string): void {
    // Resolve symlinks (realpath) before the containment check so a symlink
    // *inside* an allowed dir that points outside cannot smuggle an arbitrary
    // file past the textual check. Falls back to a plain resolve() when the
    // target doesn't exist yet (a non-existent path can't be a symlink escape;
    // the subsequent import() would fail anyway).
    const resolved = this.realpathOrResolve(scriptPath);
    const isAllowed = this.scriptDirs.some(dir => {
      const resolvedDir = this.realpathOrResolve(dir);
      const rel = relative(resolvedDir, resolved);
      // Block: parent traversal, absolute paths, and Windows cross-drive paths (e.g. D:\...)
      return !rel.startsWith('..') && !rel.startsWith(resolve('/')) && !/^[A-Za-z]:/.test(rel);
    });
    if (!isAllowed) {
      throw new ScriptSecurityError(
        `Script path not within allowed directories: ${scriptPath}. Allowed: ${this.scriptDirs.join(', ')}`,
      );
    }
  }

  /** realpathSync (resolving symlinks), falling back to resolve() when the path
   *  does not exist on disk. */
  private realpathOrResolve(p: string): string {
    try {
      return realpathSync(resolve(p));
    } catch {
      return resolve(p);
    }
  }

  private createTimeout(ms: number, scriptPath: string): { promise: Promise<never>; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout>;
    const promise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ScriptTimeoutError(`Script import exceeded ${ms}ms timeout: ${scriptPath}`)),
        ms,
      );
    });
    return { promise, cancel: () => clearTimeout(timer!) };
  }

  private unregisterScriptHooks(scriptId: string): void {
    const script = this.loadedScripts.get(scriptId);
    if (!script?.output.inlineHooks) return;

    for (const [hookId] of script.output.inlineHooks) {
      const key = `script:${scriptId}:${hookId}`;
      const unregister = this.hookUnregisters.get(key);
      if (unregister) {
        unregister();
        this.hookUnregisters.delete(key);
      }
    }
  }
}

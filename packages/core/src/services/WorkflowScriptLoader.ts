// ────────────────────────────────────────────────────────────────
// WorkflowScriptLoader — Loads and validates .workflow.mjs scripts
//
// A script is an authoring-time builder (PD-16): its default export (or
// named `workflow` export) is a `WorkflowBuilder` from
// `@generatorai/workflow-spec/builders` or a plain `WorkflowGraph`
// document, and an optional `profiles` export holds run profiles. The
// loader builds it with `buildWithHandlers()` (validating the graph with
// the one validator), registers the inline hook handlers with the
// HookExecutor, and caches the graph; `WorkflowDefinitionService.createFromSpec`
// materializes it like any other document.
//
// Responsibilities:
//   - Discover scripts from configured directories
//   - Dynamically import .workflow.mjs files via ESM import()
//   - Build and validate the graph, validate the profiles
//   - Register inline hook functions in HookExecutor
//   - Cache loaded scripts for fast access
//   - Support hot-reload via cache-busting imports
// ────────────────────────────────────────────────────────────────

import { existsSync, realpathSync } from 'node:fs';
import { readdir, rm, stat as fsStat, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ENGINE_LEVEL,
  ScriptRunProfileSchema,
  validateWorkflow,
  type ScriptRunProfile,
  type WorkflowGraph,
} from '@generatorai/workflow-spec';
import type { ILogger } from '@generatorai/shared';
import { writeFileAtomicRestricted } from '@generatorai/shared/node';
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
  /** The validated graph the script builds. */
  graph: WorkflowGraph;
  profiles: ScriptRunProfile[];
  /** Names of the inline hook handlers this script registered. */
  handlerNames: string[];
}

/** A builder from `@generatorai/workflow-spec/builders` (duck-typed: a script may import its own copy). */
interface GraphBuilder {
  buildWithHandlers(opts?: { engine?: 'v1' | 'v2' }): { graph: WorkflowGraph; handlers: Map<string, (ctx: never) => unknown> };
}

const isBuilder = (v: unknown): v is GraphBuilder =>
  !!v && typeof (v as { buildWithHandlers?: unknown }).buildWithHandlers === 'function';

/** Script id: the file name without `.workflow.mjs`. */
export function scriptIdOf(scriptPath: string): string {
  return basename(scriptPath).replace(/\.workflow\.mjs$/, '');
}

// ── Main Service ──

export interface WorkflowScriptLoaderOptions {
  /**
   * Master switch. When false (the default) NOTHING is imported: the boot
   * scan reports what it found and skips it, and every load/validate/save
   * call throws `ScriptSecurityError` so the caller sees a clear refusal
   * instead of silently getting an empty registry.
   */
  enabled?: boolean;
}

/** The message every gated path surfaces, so operators know which knob to turn. */
export const WORKFLOW_SCRIPTS_DISABLED_MESSAGE =
  'Workflow scripts are disabled. `.workflow.mjs` files execute in-process with the ' +
  "server's full privileges; set GENERATORAI_ALLOW_WORKFLOW_SCRIPTS=true " +
  '(config `scripts.workflowScriptsEnabled`) on a trusted deployment to enable them.';

export class WorkflowScriptLoader {
  private loadedScripts = new Map<string, LoadedScript>();
  private readonly IMPORT_TIMEOUT_MS = 30_000;
  private hookUnregisters = new Map<string, () => void>();
  private readonly enabled: boolean;

  constructor(
    private readonly logger: ILogger,
    private readonly scriptDirs: string[],
    private readonly hookExecutor: HookExecutor,
    options?: WorkflowScriptLoaderOptions,
  ) {
    this.enabled = options?.enabled ?? false;
  }

  /** Whether scripts may be loaded at all (operator opt-in). */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * The gate every code path that would `import()` a script goes through.
   * Kept in the loader — not the route layer — so the boot-time scan and
   * every route (reload, reload one, validate, upload) are refused together.
   */
  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ScriptSecurityError(WORKFLOW_SCRIPTS_DISABLED_MESSAGE);
    }
  }

  /**
   * Scan configured directories for .workflow.mjs files.
   * Called at boot (like TemplateRegistry) and on-demand for refresh.
   */
  async discoverScripts(): Promise<ScriptMetadata[]> {
    const metadata: ScriptMetadata[] = [];
    await this.shippedScriptNames();
    if (!this.enabled) {
      // Count what WOULD have loaded so the operator can tell "no scripts
      // present" from "scripts present but refused".
      let found = 0;
      for (const dir of this.scriptDirs) {
        const resolved = resolve(dir);
        if (!existsSync(resolved)) continue;
        try {
          found += (await readdir(resolved)).filter((f) => f.endsWith('.workflow.mjs')).length;
        } catch { /* unreadable dir — nothing to count */ }
      }
      if (found > 0) {
        this.logger.warn(
          `[ScriptLoader] ${found} workflow script(s) found but NOT loaded — ${WORKFLOW_SCRIPTS_DISABLED_MESSAGE}`,
        );
      } else {
        this.logger.info('[ScriptLoader] Workflow scripts disabled (no .workflow.mjs files present either)');
      }
      return metadata;
    }
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
    // 0. Security: operator opt-in — refused loudly, never silently.
    this.assertEnabled();
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

    // 3. Build the graph: the default (or named `workflow`) export.
    const { graph, handlers } = this.buildScriptGraph(moduleExports, resolvedPath);
    const id = scriptIdOf(resolvedPath);

    // 4. Validate profiles
    const rawProfiles = moduleExports['profiles'];
    const validatedProfiles: ScriptRunProfile[] = [];
    for (const profile of Array.isArray(rawProfiles) ? rawProfiles : []) {
      const profileParsed = ScriptRunProfileSchema.safeParse(profile);
      if (!profileParsed.success) {
        this.logger.warn(
          `[ScriptLoader] Invalid profile '${(profile as { name?: string })?.name ?? 'unknown'}', skipping`,
          { scriptPath: resolvedPath, error: profileParsed.error.message },
        );
      } else {
        validatedProfiles.push(profileParsed.data);
      }
    }

    // 5. Register inline hook functions under the names the builder generated.
    this.unregisterScriptHooks(id);
    for (const [name, handler] of handlers) {
      try {
        const unregister = this.hookExecutor.registerFunctionHandler(name, handler as unknown as FunctionHookHandler);
        this.hookUnregisters.set(name, unregister);
        this.logger.debug(`[ScriptLoader] Registered inline hook: ${name}`);
      } catch {
        this.logger.debug(`[ScriptLoader] Hook handler already registered, skipping: ${name}`);
      }
    }

    // 6. Build metadata and cache
    const fileStat = await fsStat(resolvedPath);
    const loaded: LoadedScript = {
      metadata: {
        id,
        name: graph.workflow.name,
        description: graph.workflow.description,
        filePath: resolvedPath,
        lastModified: fileStat.mtime,
        variables: graph.workflow.variables.map((v) => ({
          name: v.name,
          type: v.type,
          label: v.label,
          required: v.required,
        })),
        stageCount: graph.stages.length,
        profileCount: validatedProfiles.length,
        tags: graph.workflow.tags,
      },
      graph,
      profiles: validatedProfiles,
      handlerNames: [...handlers.keys()],
    };

    this.loadedScripts.set(id, loaded);
    this.logger.info(`[ScriptLoader] Loaded workflow script: ${id}`, {
      stages: graph.stages.length,
      profiles: validatedProfiles.length,
    });

    return loaded;
  }

  /**
   * The graph a script's module builds: a builder's `buildWithHandlers()`,
   * or a plain document through the validator. Throws ScriptValidationError
   * with the validator's issues.
   */
  private buildScriptGraph(
    moduleExports: Record<string, unknown>,
    scriptPath: string,
  ): { graph: WorkflowGraph; handlers: Map<string, (ctx: never) => unknown> } {
    const exported = moduleExports['default'] ?? moduleExports['workflow'];
    if (!exported) {
      throw new ScriptValidationError(
        'Script must export a workflow builder (or a WorkflowGraph) as its default or `workflow` export',
        { scriptPath },
      );
    }
    if (isBuilder(exported)) {
      try {
        return exported.buildWithHandlers({ engine: ENGINE_LEVEL });
      } catch (err) {
        throw new ScriptValidationError(`Script workflow is invalid: ${(err as Error).message}`, { scriptPath, zodError: err });
      }
    }
    const result = validateWorkflow(exported, { engine: ENGINE_LEVEL });
    if (!result.valid || !result.graph) {
      throw new ScriptValidationError(
        `Script workflow is invalid: ${result.issues
          .filter((i) => i.severity === 'error')
          .map((i) => `${i.path || '/'}: ${i.message}`)
          .join('; ')}`,
        { scriptPath, zodError: result.issues },
      );
    }
    return { graph: result.graph, handlers: new Map() };
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

    // Success — loadScript already swapped the old hooks for the new ones.
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
   * execution. The loader itself enforces the operator opt-in
   * (`assertEnabled`, config `scripts.workflowScriptsEnabled`) — the upload
   * route's own check is defense-in-depth, not the gate. This method also
   * enforces that the filename is a safe, single-segment `*.workflow.mjs` and
   * that the resolved path stays within an allowed directory.
   *
   * @param filename desired file name (no path segments); must end in .workflow.mjs
   * @param source   the script source text
   * @returns the loaded script
   */
  async saveScript(filename: string, source: string): Promise<LoadedScript> {
    this.assertEnabled();
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
    // A shipped script is part of the install, never replaced by an upload (A-19).
    if ((await this.shippedScriptNames()).has(safeName)) {
      throw new ScriptSecurityError(`'${safeName}' is a shipped script and cannot be replaced by an upload`);
    }
    // Validate BEFORE the script takes its name: write it under a staging name
    // (not `*.workflow.mjs`, so discovery never sees it), import and build it,
    // and only then move it into place atomically. An invalid upload never
    // replaces a working script, not even for a moment.
    const stagingPath = join(resolvedDir, `.upload-${process.pid}-${Date.now()}.mjs`);
    await writeFile(stagingPath, source, 'utf-8');
    try {
      const check = await this.validateScriptFile(stagingPath);
      if (!check.valid) {
        throw new ScriptValidationError(`Uploaded script is invalid: ${check.errors.join('; ')}`, { scriptPath: safeName });
      }
      writeFileAtomicRestricted(targetPath, source);
    } finally {
      await rm(stagingPath, { force: true });
    }
    this.logger.warn(
      `[ScriptLoader] Saved uploaded workflow script '${safeName}' to ${resolvedDir} (executes with server privileges)`,
    );
    return this.loadScript(targetPath);
  }

  /** `*.workflow.mjs` names present in the first script directory when the loader first looked (the shipped set). */
  private shippedNames?: Set<string>;

  private async shippedScriptNames(): Promise<Set<string>> {
    if (!this.shippedNames) {
      const dir = this.scriptDirs[0] ? resolve(this.scriptDirs[0]) : undefined;
      const files = dir && existsSync(dir) ? await readdir(dir) : [];
      this.shippedNames = new Set(files.filter((f) => f.endsWith('.workflow.mjs')));
    }
    return this.shippedNames;
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
    // Validation imports the module too (it has to, to read its exports), so
    // it is gated exactly like a load — the error is thrown, not folded into
    // `errors`, so the route can answer 403 rather than "invalid script".
    this.assertEnabled();
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

      this.buildScriptGraph(moduleExports, resolvedPath);
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
    for (const name of script?.handlerNames ?? []) {
      const unregister = this.hookUnregisters.get(name);
      if (unregister) {
        unregister();
        this.hookUnregisters.delete(name);
      }
    }
  }
}

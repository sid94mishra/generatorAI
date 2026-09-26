// ────────────────────────────────────────────────────────────────
// ExtensionManager — Discovers, validates, and activates GeneratorAI
// extensions from three scopes (system / user / workspace).
//
// Each extension is a directory containing an `extension.json` manifest.
// On boot (or reload) the manager:
//   1. Scans the three roots for extensions.
//   2. Validates each manifest with Zod.
//   3. Resolves conflicts by scope precedence (workspace > user > system).
//   4. Registers contributed widgets/tools/mcp servers/hooks/etc.
//   5. Emits `extension.installed` / `extension.reloaded` events.
//
// V1 does NOT execute untrusted server-side code (`tools[].module` /
// `hooks[].module`) inside a sandbox — modules are dynamically imported
// in-process. Set `SANDBOX_ENABLED=true` to require a Docker sandbox for
// hook scripts (existing plumbing) — see docs plan §8.3.
// ────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import { existsSync, statSync } from 'node:fs';
import { resolve, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  ExtensionManifest,
  ExtensionScope,
  ILogger,
  InstallExtensionParams,
  InstalledExtension,
  WidgetDescriptor,
} from '@generatorai/shared';
import { normalizeWidgetSurface, DEFAULT_WIDGET_SURFACE } from '@generatorai/shared';
import { ExtensionManifestSchema } from '@generatorai/shared';
import type { IExtensionRegistry } from '../domain/ports/IExtensionRegistry.js';
import type { IWidgetRegistry } from '../domain/ports/IWidgetRegistry.js';
import type { CustomToolRegistry } from '../tools/CustomToolRegistry.js';
import type { EventBus } from '../events/EventBus.js';
import type { ToolDefinition } from '../domain/ports/IAgentHarness.js';
import type { HookResult } from '@generatorai/shared';
import { STAGE_HOOK_PHASES, type StageHookPhase } from '@generatorai/workflow-spec';
import type { SessionHookRegistry } from './SessionHookRegistry.js';
import { ExtensionAPI, type ExtensionDisposer, type StagedContributions } from './ExtensionApi.js';

/**
 * Root directories to scan. First match wins per extension id.
 * Extension state is refreshed on every `reload()` — no need to restart the
 * server to install a new extension via CLI or by dropping files on disk.
 */
export interface ExtensionManagerConfig {
  /**
   * Absolute path to `<templatesDir>/system/extensions`. Read-only.
   * Missing directory is not an error.
   */
  systemDir?: string;
  /** Absolute path to `<GENERATORAI_EXTENSIONS_DIR>` (default `~/.generatorai/extensions`). */
  userDir: string;
  /**
   * Resolver that returns the absolute path to `<workspaceDir>/.generatorai/extensions`
   * for a given workspace id. Undefined return skips workspace scope for that id.
   * When omitted, workspace-scope extensions are not scanned globally at boot —
   * they load lazily whenever a workspace-scoped API is called.
   */
  resolveWorkspaceDir?: (workspaceId: string) => string | undefined;
  /** Enable dev logging for load failures. */
  logger?: ILogger;
}

export interface ExtensionManagerDeps {
  widgetRegistry: IWidgetRegistry;
  customToolRegistry: CustomToolRegistry;
  eventBus: EventBus;
  /**
   * Where in-process hooks (`ai.registerHook(phase, fn)`) land. Every agent
   * session (chat or stage) runs them through its hook bridge (W-54).
   */
  sessionHookRegistry?: SessionHookRegistry;
}

const MANIFEST_FILE = 'extension.json';

/** Hot reloads of one extension entry per process before we refuse (A14). */
const MAX_ENTRY_HOT_RELOADS = 100;
/** Warn every N reloads so the retained-module cost is visible before the cap. */
const HOT_RELOAD_WARN_EVERY = 25;

export class ExtensionManager implements IExtensionRegistry {
  /** Loaded entry modules by extension id — see `entryModuleVersion`. */
  private readonly entryModules = new Map<string, { entryAbs: string; mtimeMs: number; url: string; reloads: number }>();

  private readonly installed = new Map<string, InstalledExtension>();
  private readonly logger: ILogger | undefined;
  /** Disposers returned by extension `loadExtension()` factories. Called
   *  on reload / uninstall to let the extension clean up watchers, timers,
   *  cross-extension listeners, etc. */
  private readonly disposers = new Map<string, ExtensionDisposer>();
  /** Shared event bus passed to every ExtensionAPI so extensions can talk
   *  to each other via `ai.events.on(...) / .emit(...)`. */
  private readonly sharedEvents = new EventEmitter();

  constructor(
    private readonly cfg: ExtensionManagerConfig,
    private readonly deps: ExtensionManagerDeps,
  ) {
    this.logger = cfg.logger;
  }

  // ── IExtensionRegistry ──────────────────────────────────────

  list(): InstalledExtension[] {
    return Array.from(this.installed.values());
  }

  get(id: string): InstalledExtension | undefined {
    return this.installed.get(id);
  }

  isEnabled(id: string): boolean {
    const ext = this.installed.get(id);
    return !!ext && ext.enabled && ext.ready;
  }

  resolveRoot(id: string): string | undefined {
    return this.installed.get(id)?.rootPath;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const ext = this.installed.get(id);
    if (!ext) throw new Error(`Extension not installed: ${id}`);
    if (ext.enabled === enabled) return;
    if (enabled) {
      await this.activate(ext);
      ext.enabled = true;
    } else {
      await this.deactivate(ext);
      ext.enabled = false;
    }
  }

  /**
   * Scan every configured scope and reload every extension.
   * Safe to call at boot and on manual reload endpoints. Failures for a
   * single extension are logged and stored on the record's `errors` list —
   * they never abort the scan.
   */
  async reload(): Promise<void> {
    for (const ext of this.installed.values()) {
      await this.deactivate(ext);
    }
    this.installed.clear();

    // Scan in precedence order — later scans DO NOT replace earlier ones
    // (workspace > user > system means we scan workspace last so it wins).
    if (this.cfg.systemDir) await this.scanDirectory(this.cfg.systemDir, 'system');
    await this.scanDirectory(this.cfg.userDir, 'user');
    // Workspace-scope scans happen lazily via `installFromWorkspaceDir`.
  }

  /** Scan an on-disk root and register every valid extension we find. */
  private async scanDirectory(root: string, scope: ExtensionScope): Promise<void> {
    if (!existsSync(root)) return;
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch (err) {
      this.logger?.warn?.(`[ExtensionManager] readdir failed for ${root}: ${String(err)}`);
      return;
    }

    for (const entry of entries) {
      // Skip files, dotfiles, and node_modules-like scaffolding.
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const dir = resolve(root, entry);
      let stat;
      try {
        stat = await fs.stat(dir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      await this.tryLoadFromDir(dir, scope).catch((err) => {
        this.logger?.warn?.(`[ExtensionManager] failed to load ${dir}: ${String(err)}`);
      });
    }
  }

  /** Load a single extension directory. Duplicates keep the higher-precedence copy. */
  private async tryLoadFromDir(dir: string, scope: ExtensionScope): Promise<InstalledExtension | null> {
    const manifestPath = resolve(dir, MANIFEST_FILE);
    if (!existsSync(manifestPath)) return null;
    const raw = await fs.readFile(manifestPath, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.logger?.warn?.(`[ExtensionManager] invalid JSON in ${manifestPath}: ${String(err)}`);
      return null;
    }
    const result = ExtensionManifestSchema.safeParse(parsed);
    if (!result.success) {
      this.logger?.warn?.(
        `[ExtensionManager] manifest validation failed for ${manifestPath}: ${result.error.message}`,
      );
      return null;
    }
    const manifest = result.data as ExtensionManifest;

    // Precedence check — workspace beats user beats system. Within one scope
    // the higher version wins: installs go to `<id>@<version>` directories, so
    // ranking by scope alone let a reload resurrect whichever directory name
    // sorted first — usually the oldest, superseded copy.
    const prior = this.installed.get(manifest.id);
    if (prior) {
      const priorRank = rank(prior.scope);
      const thisRank = rank(scope);
      const keepPrior =
        priorRank > thisRank ||
        (priorRank === thisRank &&
          compareVersions(prior.manifest.version, manifest.version) >= 0);
      if (keepPrior) {
        this.logger?.info?.(
          `[ExtensionManager] skipped ${manifest.id}@${manifest.version} (${scope}) — ${prior.manifest.id}@${prior.manifest.version} (${prior.scope}) already loaded`,
        );
        return null;
      }
      await this.deactivate(prior);
      this.installed.delete(prior.manifest.id);
    }

    const record: InstalledExtension = {
      manifest,
      scope,
      rootPath: dir,
      enabled: true,
      loadedAt: new Date().toISOString(),
      ready: false,
    };

    await this.activate(record).catch((err) => {
      record.errors = [...(record.errors ?? []), `activate failed: ${String(err)}`];
      this.logger?.warn?.(`[ExtensionManager] activate failed for ${manifest.id}: ${String(err)}`);
    });

    this.installed.set(manifest.id, record);
    return record;
  }

  /** Register contributions with the runtime registries. */
  private async activate(ext: InstalledExtension): Promise<void> {
    // The entry file's `loadExtension(ai)` factory stages contributions;
    // `commitStagedContributions` flushes them into the runtime registries
    // transactionally. On error the entry-file's contributions do NOT
    // commit (transactional per extension).
    if (typeof ext.manifest.entry === 'string' && ext.manifest.entry.trim()) {
      await this.activateEntryFile(ext);
    } else {
      ext.errors = [...(ext.errors ?? []), 'manifest is missing a required `entry` field'];
    }

    ext.ready = true;
    ext.errors = ext.errors ?? undefined;

    await this.deps.eventBus.emit('__global__', {
      kind: 'extension.installed',
      data: {
        id: ext.manifest.id,
        version: ext.manifest.version,
        scope: ext.scope,
      },
    }).catch(() => undefined);
  }

  /**
   * v2 entry-file activation. Runs the `loadExtension(ai)` factory and
   * commits the staged contributions into the runtime registries.
   * Failures leave no residue.
   */
  /**
   * Module URL for an extension's entry file, keyed on the file's mtime so
   * re-activating an unchanged file reuses the already-loaded module. Returns
   * `undefined` once the reload cap is reached — see `activateEntryFile`.
   */
  private entryModuleVersion(
    extensionId: string,
    entryAbs: string,
  ): { url: string; reloads: number } | undefined {
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(entryAbs).mtimeMs;
    } catch {
      mtimeMs = Date.now();
    }
    const prev = this.entryModules.get(extensionId);
    if (prev && prev.mtimeMs === mtimeMs && prev.entryAbs === entryAbs) return { url: prev.url, reloads: prev.reloads };
    const reloads = prev ? prev.reloads + 1 : 0;
    if (reloads >= MAX_ENTRY_HOT_RELOADS) {
      this.logger?.warn?.(
        `[ExtensionManager] ${extensionId} reached the hot-reload cap (${MAX_ENTRY_HOT_RELOADS}); refusing further reloads until restart`,
      );
      return undefined;
    }
    if (reloads > 0 && reloads % HOT_RELOAD_WARN_EVERY === 0) {
      this.logger?.warn?.(
        `[ExtensionManager] ${extensionId} hot-reloaded ${reloads} times; each reload retains the previous module until the server restarts`,
      );
    }
    const url = pathToFileURL(entryAbs).href + `?v=${Math.round(mtimeMs)}`;
    this.entryModules.set(extensionId, { entryAbs, mtimeMs, url, reloads });
    return { url, reloads };
  }

  private async activateEntryFile(ext: InstalledExtension): Promise<void> {
    const entryRel = ext.manifest.entry!;
    const entryAbs = safeResolveInside(ext.rootPath, entryRel);
    if (!entryAbs) {
      ext.errors = [...(ext.errors ?? []), `entry path escapes extension root: ${entryRel}`];
      return;
    }
    if (!existsSync(entryAbs)) {
      ext.errors = [...(ext.errors ?? []), `entry file not found: ${entryRel}`];
      return;
    }

    // ESM modules are never unloaded. Cache-busting with `Date.now()` meant
    // EVERY activation — including re-activating an unchanged file after a
    // settings save or a restart of the extension — imported a fresh copy
    // that lived for the life of the server. Key the module URL on the entry
    // file's mtime instead: an unchanged file reuses its module, a changed
    // one gets exactly one new instance. Count those, because a developer
    // saving a file in a loop can still grow the module cache without bound;
    // past the cap the operator is told to restart rather than silently
    // leaking.
    const entryVersion = this.entryModuleVersion(ext.manifest.id, entryAbs);
    if (!entryVersion) {
      ext.errors = [
        ...(ext.errors ?? []),
        `entry ${entryRel} has been hot-reloaded ${MAX_ENTRY_HOT_RELOADS} times in this process; ` +
          'each reload keeps the previous module in memory — restart the server to continue reloading',
      ];
      return;
    }
    const url = entryVersion.url;
    let mod: Record<string, unknown>;
    try {
      mod = (await import(url)) as Record<string, unknown>;
    } catch (err) {
      ext.errors = [
        ...(ext.errors ?? []),
        `entry import failed: ${err instanceof Error ? err.message : String(err)}`,
      ];
      this.logger?.warn?.(`[ExtensionManager] entry import failed for ${ext.manifest.id}: ${String(err)}`);
      return;
    }

    const factory =
      (mod['loadExtension'] as ((ai: ExtensionAPI) => unknown) | undefined) ??
      (mod['default'] as ((ai: ExtensionAPI) => unknown) | undefined);
    if (typeof factory !== 'function') {
      ext.errors = [
        ...(ext.errors ?? []),
        `entry ${entryRel} must export a default function (or named loadExtension) that takes (ai)`,
      ];
      return;
    }

    const ai = new ExtensionAPI({
      id: ext.manifest.id,
      version: ext.manifest.version,
      extensionDir: ext.rootPath,
      logger: this.logger ?? consoleLogger,
      events: this.sharedEvents,
    });

    let disposer: unknown;
    try {
      disposer = await Promise.resolve(factory(ai));
    } catch (err) {
      ext.errors = [
        ...(ext.errors ?? []),
        `loadExtension threw: ${err instanceof Error ? err.message : String(err)}`,
      ];
      this.logger?.warn?.(`[ExtensionManager] loadExtension threw for ${ext.manifest.id}: ${String(err)}`);
      return;
    }

    // Commit staged contributions transactionally. Failures during commit
    // roll back everything staged for this extension.
    try {
      this.commitStagedContributions(ext, ai.staged);
      if (typeof disposer === 'function') {
        this.disposers.set(ext.manifest.id, disposer as ExtensionDisposer);
      }
    } catch (err) {
      // Roll back anything we may have partially added.
      this.rollbackStagedContributions(ext);
      ext.errors = [
        ...(ext.errors ?? []),
        `commit failed: ${err instanceof Error ? err.message : String(err)}`,
      ];
    }
  }

  private commitStagedContributions(
    ext: InstalledExtension,
    staged: StagedContributions,
  ): void {
    const { widgetRegistry, customToolRegistry } = this.deps;

    // Widgets
    for (const w of staged.widgets) {
      const descriptor: WidgetDescriptor = {
        id: `${ext.manifest.id}/${w.id}`,
        extensionId: ext.manifest.id,
        component: w.id,
        title: w.title ?? w.id,
        description: w.description,
        preferredSurface: normalizeWidgetSurface(w.preferredSurface ?? DEFAULT_WIDGET_SURFACE),
        entry: w.entry,
        propsSchema: w.propsSchema,
        stateSchema: w.stateSchema,
        permissions: w.permissions ?? [],
        keywords: w.keywords,
        actions: w.actions,
      };
      // De-dup in case the same id was already registered.
      if (widgetRegistry.get(descriptor.id)) widgetRegistry.unregister(descriptor.id);
      widgetRegistry.register(descriptor);
    }

    // Tools
    for (const t of staged.tools) {
      const finalDef: ToolDefinition = {
        name: t.name,
        description: t.description ?? `Contributed by ${ext.manifest.id}`,
        parametersSchema: t.parametersSchema,
        handler: t.handler,
        owner: `extension:${ext.manifest.id}@${ext.manifest.version}`,
        requiredPermissions: t.requiredPermissions,
        skipPermission: t.skipPermission,
      };
      if (customToolRegistry.get(finalDef.name)) customToolRegistry.unregister(finalDef.name);
      customToolRegistry.register(finalDef);
    }

    // In-process hooks run on every agent session through the hook bridge.
    // Script/HTTP hooks and unknown phases are not session hooks.
    const sessionHooks = this.deps.sessionHookRegistry;
    if (sessionHooks) {
      for (const h of staged.hooks) {
        if ((h.type ?? 'function') !== 'function' || !h.handler) continue;
        if (!(STAGE_HOOK_PHASES as readonly string[]).includes(h.phase)) {
          this.logger?.warn?.(`[ExtensionManager] ${ext.manifest.id}: hook phase '${h.phase}' is not a session hook phase; skipped`);
          continue;
        }
        const handler = h.handler;
        sessionHooks.register(
          `extension:${ext.manifest.id}`,
          h.phase as StageHookPhase,
          async (ctx) => (await handler(ctx.event ?? {}, ctx)) as HookResult | void,
          {
            ...(h.priority !== undefined ? { priority: h.priority } : {}),
            ...(h.timeoutMs !== undefined ? { timeoutMs: h.timeoutMs } : {}),
            ...(h.failurePolicy ? { failurePolicy: h.failurePolicy === 'skip_remaining' ? 'skip' : h.failurePolicy } : {}),
          },
        );
      }
    }

    // NOTE: MCP servers, commands, skills, prompts registration
    // through their respective services is wired in follow-on phases.
    // For now we surface them on the InstalledExtension record and log,
    // so consumers can pick them up without changing the API.
    if (
      staged.mcpServers.length > 0 ||
      staged.commands.length > 0 ||
      staged.hooks.length > 0 ||
      staged.skills.length > 0 ||
      staged.prompts.length > 0
    ) {
      this.logger?.info?.(
        `[ExtensionManager] ${ext.manifest.id} contributed ` +
          `${staged.mcpServers.length} mcp, ${staged.commands.length} cmd, ` +
          `${staged.hooks.length} hook, ${staged.skills.length} skill, ` +
          `${staged.prompts.length} prompt (not yet wired end-to-end).`,
      );
    }
  }

  private rollbackStagedContributions(ext: InstalledExtension): void {
    const { widgetRegistry, customToolRegistry } = this.deps;
    widgetRegistry.unregisterByExtension(ext.manifest.id);
    this.deps.sessionHookRegistry?.unregisterByOwner(`extension:${ext.manifest.id}`);
    // Best-effort: unregister anything with matching owner.
    for (const t of customToolRegistry.list()) {
      if (t.owner === `extension:${ext.manifest.id}@${ext.manifest.version}`) {
        customToolRegistry.unregister(t.name);
      }
    }
    this.disposers.delete(ext.manifest.id);
  }

  /** Remove contributions from registries. */
  private async deactivate(ext: InstalledExtension): Promise<void> {
    if (!ext.ready) return;
    const { widgetRegistry, customToolRegistry } = this.deps;
    // Call the disposer first so extension code can clean up its own
    // watchers/timers/handles before we tear down its contributions.
    const dispose = this.disposers.get(ext.manifest.id);
    if (dispose) {
      try {
        await Promise.resolve(dispose());
      } catch (err) {
        this.logger?.warn?.(`[ExtensionManager] disposer for ${ext.manifest.id} threw: ${String(err)}`);
      }
      this.disposers.delete(ext.manifest.id);
    }
    widgetRegistry.unregisterByExtension(ext.manifest.id);
    this.deps.sessionHookRegistry?.unregisterByOwner(`extension:${ext.manifest.id}`);
    // Entry-file tools are tagged by owner.
    for (const t of customToolRegistry.list()) {
      if (t.owner === `extension:${ext.manifest.id}@${ext.manifest.version}`) {
        customToolRegistry.unregister(t.name);
      }
    }
    ext.ready = false;
  }

  /** Read-only accessor for the user extensions directory (used by
   *  authoring tools that want to scaffold under `~/.generatorai/extensions`). */
  getUserDir(): string {
    return this.cfg.userDir;
  }

  /**
   * Reload a single extension by id — v3 hot-reload path. Tears down the
   * extension's contributions (via `deactivate`), re-parses its manifest
   * from disk, and re-runs `activate`. If the manifest has an `entry`,
   * a cache-busting query is appended so the new module code is picked up.
   */
  async reloadOne(id: string): Promise<InstalledExtension | null> {
    const existing = this.installed.get(id);
    if (!existing) return null;
    await this.deactivate(existing);
    this.installed.delete(id);
    return this.tryLoadFromDir(existing.rootPath, existing.scope);
  }

  /**
   * Install an extension from a directory path. Callers upload/extract
   * externally, then call this with the absolute path.
   */
  async install(params: InstallExtensionParams): Promise<InstalledExtension> {
    if (!params.path) {
      throw new Error(
        'ExtensionManager.install: requires an already-extracted `path`.',
      );
    }
    const src = resolve(params.path);
    if (!existsSync(src)) throw new Error(`Extension source path not found: ${src}`);
    const stat = await fs.stat(src);
    if (!stat.isDirectory()) throw new Error(`Extension source is not a directory: ${src}`);
    const manifestPath = resolve(src, MANIFEST_FILE);
    if (!existsSync(manifestPath)) throw new Error(`Extension source is missing ${MANIFEST_FILE}: ${src}`);

    // Determine target scope + directory
    const scope: ExtensionScope =
      params.scope ??
      (params.workspaceId ? 'workspace' : 'user');
    if (scope === 'system') {
      throw new Error('System-scope extensions must be installed by the platform, not via API.');
    }
    let targetRoot: string;
    if (scope === 'user') {
      targetRoot = this.cfg.userDir;
    } else {
      const wsDir = params.workspaceId && this.cfg.resolveWorkspaceDir?.(params.workspaceId);
      if (!wsDir) {
        throw new Error(`Workspace directory not resolvable for id=${params.workspaceId}`);
      }
      targetRoot = wsDir;
    }
    await fs.mkdir(targetRoot, { recursive: true });

    // Parse the manifest to name the target dir.
    const rawManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ExtensionManifest;
    const manifestParsed = ExtensionManifestSchema.parse(rawManifest);
    const dirName = `${manifestParsed.id}@${manifestParsed.version}`;
    const dst = resolve(targetRoot, dirName);
    if (existsSync(dst)) {
      if (!params.force) {
        throw new Error(`Extension already installed at ${dst}. Pass { force: true } to overwrite.`);
      }
      await fs.rm(dst, { recursive: true, force: true });
    }
    await copyDir(src, dst);

    // Tear down any previous same-id entry then load fresh.
    const prior = this.installed.get(manifestParsed.id);
    if (prior) {
      await this.deactivate(prior);
      this.installed.delete(manifestParsed.id);
    }
    const loaded = await this.tryLoadFromDir(dst, scope);
    if (!loaded) {
      throw new Error(
        `Extension installed to ${dst} but failed to load. Check manifest validation errors in server logs.`,
      );
    }
    return loaded;
  }

  async uninstall(id: string, scope?: ExtensionScope): Promise<boolean> {
    const ext = this.installed.get(id);
    if (!ext) return false;
    if (scope && ext.scope !== scope) {
      // Requesting a specific scope but the loaded copy is from elsewhere — no-op.
      return false;
    }
    await this.deactivate(ext);
    this.installed.delete(id);
    // Remove on-disk directory only for user/workspace scopes — never system.
    if (ext.scope !== 'system' && existsSync(ext.rootPath)) {
      try {
        await fs.rm(ext.rootPath, { recursive: true, force: true });
      } catch (err) {
        this.logger?.warn?.(`[ExtensionManager] rm failed for ${ext.rootPath}: ${String(err)}`);
      }
    }
    await this.deps.eventBus.emit('__global__', {
      kind: 'extension.uninstalled',
      data: { id, scope: ext.scope },
    }).catch(() => undefined);
    return true;
  }
}

/** Higher rank = higher precedence. */
function rank(scope: ExtensionScope): number {
  return scope === 'workspace' ? 2 : scope === 'user' ? 1 : 0;
}

/** Numeric-segment version compare; non-numeric suffixes fall back to a
 *  string compare so `1.0.0-beta` still orders below `1.0.0`. */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(/[.\-+]/);
  const partsB = b.split(/[.\-+]/);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i += 1) {
    const rawA = partsA[i];
    const rawB = partsB[i];
    if (rawA === undefined) return rawB === undefined ? 0 : 1;
    if (rawB === undefined) return -1;
    const numA = Number(rawA);
    const numB = Number(rawB);
    if (Number.isFinite(numA) && Number.isFinite(numB)) {
      if (numA !== numB) return numA > numB ? 1 : -1;
      continue;
    }
    if (rawA !== rawB) return rawA > rawB ? 1 : -1;
  }
  return 0;
}

/** Resolve `relative` inside `root`. Returns undefined if it escapes. */
function safeResolveInside(root: string, relative: string): string | undefined {
  const absRoot = resolve(root);
  const abs = isAbsolute(relative) ? relative : resolve(root, relative);
  const normalized = resolve(abs);
  if (!normalized.startsWith(absRoot + sep) && normalized !== absRoot) return undefined;
  return normalized;
}

/** Portable recursive copy of a directory tree. */
async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = resolve(src, entry.name);
    const d = resolve(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isSymbolicLink()) {
      // Skip symlinks — we don't want extensions to smuggle links.
      continue;
    } else {
      await fs.copyFile(s, d);
    }
  }
}

/** Utility to make a filesystem-safe id for logging. */
export function encodeAssetPath(extensionId: string, relative: string): string {
  return `/${encodeURIComponent(extensionId)}/${relative.split('/').map(encodeURIComponent).join('/')}`;
}

/** Fallback logger used when the caller omitted one. */
const consoleLogger: ILogger = ((): ILogger => {
  const build = (prefix: string): ILogger => ({
    info: (m: string) => console.log(`${prefix} ${m}`),
    warn: (m: string) => console.warn(`${prefix} ${m}`),
    error: (m: string) => console.error(`${prefix} ${m}`),
    debug: () => {},
    child: (b) => build(`${prefix} ${JSON.stringify(b)}`),
  });
  return build('[ExtensionManager]');
})();

/** Utility: normalize a request path back to the on-disk relative form. */
export function decodeAssetPath(pathAfterExtensionId: string): string {
  return pathAfterExtensionId.split('/').map(decodeURIComponent).join('/');
}

/** File-URL helper. */
export function toFileUrl(abs: string): string {
  return pathToFileURL(abs).href;
}

/** Utility to construct a unique instance id. */
export function newWidgetInstanceId(): string {
  return `w_${randomUUID().slice(0, 12)}`;
}

/** Utility to derive a file path from a URL. */
export function fromFileUrl(url: string): string {
  return fileURLToPath(url);
}

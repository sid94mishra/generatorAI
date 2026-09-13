// ────────────────────────────────────────────────────────────────
// MountService — plan, validate, materialise and remove workspace mounts
// ────────────────────────────────────────────────────────────────
//
// A mount is one directory the agent may edit. The service turns a chat's
// source list (project codebases and/or local folders, each in place or as
// a worktree, optionally on a branch) into `workspace_mounts` rows and the
// directories behind them, and it owns the ONLY code paths that touch a
// user's repository:
//
//   • in-place  — nothing is copied or initialised. A branch switch is a
//                 static pre-step that refuses a dirty tree; a requested new
//                 branch is created from the chosen base.
//   • worktree  — `git worktree add` under `<workspace>/source/<alias>`,
//                 from the codebase clone or the user's own repo. Objects are
//                 shared, so disk cost is one checkout, never a clone.
//   • generated — an empty managed directory the agent builds in.
//
// Every mount gets a private shadow git store (`<workspace>/.checkpoints/
// <alias>.git`) for checkpoints, so nothing — no refs, no objects, no index
// files — is ever written into the user's `.git`, and a plain folder is
// tracked without being `git init`-ed.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  ChatSourceSpec,
  ExecutionWorkspace,
  ILogger,
  MountGitState,
  ProjectCodebase,
  WorkspaceExposure,
  WorkspaceMount,
} from '@generatorai/shared';
import { ConflictError, NotFoundError, ValidationError } from '@generatorai/shared';
import type { IGitClient } from '@generatorai/git';
import { shadowGitDirFor } from '@generatorai/changes';
import type { IWorkspaceMountRepository } from '../domain/ports/IWorkspaceMountRepository.js';
import type { IExecutionWorkspaceRepository } from '../domain/ports/IExecutionWorkspaceRepository.js';
import type { IProjectCodebaseRepository } from '../domain/ports/IProjectCodebaseRepository.js';
import type { EventBus } from '../events/EventBus.js';
import { buildWorkspaceHint } from './chatSystemHints.js';

/** A mount that has been validated but not yet materialised. */
export interface PlannedMount {
  alias: string;
  position: number;
  originKind: WorkspaceMount['originKind'];
  codebaseId?: string;
  projectId?: string;
  originPath?: string;
  mode: WorkspaceMount['mode'];
  /** Absolute directory the agent will edit — known before preparation. */
  path: string;
  /** Git intent, resolved from the source spec. */
  intent: {
    isRepo: boolean;
    /** Codebase type, when the origin is a project codebase. */
    codebaseType?: ProjectCodebase['type'];
    /** Existing branch to check out / start from. */
    branch?: string;
    /** Branch to create. */
    newBranch?: string;
    /** Start point for `newBranch`. */
    baseRef?: string;
    /** Files copied into a fresh worktree (codebase `worktreeInclude`). */
    include?: string[];
  };
}

export interface PlanOptions {
  /** Alias of the primary mount; defaults to the first source. */
  primary?: string;
  /**
   * Used for the default worktree branch name `generatorai/<slug>` when a
   * source asks for a worktree without naming a branch.
   */
  branchSlug?: string;
}

export interface PrepareScope {
  sessionId?: string;
  chatId?: string;
}

export interface MountServiceDeps {
  mountRepo: IWorkspaceMountRepository;
  workspaceRepo: IExecutionWorkspaceRepository;
  git: IGitClient;
  logger: ILogger;
  /** Managed workspaces directory — user folders inside it are refused. */
  workspacesDir: string;
  codebaseRepo?: IProjectCodebaseRepository;
  eventBus?: EventBus;
}

/** Default alias for a workspace that has no source at all. */
export const GENERATED_MOUNT_ALIAS = 'main';
/** Managed sub-directory (under the workspace root) that holds worktrees and generated mounts. */
export const SOURCE_DIR = 'source';
/** Managed sub-directory the agent is told to use for non-deliverables. */
export const SCRATCH_DIR = 'scratch';

/**
 * Local-only ignore patterns for a mount's shadow store. The mount's own
 * `.gitignore` files still apply on top of these.
 */
const SHADOW_EXCLUDES_REPO = ['.generatorai/', 'node_modules/', '.DS_Store', 'Thumbs.db'];
const SHADOW_EXCLUDES_FOLDER = [
  ...SHADOW_EXCLUDES_REPO,
  'dist/',
  'build/',
  'coverage/',
  '.next/',
  '.turbo/',
  '.cache/',
  '.env',
  '.env.local',
  '.env.*.local',
  '*.log',
  '*.db-shm',
  '*.db-wal',
  '*.db-journal',
];

export class MountService {
  private readonly inflight = new Map<string, Promise<void>>();
  /** Late-wired: capture a baseline once every mount is ready. */
  private baselineCapture?: (workspaceId: string) => Promise<unknown>;

  constructor(private readonly deps: MountServiceDeps) {}

  setBaselineCapture(fn: (workspaceId: string) => Promise<unknown>): void {
    this.baselineCapture = fn;
  }

  // ── Plan ────────────────────────────────────────────────────

  /**
   * Validate a source list against the filesystem and git, and compute the
   * mounts it would produce. Throws `ValidationError` with a message the
   * user can act on. Nothing is written.
   *
   * `rootPath` is the workspace root the mounts belong to (known before the
   * workspace exists, because it is derived from the owner id).
   */
  async plan(
    rootPath: string,
    projectId: string | undefined,
    sources: ChatSourceSpec[],
    opts: PlanOptions = {},
  ): Promise<PlannedMount[]> {
    const planned: PlannedMount[] = [];
    const aliases = new Set<string>();
    const paths = new Set<string>();
    const managedRoot = path.resolve(this.deps.workspacesDir);
    const resolvedRoot = path.resolve(rootPath);

    const takeAlias = (requested: string | undefined, fallback: string): string => {
      const base = sanitizeAlias(requested ?? fallback);
      if (requested && aliases.has(base)) {
        throw new ValidationError(`Duplicate mount alias "${base}"`);
      }
      let alias = base;
      let n = 2;
      while (aliases.has(alias)) alias = `${base}-${n++}`;
      aliases.add(alias);
      return alias;
    };

    const claimPath = (p: string, label: string): void => {
      const abs = path.resolve(p);
      for (const other of paths) {
        if (abs === other || abs.startsWith(other + path.sep) || other.startsWith(abs + path.sep)) {
          throw new ValidationError(`${label} overlaps another mount (${other})`);
        }
      }
      paths.add(abs);
    };

    if (sources.length === 0) {
      const alias = takeAlias(undefined, GENERATED_MOUNT_ALIAS);
      const p = path.join(resolvedRoot, SOURCE_DIR, alias);
      claimPath(p, 'Generated mount');
      planned.push({
        alias,
        position: 0,
        originKind: 'generated',
        mode: 'generated',
        path: p,
        intent: { isRepo: true },
      });
      return planned;
    }

    for (const source of sources) {
      if (source.kind === 'codebase') {
        const codebase = await this.resolveCodebase(source.codebaseId, projectId);
        if (codebase.status !== 'ready') {
          throw new ValidationError(
            `Codebase "${codebase.alias}" is not ready (status: ${codebase.status})`,
          );
        }
        const isGit = codebase.type !== 'local-dir';
        const originPath = codebase.type === 'git-remote' ? codebase.clonePath : (codebase.localPath ?? codebase.clonePath);
        if (!originPath) throw new ValidationError(`Codebase "${codebase.alias}" has no path on disk`);
        await assertDirectory(originPath, `Codebase "${codebase.alias}"`);

        let mode = source.mode ?? (isGit ? 'worktree' : 'in-place');
        if (codebase.type === 'git-remote' && mode === 'in-place') {
          throw new ValidationError(
            `Codebase "${codebase.alias}" is a remote clone with no working copy; mount it as a worktree`,
          );
        }
        if (!isGit && mode === 'worktree') {
          throw new ValidationError(
            `Codebase "${codebase.alias}" is a plain folder (not a git repository) and cannot be mounted as a worktree`,
          );
        }
        if (!isGit && (source.branch || source.newBranch)) {
          throw new ValidationError(`Codebase "${codebase.alias}" is not a git repository; branches do not apply`);
        }
        const alias = takeAlias(source.alias, codebase.alias);
        const mountPath = mode === 'worktree' ? path.join(resolvedRoot, SOURCE_DIR, alias) : path.resolve(originPath);
        claimPath(mountPath, `Codebase "${codebase.alias}"`);

        const intent = isGit
          ? await this.resolveGitIntent(originPath, source, {
              mode,
              codebase,
              branchSlug: opts.branchSlug,
              isBare: codebase.type === 'git-remote',
              mountPath,
            })
          : { isRepo: false };

        planned.push({
          alias,
          position: planned.length,
          originKind: 'codebase',
          codebaseId: codebase.id,
          projectId: codebase.projectId,
          originPath: path.resolve(originPath),
          mode,
          path: mountPath,
          intent: {
            ...intent,
            codebaseType: codebase.type,
            ...(codebase.settings?.worktreeInclude?.length ? { include: codebase.settings.worktreeInclude } : {}),
          },
        });
        continue;
      }

      // ── folder ──
      const folder = source.path.trim();
      if (!path.isAbsolute(folder)) {
        throw new ValidationError(`Folder path must be absolute: ${folder}`);
      }
      const abs = path.resolve(folder);
      await assertDirectory(abs, 'Folder');
      if (abs === managedRoot || abs.startsWith(managedRoot + path.sep)) {
        throw new ValidationError('Folders inside the managed workspaces directory cannot be mounted');
      }
      if (abs === resolvedRoot || abs.startsWith(resolvedRoot + path.sep)) {
        throw new ValidationError('The workspace root itself cannot be mounted');
      }
      const isRepo = await hasDotGit(abs);
      const mode = source.mode ?? 'in-place';
      if (mode === 'worktree' && !isRepo) {
        throw new ValidationError(`${abs} is not a git repository, so it cannot be mounted as a worktree`);
      }
      if (!isRepo && (source.branch || source.newBranch)) {
        throw new ValidationError(`${abs} is not a git repository; branches do not apply`);
      }
      const alias = takeAlias(source.alias, path.basename(abs) || 'folder');
      const mountPath = mode === 'worktree' ? path.join(resolvedRoot, SOURCE_DIR, alias) : abs;
      claimPath(mountPath, `Folder ${abs}`);

      const intent = isRepo
        ? await this.resolveGitIntent(abs, source, { mode, branchSlug: opts.branchSlug, isBare: false, mountPath })
        : { isRepo: false };

      planned.push({
        alias,
        position: planned.length,
        originKind: 'folder',
        originPath: abs,
        mode,
        path: mountPath,
        intent,
      });
    }

    // Primary mount first.
    if (opts.primary) {
      const idx = planned.findIndex((m) => m.alias === opts.primary);
      if (idx === -1) throw new ValidationError(`Primary mount "${opts.primary}" is not one of the sources`);
      const [primary] = planned.splice(idx, 1);
      planned.unshift(primary!);
      planned.forEach((m, i) => (m.position = i));
    }
    return planned;
  }

  /**
   * Resolve branch intent for a git-backed source, validating refs against
   * the origin repository so a bad name fails at creation, not mid-prepare.
   */
  private async resolveGitIntent(
    originPath: string,
    source: ChatSourceSpec,
    ctx: { mode: 'in-place' | 'worktree'; codebase?: ProjectCodebase; branchSlug?: string; isBare: boolean; mountPath: string },
  ): Promise<PlannedMount['intent']> {
    const git = this.deps.git;
    let { branch, newBranch } = source;
    const { baseRef } = source;
    const samePath = (p: string | null | undefined): boolean =>
      !!p && path.resolve(p) === path.resolve(ctx.mountPath);

    if (branch && !(await git.branchExists(originPath, branch))) {
      throw new ValidationError(`Branch "${branch}" does not exist in ${originPath}`);
    }
    if (newBranch && (await git.branchExists(originPath, newBranch))) {
      // Re-planning a chat whose branch was created by an earlier prepare:
      // the branch is ours if it is checked out at this very mount path
      // (worktree) or is the current branch of the in-place repo. Treat it
      // as "check out the existing branch" instead of failing.
      const ours =
        ctx.mode === 'worktree'
          ? samePath(await git.worktreeHoldingBranch(originPath, newBranch))
          : (await git.currentBranch(originPath)) === newBranch;
      if (!ours) {
        throw new ValidationError(`Branch "${newBranch}" already exists in ${originPath}; pick another name or check it out instead`);
      }
      branch = newBranch;
      newBranch = undefined;
    }
    if (baseRef && !(await git.revParse(originPath, baseRef))) {
      throw new ValidationError(`Base ref "${baseRef}" does not resolve in ${originPath}`);
    }

    if (ctx.mode === 'worktree') {
      if (branch && !newBranch) {
        const holder = await git.worktreeHoldingBranch(originPath, branch);
        if (holder && !samePath(holder)) {
          throw new ValidationError(
            `Branch "${branch}" is already checked out at ${holder}; a branch can only be checked out in one place. Choose "new branch" instead.`,
          );
        }
        return { isRepo: true, branch };
      }
      // New branch (explicit or default), from the requested base, else the
      // codebase default branch (preferring its remote-tracking ref when the
      // repo has one), else HEAD.
      let base = baseRef ?? branch;
      if (!base) {
        const def = ctx.codebase?.defaultBranch;
        if (def) {
          if (ctx.isBare) base = def;
          else base = (await git.revParse(originPath, `origin/${def}`)) ? `origin/${def}` : def;
        } else {
          base = 'HEAD';
        }
      }
      const name = newBranch ?? (await this.defaultBranchName(originPath, ctx.branchSlug));
      return { isRepo: true, newBranch: name, baseRef: base };
    }

    // in-place
    if (newBranch) return { isRepo: true, newBranch, baseRef: baseRef ?? branch ?? 'HEAD' };
    if (branch) return { isRepo: true, branch };
    const current = await git.currentBranch(originPath);
    return { isRepo: true, ...(current ? { branch: current } : {}) };
  }

  private async defaultBranchName(originPath: string, slug: string | undefined): Promise<string> {
    const base = `generatorai/${slug && slug.length > 0 ? slug : 'chat'}`;
    let name = base;
    let n = 2;
    while (await this.deps.git.branchExists(originPath, name)) name = `${base}-${n++}`;
    return name;
  }

  private async resolveCodebase(idOrAlias: string, projectId: string | undefined): Promise<ProjectCodebase> {
    const repo = this.deps.codebaseRepo;
    if (!repo) throw new ValidationError('Project codebases are not available in this deployment');
    if (projectId) {
      const byAlias = await repo.getByAlias(projectId, idOrAlias);
      if (byAlias) return byAlias;
    }
    try {
      const cb = await repo.getById(idOrAlias);
      if (projectId && cb.projectId !== projectId) {
        throw new ValidationError(`Codebase "${idOrAlias}" belongs to a different project`);
      }
      return cb;
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new NotFoundError('Codebase', idOrAlias);
    }
  }

  // ── Stage ───────────────────────────────────────────────────

  /** Persist planned mounts as `preparing` rows. */
  async stage(workspaceId: string, planned: PlannedMount[]): Promise<WorkspaceMount[]> {
    const now = new Date();
    const rows: WorkspaceMount[] = planned.map((m) => ({
      id: randomUUID(),
      workspaceId,
      position: m.position,
      alias: m.alias,
      originKind: m.originKind,
      ...(m.codebaseId ? { codebaseId: m.codebaseId } : {}),
      ...(m.projectId ? { projectId: m.projectId } : {}),
      ...(m.originPath ? { originPath: m.originPath } : {}),
      mode: m.mode,
      path: m.path,
      git: {
        isRepo: m.intent.isRepo,
        ...(m.intent.branch ? { branch: m.intent.branch } : {}),
        ...(m.intent.newBranch ? { branch: m.intent.newBranch, createdBranch: true } : {}),
        ...(m.intent.baseRef ? { baseRef: m.intent.baseRef } : {}),
      },
      status: 'preparing',
      hasUncommittedChanges: false,
      createdAt: now,
      updatedAt: now,
    }));
    for (const row of rows) await this.deps.mountRepo.create(row);
    await this.deps.workspaceRepo.updatePrep(workspaceId, 'pending', null);
    // The intent is needed again by `prepare`; keep it alongside the row.
    for (let i = 0; i < rows.length; i++) this.intents.set(rows[i]!.id, planned[i]!.intent);
    return rows;
  }

  /** Planned intents by mount id — only needed between `stage` and `prepare`. */
  private readonly intents = new Map<string, PlannedMount['intent']>();

  // ── Prepare ─────────────────────────────────────────────────

  /**
   * Materialise every `preparing` mount of a workspace. Single-flight per
   * workspace and idempotent: a mount whose directory already exists in the
   * expected state is verified rather than re-created.
   */
  prepare(workspaceId: string, scope: PrepareScope = {}): Promise<void> {
    const existing = this.inflight.get(workspaceId);
    if (existing) return existing;
    const run = this.prepareUnlocked(workspaceId, scope).finally(() => {
      this.inflight.delete(workspaceId);
    });
    this.inflight.set(workspaceId, run);
    return run;
  }

  private async prepareUnlocked(workspaceId: string, scope: PrepareScope): Promise<void> {
    const workspace = await this.deps.workspaceRepo.findById(workspaceId);
    if (!workspace) return;
    const mounts = await this.deps.mountRepo.findByWorkspace(workspaceId);
    const pending = mounts.filter((m) => m.status === 'preparing' || m.status === 'error');
    if (pending.length === 0) {
      if (workspace.prepStatus !== 'ready') {
        await this.deps.workspaceRepo.updatePrep(workspaceId, 'ready', null);
        // Every other transition announces itself; this one used to flip the
        // row silently. A client that is gating Send on `workspacePrep` then
        // never hears that it may proceed, so the composer stays disabled on
        // a workspace that is in fact ready — which is exactly what the
        // Retry button (`POST /workspace/prepare`) lands in when the mounts
        // turned out to need no work.
        await this.emitPrep(workspace, 'ready', undefined, scope);
      }
      return;
    }

    await this.deps.workspaceRepo.updatePrep(workspaceId, 'preparing', null);
    await this.emitPrep(workspace, 'preparing', undefined, scope);

    const failures: string[] = [];
    // Worktrees of different repos are independent — prepare them together.
    await Promise.all(
      pending.map(async (mount) => {
        try {
          const git = await this.prepareMount(workspace, mount);
          await this.deps.mountRepo.update(mount.id, { status: 'ready', error: null, git });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push(`${mount.alias}: ${message}`);
          await this.deps.mountRepo.update(mount.id, { status: 'error', error: message });
          this.deps.logger.warn(`[Mounts] Failed to prepare ${mount.alias} for workspace ${workspaceId}: ${message}`);
        } finally {
          this.intents.delete(mount.id);
        }
      }),
    );

    if (failures.length > 0) {
      const error = failures.join('; ');
      await this.deps.workspaceRepo.updatePrep(workspaceId, 'error', error);
      await this.emitPrep(workspace, 'error', error, scope);
      return;
    }

    await this.writeManifest(workspace);
    // The "since the start" anchor for every mount, taken while the tree is
    // pristine — and BEFORE readiness is announced, or the first Changes
    // read races the baseline and reports every file as added (and a file
    // written in that window vanishes into the baseline). Failures are
    // logged by the checkpoint service itself.
    try {
      await this.baselineCapture?.(workspaceId);
    } catch (err) {
      this.deps.logger.warn(`[Mounts] Baseline capture failed for ${workspaceId}: ${err}`);
    }
    await this.deps.workspaceRepo.updatePrep(workspaceId, 'ready', null);
    await this.emitPrep(workspace, 'ready', undefined, scope);
    this.deps.logger.info(`[Mounts] Workspace ${workspaceId} ready (${mounts.length} mount${mounts.length === 1 ? '' : 's'})`);
  }

  private async prepareMount(workspace: ExecutionWorkspace, mount: WorkspaceMount): Promise<MountGitState> {
    const git = this.deps.git;
    const intent: PlannedMount['intent'] = this.intents.get(mount.id) ?? {
      isRepo: mount.git?.isRepo ?? false,
      ...(mount.git?.createdBranch ? { newBranch: mount.git.branch } : mount.git?.branch ? { branch: mount.git.branch } : {}),
      ...(mount.git?.baseRef ? { baseRef: mount.git.baseRef } : {}),
    };

    if (mount.mode === 'generated') {
      await fs.mkdir(mount.path, { recursive: true });
      await git.initIfNeeded(mount.path);
      await this.ensureShadow(workspace.rootPath, mount.alias, mount.path, true);
      return { isRepo: true, branch: (await git.currentBranch(mount.path)) ?? undefined };
    }

    if (mount.mode === 'worktree') {
      const origin = mount.originPath;
      if (!origin) throw new Error('worktree mount has no origin repository');
      const alreadyThere = await hasDotGit(mount.path);
      if (!alreadyThere) {
        // A previous, failed attempt may have left a non-worktree directory.
        await fs.rm(mount.path, { recursive: true, force: true }).catch(() => undefined);
        if (intent.newBranch && (await git.branchExists(origin, intent.newBranch))) {
          // The branch exists (a retry after the worktree dir was lost):
          // check it out rather than failing on "already exists".
          await git.addWorktree(origin, mount.path, { branch: intent.newBranch });
        } else {
          await git.addWorktree(origin, mount.path, {
            ...(intent.newBranch ? { newBranch: intent.newBranch } : {}),
            ...(intent.branch ? { branch: intent.branch } : {}),
            ...(intent.baseRef ? { base: intent.baseRef } : {}),
          });
        }
        await this.copyIncludes(origin, mount.path, intent.include, mount.codebaseId);
      }
      await this.ensureShadow(workspace.rootPath, mount.alias, mount.path, true);
      const branch = (await git.currentBranch(mount.path)) ?? undefined;
      const baseCommit = intent.baseRef ? await git.revParse(origin, intent.baseRef) : await git.revParse(mount.path, 'HEAD');
      return {
        isRepo: true,
        ...(branch ? { branch } : {}),
        ...(intent.baseRef ? { baseRef: intent.baseRef } : {}),
        ...(baseCommit ? { baseCommit } : {}),
        ...(intent.newBranch ? { createdBranch: true } : {}),
      };
    }

    // ── in-place ──
    await assertDirectory(mount.path, `Mount "${mount.alias}"`);
    if (!intent.isRepo) {
      const nested = await git.nestedRepos(mount.path);
      await this.ensureShadow(workspace.rootPath, mount.alias, mount.path, false);
      for (const sub of nested) {
        await this.ensureShadow(workspace.rootPath, `${mount.alias}/${sub}`, path.join(mount.path, sub), true);
      }
      return { isRepo: false, ...(nested.length ? { nested } : {}) };
    }

    const current = await git.currentBranch(mount.path);
    if (intent.newBranch) {
      if (!(await git.isClean(mount.path))) {
        throw new ConflictError(
          `${mount.path} has uncommitted changes; commit or stash them before creating branch "${intent.newBranch}"`,
        );
      }
      await git.createBranch(mount.path, intent.newBranch, intent.baseRef === 'HEAD' ? undefined : intent.baseRef);
      await git.checkoutBranch(mount.path, intent.newBranch);
    } else if (intent.branch && intent.branch !== current) {
      if (!(await git.isClean(mount.path))) {
        throw new ConflictError(
          `${mount.path} has uncommitted changes; commit or stash them before switching to "${intent.branch}"`,
        );
      }
      await git.checkoutBranch(mount.path, intent.branch);
    }
    await this.ensureShadow(workspace.rootPath, mount.alias, mount.path, true);
    const nested = await git.nestedRepos(mount.path);
    for (const sub of nested) {
      await this.ensureShadow(workspace.rootPath, `${mount.alias}/${sub}`, path.join(mount.path, sub), true);
    }
    const branch = (await git.currentBranch(mount.path)) ?? undefined;
    const baseCommit = await git.revParse(mount.path, 'HEAD');
    return {
      isRepo: true,
      ...(branch ? { branch } : {}),
      baseRef: intent.baseRef ?? branch ?? 'HEAD',
      ...(baseCommit ? { baseCommit } : {}),
      ...(intent.newBranch ? { createdBranch: true } : {}),
      ...(nested.length ? { nested } : {}),
    };
  }

  /**
   * Create the shadow store for a mount. With an origin repository the
   * store's object database is linked to the origin's through `alternates`,
   * so unchanged blobs cost nothing; the effective `core.autocrlf` is copied
   * so EOL-normalised trees compare cleanly against real commits.
   */
  private async ensureShadow(rootPath: string, alias: string, workTree: string, isRepo: boolean): Promise<void> {
    const git = this.deps.git;
    const gitDir = shadowGitDirFor(rootPath, alias);
    const alternates = isRepo ? await git.commonObjectsDir(workTree) : null;
    const autocrlf = (await git.getConfig(workTree, 'core.autocrlf')) ?? 'false';
    const ok = await git.initShadowRepo(gitDir, workTree, {
      ...(alternates ? { alternatesObjectsDir: alternates } : {}),
      autocrlf,
      excludes: isRepo ? SHADOW_EXCLUDES_REPO : SHADOW_EXCLUDES_FOLDER,
    });
    if (!ok) throw new Error(`could not create the checkpoint store for "${alias}"`);
  }

  private async copyIncludes(origin: string, worktree: string, include: string[] | undefined, codebaseId?: string): Promise<void> {
    let files = include;
    if (!files && codebaseId && this.deps.codebaseRepo) {
      try {
        files = (await this.deps.codebaseRepo.getById(codebaseId)).settings?.worktreeInclude;
      } catch {
        files = undefined;
      }
    }
    for (const rel of files ?? []) {
      const src = path.join(origin, rel);
      const dest = path.join(worktree, rel);
      try {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
      } catch {
        // Optional by nature (an .env that does not exist yet).
      }
    }
  }

  private async writeManifest(workspace: ExecutionWorkspace): Promise<void> {
    try {
      const mounts = await this.deps.mountRepo.findByWorkspace(workspace.id);
      const file = path.join(workspace.rootPath, '.workspace.json');
      let manifest: Record<string, unknown> = {};
      try {
        manifest = JSON.parse(await fs.readFile(file, 'utf-8')) as Record<string, unknown>;
      } catch {
        /* fresh */
      }
      manifest['mounts'] = mounts.map((m) => ({
        alias: m.alias,
        mode: m.mode,
        path: m.path,
        originPath: m.originPath,
        branch: m.git?.branch,
        baseRef: m.git?.baseRef,
      }));
      manifest['scratch'] = path.join(workspace.rootPath, SCRATCH_DIR);
      await fs.writeFile(file, JSON.stringify(manifest, null, 2), 'utf-8');
    } catch {
      /* the manifest is informational */
    }
  }

  // ── Readiness ───────────────────────────────────────────────

  /**
   * Resolve once the workspace's mounts are ready; reject with the
   * preparation error otherwise. Bounded so a wedged git never hangs a turn.
   */
  async ready(workspaceId: string, timeoutMs = 120_000): Promise<void> {
    const inflight = this.inflight.get(workspaceId);
    if (inflight) {
      await Promise.race([
        inflight,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Workspace preparation is taking too long; try again in a moment')), timeoutMs).unref?.(),
        ),
      ]);
    }
    const ws = await this.deps.workspaceRepo.findById(workspaceId);
    if (!ws) return;
    if (ws.prepStatus === 'error') {
      throw new ConflictError(`Workspace is not ready: ${ws.prepError ?? 'mount preparation failed'}`);
    }
    if (ws.prepStatus === 'pending' || ws.prepStatus === 'preparing') {
      // Nothing in flight in THIS process (server restarted mid-prepare):
      // run it now, then re-check.
      await this.prepare(workspaceId);
      const again = await this.deps.workspaceRepo.findById(workspaceId);
      if (again?.prepStatus === 'error') {
        throw new ConflictError(`Workspace is not ready: ${again.prepError ?? 'mount preparation failed'}`);
      }
    }
  }

  // ── Read ────────────────────────────────────────────────────

  async list(workspaceId: string): Promise<WorkspaceMount[]> {
    return this.deps.mountRepo.findByWorkspace(workspaceId);
  }

  /** What the harness receives: cwd, extra directories, env and the hint block. */
  async exposure(workspace: ExecutionWorkspace, mounts?: WorkspaceMount[]): Promise<WorkspaceExposure> {
    const list = mounts ?? (await this.deps.mountRepo.findByWorkspace(workspace.id));
    return buildExposure(workspace, list);
  }

  // ── Mutations after creation ────────────────────────────────

  /**
   * Replace the whole plan of a workspace: mounts that stay identical
   * (same origin, mode, path) are kept, the rest are removed and the new
   * ones staged. The caller must guarantee the chat is idle.
   */
  async replace(
    workspace: ExecutionWorkspace,
    projectId: string | undefined,
    sources: ChatSourceSpec[],
    opts: PlanOptions & { deleteBranches?: boolean } = {},
  ): Promise<WorkspaceMount[]> {
    const planned = await this.plan(workspace.rootPath, projectId, sources, opts);
    const existing = await this.deps.mountRepo.findByWorkspace(workspace.id);

    const keyOf = (m: { originPath?: string; mode: string; path: string; alias: string }) =>
      `${m.alias}\u0000${m.mode}\u0000${path.resolve(m.path)}\u0000${m.originPath ? path.resolve(m.originPath) : ''}`;
    const plannedKeys = new Map(planned.map((p) => [keyOf(p), p]));

    for (const m of existing) {
      const keep = plannedKeys.get(keyOf(m));
      if (keep && m.status === 'ready' && sameBranchIntent(m, keep)) {
        plannedKeys.delete(keyOf(m));
        if (m.position !== keep.position) await this.deps.mountRepo.update(m.id, { position: keep.position });
        continue;
      }
      await this.remove(m.id, { deleteBranch: opts.deleteBranches === true });
    }

    const fresh = [...plannedKeys.values()];
    if (fresh.length > 0) await this.stage(workspace.id, fresh);
    else await this.deps.workspaceRepo.updatePrep(workspace.id, 'ready', null);
    return this.deps.mountRepo.findByWorkspace(workspace.id);
  }

  /**
   * Remove one mount. A worktree is unregistered from its origin and its
   * directory deleted; an in-place mount is only forgotten — the user's
   * folder is never touched. The shadow store goes in both cases.
   */
  async remove(mountId: string, opts: { deleteBranch?: boolean } = {}): Promise<void> {
    const mount = await this.deps.mountRepo.findById(mountId);
    if (!mount) return;
    const workspace = await this.deps.workspaceRepo.findById(mount.workspaceId);
    const git = this.deps.git;

    if (mount.mode === 'worktree' && mount.originPath) {
      try {
        await git.removeWorktree(mount.originPath, mount.path);
        await git.pruneWorktrees(mount.originPath);
      } catch (err) {
        this.deps.logger.warn(`[Mounts] worktree remove failed for ${mount.path}: ${err}`);
      }
      await rmWithRetry(mount.path);
      if (opts.deleteBranch && mount.git?.createdBranch && mount.git.branch) {
        await this.deleteBranch(mount.originPath, mount.git.branch);
      }
    } else if (mount.mode === 'generated') {
      await rmWithRetry(mount.path);
    }

    if (workspace) {
      await fs.rm(shadowGitDirFor(workspace.rootPath, mount.alias), { recursive: true, force: true }).catch(() => undefined);
      for (const sub of mount.git?.nested ?? []) {
        await fs
          .rm(shadowGitDirFor(workspace.rootPath, `${mount.alias}/${sub}`), { recursive: true, force: true })
          .catch(() => undefined);
      }
    }
    await this.deps.mountRepo.delete(mountId);
  }

  private async deleteBranch(repoDir: string, branch: string): Promise<void> {
    try {
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      await promisify(execFile)('git', ['branch', '-D', branch], { cwd: repoDir, timeout: 15_000 });
    } catch (err) {
      this.deps.logger.warn(`[Mounts] could not delete branch ${branch} in ${repoDir}: ${err}`);
    }
  }

  /**
   * Remove the worktree directories of a workspace whose owner is finished
   * (archived chat) while keeping the branches and the mount rows, so the
   * work is recoverable and disk is reclaimed. Idempotent.
   */
  async releaseWorktrees(workspaceId: string): Promise<number> {
    const mounts = await this.deps.mountRepo.findByWorkspace(workspaceId);
    let released = 0;
    for (const m of mounts) {
      if (m.mode !== 'worktree' || m.status === 'removed' || !m.originPath) continue;
      if (!(await pathExists(m.path))) continue;
      try {
        await this.deps.git.removeWorktree(m.originPath, m.path);
        await this.deps.git.pruneWorktrees(m.originPath);
        await rmWithRetry(m.path);
        await this.deps.mountRepo.update(m.id, { status: 'removed' });
        released++;
      } catch (err) {
        this.deps.logger.warn(`[Mounts] release failed for ${m.path}: ${err}`);
      }
    }
    return released;
  }

  /** Recompute `hasUncommittedChanges` for every git mount (after a turn). */
  async refreshStatus(workspaceId: string): Promise<void> {
    const mounts = await this.deps.mountRepo.findByWorkspace(workspaceId);
    for (const m of mounts) {
      if (!m.git?.isRepo || m.status !== 'ready') continue;
      try {
        const dirty = !(await this.deps.git.isClean(m.path));
        if (dirty !== m.hasUncommittedChanges) {
          await this.deps.mountRepo.update(m.id, { hasUncommittedChanges: dirty });
        }
      } catch {
        /* a missing directory reads as clean */
      }
    }
  }

  // ── Events ──────────────────────────────────────────────────

  private async emitPrep(
    workspace: ExecutionWorkspace,
    status: 'preparing' | 'ready' | 'error',
    error: string | undefined,
    scope: PrepareScope,
  ): Promise<void> {
    if (!this.deps.eventBus) return;
    const event: AgentEvent = {
      kind: 'workspace.prep',
      data: {
        workspaceId: workspace.id,
        status,
        ...(error ? { error } : {}),
        ...(scope.chatId ?? (workspace.ownerType === 'chat' ? workspace.ownerId : undefined)
          ? { chatId: scope.chatId ?? workspace.ownerId }
          : {}),
      },
    };
    try {
      if (scope.sessionId) await this.deps.eventBus.emit(scope.sessionId, event);
      else await this.deps.eventBus.emitGlobal(event);
    } catch (err) {
      this.deps.logger.warn(`[Mounts] event emit failed: ${err}`);
    }
  }
}

// ── Exposure ──────────────────────────────────────────────────

/**
 * Pure: derive what the harness should see from a workspace and its mounts.
 * Exported so the resume path and the create path produce byte-identical
 * hints (the prompt-cache prefix depends on it).
 */
export function buildExposure(workspace: ExecutionWorkspace, mounts: WorkspaceMount[]): WorkspaceExposure {
  const ordered = [...mounts].filter((m) => m.status !== 'removed').sort((a, b) => a.position - b.position);
  const scratchDir = path.join(workspace.rootPath, SCRATCH_DIR);
  const primary = ordered[0];
  const workingDirectory = primary?.path ?? workspace.codeRoot ?? workspace.rootPath;
  const extra = new Set<string>();
  for (const m of ordered.slice(1)) extra.add(m.path);
  // The managed root carries scratch, plans and screenshots the agent must
  // be able to read and write. It is an additional directory unless it IS
  // the cwd (a generated mount under source/ is a sibling of scratch/, which
  // grants nothing on its own).
  if (path.resolve(workingDirectory) !== path.resolve(workspace.rootPath)) extra.add(workspace.rootPath);
  const additionalDirectories = [...extra];
  const env = {
    GENERATORAI_WORKSPACE_ROOT: workspace.rootPath,
    GENERATORAI_SCRATCH_DIR: scratchDir,
  };
  const hint = buildWorkspaceHint({ workingDirectory, scratchDir, rootPath: workspace.rootPath, mounts: ordered });
  return {
    rootPath: workspace.rootPath,
    scratchDir,
    workingDirectory,
    additionalDirectories,
    mounts: ordered,
    env,
    hint,
  };
}

// ── Helpers ───────────────────────────────────────────────────

function sanitizeAlias(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 64) : 'mount';
}

function sameBranchIntent(m: WorkspaceMount, p: PlannedMount): boolean {
  const want = p.intent.newBranch ?? p.intent.branch;
  if (!want) return true;
  return m.git?.branch === want;
}

async function assertDirectory(p: string, label: string): Promise<void> {
  try {
    const stat = await fs.stat(p);
    if (!stat.isDirectory()) throw new ValidationError(`${label} is not a directory: ${p}`);
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`${label} does not exist: ${p}`);
  }
}

async function hasDotGit(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function rmWithRetry(target: string, attempts = 4): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (err) {
      last = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 100 * 2 ** i));
    }
  }
  throw last;
}

/** `generatorai/<slug>` material from a chat name + short id. */
export function branchSlugFor(name: string, id: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const short = id.replace(/-/g, '').slice(0, 6);
  return base ? `${base}-${short}` : short;
}

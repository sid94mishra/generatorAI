// ────────────────────────────────────────────────────────────────
// Workspace exposure (WP-2.5): what a session sees of its execution
// workspace — the working directory, the other mounts and the managed root as
// additional directories, the env the agent process gets, and the
// `[Workspace]` hint. One function for chats and stages.
// ────────────────────────────────────────────────────────────────

import * as path from 'node:path';
import type { ExecutionWorkspace, WorkspaceExposure } from '@generatorai/shared';
import type { WorkspaceManager } from '../WorkspaceManager.js';
import { buildWorkspaceHint } from '../chatSystemHints.js';
import type { ConversationConfig } from './cfg.js';
import { ComposeError } from './types.js';

/**
 * The exposure of `workspace`. `workingDirectory` pins the cwd when the
 * engine placed the owner somewhere specific (a run's primary worktree);
 * every other mount and the managed root then become additional directories
 * and the hint names the pinned directory.
 */
export async function workspaceExposure(
  manager: WorkspaceManager,
  workspace: ExecutionWorkspace,
  opts: { workingDirectory?: string | undefined } = {},
): Promise<WorkspaceExposure> {
  const base = await manager.getExposure(workspace);
  const pinned = opts.workingDirectory;
  if (!pinned || path.resolve(pinned) === path.resolve(base.workingDirectory)) return base;
  const extra = new Set<string>();
  for (const d of [base.workingDirectory, ...base.additionalDirectories]) {
    if (path.resolve(d) !== path.resolve(pinned)) extra.add(d);
  }
  if (path.resolve(pinned) === path.resolve(base.rootPath)) extra.delete(base.rootPath);
  return {
    ...base,
    workingDirectory: pinned,
    additionalDirectories: [...extra],
    hint: buildWorkspaceHint({
      workingDirectory: pinned,
      scratchDir: base.scratchDir,
      rootPath: base.rootPath,
      mounts: base.mounts,
    }),
  };
}

/**
 * Put an exposure on a conversation config. Returns the `[Workspace]` hint,
 * which the composer appends after the caller's own system message.
 */
export function applyWorkspaceExposure(cfg: ConversationConfig, exposure: WorkspaceExposure): string | undefined {
  cfg['workingDirectory'] = exposure.workingDirectory;
  if (exposure.additionalDirectories.length > 0) cfg['additionalDirectories'] = exposure.additionalDirectories;
  cfg['env'] = { ...((cfg['env'] as Record<string, string> | undefined) ?? {}), ...exposure.env };
  return exposure.hint;
}

/**
 * A run's execution workspace. Every run has one (created at start); a stage
 * without it cannot be composed — there is no directory to run it in, and no
 * silent fallback to the server's cwd (B-5).
 */
export async function runWorkspace(
  manager: WorkspaceManager,
  run: { id: string; workspaceId?: string | null | undefined },
): Promise<ExecutionWorkspace> {
  const byId = run.workspaceId ? await manager.getExecutionWorkspace(run.workspaceId) : null;
  const workspace = byId ?? (await manager.findWorkspaceByOwner(run.id));
  if (!workspace) {
    throw new ComposeError('workspace_missing', `Workflow run ${run.id} has no execution workspace`);
  }
  return workspace;
}

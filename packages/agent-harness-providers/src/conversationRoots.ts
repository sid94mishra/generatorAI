// ────────────────────────────────────────────────────────────────
// Conversation roots — the cwd + extra directories a live conversation
// runs in. "Edit sources" on a live chat (D-137) moves them between turns;
// each provider compares what it holds with what the next resume asks for
// and rebinds only when they differ.
// ────────────────────────────────────────────────────────────────

import type { CreateConversationParams } from '@generatorai/core';

/** The roots a provider recorded for a live conversation. */
export interface ConversationRoots {
  workingDirectory?: string | undefined;
  additionalDirectories?: string[] | undefined;
}

/**
 * The roots `params` asks for, normalised the way they are compared: the cwd
 * falls back to the provider's default, extra directories are de-duplicated
 * (order kept).
 */
export function rootsOf(
  params: Pick<CreateConversationParams, 'workingDirectory' | 'additionalDirectories'>,
  defaultCwd: string | undefined,
): { workingDirectory: string | undefined; additionalDirectories: string[] } {
  return {
    workingDirectory: params.workingDirectory ?? defaultCwd,
    additionalDirectories: [...new Set(params.additionalDirectories ?? [])],
  };
}

/**
 * Whether a live conversation already runs in the roots `params` asks for
 * (cwd + extra directories, as `createConversation` would store them).
 */
export function sameRoots(
  existing: ConversationRoots,
  params: Pick<CreateConversationParams, 'workingDirectory' | 'additionalDirectories'>,
  defaultCwd: string | undefined,
): boolean {
  const wanted = rootsOf(params, defaultCwd);
  const had = existing.additionalDirectories ?? [];
  return (
    wanted.workingDirectory === existing.workingDirectory &&
    wanted.additionalDirectories.length === had.length &&
    wanted.additionalDirectories.every((d, i) => d === had[i])
  );
}

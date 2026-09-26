// ────────────────────────────────────────────────────────────────
// Chats list row contract (D-36, D-52; 07 M-11, P3-07).
//
// `ChatRowModel` is everything one row of the ChatsList table needs to
// render, already resolved: the live/last-turn Status column (via
// `chatRowState`/`chatRowStatus` in `@generatorai/client-core`), the
// project name joined in from the caller's project cache (the list API only
// carries `projectId`), and the change stats exactly as the server sent them
// (absent, never invented — D-36). Web (`ui/primitives/StatusBadge` +
// `features/chats`) and, next pass, mobile render the same shape.
//
// `CreateChatDraft` is the New chat draft the create surfaces hand to each
// other (04 R-1); `chatNameFromPrompt` names a chat started from a prompt.
//
// Types and pure helpers, dependency-free: only `./status.js` (a sibling ui-contract
// module), never the package root — safe for the Electron main bundle.
// ────────────────────────────────────────────────────────────────

import type { StatusBadgeProps } from './status.js';

/** Net workspace change of a chat: session baseline → working tree. */
export interface ChatRowChanges {
  files: number;
  additions: number;
  deletions: number;
}

export interface ChatRowModel {
  id: string;
  title: string;
  /** Absent when the chat has no project. */
  projectId?: string;
  /** Resolved by the caller from its project cache; absent while unresolved. */
  projectName?: string;
  /** Absent when no agent is bound. */
  agentRef?: string;
  agentName?: string;
  /**
   * The Status column's StatusBadge props (`state` + optional `label`), or
   * `null` when the row shows no status badge: either `archived` (render a
   * neutral "Archived" chip instead) or a chat that has never run (render
   * nothing). `archived` tells the two apart.
   */
  status: Pick<StatusBadgeProps, 'state' | 'label'> | null;
  archived: boolean;
  /** Absent until computed (D-36): render "—", never 0. */
  changes?: ChatRowChanges;
  /** ISO timestamp for the Activity column. */
  lastActivityAt: string;
  tags: readonly string[];
}

/**
 * The New chat draft one create surface hands to another (04 R-1): Home's quick
 * composer "More options" → the New chat dialog / `/chats/new`, carried in the
 * navigation state as `{ draft }`. Every field is optional; the receiver keeps
 * its own defaults for anything absent.
 */
export interface CreateChatDraft {
  /** The typed task; the receiver derives the chat name from it. */
  prompt?: string;
  projectId?: string;
  /** Portable `scope:slug` agent ref. */
  agentRef?: string;
  model?: string;
  /** How the project's codebases are mounted. */
  sourceMode?: 'in-place' | 'worktree';
}

/** A chat name from the first line of a prompt, clipped to `max` characters at a word break. */
export function chatNameFromPrompt(prompt: string, max = 60): string {
  const line = prompt.trim().split('\n')[0]?.trim() ?? '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

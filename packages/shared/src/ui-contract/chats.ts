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
// Types only, dependency-free: only `./status.js` (a sibling ui-contract
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

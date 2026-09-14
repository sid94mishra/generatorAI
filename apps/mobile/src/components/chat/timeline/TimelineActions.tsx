// ────────────────────────────────────────────────────────────────
// TimelineActions — what a row can ask the screen to do.
//
// Rows are memoised on their block identity and rendered by a virtualised
// list, so they cannot take fresh callbacks as props without defeating the
// memo. The screen publishes ONE stable actions object through context; a
// row reads it on tap, never on render.
// ────────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react';
import type { StreamUsage } from '@generatorai/client-core';

import type { ScreenshotRef } from './deriveTimeline';

export interface TimelineActions {
  /** The chat's workspace, when it has one. */
  workspaceId: string | null;
  /**
   * The chat itself.
   *
   * The SCM result row needs it to ask the agent to resolve a merge
   * conflict — the block carries the flow's result, not the chat it ran for.
   */
  chatId?: string | null;
  /** Stream store key (the chat's session id) — what live rows subscribe to. */
  streamKey: string | null;
  /** Usage of the turn before the live one, for the cache-miss rule. */
  previousUsage?: StreamUsage | null;
  /** Jump to the Changes pane focused on a file. */
  openInChanges?: (path: string) => void;
  /** Show a shell call in the Agent Console (a sheet). */
  openConsole?: (callId: string) => void;
  /** Open a screenshot in the image viewer. */
  openImage?: (image: ScreenshotRef) => void;
  /** Read a text row aloud; absent when TTS is unavailable. */
  readAloud?: (text: string) => void;
  /** Open a full-page widget — mobile currently only explains the limitation. */
  toast?: (message: string) => void;

  // ── History actions (§1–§3 of the chat overhaul) ───────────────
  //
  // These live on the CONTEXT rather than on the rows for the reason the
  // header above gives: a row is memoised on its block identity inside a
  // virtualised list, so a fresh `onRewind` per render would defeat the memo
  // for every row in the transcript. The screen owns the sheets, the
  // mutations and the composer draft; a row only says which turn was tapped.

  /**
   * Open the rewind sheet anchored on a user message's turn.
   *
   * `prompt` is passed so the sheet can show what is being rewound to
   * without re-deriving it from a row id.
   */
  onRewind?: (turnId: string, prompt: string) => void;
  /** Branch a new chat from the end of this turn. */
  onForkFrom?: (turnId: string) => void;
  /** Copy the WHOLE chat as markdown (not just this row). */
  onCopyTranscript?: () => void;
}

export const TimelineActionsContext = createContext<TimelineActions>({ workspaceId: null, streamKey: null });

export function useTimelineActions(): TimelineActions {
  return useContext(TimelineActionsContext);
}

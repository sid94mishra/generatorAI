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
}

export const TimelineActionsContext = createContext<TimelineActions>({ workspaceId: null, streamKey: null });

export function useTimelineActions(): TimelineActions {
  return useContext(TimelineActionsContext);
}

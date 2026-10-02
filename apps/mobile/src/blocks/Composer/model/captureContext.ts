// ────────────────────────────────────────────────────────────────
// ComposerCaptureContext — how a pane hands something to the composer.
//
// Web's panels take an `onCapture(file)` prop threaded down from ChatPage.
// On mobile the terminal and browser panes sit several components below the
// chat screen (pager → pane → tab host → view), so the chat screen provides
// the composer's capture actions once and any pane below reads them. Outside
// a chat (the full-screen terminal route) there is no provider and the
// "Send to chat" actions simply do not appear.
// ────────────────────────────────────────────────────────────────

import { createContext, useContext } from 'react';

import type { TerminalCaptureLines } from './captures';

export interface ComposerCaptureActions {
  /** Last N rendered lines of a shell (defaults to the last-viewed one). */
  captureTerminalOutput(lines: TerminalCaptureLines, sessionId?: string): Promise<void>;
  /** Text the user selected in a terminal. */
  captureTerminalSelection(text: string): void;
  /** The browser's whole viewport as a PNG. */
  captureBrowserScreenshot(): Promise<void>;
  /** The page's accessibility tree as markdown. */
  captureBrowserPageText(): Promise<void>;
  /**
   * Whether captures become attachments (true) or, for text, are inserted
   * into the draft (false). Lets a pane label its action honestly.
   */
  attachAvailable: boolean;
}

export const ComposerCaptureContext = createContext<ComposerCaptureActions | null>(null);

export function useComposerCapture(): ComposerCaptureActions | null {
  return useContext(ComposerCaptureContext);
}

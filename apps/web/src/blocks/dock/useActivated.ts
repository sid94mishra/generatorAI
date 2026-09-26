import { useState } from 'react';

/**
 * True from the first render where `active` was true, forever after.
 *
 * Pinned dock tabs (D-27) are mounted with the page, selected or not. A panel
 * that does real work on mount — spawning a PTY, starting a browser session,
 * loading the tree and highlighter chunks — renders nothing heavy until its
 * tab is first shown, then stays mounted (collapse-not-unmount) so switching
 * away never loses the session.
 */
export function useActivated(active: boolean): boolean {
  const [activated, setActivated] = useState(active);
  if (active && !activated) setActivated(true);
  return activated || active;
}

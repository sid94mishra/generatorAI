// Whether a diff viewer under `root` has painted its first file item (U-4).
//
// On a cold open the viewer mounts its items before it can lay them out: the library first creates its
// <diffs-container> elements, then waits for the highlighter worker pool to start (seconds under load) before the
// slotted headers get any height. Until then the list area is blank while the toolbar already says "57 changes".
// The host shows a loading state until this flips; once painted it stays painted (later refetches are not
// re-gated). A viewer that never paints (a test stub, a broken worker) is let through after GIVE_UP_MS.

import { useEffect, useState, type RefObject } from 'react';

const GIVE_UP_MS = 20_000;

export function useDiffPainted(root: RefObject<HTMLElement | null>, expecting: boolean): boolean {
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    if (painted || !expecting) return undefined;
    const started = Date.now();
    let frame = 0;
    const check = () => {
      const item = root.current?.querySelector('diffs-container');
      if ((item && item.getBoundingClientRect().height > 0) || Date.now() - started > GIVE_UP_MS) {
        setPainted(true);
        return;
      }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [painted, expecting, root]);
  return painted;
}

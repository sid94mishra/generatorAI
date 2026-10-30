// Whether Back / Forward can move, for the title strip and the Linux
// native-frame sidebar row (06 §3.4). Chromium's session history is the
// authority (main pushes it); until it has, both stay enabled.

import { useEffect, useState } from 'react';
import { onNavHistoryChanged } from '@/lib/desktop.js';

export function useNavHistory(): { back: boolean; forward: boolean } {
  const [state, setState] = useState({ back: true, forward: true });
  useEffect(() => onNavHistoryChanged(setState), []);
  return state;
}

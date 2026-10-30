// Home-screen quick actions / Android app shortcuts (MX-08, 06 §7.6). The only caller of expo-quick-actions:
//   • `useQuickActionLinks` (root layout): a pressed action — including the one that launched the app — becomes a
//     queued link, resolved through the shared allowlist and the server rules like any deep link (§3.12); not
//     expo-quick-actions' own router hook, which would bypass the allowlist.
//   • `QuickActionItemsSync` (inside the attention provider): writes the items on launch and whenever the Needs-you
//     count changes, so Home's subtitle reads "3 need you".
// Missing module (a client built before M9-07): every call is a no-op.
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as QuickActions from 'expo-quick-actions';

import { linkQueue } from '../navigation/links';
import { useAttention } from '../stream/AttentionProvider';
import { quickActionHref, quickActionItems } from './quickActionItems';

let handledInitial = false;

export function useQuickActionLinks(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!handledInitial) {
      handledInitial = true;
      const href = quickActionHref(QuickActions.initial);
      if (href) linkQueue.enqueue(href);
    }
    const subscription = QuickActions.addListener((action) => {
      const href = quickActionHref(action);
      if (href) linkQueue.enqueue(href);
    });
    return () => subscription.remove();
  }, []);
}

/** Debounce for count changes; the first write is immediate. */
const WRITE_DELAY_MS = 2000;

export function QuickActionItemsSync(): null {
  const attention = useAttention();
  const needsYou = attention.stale ? null : (attention.snapshot?.counts.needsYou ?? 0);
  useEffect(() => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
    const platform = Platform.OS;
    const write = () => {
      void QuickActions.setItems(quickActionItems(needsYou ?? 0, platform)).catch(() => undefined);
    };
    if (needsYou === null) return;
    const timer = setTimeout(write, WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [needsYou]);
  return null;
}

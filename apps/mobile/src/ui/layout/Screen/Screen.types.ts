// ML-01 Screen contract (03 ML-01; MD-22, MD-93).
import type { ReactElement, ReactNode, RefObject } from 'react';
import type { ScrollView } from 'react-native';
import type { HeaderProps } from '../../native/router/Header/Header.types';

export type ScreenState =
  | { kind: 'loading'; skeleton?: ReactElement }
  | { kind: 'error'; error: unknown; onRetry: () => void; title?: string }
  | { kind: 'empty'; empty: ReactElement }
  | { kind: 'offline' }
  | { kind: 'ready' };

export interface ScreenProps {
  /** ML-02 Header (native on iOS; the JS bar on Android). Screen passes it the scroll offset. */
  header: ReactElement<HeaderProps>;
  /** ML-04, under the header (Header already renders its own `status`). */
  statusLine?: ReactElement;
  /** OfflineState banner, Callout banner. */
  banner?: ReactElement;
  /** 'scroll' (default) wraps the content; 'list' hands scrolling to a Legend List child; 'none' fixes it. */
  scroll?: 'none' | 'scroll' | 'list';
  /** 'grouped' = bg-ground (iOS grouped settings screens). */
  background?: 'plain' | 'grouped';
  /** Pull to refresh (MD-93; never on the transcript). */
  onRefresh?: () => Promise<void>;
  /** NewAction, StickyActionBar, Composer, BottomToolbar: pinned to the bottom; the content gets its height as inset. */
  bottomAccessory?: ReactElement;
  /** 'form' scrolls focused fields above the keyboard; 'chat' leaves it to the chat. Default 'none'. */
  keyboard?: 'none' | 'form' | 'chat';
  state?: ScreenState;
  /** The body's ScrollView ('scroll' mode), for a screen that scrolls to a section (Home's count tiles). */
  scrollRef?: RefObject<ScrollView | null>;
  children?: ReactNode;
  testID?: string;
}

// ML-30 DirtyGuard contract (03 ML-30; 06 §3.7).

/** The slice of a navigation object the guard needs (features pass `useNavigation()`; ui/ never imports the router). */
export interface RemovalSource {
  addListener: (event: 'beforeRemove', callback: (e: { preventDefault: () => void; data: { action: unknown } }) => void) => () => void;
  dispatch: (action: never) => void;
  /** False while another screen is pushed over this one (Android Back then belongs to that screen). */
  isFocused?: () => boolean;
}

export interface DirtyGuardOptions {
  /** Runs after "Discard" on Android Back (usually: close the sheet / editor). Without it Back is not intercepted. */
  onDiscard?: () => void;
  /** Router removal (back swipe, header back, router.back()) is blocked while dirty and confirmed. */
  navigation?: RemovalSource;
  title?: string;
  message?: string;
}

export interface DirtyGuard {
  /** Runs fn now when clean; when dirty only after "Discard". */
  guard: <T>(fn: () => T) => Promise<T | undefined>;
  /** Asks "Discard changes?"; true when the user discards (or nothing is dirty). */
  confirmDiscard: () => Promise<boolean>;
}

// Pure Screen logic (03 ML-01): what the body shows for a state, and what is announced when it changes.
import type { ScreenState } from './Screen.types';

export type ScreenBody = 'skeleton' | 'spinner' | 'error' | 'empty' | 'offline' | 'content';

export function screenBody(state: ScreenState | undefined): ScreenBody {
  switch (state?.kind) {
    case 'loading':
      return state.skeleton ? 'skeleton' : 'spinner';
    case 'error':
      return 'error';
    case 'empty':
      return 'empty';
    case 'offline':
      return 'offline';
    default:
      return 'content';
  }
}

/** Announced when the state changes (screen readers): "Loaded" after loading, the error title on failure. */
export function stateAnnouncement(previous: ScreenState['kind'] | undefined, next: ScreenState['kind'] | undefined, errorTitle?: string): string | null {
  if (previous === next) return null;
  if (previous === 'loading' && (next === 'ready' || next === 'empty' || next === undefined)) return 'Loaded';
  if (next === 'error') return errorTitle ?? "Couldn't load";
  if (next === 'offline') return 'Offline';
  return null;
}

/** Reading width on expanded windows (03 ML-01): 720. */
export const READING_WIDTH = 720;

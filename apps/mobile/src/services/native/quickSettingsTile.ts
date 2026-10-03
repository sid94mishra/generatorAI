// The Android Quick Settings tile "New chat" (MX-06, 06 §7.5; MD-189), in the generatorai-live module: the app keeps
// its state current (unavailable when nothing is paired; subtitle "N need you" from the widget snapshot) and, on
// Android 13+, can ask the user to add it. iOS has the Control Center control instead (targets/controls), which needs
// no state. Every call is a no-op without the module.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

import type { WidgetSnapshot } from '../live/widgetSnapshot';

export type AddTileResult = 'added' | 'already' | 'dismissed' | 'unsupported' | 'failed';

interface TileNative {
  setTileState(paired: boolean, subtitle: string | null): void;
  canRequestAddTile(): boolean;
  requestAddTile(): Promise<AddTileResult>;
}

const tile = Platform.OS === 'android' ? requireOptionalNativeModule<TileNative>('GeneratorAILive') : null;

export function tileAvailable(): boolean {
  return tile !== null;
}

/** "3 need you"; none at zero (title-safe: a count only). */
export function tileSubtitle(needsYou: number): string | null {
  return needsYou > 0 ? `${needsYou} need you` : null;
}

let last = '';
export function setTileFromSnapshot(snapshot: WidgetSnapshot): void {
  if (!tile) return;
  const paired = snapshot.serverId !== '';
  const subtitle = paired ? tileSubtitle(snapshot.counts.needsYou) : null;
  const key = `${paired}|${subtitle ?? ''}`;
  if (key === last) return;
  last = key;
  try {
    tile.setTileState(paired, subtitle);
  } catch {
    last = '';
  }
}

export function canRequestAddTile(): boolean {
  try {
    return tile?.canRequestAddTile() === true;
  } catch {
    return false;
  }
}

export async function requestAddTile(): Promise<AddTileResult> {
  if (!tile) return 'unsupported';
  try {
    return await tile.requestAddTile();
  } catch {
    return 'failed';
  }
}

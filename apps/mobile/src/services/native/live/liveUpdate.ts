// Android Live Update driver (MX-02, 06 §7.3; MD-187): the local generatorai-live module posts one ongoing
// ProgressStyle notification per followed item under a `specialUse` foreground service (started from the
// foreground only), promoted to a status-bar chip on Android 16 when allowed. Null off Android or in a client built
// without the module. The module also stores the widget palette in SharedPreferences (02 §2.6).
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { LiveState } from '@generatorai/client-core';

import { toAndroidLiveUpdate, type AndroidLiveUpdate } from '../../live/liveSurfaceModel';
import { addPaletteWriter, type WidgetPalette } from '../widgetPalette';
import type { LiveSurfaceDriver } from './types';

interface GeneratorAILiveNative {
  isSupported(): boolean;
  canPostPromoted(): Promise<boolean>;
  activeKeys(): Promise<string[]>;
  upsert(update: AndroidLiveUpdate): Promise<void>;
  end(key: string, finalState: AndroidLiveUpdate | null, timeoutMs: number): Promise<void>;
  endAll(): Promise<void>;
  setWidgetPalette(json: string): void;
}

export const liveModule: GeneratorAILiveNative | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<GeneratorAILiveNative>('GeneratorAILive') : null;

if (liveModule) addPaletteWriter((json) => liveModule.setWidgetPalette(json));

function createDriver(native: GeneratorAILiveNative): LiveSurfaceDriver {
  const sent = new Map<string, string>();

  return {
    // A JS reload keeps the service and its notifications: the module knows which keys are still up.
    activeKeys: () => native.activeKeys().catch(() => []),

    async show(state: LiveState, palette: WidgetPalette) {
      const update = toAndroidLiveUpdate(state, palette);
      const fingerprint = JSON.stringify(update);
      if (sent.get(state.key) === fingerprint) return;
      sent.set(state.key, fingerprint);
      await native.upsert(update);
    },

    async finish(state: LiveState, palette: WidgetPalette, at: Date) {
      sent.delete(state.key);
      await native.end(state.key, toAndroidLiveUpdate(state, palette), Math.max(0, at.getTime() - Date.now()));
    },

    async drop(key: string) {
      sent.delete(key);
      await native.end(key, null, 0);
    },
  };
}

let driver: LiveSurfaceDriver | null | undefined;

export function liveUpdateDriver(): LiveSurfaceDriver | null {
  if (driver === undefined) driver = liveModule ? createDriver(liveModule) : null;
  return driver;
}

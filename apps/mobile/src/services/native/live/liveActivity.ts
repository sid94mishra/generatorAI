// iOS Live Activity driver (MX-01, 06 §7.3; MD-32 phase 1: local start / update / end while the app holds the stream,
// `staleDate` covers suspension). One activity per followed item; the ActivityKit id per live key is kept in MMKV and
// reconciled with `getInstances()` after a relaunch, so an activity the app lost track of is ended rather than left
// stale on the Lock Screen. Null when this is not iOS or the client was built without expo-widgets.
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { LiveState } from '@generatorai/client-core';

import { prefs } from '../../storage/prefs';
import { toLiveActivityProps, type LiveActivityProps } from '../../live/liveSurfaceModel';
import type { WidgetPalette } from '../widgetPalette';
import type { LiveSurfaceDriver } from './types';

/** MMKV: live key → ActivityKit id. */
const IDS_KEY = 'live.activityIds';

interface ActivityHandle {
  getId(): string;
  update(props: LiveActivityProps, staleDate?: Date): Promise<void>;
  end(policy?: 'default' | 'immediate' | { after: Date }, props?: LiveActivityProps, contentDate?: Date): Promise<void>;
}
interface ActivityFactory {
  start(props: LiveActivityProps, url?: string, staleDate?: Date): ActivityHandle;
  getInstances(): ActivityHandle[];
}

function loadFactory(): ActivityFactory | null {
  if (Platform.OS !== 'ios' || requireOptionalNativeModule('ExpoWidgets') === null) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('./RunActivity') as { RunActivity: ActivityFactory }).RunActivity;
  } catch {
    return null;
  }
}

function readIds(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(prefs.getString(IDS_KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

const ignore = (): void => undefined;

function createDriver(factory: ActivityFactory): LiveSurfaceDriver {
  const ids = readIds();
  /** Last props sent per key, so an unchanged item is not re-sent (ActivityKit budgets updates). */
  const sent = new Map<string, string>();
  const save = (): void => prefs.setString(IDS_KEY, JSON.stringify(ids));
  /** Set when ActivityKit refuses to start (Live Activities off in iOS Settings): no retry storm. */
  let refusedAt = 0;

  const instances = (): Map<string, ActivityHandle> => {
    try {
      return new Map(factory.getInstances().map((a) => [a.getId(), a]));
    } catch {
      return new Map();
    }
  };
  const handle = (key: string): ActivityHandle | undefined => (ids[key] ? instances().get(ids[key]!) : undefined);
  const forget = (key: string): void => {
    delete ids[key];
    sent.delete(key);
    save();
  };

  return {
    activeKeys() {
      const live = instances();
      const known = new Set<string>();
      for (const [key, id] of Object.entries(ids)) {
        if (live.has(id)) known.add(id);
        else delete ids[key];
      }
      // An activity no key owns (the MMKV write was lost): end it rather than leave it on the Lock Screen.
      for (const [id, activity] of live) if (!known.has(id)) void activity.end('immediate').catch(ignore);
      save();
      return Object.keys(ids);
    },

    async show(state: LiveState, palette: WidgetPalette) {
      const props = toLiveActivityProps(state, palette);
      const staleDate = new Date(state.staleAt);
      const fingerprint = JSON.stringify([props, state.staleAt]);
      if (sent.get(state.key) === fingerprint) return;
      const existing = handle(state.key);
      if (existing) {
        await existing.update(props, staleDate);
        sent.set(state.key, fingerprint);
        return;
      }
      // ActivityKit starts an activity only for a foreground app: a start attempted while going to the background
      // (the background flush) would be refused and then block the retry for a minute; the next foreground
      // evaluation starts it instead.
      if (AppState.currentState !== 'active' || Date.now() - refusedAt < 60_000) return;
      try {
        const activity = factory.start(props, state.deepLink, staleDate);
        ids[state.key] = activity.getId();
        sent.set(state.key, fingerprint);
        save();
      } catch {
        refusedAt = Date.now();
      }
    },

    async finish(state: LiveState, palette: WidgetPalette, at: Date) {
      const activity = handle(state.key);
      forget(state.key);
      await activity?.end({ after: at }, toLiveActivityProps(state, palette), new Date(state.updatedAt));
    },

    async drop(key: string) {
      const activity = handle(key);
      forget(key);
      await activity?.end('immediate');
    },
  };
}

let driver: LiveSurfaceDriver | null | undefined;

/** The iOS driver, created on first use; null off iOS or without the native module. */
export function liveActivityDriver(): LiveSurfaceDriver | null {
  if (driver === undefined) {
    const factory = loadFactory();
    driver = factory ? createDriver(factory) : null;
  }
  return driver;
}

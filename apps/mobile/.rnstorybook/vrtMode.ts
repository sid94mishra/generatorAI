// VRT mode (08 §4.6 step 2): with `EXPO_PUBLIC_VRT=1` on a Storybook dev build, every capture is deterministic — the
// clock is frozen at 2026-10-01 09:41 UTC (so "3 min ago", elapsed timers and dates never move), Math.random is seeded,
// and Reduce Motion is forced (spinners and the scan line hold still, panels jump). Imported first by Screen.tsx so it
// runs before any story module evaluates. Never part of a release build (the Storybook route redirects there).
import { LogBox } from 'react-native';

import { setMotionPreference } from '../src/ui/platform/motion';

export const VRT = __DEV__ && process.env.EXPO_PUBLIC_VRT === '1';

if (VRT) {
  const FIXED = Date.UTC(2026, 9, 1, 9, 41, 0);
  const RealDate = Date;
  class FrozenDate extends RealDate {
    constructor(...args: ConstructorParameters<DateConstructor> | []) {
      if (args.length === 0) super(FIXED);
      else super(...(args as ConstructorParameters<DateConstructor>));
    }
    static now(): number {
      return FIXED;
    }
  }
  globalThis.Date = FrozenDate as DateConstructor;
  // mulberry32: the same sequence every launch.
  let seed = 0x9e3779b9;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  setMotionPreference('reduced');
  // A story's dev warning would draw the LogBox banner into the capture (and over the ready marker).
  LogBox.ignoreAllLogs(true);
}

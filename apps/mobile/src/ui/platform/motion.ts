// Motion (mobile 02 §6; MD-76): `useReduceMotion()` merges the OS switch with the app preference
// (Settings › Motion: 'system' | 'reduced' | 'full', pushed by the preferences bridge), and
// `useMotion(concept)` turns MOTION_CONCEPTS into Reanimated configs for this platform, with
// Reanimated's own `reduceMotion` set so worklet-driven animations collapse too.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';
import { Easing, ReduceMotion, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';
import { MOTION_CONCEPTS, type MotionConcept, type MotionSpec, type ReducedSpec } from '@generatorai/design-tokens';

export type MotionPreference = 'system' | 'reduced' | 'full';

let preference: MotionPreference = 'system';
let osReduced = false;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((l) => l());

/** Pushed by the preferences bridge (Settings › Motion). */
export function setMotionPreference(next: MotionPreference): void {
  if (preference === next) return;
  preference = next;
  notify();
}

/** Effective value for a preference and the OS switch (exported for tests). */
export function reduceMotionFor(pref: MotionPreference, os: boolean): boolean {
  return pref === 'reduced' ? true : pref === 'full' ? false : os;
}

let subscribedToOs = false;
function ensureOsSubscription(): void {
  if (subscribedToOs) return;
  subscribedToOs = true;
  void AccessibilityInfo.isReduceMotionEnabled?.()
    .then((value) => {
      osReduced = value;
      notify();
    })
    .catch(() => undefined);
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value: boolean) => {
    osReduced = value;
    notify();
  });
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useReduceMotion(): boolean {
  useEffect(ensureOsSubscription, []);
  return useSyncExternalStore(subscribe, () => reduceMotionFor(preference, osReduced));
}

export type MotionConfig =
  | { type: 'spring'; config: WithSpringConfig }
  | { type: 'timing'; config: WithTimingConfig }
  | { type: 'native' }
  | null;

export interface ResolvedMotion {
  spatial: MotionConfig;
  effects: MotionConfig;
  reduced: boolean;
  /** press only: the scale to press to (02 §6.2). */
  pressScale?: { default: number; large: number };
}

function toConfig(spec: MotionSpec | ReducedSpec, reduceMotion: ReduceMotion): MotionConfig {
  switch (spec.kind) {
    case 'spring':
      return { type: 'spring', config: { stiffness: spec.stiffness, damping: spec.damping, mass: spec.mass, reduceMotion } };
    case 'timing':
      return {
        type: 'timing',
        config: { duration: spec.duration, easing: spec.easing === 'linear' ? Easing.linear : Easing.bezier(0.2, 0, 0, 1), reduceMotion },
      };
    case 'fade':
      return { type: 'timing', config: { duration: spec.duration, easing: Easing.bezier(0.2, 0, 0, 1), reduceMotion } };
    case 'native':
      return { type: 'native' };
    case 'none':
      return null;
  }
}

/** Pure resolution (exported for tests). Under reduced motion both channels take the concept's reduced spec. */
export function resolveMotion(concept: MotionConcept, platform: 'ios' | 'android', reduced: boolean): ResolvedMotion {
  const spec = MOTION_CONCEPTS[concept];
  const rm = reduced ? ReduceMotion.Always : ReduceMotion.Never;
  if (reduced) {
    const r = toConfig(spec.reduced, rm);
    return { spatial: r, effects: r, reduced };
  }
  const p = spec[platform];
  return { spatial: toConfig(p.spatial, rm), effects: toConfig(p.effects, rm), reduced, pressScale: spec.pressScale };
}

export function useMotion(concept: MotionConcept): ResolvedMotion {
  const reduced = useReduceMotion();
  return useMemo(() => resolveMotion(concept, Platform.OS === 'android' ? 'android' : 'ios', reduced), [concept, reduced]);
}

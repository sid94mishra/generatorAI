// The platform layer on both OSes (jest-expo runs this file once as iOS and once as Android).
import { Platform } from 'react-native';
import { HAPTICS } from '@generatorai/design-tokens';

jest.mock('expo-haptics', () => {
  const actual = jest.requireActual('expo-haptics');
  return {
    ...actual,
    selectionAsync: jest.fn(() => Promise.resolve()),
    impactAsync: jest.fn(() => Promise.resolve()),
    notificationAsync: jest.fn(() => Promise.resolve()),
    performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  };
});

import * as Haptics from 'expo-haptics';
import { geometry } from './geometry';
import { adjacentGapFor, hitFrame, hitFrameFor } from './hit';
import { androidMemberFor, haptic, setHapticsEnabled } from './haptics';
import { reduceMotionFor, resolveMotion } from './motion';
import { sizeClassFor } from './breakpoints';
import { detailOptionsFor, sheetOptionsFor } from './presentation';
import { edgeSwipeOpensDrawerOn } from './gestures';
import { pressFeedbackFor } from './pressFeedback';
import { maxScaleFor } from './fontScale';
import { nouns } from './nouns';

const android = Platform.OS === 'android';

describe(`platform layer (${Platform.OS})`, () => {
  it('reads the platform geometry slot', () => {
    expect(geometry().minHitTarget).toBe(android ? 48 : 44);
    expect(geometry().unit).toBe(android ? 'dp' : 'pt');
  });

  it('grows a drawn control to the hit target with frame padding (MD-91)', () => {
    expect(hitFrame(44, 36, 36)).toEqual({ paddingHorizontal: 4, paddingVertical: 4 });
    expect(hitFrame(48, 60, 20)).toEqual({ paddingHorizontal: 0, paddingVertical: 14 });
    expect(hitFrameFor(36, 36)).toEqual(android ? { paddingHorizontal: 6, paddingVertical: 6 } : { paddingHorizontal: 4, paddingVertical: 4 });
    expect(adjacentGapFor(36)).toBe(android ? 12 : 8);
  });

  it('plays the platform haptic, throttles repeats and honours the switch (MD-78)', () => {
    jest.clearAllMocks();
    setHapticsEnabled(true);
    haptic('selection', 1_000);
    haptic('selection', 1_010); // throttled
    haptic('selection', 1_100);
    const calls = android ? (Haptics.performAndroidHapticsAsync as jest.Mock).mock.calls : (Haptics.selectionAsync as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    setHapticsEnabled(false);
    haptic('error', 5_000);
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    setHapticsEnabled(true);
  });

  it('walks the Android chain by API level', () => {
    expect(androidMemberFor(HAPTICS.selection, 34)).toBe('Segment_Tick');
    expect(androidMemberFor(HAPTICS.selection, 30)).toBe('Clock_Tick');
    expect(androidMemberFor(HAPTICS.success, 24)).toBe('Virtual_Key');
  });

  it('resolves motion concepts and the reduced-motion rule (MD-76)', () => {
    expect(reduceMotionFor('system', true)).toBe(true);
    expect(reduceMotionFor('full', true)).toBe(false);
    expect(reduceMotionFor('reduced', false)).toBe(true);
    const panel = resolveMotion('panel', 'ios', false);
    expect(panel.spatial).toMatchObject({ type: 'spring', config: { stiffness: 157.91, damping: 25.13 } });
    expect(resolveMotion('panel', 'android', false).spatial).toMatchObject({ type: 'spring', config: { stiffness: 700 } });
    expect(resolveMotion('panel', 'ios', true).spatial).toMatchObject({ type: 'timing', config: { duration: 180 } });
    expect(resolveMotion('press', 'android', false).spatial).toBeNull();
    expect(resolveMotion('press', 'ios', false).pressScale).toEqual({ default: 0.97, large: 0.985 });
    expect(resolveMotion('sheet', 'ios', false).spatial).toEqual({ type: 'native' });
  });

  it('classifies window widths (MD-24)', () => {
    expect([sizeClassFor(390), sizeClassFor(600), sizeClassFor(839), sizeClassFor(840)]).toEqual(['compact', 'medium', 'medium', 'expanded']);
  });

  it('builds sheet options per OS (06 §3.7)', () => {
    expect(sheetOptionsFor('ios', 'picker')).toMatchObject({ presentation: 'formSheet', sheetAllowedDetents: [0.5, 1], sheetGrabberVisible: true });
    expect(sheetOptionsFor('android', 'large')).toEqual({ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: [1], sheetCornerRadius: 28 });
    expect(detailOptionsFor('android')).toMatchObject({ animation: 'slide_from_right', gestureEnabled: true });
    expect(detailOptionsFor('ios')).toMatchObject({ animation: 'default', fullScreenGestureEnabled: false });
  });

  it('opens the drawer by edge only on iOS module roots in the compact class (MD-19)', () => {
    const ctx = { role: 'top' as const, sizeClass: 'compact' as const, surfaceOwnsGestures: false };
    expect(edgeSwipeOpensDrawerOn('ios', ctx)).toBe(true);
    expect(edgeSwipeOpensDrawerOn('android', ctx)).toBe(false);
    expect(edgeSwipeOpensDrawerOn('ios', { ...ctx, role: 'detail' })).toBe(false);
    expect(edgeSwipeOpensDrawerOn('ios', { ...ctx, sizeClass: 'medium' })).toBe(false);
    expect(edgeSwipeOpensDrawerOn('ios', { ...ctx, surfaceOwnsGestures: true })).toBe(false);
  });

  it('maps press feedback, text caps and nouns per OS', () => {
    expect(pressFeedbackFor('android', 'scale')).toBe('ripple');
    expect(pressFeedbackFor('ios', 'scale')).toBe('scale');
    expect(maxScaleFor('display')).toBe(1.3);
    expect(maxScaleFor('body')).toBe(0);
    expect(maxScaleFor('body', true)).toBe(1.4);
    expect(maxScaleFor('title', true)).toBe(1.4);
    expect(nouns().biometric).toBe(android ? 'fingerprint' : 'Face ID');
  });
});

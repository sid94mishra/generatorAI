import { describe, expect, it } from 'vitest';
import type { RawDeviceSnapshot } from '../../../domain/ports/IDeviceBridge.js';
import { ancestorsOf, buildSnapshot, diffSnapshots, elementAt, findElement, formatSnapshot } from '../deviceSnapshot.js';
import { parseDeviceStep } from '../../../tools/devices/index.js';

const raw = (elements: RawDeviceSnapshot['elements'], app = 'com.example'): RawDeviceSnapshot => ({
  app,
  screen: { width: 402, height: 874, unit: 'pt' },
  elements,
});

const el = (role: string, label: string | undefined, frame: [number, number, number, number], depth = 0, extra: object = {}) => ({
  role,
  ...(label ? { label } : {}),
  enabled: true,
  interactive: role === 'Button' || role === 'TextField',
  frame: { x: frame[0], y: frame[1], w: frame[2], h: frame[3] },
  depth,
  ...extra,
});

const screen = raw([
  el('Group', undefined, [0, 0, 1, 1], 0),
  el('Cell', 'Account', [0, 0.2, 1, 0.1], 1),
  el('Button', 'Sign in', [0.1, 0.22, 0.3, 0.06], 2),
  el('TextField', 'Email', [0.1, 0.4, 0.8, 0.05], 1, { value: '' }),
]);

describe('buildSnapshot', () => {
  it('numbers meaningful elements in order and links parents', () => {
    const snap = buildSnapshot('ios:A', 'ios', screen);
    expect(snap.elements.map((e) => e.ref)).toEqual(['e1', 'e2', 'e3']);
    expect(snap.elements[1]).toMatchObject({ label: 'Sign in', parent: 'e1' });
    expect(ancestorsOf(snap, snap.elements[1]!).map((a) => a.label)).toEqual(['Account']);
  });

  it('keeps every element with all', () => {
    expect(buildSnapshot('ios:A', 'ios', screen, { all: true }).elements).toHaveLength(4);
  });
});

describe('formatSnapshot', () => {
  it('prints refs, roles, labels and centres', () => {
    const text = formatSnapshot(buildSnapshot('ios:A', 'ios', screen));
    expect(text).toContain('App: com.example');
    expect(text).toMatch(/e2 Button "Sign in" @0\.25,0\.25/);
  });
});

describe('diffSnapshots', () => {
  const before = buildSnapshot('ios:A', 'ios', screen);
  it('reports additions, value changes and removals', () => {
    const after = buildSnapshot(
      'ios:A',
      'ios',
      raw([
        el('Cell', 'Account', [0, 0.2, 1, 0.1], 1),
        el('TextField', 'Email', [0.1, 0.4, 0.8, 0.05], 1, { value: 'ada@x.io' }),
        el('Button', 'Continue', [0.1, 0.6, 0.8, 0.06], 1),
      ]),
    );
    const text = diffSnapshots(before, after);
    expect(text).toContain('+ e3 Button "Continue"');
    expect(text).toContain('~ e2 TextField "Email" value="ada@x.io"');
    expect(text).toContain('- 1 element(s) gone');
  });

  it('says so when nothing changed', () => {
    expect(diffSnapshots(before, buildSnapshot('ios:A', 'ios', screen))).toMatch(/^No visible change/);
  });
});

describe('elementAt / findElement', () => {
  const snap = buildSnapshot('ios:A', 'ios', screen);
  it('hit-tests the smallest interactive element', () => {
    expect(elementAt(snap, 0.2, 0.25)?.label).toBe('Sign in');
    expect(elementAt(snap, 0.9, 0.25)?.label).toBe('Account');
    expect(elementAt(snap, 0.5, 0.95)).toBeUndefined();
  });

  it('finds by ref, exact label, then partial label', () => {
    expect(findElement(snap, 'e3')?.label).toBe('Email');
    expect(findElement(snap, 'sign in')?.ref).toBe('e2');
    expect(findElement(snap, 'Acc')?.ref).toBe('e1');
    expect(findElement(snap, 'nothing')).toBeUndefined();
  });
});

describe('parseDeviceStep', () => {
  it('accepts each action and rejects malformed ones', () => {
    expect(parseDeviceStep({ action: 'tap', target: 'e2' }, 0)).toEqual({ action: 'tap', target: 'e2' });
    expect(parseDeviceStep({ action: 'type', text: 'hi', submit: true }, 0)).toEqual({ action: 'type', text: 'hi', submit: true });
    expect(parseDeviceStep({ action: 'scroll', direction: 'down' }, 0)).toEqual({ action: 'scroll', direction: 'down' });
    expect(parseDeviceStep({ action: 'press', key: 'back' }, 0)).toEqual({ action: 'press', key: 'back' });
    expect(() => parseDeviceStep({ action: 'press', key: 'power' }, 1)).toThrow(/step 2: press needs key/);
    expect(() => parseDeviceStep({ action: 'scroll' }, 0)).toThrow(/direction/);
    expect(() => parseDeviceStep({ action: 'fly' }, 0)).toThrow(/action is one of/);
  });
});

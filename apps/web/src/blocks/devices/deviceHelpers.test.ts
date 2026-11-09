import { describe, expect, it } from 'vitest';
import type { DeviceInfo, DeviceSnapshot } from '@generatorai/shared';
import { annexBNalUnits, codecFromAnnexB, codecFromAvcc, concatBytes, parseDeviceFrame } from './deviceFrames.js';
import { ancestorsOf, elementAt, elementSummary } from './deviceSelection.js';

function frame(codec: number, flags: number, payload: number[]): ArrayBuffer {
  const buf = new ArrayBuffer(16 + payload.length);
  const view = new DataView(buf);
  view.setUint8(0, 0x47);
  view.setUint8(1, 1);
  view.setUint8(2, codec);
  view.setUint8(3, flags);
  view.setUint16(4, 1080);
  view.setUint16(6, 2424);
  view.setFloat64(8, 1234);
  new Uint8Array(buf, 16).set(payload);
  return buf;
}

describe('device frames', () => {
  it('reads the config flag on top of the screencast header', () => {
    const f = parseDeviceFrame(frame(3, 2, [0, 0, 0, 1, 0x67, 0x64, 0, 0x28]))!;
    expect(f).toMatchObject({ codec: 3, config: true, keyframe: false, width: 1080, height: 2424, timestamp: 1234 });
    expect(parseDeviceFrame(frame(2, 1, [1, 2]))!.keyframe).toBe(true);
    expect(parseDeviceFrame(new ArrayBuffer(4))).toBeNull();
  });

  it('splits Annex-B NAL units and derives the codec from the SPS', () => {
    const config = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28, 0xac, 0, 0, 1, 0x68, 0xee, 0x3c]);
    expect(annexBNalUnits(config).map((n) => n[0])).toEqual([0x67, 0x68]);
    expect(codecFromAnnexB(config)).toBe('avc1.640028');
    expect(codecFromAnnexB(new Uint8Array([0, 0, 1, 0x68, 1]))).toBeNull();
  });

  it('derives the codec from an avcC record and joins byte arrays', () => {
    expect(codecFromAvcc(new Uint8Array([1, 0x42, 0xc0, 0x1f, 0xff]))).toBe('avc1.42c01f');
    expect(Array.from(concatBytes(new Uint8Array([1]), new Uint8Array([2, 3])))).toEqual([1, 2, 3]);
  });
});

const snapshot: DeviceSnapshot = {
  device: 'ios:A',
  platform: 'ios',
  app: 'com.example',
  screen: { width: 402, height: 874, unit: 'pt' },
  capturedAt: 0,
  elements: [
    { ref: 'e1', role: 'Cell', label: 'Account', enabled: true, interactive: true, frame: { x: 0, y: 0.2, w: 1, h: 0.1 } },
    { ref: 'e2', role: 'Button', label: 'Sign in', id: 'login', enabled: true, interactive: true, frame: { x: 0.1, y: 0.22, w: 0.3, h: 0.06 }, parent: 'e1' },
  ],
};

const device: DeviceInfo = { key: 'ios:A', platform: 'ios', kind: 'simulator', name: 'iPhone 17', osVersion: 'iOS 27.0', state: 'running', agentAccess: true };

describe('device selection', () => {
  it('hit-tests the smallest element and walks its ancestors', () => {
    const el = elementAt(snapshot, 0.2, 0.25)!;
    expect(el.ref).toBe('e2');
    expect(ancestorsOf(snapshot, el).map((a) => a.ref)).toEqual(['e1']);
    expect(elementAt(snapshot, 0.9, 0.9)).toBeUndefined();
  });

  it('summarises a picked element for the agent', () => {
    const summary = elementSummary(device, snapshot, snapshot.elements[1]!) as {
      element: { boundsNative: { x: number; width: number; unit: string }; id: string };
      path: string;
      app: string;
    };
    expect(summary.app).toBe('com.example');
    expect(summary.element.id).toBe('login');
    expect(summary.element.boundsNative).toMatchObject({ x: 40, width: 121, unit: 'pt' });
    expect(summary.path).toBe('Cell "Account" › Button "Sign in" #login');
  });
});

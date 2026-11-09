import { describe, expect, it } from 'vitest';
import { parseUiautomatorDump } from '../uiautomatorXml.js';
import { parseIosAccessibility } from '../iosAccessibility.js';
import { hidStrokeFor, hidStrokesFor, HID_NAMED_KEYS } from '../hidKeys.js';
import { AvccEnvelopeReader, AVCC_TAG, avcCodecString } from '../avccEnvelope.js';
import { escapeInputText, parseAdbDevices, parseDisplaySize } from '../AndroidBridge.js';
import { parseSimctlList } from '../IosSimulatorBridge.js';
import { androidVersionForTarget } from '../androidSdk.js';

const DUMP = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][1080,2400]">
<node index="0" text="Welcome &amp; hello" resource-id="com.example.app:id/title" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,100][1080,200]" />
<node index="1" text="" resource-id="com.example.app:id/email" class="android.widget.EditText" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" hint="Email" bounds="[40,300][1040,420]" />
<node index="2" text="" resource-id="" class="android.widget.EditText" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="true" selected="false" bounds="[40,450][1040,570]" />
<node index="3" text="Sign in" resource-id="com.example.app:id/go" class="android.widget.Button" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="false" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,1200][1040,1320]" />
<node index="4" text="" resource-id="" class="android.widget.Switch" package="com.example.app" content-desc="Dark mode" checkable="true" checked="true" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[40,1400][1040,1500]" />
</node>
<node index="1" text="" resource-id="" class="android.view.View" package="com.android.systemui" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][0,0]" />
</hierarchy>`;

describe('parseUiautomatorDump', () => {
  const snap = parseUiautomatorDump(DUMP, { width: 1080, height: 2400 });

  it('normalises frames, decodes entities and maps classes to roles', () => {
    const title = snap.elements.find((e) => e.label === 'Welcome & hello')!;
    expect(title.role).toBe('StaticText');
    expect(title.frame.y).toBeCloseTo(100 / 2400);
    expect(title.frame.w).toBe(1);
    expect(title.depth).toBe(1);
  });

  it('labels a field by its hint and marks a password field', () => {
    const email = snap.elements.find((e) => e.id === 'com.example.app:id/email')!;
    expect(email).toMatchObject({ role: 'TextField', label: 'Email', interactive: true });
    expect(snap.elements.some((e) => e.role === 'SecureTextField')).toBe(true);
  });

  it('keeps disabled state and switch values', () => {
    expect(snap.elements.find((e) => e.label === 'Sign in')).toMatchObject({ role: 'Button', enabled: false });
    expect(snap.elements.find((e) => e.label === 'Dark mode')).toMatchObject({ role: 'Switch', value: 'on' });
  });

  it('treats a clickable TextView (a launcher icon) as a button', () => {
    const icon = parseUiautomatorDump(
      '<hierarchy><node class="android.widget.FrameLayout" package="l" bounds="[0,0][100,200]"><node text="Gmail" class="android.widget.TextView" package="l" clickable="true" bounds="[0,0][50,50]" /></node></hierarchy>',
      { width: 100, height: 200 },
    );
    expect(icon.elements.find((e) => e.label === 'Gmail')).toMatchObject({ role: 'Button', interactive: true });
  });

  it('drops zero-size nodes and names the foreground app', () => {
    expect(snap.elements.every((e) => e.frame.w > 0 && e.frame.h > 0)).toBe(true);
    expect(snap.app).toBe('com.example.app');
  });

  it('places a dialog by the display size, not by its own window', () => {
    const dialog = parseUiautomatorDump(
      '<hierarchy rotation="0"><node class="android.widget.FrameLayout" package="android" bounds="[28,907][1052,1493]"><node text="Close app" class="android.widget.Button" package="android" clickable="true" bounds="[80,1300][540,1420]" /></node></hierarchy>',
      { width: 1080, height: 2400 },
    );
    expect(dialog.screen).toEqual({ width: 1080, height: 2400, unit: 'px' });
    const close = dialog.elements.find((e) => e.label === 'Close app')!;
    expect(close.frame.x + close.frame.w / 2).toBeCloseTo(310 / 1080);
    expect(close.frame.y + close.frame.h / 2).toBeCloseTo(1360 / 2400);
  });
});

describe('parseIosAccessibility', () => {
  const json = JSON.stringify([
    {
      type: 'Application',
      AXLabel: 'Settings',
      frame: { x: 0, y: 0, width: 402, height: 874 },
      children: [
        { type: 'Heading', AXLabel: 'Settings', frame: { x: 16, y: 120, width: 133, height: 40 } },
        { type: 'Button', AXLabel: 'General', AXUniqueId: 'com.apple.settings.general', frame: { x: 16, y: 380, width: 370, height: 52 } },
        { type: 'SearchField', AXValue: 'Search', frame: { x: 28, y: 808, width: 346, height: 28 } },
        { type: 'Button', AXLabel: 'Hidden', frame: { x: 0, y: 0, width: 0, height: 0 } },
      ],
    },
  ]);
  const snap = parseIosAccessibility(json);

  it('uses the app frame as the screen and normalises', () => {
    expect(snap.screen).toEqual({ width: 402, height: 874, unit: 'pt' });
    const general = snap.elements.find((e) => e.label === 'General')!;
    expect(general.frame.x).toBeCloseTo(16 / 402);
    expect(general).toMatchObject({ role: 'Button', interactive: true, id: 'com.apple.settings.general' });
  });

  it('maps search fields to TextField and skips zero-size elements', () => {
    expect(snap.elements.find((e) => e.value === 'Search')?.role).toBe('TextField');
    expect(snap.elements.some((e) => e.label === 'Hidden')).toBe(false);
  });

  it('survives an app with no frame yet and bad JSON', () => {
    expect(parseIosAccessibility('[{"type":"Application","frame":{"width":0,"height":0},"children":[]}]', { width: 390, height: 844 }).screen.width).toBe(390);
    expect(parseIosAccessibility('not json').elements).toEqual([]);
  });
});

describe('hid keys', () => {
  it('maps letters, shifted symbols and newlines', () => {
    expect(hidStrokeFor('a')).toEqual({ usage: 0x04, shift: false });
    expect(hidStrokeFor('Z')).toEqual({ usage: 0x1d, shift: true });
    expect(hidStrokeFor('@')).toEqual({ usage: 0x1f, shift: true });
    expect(hidStrokeFor('\n')).toEqual({ usage: 0x28, shift: false });
    expect(HID_NAMED_KEYS.delete).toBe(0x2a);
  });

  it('reports characters the US layout cannot type', () => {
    const { strokes, skipped } = hidStrokesFor('hi é!');
    expect(strokes).toHaveLength(4);
    expect(skipped).toEqual(['é']);
  });
});

describe('AvccEnvelopeReader', () => {
  const env = (tag: number, payload: number[]) => {
    const out = new Uint8Array(5 + payload.length);
    new DataView(out.buffer).setUint32(0, payload.length + 1);
    out[4] = tag;
    out.set(payload, 5);
    return out;
  };

  it('splits envelopes across arbitrary chunk boundaries', () => {
    const all = new Uint8Array([...env(AVCC_TAG.description, [1, 0x64, 0, 0x1f]), ...env(AVCC_TAG.keyframe, [9, 9, 9])]);
    const reader = new AvccEnvelopeReader();
    const first = reader.push(all.slice(0, 7));
    const rest = reader.push(all.slice(7));
    expect(first).toEqual([]);
    expect(rest.map((e) => e.tag)).toEqual([AVCC_TAG.description, AVCC_TAG.keyframe]);
    expect(Array.from(rest[1]!.payload)).toEqual([9, 9, 9]);
  });

  it('derives the WebCodecs codec string from avcC', () => {
    expect(avcCodecString(new Uint8Array([1, 0x64, 0x00, 0x1f, 0xff]))).toBe('avc1.64001f');
    expect(avcCodecString(new Uint8Array([0, 1]))).toBeNull();
  });
});

describe('Android parsing', () => {
  it('parses adb devices -l', () => {
    const out = parseAdbDevices(
      'List of devices attached\nemulator-5554\tdevice product:sdk_gphone64 model:sdk_gphone64_arm64 device:emu64a transport_id:1\nR5CT1\tunauthorized usb:1-1 transport_id:2\n192.168.1.4:5555 offline\n\n',
    );
    expect(out.map((d) => [d.serial, d.state])).toEqual([
      ['emulator-5554', 'device'],
      ['R5CT1', 'unauthorized'],
      ['192.168.1.4:5555', 'offline'],
    ]);
    expect(out[0]!.props['model']).toBe('sdk_gphone64_arm64');
  });

  it('prefers the current display size, then the override, then physical', () => {
    expect(parseDisplaySize('  cur=2424x1080 app=2424x1080', 'Physical size: 1080x2424')).toEqual({ width: 2424, height: 1080 });
    expect(parseDisplaySize('', 'Physical size: 1080x2424\nOverride size: 720x1600')).toEqual({ width: 720, height: 1600 });
    expect(parseDisplaySize('', 'nothing')).toBeNull();
    // A mirroring session's virtual display listed before display 0 must not win.
    const two = 'Display: mDisplayId=2 (organized)\n  cur=568x1280 app=568x1280\nDisplay: mDisplayId=0 (organized)\n  init=1080x2424 cur=1080x2424';
    expect(parseDisplaySize(two, 'Physical size: 1080x2424')).toEqual({ width: 1080, height: 2424 });
  });

  it('escapes text for input text', () => {
    expect(escapeInputText('a b')).toBe('a%sb');
    expect(escapeInputText(`it's $5 & (x)`)).toBe(`it\\'s%s\\$5%s\\&%s\\(x\\)`);
  });

  it('names Android releases by API level', () => {
    expect(androidVersionForTarget('android-36')).toBe('Android 16');
    expect(androidVersionForTarget('android-99')).toBe('Android API 99');
    expect(androidVersionForTarget(undefined)).toBeUndefined();
  });
});

describe('parseSimctlList', () => {
  it('keeps available iOS devices with their OS version', () => {
    const json = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [
          { udid: 'A', name: 'iPhone 17', state: 'Booted', isAvailable: true },
          { udid: 'B', name: 'Old', state: 'Shutdown', isAvailable: false },
        ],
        'com.apple.CoreSimulator.SimRuntime.watchOS-12-0': [{ udid: 'C', name: 'Watch', state: 'Shutdown', isAvailable: true }],
      },
    });
    expect(parseSimctlList(json)).toEqual([{ udid: 'A', name: 'iPhone 17', state: 'Booted', os: 'iOS 27.0' }]);
    expect(parseSimctlList('nope')).toEqual([]);
  });
});

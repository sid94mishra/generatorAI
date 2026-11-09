// ────────────────────────────────────────────────────────────────
// AndroidBridge (docs/devices DV-2): emulators and phones through the user's
// own `adb` server.
//
//  - Live view and the user's input: scrcpy 3.3.3 through Tango (H.264 Annex-B
//    packets + the control socket), pushed to the device on first use.
//  - Everything else — discovery, boot, the UI tree, screenshots, apps, logs
//    and the agent's taps — through the `adb` / `emulator` executables, so
//    an agent action never depends on a live view being open.
//
// Emulators boot headless (`-no-window`) with SwiftShader: a host-GPU
// emulator without a window composites nothing, and both `screencap` and the
// encoder then read black frames (measured, docs/devices §10.1).
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Adb, AdbServerClient } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { AdbScrcpyClient, AdbScrcpyOptionsLatest } from '@yume-chan/adb-scrcpy';
import { DefaultServerPath, ScrcpyPointerId, type AndroidKeyCode } from '@yume-chan/scrcpy';
import { ReadableStream, WritableStream } from '@yume-chan/stream-extra';
import type { DeviceInputEvent, DeviceKey, DeviceButton, DeviceToolingStatus, ILogger } from '@generatorai/shared';
import { DEVICE_FRAME_CODEC } from '@generatorai/shared';
import type {
  BridgeDevice,
  DeviceAppAction,
  DeviceFrameSink,
  DeviceLogOptions,
  DeviceStreamHandle,
  IDeviceBridge,
  RawDeviceSnapshot,
} from '../../domain/ports/IDeviceBridge.js';
import { androidVersionForTarget, findAndroidTools, listAvds, type AndroidTools } from './androidSdk.js';
import { runBytes, runText } from './run.js';
import { parseUiautomatorDump } from './uiautomatorXml.js';

/** Android KeyEvent codes (stable since API 1–11). */
const KEYCODE: Record<DeviceKey | DeviceButton, number> = {
  home: 3,
  back: 4,
  recents: 187,
  lock: 26,
  volume_up: 24,
  volume_down: 25,
  enter: 66,
  delete: 67,
  tab: 61,
  escape: 111,
  up: 19,
  down: 20,
  left: 21,
  right: 22,
};

const MOTION = { down: 0, up: 1, move: 2 } as const;
const KEY_DOWN = 0;
const KEY_UP = 1;

// A cold boot (a new device, or a snapshot saved with another renderer) can take minutes on a busy machine.
const BOOT_TIMEOUT_MS = 600_000;
const TOOLS_TTL_MS = 10_000;

export interface AndroidBridgeOptions {
  logger: ILogger;
  /** Settings › Mobile devices › Android SDK path. */
  sdkPath?: () => string | null | undefined;
  /** The bundled scrcpy-server jar (null: no live view, everything else works). */
  scrcpyServerPath: string | null;
}

interface DisplaySize {
  width: number;
  height: number;
}

/** `adb devices -l` lines → serial, state and the key:value tail. */
export function parseAdbDevices(output: string): { serial: string; state: string; props: Record<string, string> }[] {
  const out: { serial: string; state: string; props: Record<string, string> }[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(device|offline|unauthorized|authorizing|connecting|no permissions|recovery|sideload|bootloader)\b(.*)$/);
    if (!m) continue;
    const props: Record<string, string> = {};
    for (const kv of (m[3] ?? '').matchAll(/(\w+):(\S+)/g)) props[kv[1]!] = kv[2]!;
    out.push({ serial: m[1]!, state: m[2]!, props });
  }
  return out;
}

/**
 * `cur=1080x2424` in `dumpsys window displays` is the size in the current
 * rotation — of display 0. A mirroring session (scrcpy) adds a virtual display
 * of its own, which may be listed first.
 */
export function parseDisplaySize(dumpsys: string, wmSize: string): DisplaySize | null {
  const blocks = dumpsys.split(/(?=Display: mDisplayId=)/);
  const main = blocks.find((b) => /^Display: mDisplayId=0\b/.test(b)) ?? (blocks.length === 1 ? blocks[0] : '');
  const cur = main?.match(/\bcur=(\d+)x(\d+)/);
  if (cur) return { width: Number(cur[1]), height: Number(cur[2]) };
  const override = wmSize.match(/Override size:\s*(\d+)x(\d+)/);
  const physical = wmSize.match(/Physical size:\s*(\d+)x(\d+)/);
  const m = override ?? physical;
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/**
 * `adb shell` joins its arguments into one device shell line, so text for
 * `input text` is escaped for that shell; spaces become `%s` (the tool's own
 * encoding).
 */
export function escapeInputText(text: string): string {
  return text.replace(/[\\'"`$&|;<>(){}[\]*?~!#]/g, (c) => `\\${c}`).replace(/ /g, '%s');
}

/** Single-quotes a value for the device shell. */
function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function prettyModel(model: string | undefined): string | undefined {
  return model?.replace(/_/g, ' ');
}

export class AndroidBridge implements IDeviceBridge {
  readonly platform = 'android' as const;

  private toolsCache: { at: number; tools: AndroidTools } | null = null;
  private serverStarted = false;
  private client: AdbServerClient | null = null;
  private readonly avdBySerial = new Map<string, string>();
  private readonly versionBySerial = new Map<string, string>();
  private readonly pushed = new Set<string>();
  private readonly booting = new Map<string, Promise<string>>();
  private readonly streams = new Set<{ close(): Promise<void> }>();

  constructor(private readonly options: AndroidBridgeOptions) {}

  private async tools(): Promise<AndroidTools> {
    const now = Date.now();
    if (!this.toolsCache || now - this.toolsCache.at > TOOLS_TTL_MS) {
      this.toolsCache = { at: now, tools: await findAndroidTools(this.options.sdkPath?.() ?? null) };
    }
    return this.toolsCache.tools;
  }

  private async adbPath(): Promise<string> {
    const adb = (await this.tools()).adb;
    if (!adb) throw new Error('adb was not found. Install the Android SDK platform-tools (Android Studio installs them).');
    return adb;
  }

  private async adb(args: string[], timeoutMs = 30_000): Promise<string> {
    await this.ensureServer();
    return runText(await this.adbPath(), args, { timeoutMs });
  }

  private async shell(serial: string, command: string, timeoutMs = 30_000): Promise<string> {
    return this.adb(['-s', serial, 'shell', command], timeoutMs);
  }

  private async ensureServer(): Promise<void> {
    if (this.serverStarted) return;
    await runText(await this.adbPath(), ['start-server'], { timeoutMs: 20_000 });
    this.serverStarted = true;
  }

  async status(): Promise<DeviceToolingStatus> {
    const tools = await this.tools();
    const avds = await listAvds();
    const checks = [
      {
        id: 'android-sdk',
        label: 'Android SDK',
        ok: !!tools.sdkRoot,
        ...(tools.sdkRoot ? { detail: tools.sdkRoot } : {}),
        hint: 'Install Android Studio; its setup wizard installs the SDK. Or set the SDK path in Settings › Mobile devices.',
      },
      {
        id: 'adb',
        label: 'adb (platform-tools)',
        ok: !!tools.adb,
        ...(tools.adb ? { detail: tools.adb } : {}),
        hint: 'Android Studio › SDK Manager › SDK Tools › Android SDK Platform-Tools.',
      },
      {
        id: 'emulator',
        label: 'Android Emulator',
        ok: !!tools.emulator,
        ...(tools.emulator ? { detail: tools.emulator } : {}),
        hint: 'Android Studio › SDK Manager › SDK Tools › Android Emulator. Not needed for a phone on USB.',
      },
      {
        id: 'avd',
        label: 'A virtual device',
        ok: avds.length > 0,
        detail: avds.length > 0 ? avds.map((a) => a.displayName).join(', ') : 'none',
        hint: 'Android Studio › Device Manager › Create virtual device. Or plug in a phone with USB debugging on.',
      },
      {
        id: 'scrcpy-server',
        label: 'Live view component',
        ok: !!this.options.scrcpyServerPath,
        ...(this.options.scrcpyServerPath ? { detail: 'scrcpy-server 3.3.3' } : {}),
        hint: 'Missing from this build: the live view is off, the agent tools still work.',
      },
    ];
    return { platform: 'android', available: !!tools.adb, checks };
  }

  async list(): Promise<BridgeDevice[]> {
    const tools = await this.tools();
    if (!tools.adb) return [];
    const listed = parseAdbDevices(await this.adb(['devices', '-l'], 15_000));
    const avds = await listAvds();
    const devices: BridgeDevice[] = [];
    const runningAvds = new Set<string>();
    for (const d of listed) {
      const emulator = d.serial.startsWith('emulator-');
      let avd: string | undefined;
      if (emulator && d.state === 'device') {
        avd = this.avdBySerial.get(d.serial);
        if (!avd) {
          // The emulator console answers instantly when idle but can time out
          // while the guest is busy booting; the boot property never does.
          avd =
            (await this.adb(['-s', d.serial, 'emu', 'avd', 'name'], 5_000).catch(() => '')).split(/\r?\n/)[0]?.trim() ||
            (await this.shell(d.serial, 'getprop ro.boot.qemu.avd_name', 8_000).catch(() => '')).trim();
          if (avd) this.avdBySerial.set(d.serial, avd);
        }
        if (avd) runningAvds.add(avd);
      }
      let osVersion = this.versionBySerial.get(d.serial);
      if (!osVersion && d.state === 'device') {
        const release = (await this.shell(d.serial, 'getprop ro.build.version.release', 5_000).catch(() => '')).trim();
        if (release) {
          osVersion = `Android ${release}`;
          this.versionBySerial.set(d.serial, osVersion);
        }
      }
      const avdInfo = avd ? avds.find((a) => a.name === avd) : undefined;
      devices.push({
        id: d.serial,
        keyId: avd ? `avd:${avd}` : d.serial,
        kind: emulator ? 'emulator' : d.serial.includes(':') ? 'wifi' : 'usb',
        name: avdInfo?.displayName ?? avd ?? prettyModel(d.props['model']) ?? d.serial,
        ...(osVersion ? { osVersion } : {}),
        state: d.state === 'device' ? 'running' : d.state === 'unauthorized' ? 'unauthorized' : 'offline',
      });
    }
    for (const avd of avds) {
      if (runningAvds.has(avd.name)) continue;
      const osVersion = androidVersionForTarget(avd.target);
      devices.push({
        id: avd.name,
        keyId: `avd:${avd.name}`,
        kind: 'emulator',
        name: avd.displayName,
        ...(osVersion ? { osVersion } : {}),
        state: this.booting.has(avd.name) ? 'starting' : 'off',
      });
    }
    return devices;
  }

  boot(device: BridgeDevice, signal?: AbortSignal): Promise<string> {
    if (device.state === 'running') return Promise.resolve(device.id);
    if (device.kind !== 'emulator') return Promise.reject(new Error(`${device.name} is not running and is not a virtual device.`));
    const avd = device.keyId.replace(/^avd:/, '');
    const pending = this.booting.get(avd);
    if (pending) return pending;
    const run = this.bootAvd(avd, signal).finally(() => this.booting.delete(avd));
    this.booting.set(avd, run);
    return run;
  }

  private async bootAvd(avd: string, signal?: AbortSignal): Promise<string> {
    const emulator = (await this.tools()).emulator;
    if (!emulator) throw new Error('The Android Emulator is not installed (Android Studio › SDK Manager › SDK Tools).');
    await this.ensureServer();
    const logFile = path.join(os.tmpdir(), `generatorai-emulator-${avd.replace(/[^\w.-]/g, '_')}.log`);
    const log = await fs.open(logFile, 'w');
    const child = spawn(
      emulator,
      ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-no-snapshot-save'],
      { detached: true, stdio: ['ignore', log.fd, log.fd], windowsHide: true },
    );
    child.unref();
    await log.close();
    let exited: string | null = null;
    child.once('exit', (code) => {
      exited = `exited with code ${code}`;
    });
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    const tail = async () => {
      try {
        return (await fs.readFile(logFile, 'utf8')).trim().split(/\r?\n/).slice(-6).join('\n');
      } catch {
        return '';
      }
    };
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Cancelled');
      if (exited) throw new Error(`The emulator ${exited}.\n${await tail()}`);
      const serial = (await this.list().catch(() => [])).find((d) => d.keyId === `avd:${avd}` && d.state === 'running')?.id;
      if (serial) {
        const done = (await this.shell(serial, 'getprop sys.boot_completed', 5_000).catch(() => '')).trim();
        if (done === '1') {
          await this.wake(serial);
          return serial;
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`The emulator is still starting after ${BOOT_TIMEOUT_MS / 60_000} minutes; it keeps booting in the background.\n${await tail()}`);
  }

  /** A dozing emulator streams black: wake it and lift the lock screen. */
  private async wake(serial: string): Promise<void> {
    await this.shell(serial, 'input keyevent KEYCODE_WAKEUP', 10_000).catch(() => undefined);
    await this.shell(serial, 'wm dismiss-keyguard', 10_000).catch(() => undefined);
  }

  async shutdown(id: string): Promise<void> {
    if (!id.startsWith('emulator-')) throw new Error('Only virtual devices can be shut down from here.');
    await this.adb(['-s', id, 'emu', 'kill'], 15_000);
    this.avdBySerial.delete(id);
  }

  private async displaySize(serial: string): Promise<DisplaySize> {
    const [dumpsys, wm] = await Promise.all([
      this.shell(serial, 'dumpsys window displays', 10_000).catch(() => ''),
      this.shell(serial, 'wm size', 10_000).catch(() => ''),
    ]);
    const size = parseDisplaySize(dumpsys, wm);
    if (!size) throw new Error('Could not read the screen size.');
    return size;
  }

  private async adbClient(): Promise<AdbServerClient> {
    await this.ensureServer();
    this.client ??= new AdbServerClient(new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 }));
    return this.client;
  }

  async openStream(id: string, sink: DeviceFrameSink): Promise<DeviceStreamHandle> {
    const jar = this.options.scrcpyServerPath;
    if (!jar) throw new Error('The live view component (scrcpy-server) is missing from this build.');
    const client = await this.adbClient();
    const device = (await client.getDevices()).find((d) => d.serial === id);
    if (!device) throw new Error(`Device ${id} is not connected.`);
    const adb = new Adb(await client.createTransport(device));
    if (!this.pushed.has(id)) {
      const bytes = new Uint8Array(await fs.readFile(jar));
      await AdbScrcpyClient.pushServer(
        adb,
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(bytes);
            c.close();
          },
        }),
      );
      this.pushed.add(id);
    }
    await this.wake(id);
    const options = new AdbScrcpyOptionsLatest({
      audio: false,
      control: true,
      maxSize: 1280,
      maxFps: 60,
      videoBitRate: 6_000_000,
      stayAwake: true,
      powerOn: true,
      clipboardAutosync: false,
    });
    const scrcpy = await AdbScrcpyClient.start(adb, DefaultServerPath, options);
    const video = await scrcpy.videoStream;
    if (!video) {
      await scrcpy.close().catch(() => undefined);
      throw new Error('The device sent no video stream.');
    }
    let width = video.width;
    let height = video.height;
    video.sizeChanged((size) => {
      width = size.width;
      height = size.height;
      sink.size(width, height);
    });
    void video.stream
      .pipeTo(
        new WritableStream({
          write(packet) {
            if (packet.type === 'configuration') {
              sink.frame({ codec: DEVICE_FRAME_CODEC.h264AnnexB, keyframe: false, config: true, width, height, data: packet.data });
            } else {
              sink.frame({
                codec: DEVICE_FRAME_CODEC.h264AnnexB,
                keyframe: packet.keyframe === true,
                config: false,
                width,
                height,
                data: packet.data,
              });
            }
          },
        }),
      )
      .catch((err: unknown) => sink.error(err instanceof Error ? err.message : String(err)));
    const controller = scrcpy.controller;
    const key = async (code: number) => {
      await controller?.injectKeyCode({ action: KEY_DOWN, keyCode: code as AndroidKeyCode, repeat: 0, metaState: 0 });
      await controller?.injectKeyCode({ action: KEY_UP, keyCode: code as AndroidKeyCode, repeat: 0, metaState: 0 });
    };
    const handle = {
      input: async (event: DeviceInputEvent): Promise<void> => {
        if (!controller || width === 0) return;
        switch (event.type) {
          case 'touch':
            await controller.injectTouch({
              action: MOTION[event.action],
              pointerId: ScrcpyPointerId.Finger,
              pointerX: Math.round(event.x * width),
              pointerY: Math.round(event.y * height),
              videoWidth: width,
              videoHeight: height,
              pressure: event.action === 'up' ? 0 : 1,
              actionButton: 0,
              buttons: 0,
            });
            return;
          case 'scroll':
            // scrcpy takes -1..1 per event (one wheel notch is 1); `dx`/`dy` are
            // fractions of the screen, a notch being about a tenth of it.
            await controller.injectScroll({
              pointerX: Math.round(event.x * width),
              pointerY: Math.round(event.y * height),
              videoWidth: width,
              videoHeight: height,
              scrollX: Math.max(-1, Math.min(1, -event.dx * 10)),
              scrollY: Math.max(-1, Math.min(1, -event.dy * 10)),
              buttons: 0,
            });
            return;
          case 'text':
            await controller.injectText(event.text);
            return;
          case 'key':
            await key(KEYCODE[event.key]);
            return;
          case 'button':
            await key(KEYCODE[event.button]);
            return;
          case 'rotate':
            await controller.rotateDevice();
            return;
        }
      },
      requestKeyframe: async (): Promise<void> => {
        await controller?.resetVideo();
      },
      close: async (): Promise<void> => {
        this.streams.delete(handle);
        await scrcpy.close().catch(() => undefined);
      },
    };
    this.streams.add(handle);
    return handle;
  }

  async input(id: string, event: DeviceInputEvent): Promise<void> {
    switch (event.type) {
      case 'text':
        // `input text` cannot type a newline: each line, then Enter between them.
        for (const [i, line] of event.text.split('\n').entries()) {
          if (i > 0) await this.shell(id, `input keyevent ${KEYCODE.enter}`);
          if (line) await this.shell(id, `input text ${escapeInputText(line)}`);
        }
        return;
      case 'key':
        await this.shell(id, `input keyevent ${KEYCODE[event.key]}`);
        return;
      case 'button':
        await this.shell(id, `input keyevent ${KEYCODE[event.button]}`);
        return;
      case 'scroll': {
        const size = await this.displaySize(id);
        const x = Math.round(event.x * size.width);
        const y = Math.round(event.y * size.height);
        const toX = Math.round(Math.min(1, Math.max(0, event.x - event.dx)) * size.width);
        const toY = Math.round(Math.min(1, Math.max(0, event.y - event.dy)) * size.height);
        await this.shell(id, `input swipe ${x} ${y} ${toX} ${toY} 300`);
        return;
      }
      case 'rotate': {
        const current = (await this.shell(id, 'settings get system user_rotation', 5_000).catch(() => '0')).trim();
        await this.shell(id, 'settings put system accelerometer_rotation 0');
        await this.shell(id, `settings put system user_rotation ${current === '0' ? 1 : 0}`);
        return;
      }
      case 'touch':
        return;
    }
  }

  async tap(id: string, at: { x: number; y: number }): Promise<void> {
    const size = await this.displaySize(id);
    await this.shell(id, `input tap ${Math.round(at.x * size.width)} ${Math.round(at.y * size.height)}`);
  }

  async swipe(id: string, from: { x: number; y: number }, to: { x: number; y: number }, ms: number): Promise<void> {
    const size = await this.displaySize(id);
    const p = (v: number, n: number) => Math.round(Math.min(1, Math.max(0, v)) * n);
    await this.shell(
      id,
      `input swipe ${p(from.x, size.width)} ${p(from.y, size.height)} ${p(to.x, size.width)} ${p(to.y, size.height)} ${Math.round(ms)}`,
    );
  }

  async longPress(id: string, at: { x: number; y: number }, ms: number): Promise<void> {
    await this.swipe(id, at, at, ms);
  }

  async snapshot(id: string): Promise<RawDeviceSnapshot> {
    // The dump's root bounds are the screen in its current rotation. While the
    // UI is animating or the device is busy, uiautomator prints an error
    // ("could not get idle state") instead of XML: try once more.
    let xml = await this.adb(['-s', id, 'exec-out', 'uiautomator', 'dump', '--compressed', '/dev/tty'], 30_000);
    if (!xml.includes('<hierarchy')) {
      await new Promise((r) => setTimeout(r, 1000));
      xml = await this.adb(['-s', id, 'exec-out', 'uiautomator', 'dump', '--compressed', '/dev/tty'], 30_000);
    }
    if (!xml.includes('<hierarchy')) throw new Error(`The screen could not be read: ${xml.trim().slice(0, 200) || 'no output'}`);
    const parsed = parseUiautomatorDump(xml);
    const focus = await this.shell(id, 'dumpsys window | grep -E "mCurrentFocus|mFocusedApp"', 10_000).catch(() => '');
    const pkg = focus.match(/\s([a-zA-Z][\w.]+)\/[\w.$]+/)?.[1];
    return { ...parsed, ...(pkg ? { app: pkg } : {}) };
  }

  async screenshot(id: string): Promise<{ bytes: Uint8Array; mime: 'image/png' }> {
    await this.ensureServer();
    const bytes = await runBytes(await this.adbPath(), ['-s', id, 'exec-out', 'screencap', '-p'], { timeoutMs: 30_000 });
    return { bytes: new Uint8Array(bytes), mime: 'image/png' };
  }

  async app(id: string, request: DeviceAppAction): Promise<string> {
    switch (request.action) {
      case 'launch': {
        const out = await this.shell(id, `monkey -p ${shq(request.app)} -c android.intent.category.LAUNCHER 1`);
        if (/No activities found|monkey aborted/i.test(out)) throw new Error(`${request.app} has no launchable activity or is not installed.`);
        return `Launched ${request.app}.`;
      }
      case 'terminate':
        await this.shell(id, `am force-stop ${shq(request.app)}`);
        return `Stopped ${request.app}.`;
      case 'install': {
        const out = await this.adb(['-s', id, 'install', '-r', request.path], 300_000);
        if (!/Success/.test(out)) throw new Error(out.trim() || 'Install failed.');
        return `Installed ${path.basename(request.path)}.`;
      }
      case 'list': {
        const out = await this.shell(id, 'pm list packages -3');
        const pkgs = out.split(/\r?\n/).map((l) => l.replace(/^package:/, '').trim()).filter(Boolean).sort();
        return pkgs.length ? pkgs.join('\n') : 'No apps installed by the user.';
      }
      case 'open_url':
        await this.shell(id, `am start -a android.intent.action.VIEW -d ${shq(request.url)}`);
        return `Opened ${request.url}.`;
    }
  }

  async logs(id: string, options: DeviceLogOptions): Promise<string> {
    const level = { debug: 'D', info: 'I', warn: 'W', error: 'E' }[options.level ?? 'debug'];
    const pid = options.app ? (await this.shell(id, `pidof -s ${shq(options.app)}`, 5_000).catch(() => '')).trim() : '';
    if (options.app && !pid) return `${options.app} is not running.`;
    const out = await this.shell(id, `logcat -d -v time -t ${Math.max(1, Math.min(2000, options.lines))}${pid ? ` --pid=${pid}` : ''} *:${level}`);
    return out.trim();
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.streams].map((s) => s.close().catch(() => undefined)));
  }
}

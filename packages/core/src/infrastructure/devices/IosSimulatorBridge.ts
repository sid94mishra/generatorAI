// ────────────────────────────────────────────────────────────────
// IosSimulatorBridge (docs/devices DV-3): iOS simulators on macOS.
//
//  - Lifecycle, apps, URLs, logs: `xcrun simctl`.
//  - Video, touch, keys, buttons, the accessibility tree and the foreground
//    app: one `serve-sim` helper per booted simulator, run in the foreground
//    as a process of OUR own on 127.0.0.1 (never `--allow-exec`). Apple
//    publishes no tap or streaming API; the helper drives SimulatorKit
//    privately, and a native hang or crash in it must not take the server
//    down. Neither in-process form works: on the main thread its addon hung
//    Node, and in a worker its capture threads outlive `terminate()` and
//    crash the process (docs/devices §10.1). The desktop app's server cannot
//    run a script with its own binary (the RunAsNode fuse is off), so how the
//    process starts is the `launchScript` option's business.
//
// The helper is reached only by this process; nothing is exposed to clients
// except through the server's authenticated device routes.
// ────────────────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as net from 'node:net';
import type { DeviceInputEvent, DeviceToolingStatus, ILogger } from '@generatorai/shared';
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
import { AVCC_TAG, AvccEnvelopeReader } from './avccEnvelope.js';
import { HID_NAMED_KEYS, HID_SHIFT, hidStrokesFor } from './hidKeys.js';
import { parseIosAccessibility } from './iosAccessibility.js';
import { runBytes, runText } from './run.js';

/** A Node script running as a process of its own. */
export interface ScriptProcess {
  /** Called once, when the process is gone (null code: killed or never started). */
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

/** Starts a Node script as a separate process. */
export type ScriptLauncher = (script: string, args: string[]) => ScriptProcess;

/** The default launcher: the current Node runs the script (a plain Node server). */
export const spawnNodeScript: ScriptLauncher = (script, args) => {
  const child = spawn(process.execPath, [script, ...args], { stdio: 'ignore', windowsHide: true });
  let exited = false;
  const listeners: ((code: number | null) => void)[] = [];
  const finish = (code: number | null) => {
    if (exited) return;
    exited = true;
    for (const l of listeners) l(code);
  };
  child.once('exit', (code) => finish(code));
  child.once('error', () => finish(null));
  return {
    onExit: (listener) => {
      if (exited) listener(child.exitCode);
      else listeners.push(listener);
    },
    kill: () => {
      if (!exited) child.kill('SIGTERM');
    },
  };
};

export interface IosSimulatorBridgeOptions {
  logger: ILogger;
  /** `serve-sim/dist/serve-sim.js`, or null when the package is not installed. */
  serveSimCli: string | null;
  /** How the helper script starts; {@link spawnNodeScript} by default. */
  launchScript?: ScriptLauncher;
}

interface Helper {
  process: ScriptProcess;
  base: string;
  ws: WebSocket | null;
  wsReady: Promise<WebSocket> | null;
}

/** HID button table of the helper (page 12 = consumer). */
const BUTTON_HID: Record<string, { page: number; usage: number } | undefined> = {
  lock: { page: 12, usage: 48 },
  volume_up: { page: 12, usage: 233 },
  volume_down: { page: 12, usage: 234 },
};

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
}

export function parseSimctlList(json: string): { udid: string; name: string; state: string; os: string }[] {
  const out: { udid: string; name: string; state: string; os: string }[] = [];
  let parsed: { devices?: Record<string, SimctlDevice[]> };
  try {
    parsed = JSON.parse(json) as typeof parsed;
  } catch {
    return out;
  }
  for (const [runtime, devices] of Object.entries(parsed.devices ?? {})) {
    const m = runtime.match(/SimRuntime\.(iOS)-(\d+)-(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const os = `iOS ${m[2]}.${m[3]}${m[4] ? `.${m[4]}` : ''}`;
    for (const d of devices) {
      if (d.isAvailable === false) continue;
      out.push({ udid: d.udid, name: d.name, state: d.state, os });
    }
  }
  return out;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export class IosSimulatorBridge implements IDeviceBridge {
  readonly platform = 'ios' as const;

  private readonly helpers = new Map<string, Promise<Helper>>();
  private readonly booting = new Set<string>();

  constructor(private readonly options: IosSimulatorBridgeOptions) {}

  private get supported(): boolean {
    return process.platform === 'darwin';
  }

  private simctl(args: string[], timeoutMs = 60_000): Promise<string> {
    return runText('/usr/bin/xcrun', ['simctl', ...args], { timeoutMs });
  }

  async status(): Promise<DeviceToolingStatus> {
    if (!this.supported) {
      return {
        platform: 'ios',
        available: false,
        checks: [{ id: 'macos', label: 'A Mac', ok: false, hint: 'Apple runs iOS simulators only on macOS.' }],
      };
    }
    const xcode = await runText('/usr/bin/xcrun', ['--find', 'simctl'], { timeoutMs: 15_000 }).then(
      (p) => ({ ok: true, detail: p.trim() }),
      () => ({ ok: false, detail: undefined }),
    );
    const sims = xcode.ok ? parseSimctlList(await this.simctl(['list', 'devices', 'available', '--json'], 30_000).catch(() => '{}')) : [];
    const appleSilicon = process.arch === 'arm64';
    const checks = [
      {
        id: 'xcode',
        label: 'Xcode',
        ok: xcode.ok,
        ...(xcode.detail ? { detail: xcode.detail } : {}),
        hint: 'Install Xcode from the App Store, open it once, then run `xcode-select -s /Applications/Xcode.app`.',
      },
      {
        id: 'ios-runtime',
        label: 'An iOS simulator',
        ok: sims.length > 0,
        detail: sims.length > 0 ? `${sims.length} available` : 'none',
        hint: 'Xcode › Settings › Components › iOS (download the platform); Xcode creates simulators with it.',
      },
      {
        id: 'apple-silicon',
        label: 'Apple silicon',
        ok: appleSilicon,
        hint: 'The live view and touch input need an Apple-silicon Mac; on Intel the simulators are listed only.',
      },
      {
        id: 'serve-sim',
        label: 'Simulator helper',
        ok: !!this.options.serveSimCli,
        ...(this.options.serveSimCli ? { detail: 'serve-sim 0.1.49' } : {}),
        hint: 'Missing from this build: iOS live view and input are off.',
      },
    ];
    return { platform: 'ios', available: xcode.ok, checks };
  }

  async list(): Promise<BridgeDevice[]> {
    if (!this.supported) return [];
    const json = await this.simctl(['list', 'devices', 'available', '--json'], 30_000).catch(() => '');
    return parseSimctlList(json).map((d) => ({
      id: d.udid,
      keyId: d.udid,
      kind: 'simulator' as const,
      name: d.name,
      osVersion: d.os,
      state: d.state === 'Booted' ? ('running' as const) : this.booting.has(d.udid) || d.state === 'Booting' ? ('starting' as const) : ('off' as const),
    }));
  }

  async boot(device: BridgeDevice, signal?: AbortSignal): Promise<string> {
    this.booting.add(device.id);
    try {
      // `simctl` reports Booted as soon as a boot STARTS, so a simulator booted a moment ago (from the pane, Xcode, a
      // previous call) is not necessarily ready: apps would not launch and `spawn` failed with "getpwuid_r did not
      // find a match". `bootstatus -b` returns at once on a simulator that has finished booting.
      if (device.state !== 'running') {
        await this.simctl(['boot', device.id], 120_000).catch((err: Error) => {
          if (!/current state: Booted/i.test(err.message)) throw err;
        });
      }
      // `bootstatus -b` blocks until SpringBoard is up. A first boot can
      // report "Data Migration Failed" and still finish; the state is what counts.
      await this.simctl(['bootstatus', device.id, '-b'], 300_000).catch(() => undefined);
      if (signal?.aborted) throw new Error('Cancelled');
      return device.id;
    } finally {
      this.booting.delete(device.id);
    }
  }

  async shutdown(id: string): Promise<void> {
    await this.stopHelper(id);
    await this.simctl(['shutdown', id], 60_000);
  }

  // ── The helper ──────────────────────────────────────────────

  private helper(udid: string): Promise<Helper> {
    const existing = this.helpers.get(udid);
    if (existing) return existing;
    const started = this.startHelper(udid);
    this.helpers.set(udid, started);
    started.catch(() => this.helpers.delete(udid));
    return started;
  }

  private async startHelper(udid: string): Promise<Helper> {
    const cli = this.options.serveSimCli;
    if (!cli || !(await fs.access(cli).then(() => true, () => false))) {
      throw new Error('The simulator helper (serve-sim) is not installed with this build.');
    }
    if (process.arch !== 'arm64') throw new Error('The simulator live view and input need an Apple-silicon Mac.');
    const port = await freePort();
    // Foreground mode: the helper serves this one simulator until we stop it
    // (or the simulator shuts down) — no detached daemon to track or `--kill`.
    const proc = (this.options.launchScript ?? spawnNodeScript)(cli, [
      udid,
      '--port',
      String(port),
      '--host',
      '127.0.0.1',
      '--exit-on-simulator-shutdown',
      '-q',
    ]);
    let exitCode: number | null | undefined;
    proc.onExit((code) => {
      exitCode = code;
    });
    const base = `http://127.0.0.1:${port}/helper/${udid}`;
    // Ready once it reports the simulator's framebuffer (0×0 until capture starts).
    const deadline = Date.now() + 45_000;
    for (;;) {
      if (exitCode !== undefined) throw new Error(`The simulator helper exited (${exitCode ?? 'killed'}) before it was ready.`);
      const config = await fetch(`${base}/config`, { signal: AbortSignal.timeout(3000) })
        .then((r) => (r.ok ? (r.json() as Promise<{ width?: number }>) : null))
        .catch(() => null);
      if (config && (config.width ?? 0) > 0) break;
      if (Date.now() > deadline) {
        proc.kill();
        throw new Error('The simulator helper did not start within 45 s.');
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    const helper: Helper = { process: proc, base, ws: null, wsReady: null };
    // The map holds this start's promise; a later helper for the same simulator must not be dropped by this exit.
    const entry = this.helpers.get(udid);
    proc.onExit((code) => {
      // Gone (the simulator shut down, or it crashed): the next call starts a fresh one.
      if (this.helpers.get(udid) === entry) this.helpers.delete(udid);
      this.options.logger.info?.(`[devices] simulator helper for ${udid} exited (${code ?? 'killed'})`);
    });
    this.options.logger.info?.(`[devices] simulator helper for ${udid} on ${base}`);
    return helper;
  }

  private async stopHelper(udid: string): Promise<void> {
    const pending = this.helpers.get(udid);
    this.helpers.delete(udid);
    const helper = await pending?.catch(() => null);
    helper?.ws?.close();
    helper?.process.kill();
  }

  private async get(udid: string, route: string, timeoutMs = 20_000): Promise<Response> {
    const helper = await this.helper(udid);
    let res: Response;
    try {
      res = await fetch(`${helper.base}/${route}`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      // Unreachable (the helper went away): start a fresh one next time.
      if ((err as Error).name !== 'TimeoutError') this.helpers.delete(udid);
      throw err;
    }
    if (!res.ok) throw new Error(`${route}: ${(await res.text().catch(() => '')).slice(0, 300) || res.status}`);
    return res;
  }

  /** The helper's HID socket, opened once per helper. */
  private async socket(udid: string): Promise<WebSocket> {
    const helper = await this.helper(udid);
    if (helper.ws && helper.ws.readyState === WebSocket.OPEN) return helper.ws;
    helper.wsReady ??= new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`${helper.base.replace(/^http/, 'ws')}/ws`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        helper.ws = ws;
        resolve(ws);
      };
      ws.onerror = () => {
        this.helpers.delete(udid);
        reject(new Error('Could not connect to the simulator input channel.'));
      };
      ws.onclose = () => {
        helper.ws = null;
        helper.wsReady = null;
      };
    });
    try {
      return await helper.wsReady;
    } catch (err) {
      helper.wsReady = null;
      throw err;
    }
  }

  private async send(udid: string, tag: number, body: unknown): Promise<void> {
    const ws = await this.socket(udid);
    const json = new TextEncoder().encode(JSON.stringify(body));
    const frame = new Uint8Array(json.length + 1);
    frame[0] = tag;
    frame.set(json, 1);
    ws.send(frame);
  }

  private async touch(udid: string, type: 'begin' | 'move' | 'end', x: number, y: number): Promise<void> {
    await this.send(udid, 0x03, { type, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) });
  }

  private async key(udid: string, usage: number, shift = false): Promise<void> {
    if (shift) await this.send(udid, 0x06, { type: 'down', usage: HID_SHIFT });
    await this.send(udid, 0x06, { type: 'down', usage });
    await new Promise((r) => setTimeout(r, 15));
    await this.send(udid, 0x06, { type: 'up', usage });
    if (shift) await this.send(udid, 0x06, { type: 'up', usage: HID_SHIFT });
    await new Promise((r) => setTimeout(r, 25));
  }

  private async text(udid: string, text: string): Promise<void> {
    const { strokes, skipped } = hidStrokesFor(text);
    for (const stroke of strokes) await this.key(udid, stroke.usage, stroke.shift);
    if (skipped.length > 0) {
      throw new Error(`The simulator keyboard cannot type: ${[...new Set(skipped)].join(' ')} (US layout only).`);
    }
  }

  private async button(udid: string, button: string): Promise<void> {
    if (button === 'home') return this.send(udid, 0x04, { button: 'home' });
    if (button === 'back' || button === 'recents') {
      // iOS has no Back or app switcher button: an edge swipe and a bottom
      // swipe-and-hold are what a person does.
      if (button === 'back') return this.swipe(udid, { x: 0.01, y: 0.5 }, { x: 0.6, y: 0.5 }, 250);
      return this.swipe(udid, { x: 0.5, y: 0.995 }, { x: 0.5, y: 0.6 }, 600);
    }
    const hid = BUTTON_HID[button];
    if (!hid) throw new Error(`Unknown button ${button}.`);
    await this.send(udid, 0x04, { button, page: hid.page, usage: hid.usage, phase: 'press' });
  }

  // ── IDeviceBridge ───────────────────────────────────────────

  async openStream(id: string, sink: DeviceFrameSink): Promise<DeviceStreamHandle> {
    const helper = await this.helper(id);
    const config = (await (await this.get(id, 'config')).json()) as { width?: number; height?: number };
    let width = config.width ?? 0;
    let height = config.height ?? 0;
    if (width > 0) sink.size(width, height);
    let controller = new AbortController();
    let closed = false;
    // Each request to `stream.avcc` is a fresh native subscription that starts
    // with the decoder config and a keyframe, so reconnecting IS the keyframe request.
    const connect = async (): Promise<void> => {
      const own = controller;
      const res = await fetch(`${helper.base}/stream.avcc`, { signal: own.signal });
      if (!res.ok || !res.body) throw new Error(`The simulator stream did not open (${res.status}).`);
      const reader = new AvccEnvelopeReader();
      const body = res.body.getReader();
      for (;;) {
        const { value, done } = await body.read();
        if (done) break;
        for (const env of reader.push(value)) {
          if (env.tag === AVCC_TAG.seed) {
            sink.frame({ codec: DEVICE_FRAME_CODEC.jpeg, keyframe: true, config: false, width, height, data: env.payload });
          } else if (env.tag === AVCC_TAG.description) {
            const size = (await this.get(id, 'config').then((r) => r.json()).catch(() => null)) as { width?: number; height?: number } | null;
            if (size?.width && (size.width !== width || size.height !== height)) {
              width = size.width;
              height = size.height ?? height;
              sink.size(width, height);
            }
            sink.frame({ codec: DEVICE_FRAME_CODEC.h264Avcc, keyframe: false, config: true, width, height, data: env.payload });
          } else if (env.tag === AVCC_TAG.keyframe || env.tag === AVCC_TAG.delta) {
            sink.frame({
              codec: DEVICE_FRAME_CODEC.h264Avcc,
              keyframe: env.tag === AVCC_TAG.keyframe,
              config: false,
              width,
              height,
              data: env.payload,
            });
          }
        }
      }
    };
    const run = () => {
      void connect().catch((err: unknown) => {
        if (!closed && !controller.signal.aborted) sink.error(err instanceof Error ? err.message : String(err));
      });
    };
    run();
    return {
      input: (event) => this.liveInput(id, event),
      requestKeyframe: async () => {
        if (closed) return;
        controller.abort();
        controller = new AbortController();
        run();
      },
      close: async () => {
        closed = true;
        controller.abort();
      },
    };
  }

  /** Pane input: touches are streamed as the pointer moves. */
  private async liveInput(id: string, event: DeviceInputEvent): Promise<void> {
    if (event.type === 'touch') {
      return this.touch(id, event.action === 'down' ? 'begin' : event.action === 'up' ? 'end' : 'move', event.x, event.y);
    }
    return this.input(id, event);
  }

  async input(id: string, event: DeviceInputEvent): Promise<void> {
    switch (event.type) {
      case 'text':
        return this.text(id, event.text);
      case 'key':
        return this.key(id, HID_NAMED_KEYS[event.key]);
      case 'button':
        return this.button(id, event.button);
      case 'scroll':
        return this.send(id, 0x0b, { dx: event.dx, dy: event.dy, x: event.x, y: event.y });
      case 'rotate': {
        const config = (await (await this.get(id, 'config')).json()) as { orientation?: string };
        const next = config.orientation === 'portrait' ? 'landscape_left' : 'portrait';
        return this.send(id, 0x07, { orientation: next });
      }
      case 'touch':
        return;
    }
  }

  async tap(id: string, at: { x: number; y: number }): Promise<void> {
    await this.touch(id, 'begin', at.x, at.y);
    await new Promise((r) => setTimeout(r, 60));
    await this.touch(id, 'end', at.x, at.y);
  }

  async swipe(id: string, from: { x: number; y: number }, to: { x: number; y: number }, ms: number): Promise<void> {
    const steps = Math.max(6, Math.round(ms / 16));
    await this.touch(id, 'begin', from.x, from.y);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await new Promise((r) => setTimeout(r, ms / steps));
      await this.touch(id, i === steps ? 'end' : 'move', from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    }
  }

  async longPress(id: string, at: { x: number; y: number }, ms: number): Promise<void> {
    await this.touch(id, 'begin', at.x, at.y);
    await new Promise((r) => setTimeout(r, ms));
    await this.touch(id, 'end', at.x, at.y);
  }

  async snapshot(id: string): Promise<RawDeviceSnapshot> {
    // The simulator's accessibility service answers with an empty tree after a
    // boot, an app launch or mid-transition (a pushed screen); a loaded screen
    // always has elements (the status bar at least), so an empty one is read
    // again for a while before it is reported.
    const deadline = Date.now() + 3_000;
    let parsed = await this.readAx(id);
    while (parsed.elements.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      parsed = await this.readAx(id);
    }
    return parsed;
  }

  private async readAx(id: string): Promise<RawDeviceSnapshot> {
    const [ax, front] = await Promise.all([
      this.get(id, 'ax', 30_000).then((r) => r.text()),
      this.get(id, 'foreground', 10_000)
        .then((r) => r.json() as Promise<{ bundleId?: string }>)
        .catch(() => ({}) as { bundleId?: string }),
    ]);
    const parsed = parseIosAccessibility(ax);
    return { ...parsed, ...(front.bundleId ? { app: front.bundleId } : {}) };
  }

  async screenshot(id: string): Promise<{ bytes: Uint8Array; mime: 'image/jpeg' }> {
    // The first part of the helper's MJPEG stream is the current screen,
    // ~50 ms; `simctl io screenshot` takes seconds.
    const controller = new AbortController();
    const helper = await this.helper(id);
    const res = await fetch(`${helper.base}/stream.mjpeg?raw=1`, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`Screenshot failed (${res.status}).`);
    const reader = res.body.getReader();
    let buf = new Uint8Array(0);
    const deadline = Date.now() + 10_000;
    try {
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        const joined = new Uint8Array(buf.length + value.length);
        joined.set(buf);
        joined.set(value, buf.length);
        buf = joined;
        const start = indexOf(buf, [0xff, 0xd8], 0);
        const end = start >= 0 ? indexOf(buf, [0xff, 0xd9], start + 2) : -1;
        if (start >= 0 && end > 0) return { bytes: buf.slice(start, end + 2), mime: 'image/jpeg' };
      }
    } finally {
      controller.abort();
    }
    const fallback = await runBytes('/usr/bin/xcrun', ['simctl', 'io', id, 'screenshot', '--type=jpeg', '-'], { timeoutMs: 30_000 });
    return { bytes: new Uint8Array(fallback), mime: 'image/jpeg' };
  }

  async app(id: string, request: DeviceAppAction): Promise<string> {
    switch (request.action) {
      case 'launch':
        await this.simctl(['launch', id, request.app], 60_000);
        return `Launched ${request.app}.`;
      case 'terminate':
        await this.simctl(['terminate', id, request.app], 30_000);
        return `Stopped ${request.app}.`;
      case 'install':
        await this.simctl(['install', id, request.path], 300_000);
        return `Installed ${request.path.split(/[\\/]/).pop()}.`;
      case 'list': {
        const out = await this.simctl(['listapps', id], 30_000);
        const ids = [...out.matchAll(/CFBundleIdentifier\s*=\s*"?([\w.-]+)"?;/g)].map((m) => m[1]!).filter((b) => !b.startsWith('com.apple.'));
        return ids.length ? [...new Set(ids)].sort().join('\n') : 'No apps installed by the user.';
      }
      case 'open_url':
        await this.simctl(['openurl', id, request.url], 30_000);
        return `Opened ${request.url}.`;
    }
  }

  async logs(id: string, options: DeviceLogOptions): Promise<string> {
    const args = ['spawn', id, 'log', 'show', '--last', '5m', '--style', 'compact'];
    const clauses: string[] = [];
    if (options.app) {
      const proc = (options.app.split('.').pop() ?? options.app).replace(/[^\w.-]/g, '');
      const subsystem = options.app.replace(/[^\w.-]/g, '');
      clauses.push(`(process == "${proc}" OR subsystem == "${subsystem}")`);
    }
    if (options.level === 'error') clauses.push('(messageType == error OR messageType == fault)');
    if (clauses.length > 0) args.push('--predicate', clauses.join(' AND '));
    const out = await this.simctl(args, 60_000);
    const lines = out.trim().split(/\r?\n/);
    return lines.slice(-Math.max(1, Math.min(2000, options.lines))).join('\n');
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.helpers.keys()].map((udid) => this.stopHelper(udid)));
  }
}

function indexOf(buf: Uint8Array, pattern: number[], from: number): number {
  outer: for (let i = from; i <= buf.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (buf[i + j] !== pattern[j]) continue outer;
    return i;
  }
  return -1;
}

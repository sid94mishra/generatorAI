// ────────────────────────────────────────────────────────────────
// DeviceService (docs/devices §5): the one owner of mobile devices.
//
//  - Discovery merged across the platform bridges, cached briefly (adb and
//    simctl calls cost hundreds of ms).
//  - Per-workspace state: the device the chat has open, agent access grants
//    (DV-8), the latest snapshot's refs.
//  - One live stream per device, fanned out to every watcher (the pane's
//    sockets); a joiner gets the decoder config and a fresh keyframe.
//  - Agent actions: refs → points, the touch drawn on every watcher (DV-12),
//    and a snapshot diff as feedback.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  AgentEvent,
  DeviceActionMark,
  DeviceButton,
  DeviceInfo,
  DeviceInputEvent,
  DeviceKey,
  DeviceSnapshot,
  DeviceStreamMessage,
  DevicesOverview,
  DeviceToolingStatus,
  ILogger,
} from '@generatorai/shared';
import type {
  BridgeDevice,
  DeviceAppAction,
  DeviceFrame,
  DeviceStreamHandle,
  IDeviceBridge,
} from '../../domain/ports/IDeviceBridge.js';
import { DEVICE_BUTTONS, DEVICE_KEYS } from '../../domain/ports/IDeviceBridge.js';
import type { EventBus } from '../../events/EventBus.js';
import { transcodeScreenshot } from '../../infrastructure/computer/screenshotCodec.js';
import { buildSnapshot, diffSnapshots, findElement } from './deviceSnapshot.js';

export const DEVICE_EVENT_SCOPE = 'devices';
const LIST_TTL_MS = 2_000;
const TOOLING_TTL_MS = 30_000;
const AGENT_ACTIVE_MS = 6_000;

export interface DeviceWatcher {
  frame(frame: DeviceFrame): void;
  message(message: DeviceStreamMessage): void;
}

export type DeviceStep =
  | { action: 'tap'; target?: string; x?: number; y?: number }
  | { action: 'long_press'; target?: string; x?: number; y?: number; ms?: number }
  | { action: 'swipe'; target?: string; x?: number; y?: number; toX?: number; toY?: number; direction?: Direction; ms?: number }
  | { action: 'scroll'; direction: Direction; target?: string }
  | { action: 'type'; text: string; target?: string; submit?: boolean }
  | { action: 'press'; key: DeviceButton | DeviceKey }
  | { action: 'wait'; ms?: number; text?: string };

type Direction = 'up' | 'down' | 'left' | 'right';

export class DeviceAccessError extends Error {}

interface Producer {
  key: string;
  handle: DeviceStreamHandle | null;
  opening: Promise<DeviceStreamHandle> | null;
  watchers: Set<DeviceWatcher>;
  config: DeviceFrame | null;
  size: { width: number; height: number } | null;
}

interface WorkspaceState {
  current?: string;
  grants: Map<string, boolean>;
  snapshots: Map<string, DeviceSnapshot>;
  activeUntil: Map<string, number>;
  /** Devices this workspace booted, which `device_close` may shut down. */
  booted: Set<string>;
}

export interface DeviceServiceOptions {
  enabled: boolean;
}

export class DeviceService {
  private enabled: boolean;
  private readonly bridges: Map<string, IDeviceBridge>;
  private listCache: { at: number; devices: (BridgeDevice & { platform: string })[] } | null = null;
  private listing: Promise<(BridgeDevice & { platform: string })[]> | null = null;
  private toolingCache: { at: number; tooling: DeviceToolingStatus[] } | null = null;
  private readonly workspaces = new Map<string, WorkspaceState>();
  private readonly producers = new Map<string, Producer>();
  private readonly activityTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly eventBus: EventBus,
    private readonly logger: ILogger,
    bridges: IDeviceBridge[],
    options: DeviceServiceOptions,
  ) {
    this.bridges = new Map(bridges.map((b) => [b.platform, b]));
    this.enabled = options.enabled;
  }

  // ── Feature switch (DV-9) ───────────────────────────────────

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) void this.stopAllStreams();
  }

  // ── Discovery ───────────────────────────────────────────────

  private workspace(workspaceId: string): WorkspaceState {
    let state = this.workspaces.get(workspaceId);
    if (!state) {
      state = { grants: new Map(), snapshots: new Map(), activeUntil: new Map(), booted: new Set() };
      this.workspaces.set(workspaceId, state);
    }
    return state;
  }

  private async rawList(fresh = false): Promise<(BridgeDevice & { platform: string })[]> {
    if (!fresh && this.listCache && Date.now() - this.listCache.at < LIST_TTL_MS) return this.listCache.devices;
    this.listing ??= Promise.all(
      [...this.bridges.values()].map(async (bridge) => {
        try {
          return (await bridge.list()).map((d) => ({ ...d, platform: bridge.platform }));
        } catch (err) {
          this.logger.warn?.(`[devices] ${bridge.platform} list failed: ${(err as Error).message}`);
          return [];
        }
      }),
    )
      .then((groups) => {
        const devices = groups.flat();
        this.listCache = { at: Date.now(), devices };
        return devices;
      })
      .finally(() => {
        this.listing = null;
      });
    return this.listing;
  }

  private keyOf(d: BridgeDevice & { platform: string }): string {
    return `${d.platform}:${d.keyId}`;
  }

  /** Default access: virtual devices yes, a person's phone no (DV-8). */
  private defaultAccess(kind: string): boolean {
    return kind === 'emulator' || kind === 'simulator';
  }

  agentAccess(workspaceId: string, key: string, kind: string): boolean {
    return this.workspace(workspaceId).grants.get(key) ?? this.defaultAccess(kind);
  }

  async list(workspaceId?: string, fresh = false): Promise<DeviceInfo[]> {
    const devices = await this.rawList(fresh);
    return devices.map((d) => {
      const key = this.keyOf(d);
      return {
        key,
        platform: d.platform as DeviceInfo['platform'],
        kind: d.kind,
        name: d.name,
        ...(d.osVersion ? { osVersion: d.osVersion } : {}),
        state: d.state,
        agentAccess: workspaceId ? this.agentAccess(workspaceId, key, d.kind) : this.defaultAccess(d.kind),
      };
    });
  }

  async tooling(fresh = false): Promise<DeviceToolingStatus[]> {
    if (!fresh && this.toolingCache && Date.now() - this.toolingCache.at < TOOLING_TTL_MS) return this.toolingCache.tooling;
    const tooling = await Promise.all([...this.bridges.values()].map((b) => b.status()));
    this.toolingCache = { at: Date.now(), tooling };
    return tooling;
  }

  async overview(workspaceId?: string, fresh = false): Promise<DevicesOverview> {
    const [devices, tooling] = await Promise.all([this.list(workspaceId, fresh), this.tooling(fresh)]);
    return { enabled: this.enabled, devices, tooling };
  }

  /** The chat's open device, if any. */
  current(workspaceId: string): string | undefined {
    return this.workspace(workspaceId).current;
  }

  /** A key, or a name the agent typed ("Pixel 9", "iPhone 17"). */
  private async resolve(target: string, fresh = false): Promise<{ bridge: IDeviceBridge; device: BridgeDevice & { platform: string }; key: string }> {
    const devices = await this.rawList(fresh);
    const wanted = target.trim();
    const lower = wanted.toLowerCase();
    const device =
      devices.find((d) => this.keyOf(d) === wanted) ??
      devices.find((d) => d.id === wanted || d.keyId === wanted) ??
      devices.find((d) => d.name.toLowerCase() === lower) ??
      devices.find((d) => d.name.toLowerCase().includes(lower));
    if (!device) {
      if (!fresh) return this.resolve(target, true);
      throw new Error(`No device matches "${target}". Call device_list for the keys.`);
    }
    const bridge = this.bridges.get(device.platform);
    if (!bridge) throw new Error(`No ${device.platform} support on this host.`);
    return { bridge, device, key: this.keyOf(device) };
  }

  /** A running device for `target` (or the chat's open one). */
  private async running(workspaceId: string, target: string | undefined) {
    const key = target ?? this.workspace(workspaceId).current;
    if (!key) throw new Error('No device is open. Call device_open first.');
    const resolved = await this.resolve(key);
    if (resolved.device.state !== 'running') {
      throw new Error(`${resolved.device.name} is ${resolved.device.state}. Call device_open to start it.`);
    }
    return resolved;
  }

  private ensureEnabled(): void {
    if (!this.enabled) throw new DeviceAccessError('Mobile devices are turned off in Settings › Mobile devices.');
  }

  private ensureAgent(workspaceId: string, key: string, kind: string, name: string): void {
    this.ensureEnabled();
    if (this.agentAccess(workspaceId, key, kind)) return;
    void this.emit(workspaceId, { kind: 'devices.access_requested', data: { workspaceId, device: key, name } });
    throw new DeviceAccessError(
      `The agent may not use ${name} in this chat. Ask the user to turn on "Agent" for it in the Devices tab, then try again.`,
    );
  }

  setAgentAccess(workspaceId: string, key: string, allowed: boolean): void {
    this.workspace(workspaceId).grants.set(key, allowed);
    if (!allowed) this.workspace(workspaceId).activeUntil.delete(key);
    this.broadcastAccess(workspaceId, key);
  }

  // ── Open / close ────────────────────────────────────────────

  /**
   * Starts the device if it is off and makes it the chat's open device. `by`
   * decides the access check: the user's own pane may open anything.
   */
  async open(workspaceId: string, target: string, by: 'agent' | 'user', signal?: AbortSignal): Promise<DeviceInfo> {
    this.ensureEnabled();
    const { bridge, device, key } = await this.resolve(target);
    if (by === 'agent') this.ensureAgent(workspaceId, key, device.kind, device.name);
    if (device.state === 'unauthorized') {
      throw new Error(`${device.name} has not allowed USB debugging from this computer yet: accept the prompt on the phone.`);
    }
    if (device.state !== 'running') {
      await bridge.boot(device, signal);
      this.workspace(workspaceId).booted.add(key);
      this.listCache = null;
    }
    const state = this.workspace(workspaceId);
    state.current = key;
    const info = (await this.list(workspaceId, true)).find((d) => d.key === key);
    if (!info) throw new Error(`${device.name} disappeared while starting.`);
    void this.emit(workspaceId, { kind: 'devices.opened', data: { workspaceId, device: key, name: info.name, by } });
    return info;
  }

  async close(workspaceId: string, target: string | undefined, shutdown: boolean): Promise<string> {
    const state = this.workspace(workspaceId);
    const key = target ? (await this.resolve(target)).key : state.current;
    if (!key) return 'No device was open.';
    if (state.current === key) state.current = undefined;
    state.snapshots.delete(key);
    if (shutdown) {
      if (!state.booted.has(key)) return 'Detached. Not shut down: this chat did not start the device.';
      const { bridge, device } = await this.resolve(key);
      await this.stopStream(key);
      if (device.state === 'running') await bridge.shutdown(device.id);
      state.booted.delete(key);
      this.listCache = null;
      void this.emit(workspaceId, { kind: 'devices.closed', data: { workspaceId, device: key } });
      return `Shut down ${device.name}.`;
    }
    return 'Detached.';
  }

  // ── Streams ─────────────────────────────────────────────────

  /**
   * Adds a watcher to the device's stream, starting it on the first. The
   * returned input path is the user's (pane) input.
   */
  async watch(workspaceId: string, key: string, watcher: DeviceWatcher): Promise<{ input(e: DeviceInputEvent): Promise<void>; close(): void }> {
    this.ensureEnabled();
    const { bridge, device } = await this.resolve(key);
    if (device.state !== 'running') throw new Error(`${device.name} is not running.`);
    let producer = this.producers.get(key);
    if (!producer) {
      producer = { key, handle: null, opening: null, watchers: new Set(), config: null, size: null };
      this.producers.set(key, producer);
    }
    const p = producer;
    p.watchers.add(watcher);
    if (p.size) watcher.message({ type: 'size', width: p.size.width, height: p.size.height });
    watcher.message(this.accessMessage(workspaceId, key, device.kind));
    try {
      if (!p.handle) {
        p.opening ??= bridge.openStream(device.id, {
          frame: (frame) => {
            if (frame.config) p.config = frame;
            for (const w of p.watchers) w.frame(frame);
          },
          size: (width, height) => {
            p.size = { width, height };
            for (const w of p.watchers) w.message({ type: 'size', width, height });
          },
          error: (message) => {
            for (const w of p.watchers) w.message({ type: 'stream_error', message });
            void this.stopStream(key);
          },
        });
        p.handle = await p.opening;
        p.opening = null;
      } else {
        if (p.config) watcher.frame(p.config);
        await p.handle.requestKeyframe().catch(() => undefined);
      }
    } catch (err) {
      p.watchers.delete(watcher);
      p.opening = null;
      if (p.watchers.size === 0) this.producers.delete(key);
      throw err;
    }
    return {
      input: async (event) => {
        await p.handle?.input(event);
      },
      close: () => {
        p.watchers.delete(watcher);
        if (p.watchers.size === 0) void this.stopStream(key);
      },
    };
  }

  private async stopStream(key: string): Promise<void> {
    const producer = this.producers.get(key);
    if (!producer) return;
    this.producers.delete(key);
    const handle = producer.handle ?? (await producer.opening?.catch(() => null));
    await handle?.close().catch(() => undefined);
  }

  private async stopAllStreams(): Promise<void> {
    await Promise.all([...this.producers.keys()].map((k) => this.stopStream(k)));
  }

  private broadcastMark(key: string, mark: DeviceActionMark): void {
    const producer = this.producers.get(key);
    if (!producer) return;
    for (const w of producer.watchers) w.message({ type: 'action', mark });
  }

  private accessMessage(workspaceId: string, key: string, kind: string): DeviceStreamMessage {
    const state = this.workspace(workspaceId);
    return {
      type: 'access',
      agentAccess: this.agentAccess(workspaceId, key, kind),
      agentActive: (state.activeUntil.get(key) ?? 0) > Date.now(),
    };
  }

  private broadcastAccess(workspaceId: string, key: string): void {
    const producer = this.producers.get(key);
    if (!producer) return;
    const kind = this.listCache?.devices.find((d) => this.keyOf(d) === key)?.kind ?? 'usb';
    const message = this.accessMessage(workspaceId, key, kind);
    for (const w of producer.watchers) w.message(message);
  }

  private markAgentActive(workspaceId: string, key: string): void {
    const state = this.workspace(workspaceId);
    const wasActive = (state.activeUntil.get(key) ?? 0) > Date.now();
    state.activeUntil.set(key, Date.now() + AGENT_ACTIVE_MS);
    if (!wasActive) this.broadcastAccess(workspaceId, key);
    const timerKey = `${workspaceId}|${key}`;
    clearTimeout(this.activityTimers.get(timerKey));
    this.activityTimers.set(
      timerKey,
      setTimeout(() => {
        this.activityTimers.delete(timerKey);
        this.broadcastAccess(workspaceId, key);
      }, AGENT_ACTIVE_MS + 50).unref(),
    );
  }

  // ── Reading ─────────────────────────────────────────────────

  async snapshot(workspaceId: string, target: string | undefined, options: { all?: boolean; by: 'agent' | 'user' }): Promise<DeviceSnapshot> {
    this.ensureEnabled();
    const { bridge, device, key } = await this.running(workspaceId, target);
    if (options.by === 'agent') this.ensureAgent(workspaceId, key, device.kind, device.name);
    const raw = await bridge.snapshot(device.id);
    const snapshot = buildSnapshot(key, bridge.platform, raw, { all: options.all });
    if (options.by === 'agent') this.workspace(workspaceId).snapshots.set(key, snapshot);
    return snapshot;
  }

  async screenshot(
    workspaceId: string,
    target: string | undefined,
    by: 'agent' | 'user',
    maxEdge = 1280,
  ): Promise<{ bytes: Buffer; mimeType: string; width: number; height: number; device: string }> {
    this.ensureEnabled();
    const { bridge, device, key } = await this.running(workspaceId, target);
    if (by === 'agent') this.ensureAgent(workspaceId, key, device.kind, device.name);
    const shot = await bridge.screenshot(device.id);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gai-device-shot-'));
    try {
      const source = path.join(dir, `shot.${shot.mime === 'image/png' ? 'png' : 'jpg'}`);
      await fs.writeFile(source, shot.bytes);
      const out = await transcodeScreenshot({ sourcePath: source, format: 'jpeg', maxEdge, quality: 80, logger: this.logger });
      const bytes = await fs.readFile(out.path);
      return { bytes, mimeType: out.mimeType, width: out.width, height: out.height, device: key };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ── Acting ──────────────────────────────────────────────────

  private point(snapshot: DeviceSnapshot | undefined, step: { target?: string; x?: number; y?: number }): { x: number; y: number } {
    if (step.target) {
      if (!snapshot) throw new Error(`No snapshot to resolve "${step.target}". Call device_snapshot first.`);
      const el = findElement(snapshot, step.target);
      if (!el) throw new Error(`No element "${step.target}" in the last snapshot. Snapshot again or pass x,y.`);
      return { x: el.frame.x + el.frame.w / 2, y: el.frame.y + el.frame.h / 2 };
    }
    if (typeof step.x === 'number' && typeof step.y === 'number') {
      if (step.x < 0 || step.x > 1 || step.y < 0 || step.y > 1) throw new Error('x and y are fractions of the screen, 0..1.');
      return { x: step.x, y: step.y };
    }
    throw new Error('Give a target (a ref like e4, or a label) or x and y.');
  }

  /**
   * Runs steps in order, stopping at the first failure. Returns one line per
   * step and the diff against the last snapshot (DV-7).
   */
  async act(workspaceId: string, target: string | undefined, steps: DeviceStep[], signal?: AbortSignal): Promise<{ ok: boolean; results: string[]; changes: string; snapshot: DeviceSnapshot | null }> {
    this.ensureEnabled();
    const { bridge, device, key } = await this.running(workspaceId, target);
    this.ensureAgent(workspaceId, key, device.kind, device.name);
    const state = this.workspace(workspaceId);
    const before = state.snapshots.get(key);
    const results: string[] = [];
    let ok = true;
    for (const [i, step] of steps.entries()) {
      if (signal?.aborted) {
        results.push(`${i + 1}. cancelled`);
        ok = false;
        break;
      }
      // Access can be revoked mid-batch (Take over).
      if (!this.agentAccess(workspaceId, key, device.kind)) {
        results.push(`${i + 1}. stopped: the user took over ${device.name}`);
        ok = false;
        break;
      }
      this.markAgentActive(workspaceId, key);
      try {
        results.push(`${i + 1}. ${await this.runStep(bridge, device.id, key, before, step)}`);
      } catch (err) {
        results.push(`${i + 1}. failed: ${(err as Error).message}`);
        ok = false;
        break;
      }
    }
    // Let animations settle before reading the result.
    await new Promise((r) => setTimeout(r, 600));
    let after: DeviceSnapshot | null = null;
    let changes = '';
    try {
      after = buildSnapshot(key, bridge.platform, await bridge.snapshot(device.id));
      state.snapshots.set(key, after);
      changes = diffSnapshots(before, after);
    } catch (err) {
      changes = `Could not read the screen afterwards: ${(err as Error).message}`;
    }
    return { ok, results, changes, snapshot: after };
  }

  private async runStep(bridge: IDeviceBridge, id: string, key: string, snapshot: DeviceSnapshot | undefined, step: DeviceStep): Promise<string> {
    const at = Date.now();
    switch (step.action) {
      case 'tap': {
        const p = this.point(snapshot, step);
        this.broadcastMark(key, { kind: 'tap', x: p.x, y: p.y, by: 'agent', at });
        await bridge.tap(id, p);
        return `tapped ${step.target ?? `${p.x.toFixed(2)},${p.y.toFixed(2)}`}`;
      }
      case 'long_press': {
        const p = this.point(snapshot, step);
        this.broadcastMark(key, { kind: 'long_press', x: p.x, y: p.y, by: 'agent', at });
        await bridge.longPress(id, p, step.ms ?? 800);
        return `long-pressed ${step.target ?? `${p.x.toFixed(2)},${p.y.toFixed(2)}`}`;
      }
      case 'swipe': {
        const from = step.target || typeof step.x === 'number' ? this.point(snapshot, step) : { x: 0.5, y: 0.5 };
        let to: { x: number; y: number };
        if (typeof step.toX === 'number' && typeof step.toY === 'number') to = { x: step.toX, y: step.toY };
        else if (step.direction) to = shift(from, step.direction, 0.4);
        else throw new Error('A swipe needs toX,toY or a direction.');
        this.broadcastMark(key, { kind: 'swipe', x: from.x, y: from.y, toX: to.x, toY: to.y, by: 'agent', at });
        await bridge.swipe(id, from, to, step.ms ?? 300);
        return `swiped ${from.x.toFixed(2)},${from.y.toFixed(2)} → ${to.x.toFixed(2)},${to.y.toFixed(2)}`;
      }
      case 'scroll': {
        const center = step.target ? this.point(snapshot, step) : { x: 0.5, y: 0.5 };
        // Scrolling DOWN shows content further down: the finger moves up.
        const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;
        const from = shift(center, opposite[step.direction], 0.25);
        const to = shift(center, step.direction, 0.25);
        this.broadcastMark(key, { kind: 'swipe', x: from.x, y: from.y, toX: to.x, toY: to.y, by: 'agent', at });
        await bridge.swipe(id, from, to, 350);
        return `scrolled ${step.direction}`;
      }
      case 'type': {
        if (step.target) {
          const p = this.point(snapshot, step);
          this.broadcastMark(key, { kind: 'tap', x: p.x, y: p.y, by: 'agent', at });
          await bridge.tap(id, p);
          await new Promise((r) => setTimeout(r, 400));
        }
        await bridge.input(id, { type: 'text', text: step.text });
        if (step.submit) await bridge.input(id, { type: 'key', key: 'enter' });
        return `typed ${JSON.stringify(step.text.length > 40 ? `${step.text.slice(0, 39)}…` : step.text)}${step.submit ? ' + Enter' : ''}`;
      }
      case 'press': {
        if ((DEVICE_BUTTONS as readonly string[]).includes(step.key)) {
          await bridge.input(id, { type: 'button', button: step.key as DeviceButton });
        } else if ((DEVICE_KEYS as readonly string[]).includes(step.key)) {
          await bridge.input(id, { type: 'key', key: step.key as DeviceKey });
        } else {
          throw new Error(`Unknown key "${step.key}". Use one of: ${[...DEVICE_BUTTONS, ...DEVICE_KEYS].join(', ')}.`);
        }
        this.broadcastMark(key, { kind: 'press', by: 'agent', at });
        return `pressed ${step.key}`;
      }
      case 'wait': {
        if (step.text) {
          const deadline = Date.now() + Math.min(step.ms ?? 10_000, 30_000);
          const wanted = step.text.toLowerCase();
          while (Date.now() < deadline) {
            const raw = await bridge.snapshot(id).catch(() => null);
            if (raw?.elements.some((e) => [e.label, e.value].some((v) => v?.toLowerCase().includes(wanted)))) return `"${step.text}" appeared`;
            await new Promise((r) => setTimeout(r, 700));
          }
          throw new Error(`"${step.text}" did not appear`);
        }
        await new Promise((r) => setTimeout(r, Math.min(step.ms ?? 1000, 10_000)));
        return `waited ${Math.min(step.ms ?? 1000, 10_000)} ms`;
      }
    }
  }

  async app(workspaceId: string, target: string | undefined, request: DeviceAppAction): Promise<string> {
    this.ensureEnabled();
    const { bridge, device, key } = await this.running(workspaceId, target);
    this.ensureAgent(workspaceId, key, device.kind, device.name);
    if (request.action !== 'list') this.markAgentActive(workspaceId, key);
    return bridge.app(device.id, request);
  }

  async logs(workspaceId: string, target: string | undefined, options: { app?: string; lines?: number; level?: 'debug' | 'info' | 'warn' | 'error' }): Promise<string> {
    this.ensureEnabled();
    const { bridge, device, key } = await this.running(workspaceId, target);
    this.ensureAgent(workspaceId, key, device.kind, device.name);
    return bridge.logs(device.id, { lines: options.lines ?? 200, ...(options.app ? { app: options.app } : {}), ...(options.level ? { level: options.level } : {}) });
  }

  /** The user's own action from the pane (hardware keys, rotate), drawn like any other. */
  async userInput(workspaceId: string, key: string, event: DeviceInputEvent): Promise<void> {
    this.ensureEnabled();
    const { bridge, device } = await this.running(workspaceId, key);
    await bridge.input(device.id, event);
  }

  async startDevice(workspaceId: string, key: string): Promise<DeviceInfo> {
    return this.open(workspaceId, key, 'user');
  }

  async stopDevice(workspaceId: string, key: string): Promise<void> {
    this.ensureEnabled();
    const { bridge, device } = await this.resolve(key);
    await this.stopStream(key);
    if (device.state === 'running') await bridge.shutdown(device.id);
    this.workspace(workspaceId).booted.delete(key);
    this.listCache = null;
  }

  /** Workspace deleted: forget its state (devices keep running; they are the user's). */
  forgetWorkspace(workspaceId: string): void {
    this.workspaces.delete(workspaceId);
  }

  async dispose(): Promise<void> {
    await this.stopAllStreams();
    for (const t of this.activityTimers.values()) clearTimeout(t);
    await Promise.all([...this.bridges.values()].map((b) => b.dispose().catch(() => undefined)));
  }

  private async emit(workspaceId: string, event: AgentEvent): Promise<void> {
    try {
      await this.eventBus.emit(`${DEVICE_EVENT_SCOPE}:${workspaceId}`, event);
    } catch (err) {
      this.logger.warn?.(`[devices] emit failed: ${(err as Error).message}`);
    }
  }

}

function shift(p: { x: number; y: number }, direction: Direction, by: number): { x: number; y: number } {
  const c = (v: number) => Math.min(0.98, Math.max(0.02, v));
  if (direction === 'up') return { x: p.x, y: c(p.y - by) };
  if (direction === 'down') return { x: p.x, y: c(p.y + by) };
  if (direction === 'left') return { x: c(p.x - by), y: p.y };
  return { x: c(p.x + by), y: p.y };
}

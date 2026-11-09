// ────────────────────────────────────────────────────────────────
// IDeviceBridge — one mobile platform's native back end (docs/devices DV-2,
// DV-3). `DeviceService` merges the bridges; the tools and routes never see
// adb, simctl or the simulator helper.
//
// Bridges speak in NATIVE device ids (an adb serial, a simulator UDID) and
// normalised coordinates. The service owns the `platform:` keys, refs,
// access and fan-out.
// ────────────────────────────────────────────────────────────────

import type {
  DeviceButton,
  DeviceInputEvent,
  DeviceKey,
  DeviceKind,
  DevicePlatform,
  DeviceState,
  DeviceToolingStatus,
} from '@generatorai/shared';

export interface BridgeDevice {
  /** Native id: adb serial (running) or AVD name (off), simulator UDID. */
  id: string;
  /** Stable key part after `platform:` (an AVD keeps `avd:<name>` while running). */
  keyId: string;
  kind: DeviceKind;
  name: string;
  osVersion?: string;
  state: DeviceState;
}

/** A raw element before the service assigns refs; frame is normalised 0..1. */
export interface RawDeviceElement {
  role: string;
  type?: string;
  label?: string;
  value?: string;
  id?: string;
  enabled: boolean;
  interactive: boolean;
  frame: { x: number; y: number; w: number; h: number };
  depth: number;
}

export interface RawDeviceSnapshot {
  app?: string;
  screen: { width: number; height: number; unit: 'px' | 'pt' };
  elements: RawDeviceElement[];
}

/** One encoded frame for the stream socket. */
export interface DeviceFrame {
  codec: number;
  keyframe: boolean;
  config: boolean;
  width: number;
  height: number;
  data: Uint8Array;
}

export interface DeviceFrameSink {
  frame(frame: DeviceFrame): void;
  size(width: number, height: number): void;
  error(message: string): void;
}

export interface DeviceStreamHandle {
  input(event: DeviceInputEvent): Promise<void>;
  /** Re-send the decoder config and a keyframe (a viewer joined). */
  requestKeyframe(): Promise<void>;
  close(): Promise<void>;
}

export type DeviceAppAction =
  | { action: 'launch'; app: string }
  | { action: 'terminate'; app: string }
  | { action: 'install'; path: string }
  | { action: 'list' }
  | { action: 'open_url'; url: string };

export interface DeviceLogOptions {
  app?: string;
  lines: number;
  level?: 'debug' | 'info' | 'warn' | 'error';
}

export interface IDeviceBridge {
  readonly platform: DevicePlatform;
  /** Tooling checks for the setup checklist; never throws. */
  status(): Promise<DeviceToolingStatus>;
  list(): Promise<BridgeDevice[]>;
  /** Starts an off device; resolves with its running native id once usable. */
  boot(device: BridgeDevice, signal?: AbortSignal): Promise<string>;
  shutdown(id: string): Promise<void>;
  /** A live stream with input; frames go to `sink` until `close()`. */
  openStream(id: string, sink: DeviceFrameSink): Promise<DeviceStreamHandle>;
  /** One input event without a stream (agent actions); a `touch` here is ignored, use `tap`. */
  input(id: string, event: DeviceInputEvent): Promise<void>;
  tap(id: string, at: { x: number; y: number }): Promise<void>;
  /** A swipe from one normalised point to another over `ms`. */
  swipe(id: string, from: { x: number; y: number }, to: { x: number; y: number }, ms: number): Promise<void>;
  longPress(id: string, at: { x: number; y: number }, ms: number): Promise<void>;
  snapshot(id: string): Promise<RawDeviceSnapshot>;
  /** JPEG or PNG bytes of the current screen. */
  screenshot(id: string): Promise<{ bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' }>;
  app(id: string, request: DeviceAppAction): Promise<string>;
  logs(id: string, options: DeviceLogOptions): Promise<string>;
  /** Stops helpers and sockets. */
  dispose(): Promise<void>;
}

export const DEVICE_BUTTONS: readonly DeviceButton[] = ['home', 'back', 'recents', 'lock', 'volume_up', 'volume_down'];
export const DEVICE_KEYS: readonly DeviceKey[] = ['enter', 'delete', 'tab', 'escape', 'up', 'down', 'left', 'right'];

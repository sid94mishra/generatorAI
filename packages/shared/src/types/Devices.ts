// ────────────────────────────────────────────────────────────────
// Mobile devices (docs/devices): the shapes the Devices dock tab, the
// `device_*` agent tools and the server share.
//
// Coordinates are NORMALISED 0..1 of the device screen everywhere (DV-6):
// iOS reports points and Android pixels, and neither leaks past the bridge.
// ────────────────────────────────────────────────────────────────

export type DevicePlatform = 'android' | 'ios';

/** How the device exists: a virtual device, or a phone on a cable or the network. */
export type DeviceKind = 'emulator' | 'simulator' | 'usb' | 'wifi';

/**
 * `off` a virtual device that is not running; `starting` booting; `running`
 * usable; `offline` adb lost it; `unauthorized` a phone that has not accepted
 * this computer's debugging key yet.
 */
export type DeviceState = 'off' | 'starting' | 'running' | 'offline' | 'unauthorized';

export interface DeviceInfo {
  /** Stable id: `android:avd:<name>`, `android:<serial>` or `ios:<udid>`. */
  key: string;
  platform: DevicePlatform;
  kind: DeviceKind;
  name: string;
  /** "Android 16", "iOS 27.0". */
  osVersion?: string;
  state: DeviceState;
  /** Whether the agent may drive this device in the asking chat (DV-8). */
  agentAccess: boolean;
}

export interface DeviceToolingCheck {
  id: string;
  label: string;
  ok: boolean;
  /** What was found (a path, a version) or why not. */
  detail?: string;
  /** The next step when `ok` is false. */
  hint?: string;
}

export interface DeviceToolingStatus {
  platform: DevicePlatform;
  /** The platform can list and drive devices on this host. */
  available: boolean;
  checks: DeviceToolingCheck[];
}

export interface DevicesOverview {
  /** Settings › Mobile devices. */
  enabled: boolean;
  devices: DeviceInfo[];
  tooling: DeviceToolingStatus[];
}

/** A rectangle in normalised screen coordinates. */
export interface DeviceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeviceElement {
  /** `e1`…`eN`, valid until the next snapshot of the same device. */
  ref: string;
  /** Normalised role: Button, TextField, StaticText, Image, Switch, Cell … */
  role: string;
  label?: string;
  value?: string;
  /** resource-id (Android) or accessibility identifier (iOS). */
  id?: string;
  /** Android class or iOS AX type, verbatim. */
  type?: string;
  enabled: boolean;
  /** Can be tapped, typed into or toggled. */
  interactive: boolean;
  frame: DeviceRect;
  /** Ref of the nearest kept ancestor. */
  parent?: string;
}

export interface DeviceSnapshot {
  device: string;
  platform: DevicePlatform;
  /** The foreground app: bundle id or package. */
  app?: string;
  /** Native screen size and its unit, for reports. */
  screen: { width: number; height: number; unit: 'px' | 'pt' };
  elements: DeviceElement[];
  capturedAt: number;
}

export type DeviceButton = 'home' | 'back' | 'recents' | 'lock' | 'volume_up' | 'volume_down';

/** Named keys the pane and the tools may press (printable text goes as `text`). */
export type DeviceKey = 'enter' | 'delete' | 'tab' | 'escape' | 'up' | 'down' | 'left' | 'right';

export type DeviceInputEvent =
  | { type: 'touch'; action: 'down' | 'move' | 'up'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; dx: number; dy: number }
  | { type: 'key'; key: DeviceKey }
  | { type: 'text'; text: string }
  | { type: 'button'; button: DeviceButton }
  | { type: 'rotate' };

/** One touch the pane draws as a ripple or a trail (DV-12). */
export interface DeviceActionMark {
  kind: 'tap' | 'long_press' | 'swipe' | 'type' | 'press';
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  by: 'agent' | 'user';
  at: number;
}

/**
 * Text messages on the device stream socket, server → client. Binary
 * messages are frames with the Browser screencast's 16-byte header
 * (`DEVICE_FRAME_CODEC`).
 */
export type DeviceStreamMessage =
  | { type: 'stream_unavailable'; message: string }
  | { type: 'stream_error'; message: string }
  | { type: 'size'; width: number; height: number }
  | { type: 'action'; mark: DeviceActionMark }
  | { type: 'access'; agentAccess: boolean; agentActive: boolean };

/** Frame header codec ids (the Browser screencast owns 0 and 1). */
export const DEVICE_FRAME_CODEC = { jpeg: 0, h264Avcc: 2, h264AnnexB: 3 } as const;

/** Frame header flag bits. */
export const DEVICE_FRAME_FLAG = { keyframe: 1, config: 2 } as const;

/** Event kinds on the `devices:<workspaceId>` session scope. */
export type DevicesEventKind = 'devices.opened' | 'devices.access_requested' | 'devices.closed';

// ────────────────────────────────────────────────────────────────
// The `device_*` tools (docs/devices DV-7): mobile devices for the agent,
// bound to one workspace like the Browser tools. Elements are `e1…eN` from
// the latest snapshot; points are fractions of the screen (0..1).
// ────────────────────────────────────────────────────────────────

import type { DeviceButton, DeviceKey } from '@generatorai/shared';
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import { TOOL_BINARY_KEY } from '../../domain/ports/IAgentHarness.js';
import type { DeviceService, DeviceStep } from '../../services/devices/DeviceService.js';
import { formatSnapshot } from '../../services/devices/deviceSnapshot.js';
import { DEVICE_BUTTONS, DEVICE_KEYS } from '../../domain/ports/IDeviceBridge.js';

export interface DeviceToolContext {
  deviceService: DeviceService;
  workspaceId: string;
  owner?: string;
}

export const DEVICE_TOOL_NAMES = [
  'device_list',
  'device_open',
  'device_close',
  'device_snapshot',
  'device_screenshot',
  'device_act',
  'device_app',
  'device_logs',
] as const;

/** `device_app` actions that change things beyond the device's screen: asked like an install (DV-8). */
export const DEVICE_APP_ASKING_ACTIONS: ReadonlySet<string> = new Set(['install', 'open_url']);

const DEVICE = { type: 'string', description: 'Device key or name from device_list. Omit for the device open in this chat.' };

async function wrap<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
const ACTIONS = ['tap', 'long_press', 'swipe', 'scroll', 'type', 'press', 'wait'] as const;

/** Validates one raw step; throws a message the model can act on. */
export function parseDeviceStep(raw: unknown, index: number): DeviceStep {
  if (!raw || typeof raw !== 'object') throw new Error(`step ${index + 1}: not an object`);
  const s = raw as Record<string, unknown>;
  const action = s['action'];
  const target = str(s['target']);
  const x = num(s['x']);
  const y = num(s['y']);
  const at = { ...(target ? { target } : {}), ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) };
  switch (action) {
    case 'tap':
      return { action, ...at };
    case 'long_press':
      return { action, ...at, ...(num(s['ms']) !== undefined ? { ms: num(s['ms'])! } : {}) };
    case 'swipe': {
      const direction = s['direction'];
      if (direction !== undefined && !DIRECTIONS.includes(direction as never)) throw new Error(`step ${index + 1}: direction is up, down, left or right`);
      return {
        action,
        ...at,
        ...(num(s['toX']) !== undefined ? { toX: num(s['toX'])! } : {}),
        ...(num(s['toY']) !== undefined ? { toY: num(s['toY'])! } : {}),
        ...(direction ? { direction: direction as (typeof DIRECTIONS)[number] } : {}),
        ...(num(s['ms']) !== undefined ? { ms: num(s['ms'])! } : {}),
      };
    }
    case 'scroll': {
      const direction = s['direction'];
      if (!DIRECTIONS.includes(direction as never)) throw new Error(`step ${index + 1}: scroll needs direction up, down, left or right`);
      return { action, direction: direction as (typeof DIRECTIONS)[number], ...(target ? { target } : {}) };
    }
    case 'type': {
      const text = typeof s['text'] === 'string' ? s['text'] : undefined;
      if (text === undefined) throw new Error(`step ${index + 1}: type needs text`);
      return { action, text, ...(target ? { target } : {}), ...(s['submit'] === true ? { submit: true } : {}) };
    }
    case 'press': {
      const key = s['key'];
      const allowed = [...DEVICE_BUTTONS, ...DEVICE_KEYS] as readonly string[];
      if (typeof key !== 'string' || !allowed.includes(key)) throw new Error(`step ${index + 1}: press needs key, one of ${allowed.join(', ')}`);
      return { action, key: key as DeviceButton | DeviceKey };
    }
    case 'wait':
      return { action, ...(num(s['ms']) !== undefined ? { ms: num(s['ms'])! } : {}), ...(str(s['text']) ? { text: str(s['text'])! } : {}) };
    default:
      throw new Error(`step ${index + 1}: action is one of ${ACTIONS.join(', ')}`);
  }
}

export function buildDeviceToolSet(ctx: DeviceToolContext): ToolDefinition[] {
  const svc = ctx.deviceService;
  const ws = ctx.workspaceId;
  const owner = ctx.owner ?? 'device-tools';
  return [
    {
      name: 'device_list',
      description:
        'List the mobile devices on this computer: iOS simulators (macOS), Android emulators and Android phones, ' +
        'with each one’s key, state and whether you may use it. Also reports missing tooling.',
      owner,
      skipPermission: true,
      alwaysLoad: true,
      parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: async () =>
        wrap(async () => {
          const overview = await svc.overview(ws, true);
          const open = svc.current(ws);
          return {
            ok: true,
            open: open ?? null,
            devices: overview.devices.map((d) => ({
              key: d.key,
              name: d.name,
              platform: d.platform,
              kind: d.kind,
              os: d.osVersion,
              state: d.state,
              agentAccess: d.agentAccess,
            })),
            ...(overview.tooling.some((t) => t.checks.some((c) => !c.ok))
              ? {
                  missing: overview.tooling.flatMap((t) =>
                    t.checks.filter((c) => !c.ok).map((c) => `${t.platform}: ${c.label} — ${c.hint ?? ''}`),
                  ),
                }
              : {}),
          };
        }),
    },
    {
      name: 'device_open',
      description:
        'Open a device for this chat: starts it if it is off (an emulator or simulator can take a minute) and ' +
        'shows it to the user in the Devices tab. Later device_* calls default to it.',
      owner,
      skipPermission: true,
      alwaysLoad: true,
      timeoutMs: 330_000,
      parametersSchema: {
        type: 'object',
        properties: { device: { type: 'string', description: 'Device key or name from device_list.' } },
        required: ['device'],
        additionalProperties: false,
      },
      handler: async (args) =>
        wrap(async () => {
          const device = str(args['device']);
          if (!device) throw new Error('device is required.');
          const info = await svc.open(ws, device, 'agent');
          return { ok: true, device: info, next: 'Call device_snapshot to read the screen.' };
        }),
    },
    {
      name: 'device_close',
      description:
        'Stop using a device in this chat. With shutdown:true, also shut it down — only a device this chat started.',
      owner,
      skipPermission: true,
      parametersSchema: {
        type: 'object',
        properties: { device: DEVICE, shutdown: { type: 'boolean', description: 'Shut the device down. Default false.' } },
        additionalProperties: false,
      },
      handler: async (args) => wrap(async () => ({ ok: true, result: await svc.close(ws, str(args['device']), args['shutdown'] === true) })),
    },
    {
      name: 'device_snapshot',
      description:
        'Read the device screen as a list of elements: `e4 Button "Sign in" id=login @0.50,0.83` — ref, role, ' +
        'label, value, id and centre (fractions of the screen). Refs stay valid until the next snapshot or ' +
        'device_act. Lists interactive and labelled elements; all:true lists every element. Prefer this to a ' +
        'screenshot.',
      owner,
      skipPermission: true,
      alwaysLoad: true,
      parametersSchema: {
        type: 'object',
        properties: { device: DEVICE, all: { type: 'boolean', description: 'Every element, not only meaningful ones.' } },
        additionalProperties: false,
      },
      handler: async (args) =>
        wrap(async () => {
          const snapshot = await svc.snapshot(ws, str(args['device']), { all: args['all'] === true, by: 'agent' });
          return { ok: true, device: snapshot.device, screen: formatSnapshot(snapshot) };
        }),
    },
    {
      name: 'device_screenshot',
      description:
        'A picture of the device screen, for what the element list cannot tell (layout, colours, images, ' +
        'clipping). Points you report from it are fractions of the image (0..1).',
      owner,
      skipPermission: true,
      parametersSchema: { type: 'object', properties: { device: DEVICE }, additionalProperties: false },
      handler: async (args) =>
        wrap(async () => {
          const shot = await svc.screenshot(ws, str(args['device']), 'agent');
          return {
            ok: true,
            device: shot.device,
            image: `${shot.width}×${shot.height}`,
            note: 'The image follows. Give points as fractions of its width and height.',
            [TOOL_BINARY_KEY]: [{ data: shot.bytes.toString('base64'), mimeType: shot.mimeType, description: `Screen of ${shot.device}` }],
          };
        }),
    },
    {
      name: 'device_act',
      description:
        'Act on the device: one or more steps in order, then what changed on screen (with fresh refs). Batch ' +
        'the steps of one flow in one call. Steps: {action:"tap", target:"e4"} (a ref or a label) or ' +
        '{action:"tap", x:0.5, y:0.8}; {action:"long_press", target, ms?}; {action:"swipe", x, y, toX, toY} ' +
        'or {action:"swipe", direction:"up"}; {action:"scroll", direction:"down", target?}; ' +
        '{action:"type", text, target?, submit?} (target is tapped first; submit presses Enter); ' +
        '{action:"press", key:"home"|"back"|"recents"|"lock"|"volume_up"|"volume_down"|"enter"|"delete"|"tab"|' +
        '"escape"|"up"|"down"|"left"|"right"}; {action:"wait", ms?, text?} (text waits until it appears).',
      owner,
      skipPermission: true,
      alwaysLoad: true,
      timeoutMs: 180_000,
      parametersSchema: {
        type: 'object',
        properties: {
          device: DEVICE,
          steps: {
            type: 'array',
            minItems: 1,
            maxItems: 40,
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: [...ACTIONS] },
                target: { type: 'string', description: 'Ref (e4) or label from the last snapshot.' },
                x: { type: 'number' },
                y: { type: 'number' },
                toX: { type: 'number' },
                toY: { type: 'number' },
                direction: { type: 'string', enum: [...DIRECTIONS] },
                text: { type: 'string' },
                submit: { type: 'boolean' },
                key: { type: 'string', enum: [...DEVICE_BUTTONS, ...DEVICE_KEYS] },
                ms: { type: 'number' },
              },
              required: ['action'],
            },
          },
        },
        required: ['steps'],
        additionalProperties: false,
      },
      handler: async (args) =>
        wrap(async () => {
          const raw = Array.isArray(args['steps']) ? args['steps'] : [];
          if (raw.length === 0) throw new Error('steps must list at least one step.');
          const steps = raw.map((s, i) => parseDeviceStep(s, i));
          const result = await svc.act(ws, str(args['device']), steps);
          return { ok: result.ok, steps: result.results, changes: result.changes };
        }),
    },
    {
      name: 'device_app',
      description:
        'Apps on the device: launch or terminate one (bundle id or package), list the apps the user installed, ' +
        'install a built app (.app for a simulator, .apk for Android; an absolute path), or open a URL or deep ' +
        'link. Installing and opening URLs may ask the user first.',
      owner,
      skipPermission: true,
      timeoutMs: 330_000,
      parametersSchema: {
        type: 'object',
        properties: {
          device: DEVICE,
          action: { type: 'string', enum: ['launch', 'terminate', 'list', 'install', 'open_url'] },
          app: { type: 'string', description: 'Bundle id (iOS) or package name (Android).' },
          path: { type: 'string', description: 'Absolute path of the .app or .apk to install.' },
          url: { type: 'string', description: 'URL or deep link for open_url.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      handler: async (args) =>
        wrap(async () => {
          const action = args['action'];
          const device = str(args['device']);
          const need = (name: 'app' | 'path' | 'url') => {
            const v = str(args[name]);
            if (!v) throw new Error(`${String(action)} needs ${name}.`);
            return v;
          };
          let result: string;
          if (action === 'launch' || action === 'terminate') result = await svc.app(ws, device, { action, app: need('app') });
          else if (action === 'install') result = await svc.app(ws, device, { action, path: need('path') });
          else if (action === 'open_url') result = await svc.app(ws, device, { action, url: need('url') });
          else if (action === 'list') result = await svc.app(ws, device, { action });
          else throw new Error('action is one of launch, terminate, list, install, open_url.');
          return { ok: true, result };
        }),
    },
    {
      name: 'device_logs',
      description: 'Recent device logs (Android logcat, iOS simulator log), optionally for one app and from a level up.',
      owner,
      skipPermission: true,
      parametersSchema: {
        type: 'object',
        properties: {
          device: DEVICE,
          app: { type: 'string', description: 'Bundle id or package name.' },
          lines: { type: 'number', description: 'How many recent lines (default 200, max 2000).' },
          level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
        },
        additionalProperties: false,
      },
      handler: async (args) =>
        wrap(async () => {
          const level = args['level'];
          const logs = await svc.logs(ws, str(args['device']), {
            ...(str(args['app']) ? { app: str(args['app'])! } : {}),
            ...(num(args['lines']) !== undefined ? { lines: num(args['lines'])! } : {}),
            ...(level === 'debug' || level === 'info' || level === 'warn' || level === 'error' ? { level } : {}),
          });
          return { ok: true, logs: logs || '(no lines)' };
        }),
    },
  ];
}

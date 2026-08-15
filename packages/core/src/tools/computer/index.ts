// ────────────────────────────────────────────────────────────────
// Computer Use tool set.
//
// Descriptions are load-bearing. Each one steers the model toward the cheap,
// background-safe path (an element index from a snapshot) and away from the
// expensive, cursor-stealing one (coordinates and synthetic typing), because
// the model's tool choice is the first place safety is either won or lost.
//
// Every tool declares `requiredPermissions: [{ kind: 'computer_use', ... }]`
// so `withPermissionGate` can deny before the handler runs — the harness-level
// gate for providers (OpenAI) that emit no permission requests of their own.
// ────────────────────────────────────────────────────────────────

import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import { TOOL_BINARY_KEY } from '../../domain/ports/IAgentHarness.js';
import type { ComputerToolContext, ComputerToolFactory } from './computerToolTypes.js';
import {
  APP_TARGET_PROPERTIES,
  actionPayload,
  callContext,
  coerceInt,
  coerceString,
  guard,
  refusalPayload,
  snapshotPayload,
  toAppRef,
} from './computerToolTypes.js';

function permission(description: string, resource?: string) {
  return [{ kind: 'computer_use' as const, resource, description }];
}

const createCapabilitiesTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_capabilities',
  description:
    'Report what desktop automation is available on this machine: platform, provider, which operations are ' +
    'supported, and any limitations. Call this once before planning desktop work — on some systems element ' +
    'targeting or dragging is unavailable and you must choose a different approach.',
  owner: ctx.owner ?? 'computer-tools',
  // A capability probe reveals nothing about the user's screen, and gating it
  // would mean the model cannot discover the feature is off without a denial.
  skipPermission: true,
  parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async () => {
    const caps = await ctx.computerService.capabilities(callContext(ctx));
    return {
      ok: true,
      platform: caps.platform,
      provider: caps.provider,
      displayServer: caps.displayServer,
      supports: caps.supports,
      limitations: caps.limitations,
    };
  },
});

const createListAppsTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_list_apps',
  description:
    'List running desktop applications. Use the returned `appId` to target every other computer_* tool. ' +
    'Some applications are permanently excluded for security and will never appear.',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('List running desktop applications'),
  parametersSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async () => {
    const { apps, refusal } = await ctx.computerService.listApps(callContext(ctx));
    if (refusal) return { ok: false, refusal: refusal.code, message: refusal.message };
    return {
      ok: true,
      apps: apps.map((app) => ({
        appId: app.id,
        name: app.name,
        pid: app.pid,
        frontmost: app.frontmost,
        windowCount: app.windowCount,
      })),
    };
  },
});

const createListWindowsTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_list_windows',
  description:
    'List the windows of one application, with their ids and titles. Use this to pick a `windowId` when an ' +
    'application has several windows open.',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('List an application\u2019s windows'),
  parametersSchema: {
    type: 'object',
    properties: { ...APP_TARGET_PROPERTIES },
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const { windows, refusal } = await ctx.computerService.listWindows(callContext(ctx), ref);
    if (refusal) return { ok: false, refusal: refusal.code, message: refusal.message };
    return {
      ok: true,
      windows: windows.map((w) => ({
        windowId: w.id,
        title: w.title,
        focused: w.focused,
        minimised: w.minimised,
      })),
    };
  },
});

const createSnapshotTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_snapshot',
  description:
    'Read a window\u2019s accessibility tree as an indexed list of elements. This is the primary way to see a ' +
    'desktop application: it is cheaper and far more reliable than a screenshot, and the returned element ' +
    'indices are what every other tool targets. The indices are valid ONLY for the returned snapshotId, and ' +
    'any action invalidates them \u2014 always snapshot again after acting. When you already know what you are ' +
    'looking for, pass `query`: it filters at the source and can cut the response by 30x on a large grid.',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Read the contents of a desktop window'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      windowId: { type: 'number', description: 'Window id from computer_list_windows. Defaults to the focused window.' },
      query: {
        type: 'string',
        description:
          'Case-insensitive substring of a role, label or value. Returns only matching elements and their ' +
          'parents, keeping the same element indices. Use it whenever you know the control you want ' +
          '("Save", "Address", "A1"); omit it when you need to see what the window contains.',
      },
      includeScreenshot: {
        type: 'boolean',
        description:
          'Also capture a PNG of this window (never the whole screen) and return the IMAGE to you. Use it when ' +
          'the tree cannot answer the question — a write that may not have landed, a canvas, a chart. It costs ' +
          'real context, so do not set it by default.',
      },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const query = coerceString(args['query']);
    // Only when the model ASKED for the image. Left undefined otherwise so
    // `screenshotEveryAction` still captures a frame for the Computer panel
    // without spending a megabyte of context on every read.
    const wantsImage = args['includeScreenshot'] === true;
    const result = await ctx.computerService.snapshot(callContext(ctx), ref, {
      windowId: coerceInt(args['windowId']),
      ...(query ? { query } : {}),
      includeScreenshot: typeof args['includeScreenshot'] === 'boolean' ? args['includeScreenshot'] : undefined,
    });
    const payload = snapshotPayload(result, query);
    if (!wantsImage || !result.screenshot?.artifactId) return payload;

    const image = await ctx.computerService.readScreenshot(
      callContext(ctx).workspaceId,
      result.screenshot.artifactId,
    );
    if (!image) return payload;
    return {
      ...payload,
      [TOOL_BINARY_KEY]: [
        {
          data: image.base64,
          mimeType: image.mimeType,
          description: `Screenshot of ${result.snapshot?.window.title ?? 'the target window'}`,
        },
      ],
    };
  },
});

const createClickTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_click',
  description:
    'Click an element from the most recent computer_snapshot. ALWAYS prefer this over coordinates: it is ' +
    'delivered through the accessibility layer, so it is verifiable and does not move the user\u2019s mouse ' +
    'pointer. Requires the snapshotId the element index came from.',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Click a control in a desktop application'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      snapshotId: { type: 'string', description: 'snapshotId from the computer_snapshot that produced elementIndex.' },
      elementIndex: { type: 'number', description: 'Element index within that snapshot.' },
      button: { type: 'string', enum: ['left', 'right'], description: 'Mouse button. Default "left".' },
      clickCount: { type: 'number', description: '2 for a double-click. Default 1.' },
    },
    required: ['snapshotId', 'elementIndex'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const snapshotId = coerceString(args['snapshotId']);
    const elementIndex = coerceInt(args['elementIndex']);
    if (!snapshotId || elementIndex === undefined) {
      return { ok: false, error: '`snapshotId` and `elementIndex` are required. Call computer_snapshot first.' };
    }
    const result = await ctx.computerService.act(callContext(ctx), ref, {
      type: 'click',
      snapshotId,
      elementIndex,
      button: args['button'] === 'right' ? 'right' : 'left',
      clickCount: coerceInt(args['clickCount']) ?? 1,
    });
    return actionPayload(result);
  },
});

const createSetValueTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_set_value',
  description:
    'Set a text field\u2019s value directly. STRONGLY PREFERRED over computer_type_text: it is atomic, does not ' +
    'steal keyboard focus, and the result is verified by reading the value back. Never use it on a field ' +
    'reported as `secure: true` \u2014 ask the user to enter credentials themselves.',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Set the value of a field in a desktop application'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      snapshotId: { type: 'string', description: 'snapshotId from the computer_snapshot that produced elementIndex.' },
      elementIndex: { type: 'number', description: 'Element index within that snapshot.' },
      value: { type: 'string', description: 'The text to write.' },
    },
    required: ['snapshotId', 'elementIndex', 'value'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const snapshotId = coerceString(args['snapshotId']);
    const elementIndex = coerceInt(args['elementIndex']);
    const value = typeof args['value'] === 'string' ? args['value'] : undefined;
    if (!snapshotId || elementIndex === undefined || value === undefined) {
      return { ok: false, error: '`snapshotId`, `elementIndex`, and `value` are required.' };
    }
    const result = await ctx.computerService.act(callContext(ctx), ref, {
      type: 'setValue',
      snapshotId,
      elementIndex,
      value,
    });
    return actionPayload(result);
  },
});

const createPerformActionTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_perform_action',
  description:
    'Invoke an accessibility action that an element advertised in its `actions` array (for example "AXPress", ' +
    '"AXConfirm", "Expand"). Only actions listed on that element in that snapshot are permitted.',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Invoke an accessibility action on a control'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      snapshotId: { type: 'string', description: 'snapshotId from the computer_snapshot that produced elementIndex.' },
      elementIndex: { type: 'number', description: 'Element index within that snapshot.' },
      actionName: { type: 'string', description: 'Must be a member of that element\u2019s `actions` array.' },
    },
    required: ['snapshotId', 'elementIndex', 'actionName'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const snapshotId = coerceString(args['snapshotId']);
    const elementIndex = coerceInt(args['elementIndex']);
    const actionName = coerceString(args['actionName']);
    if (!snapshotId || elementIndex === undefined || !actionName) {
      return { ok: false, error: '`snapshotId`, `elementIndex`, and `actionName` are required.' };
    }
    const result = await ctx.computerService.act(callContext(ctx), ref, {
      type: 'performAction',
      snapshotId,
      elementIndex,
      actionName,
    });
    return actionPayload(result);
  },
});

/** Window-scoped target used by every synthetic-input tool. */
function windowTarget(args: Record<string, unknown>) {
  const windowId = coerceInt(args['windowId']);
  return {
    // The service overwrites `app` with the identity it resolved and consented
    // to, so this placeholder can never redirect the input.
    app: { appId: '', name: '', pid: 0 },
    window: windowId !== undefined ? ({ by: 'id', id: windowId } as const) : ({ by: 'focused' } as const),
  };
}

const SYNTHETIC_WARNING =
  'This takes over the user\u2019s real keyboard/mouse, cannot be verified, and requires the window to be ' +
  'focused. It is disabled by default and always asks the user. Use the snapshot-based tools instead ' +
  'wherever the control appears in a snapshot.';

const createTypeTextTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_type_text',
  description: `Type text into the focused window using synthetic keystrokes. ${SYNTHETIC_WARNING}`,
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Type into a desktop application using synthetic keystrokes'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      windowId: { type: 'number', description: 'Target window. Defaults to the focused window.' },
      text: { type: 'string', description: 'Text to type.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const text = typeof args['text'] === 'string' ? args['text'] : undefined;
    if (text === undefined) return { ok: false, error: '`text` is required.' };
    const result = await ctx.computerService.act(callContext(ctx), ref, {
      type: 'typeText',
      target: windowTarget(args),
      text,
    });
    return actionPayload(result);
  },
});

const createPressKeyTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_press_key',
  description:
    `Press a key, optionally with modifiers (a hotkey chord such as Meta+S). ${SYNTHETIC_WARNING}`,
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Send a keystroke to a desktop application'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      windowId: { type: 'number', description: 'Target window. Defaults to the focused window.' },
      key: { type: 'string', description: 'Key name, e.g. "Enter", "Escape", "a".' },
      modifiers: {
        type: 'array',
        items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] },
        description: 'Modifiers held during the press.',
      },
    },
    required: ['key'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const key = coerceString(args['key']);
    if (!key) return { ok: false, error: '`key` is required.' };
    const raw = Array.isArray(args['modifiers']) ? args['modifiers'] : [];
    const modifiers = raw.filter(
      (m): m is 'Alt' | 'Control' | 'Meta' | 'Shift' =>
        m === 'Alt' || m === 'Control' || m === 'Meta' || m === 'Shift',
    );
    const result = await ctx.computerService.act(callContext(ctx), ref, {
      type: 'pressKey',
      target: windowTarget(args),
      key,
      modifiers: modifiers.length > 0 ? modifiers : undefined,
    });
    return actionPayload(result);
  },
});

const createPasteTextTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_paste_text',
  description:
    'Paste text via the system clipboard. Faster than typing for long text, but it REPLACES the user\u2019s ' +
    `clipboard contents. ${SYNTHETIC_WARNING}`,
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Paste text into a desktop application via the clipboard'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      windowId: { type: 'number', description: 'Target window. Defaults to the focused window.' },
      text: { type: 'string', description: 'Text to place on the clipboard and paste.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const text = typeof args['text'] === 'string' ? args['text'] : undefined;
    if (text === undefined) return { ok: false, error: '`text` is required.' };
    const result = await ctx.computerService.act(callContext(ctx), ref, {
      type: 'pasteText',
      target: windowTarget(args),
      text,
    });
    return actionPayload(result);
  },
});

const createScrollTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_scroll',
  description: `Scroll within a window. ${SYNTHETIC_WARNING}`,
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Scroll a desktop application'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      windowId: { type: 'number', description: 'Target window. Defaults to the focused window.' },
      deltaX: { type: 'number', description: 'Horizontal scroll amount in pixels.' },
      deltaY: { type: 'number', description: 'Vertical scroll amount in pixels. Negative scrolls up.' },
      x: { type: 'number', description: 'Optional pointer x for the scroll origin.' },
      y: { type: 'number', description: 'Optional pointer y for the scroll origin.' },
    },
    required: ['deltaY'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const result = await ctx.computerService.act(callContext(ctx), ref, {
      type: 'scroll',
      target: windowTarget(args),
      deltaX: coerceInt(args['deltaX']) ?? 0,
      deltaY: coerceInt(args['deltaY']) ?? 0,
      x: coerceInt(args['x']),
      y: coerceInt(args['y']),
    });
    return actionPayload(result);
  },
});

const createDragTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_drag',
  description: `Drag from one point to another within a window. ${SYNTHETIC_WARNING}`,
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Drag within a desktop application'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      windowId: { type: 'number', description: 'Target window. Defaults to the focused window.' },
      fromX: { type: 'number' },
      fromY: { type: 'number' },
      toX: { type: 'number' },
      toY: { type: 'number' },
    },
    required: ['fromX', 'fromY', 'toX', 'toY'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const from = { x: coerceInt(args['fromX']), y: coerceInt(args['fromY']) };
    const to = { x: coerceInt(args['toX']), y: coerceInt(args['toY']) };
    if (from.x === undefined || from.y === undefined || to.x === undefined || to.y === undefined) {
      return { ok: false, error: '`fromX`, `fromY`, `toX`, and `toY` are all required.' };
    }
    const result = await ctx.computerService.act(callContext(ctx), ref, {
      type: 'drag',
      target: windowTarget(args),
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
    });
    return actionPayload(result);
  },
});

const createClickPointTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_click_point',
  description:
    'Click at raw screen coordinates. LAST RESORT \u2014 only when the control does not appear in a ' +
    `computer_snapshot at all. ${SYNTHETIC_WARNING}`,
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Click at screen coordinates'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      windowId: { type: 'number', description: 'Target window. Defaults to the focused window.' },
      x: { type: 'number' },
      y: { type: 'number' },
      button: { type: 'string', enum: ['left', 'right'] },
    },
    required: ['x', 'y'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const x = coerceInt(args['x']);
    const y = coerceInt(args['y']);
    if (x === undefined || y === undefined) return { ok: false, error: '`x` and `y` are required.' };
    const result = await ctx.computerService.act(callContext(ctx), ref, {
      type: 'clickPoint',
      target: windowTarget(args),
      x,
      y,
      button: args['button'] === 'right' ? 'right' : 'left',
    });
    return actionPayload(result);
  },
});

const createVerifyTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_verify',
  description:
    'Check whether a window really is in the state you expect, and get a definitive answer. Use this INSTEAD of ' +
    're-reading a value you just wrote: a write returns "unverified" on most applications, and reading it back ' +
    'goes through the same layer that may have discarded it. Returns "satisfied", "unsatisfied", or "unknown" — ' +
    'and unknown NEVER means success. If it comes back unknown twice, stop and tell the user you could not ' +
    'confirm it. Make the label specific: "A1" also matches "A10", which returns unknown (multi_match).',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Check the state of a desktop window'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      windowId: { type: 'number', description: 'Window id. Defaults to the focused window.' },
      timeoutMs: {
        type: 'number',
        description:
          'How long to wait for the condition, in ms (0–10000, default 5000). A verify costs roughly this ' +
          'long on a slow application, so lower it for a check you expect to pass immediately.',
      },
      stableSamples: {
        type: 'number',
        description:
          'Consecutive matching reads required before reporting satisfied (1–5, default 2). Use 1 for a ' +
          'settled window; leave the default when something may still be animating.',
      },
      expect: {
        type: 'array',
        description: 'One to eight conditions, all of which must hold.',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', description: 'Accessibility role of the element, e.g. "Edit", "DataItem".' },
            labelContains: { type: 'string', description: 'Substring of the element label. Be specific.' },
            valueEquals: { type: 'string', description: 'The exact value the element should hold.' },
            exists: { type: 'boolean', description: 'Assert the element is present. Only `true` is meaningful.' },
            enabled: { type: 'boolean' },
            selected: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    required: ['expect'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const raw = Array.isArray(args['expect']) ? args['expect'] : [];
    if (raw.length === 0) return { ok: false, error: '`expect` needs at least one condition.' };

    const expect = raw.slice(0, 8).map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      return {
        selector: {
          ...(typeof e['role'] === 'string' ? { role: e['role'] } : {}),
          ...(typeof e['labelContains'] === 'string' ? { labelContains: e['labelContains'] } : {}),
        },
        ...(typeof e['valueEquals'] === 'string' ? { valueEquals: e['valueEquals'] } : {}),
        ...(e['exists'] === true ? { exists: true as const } : {}),
        ...(typeof e['enabled'] === 'boolean' ? { enabled: e['enabled'] } : {}),
        ...(typeof e['selected'] === 'boolean' ? { selected: e['selected'] } : {}),
      };
    });

    const result = await ctx.computerService.verify(callContext(ctx), ref, expect, {
      windowId: coerceInt(args['windowId']),
      ...(coerceInt(args['timeoutMs']) !== undefined ? { timeoutMs: coerceInt(args['timeoutMs']) as number } : {}),
      ...(coerceInt(args['stableSamples']) !== undefined
        ? { stableSamples: coerceInt(args['stableSamples']) as number }
        : {}),
    });
    if (result.refusal) {
      return { ok: false, refusal: result.refusal.code, message: result.refusal.message };
    }
    const ambiguous = result.results.find((r) => r.detail === 'multi_match');
    return {
      ok: true,
      outcome: result.outcome,
      conditions: result.results,
      ...(result.outcome === 'unknown'
        ? {
            note: ambiguous
              ? `UNKNOWN is not success. The label matched ${ambiguous.matches ?? 'several'} elements, so the ` +
                'value could not be attributed to one of them. Labels are matched by substring and there is no ' +
                'exact-match option, so a spreadsheet address like "A1" can never be separated from "A10".."A19" — ' +
                'if that is your case, no narrowing will help. Tell the user you could not confirm it.'
              : 'UNKNOWN is not success. The window could not be observed well enough to decide — the provider ' +
                'did not answer, or the predicate is unsupported for that element. Tell the user it could not be ' +
                'confirmed. Do not assume it worked.',
          }
        : {}),
    };
  },
});

const createLaunchAppTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_launch_app',
  description:
    'Start a desktop application that is not currently running, and wait until it has a window. Use this when ' +
    'computer_list_apps does not show the app you need. Give the display name, e.g. "Excel", "Notepad", ' +
    '"Calculator". Pass `url` to open a web page in the default browser instead of navigating one by hand. ' +
    'Returns the appId to use with the other computer_* tools.',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Launch a desktop application'),
  parametersSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Application name, e.g. "Excel".' },
      url: {
        type: 'string',
        description:
          'Optional URL to open in the default browser. The page opens without stealing the foreground.',
      },
      newInstance: {
        type: 'boolean',
        description:
          'Start a separate copy of the app instead of reusing a running one. Use when the app may already ' +
          'be open with the user’s own work in it, so you get your own window rather than typing into theirs.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const name = coerceString(args['name']);
    if (!name) return { ok: false, error: '`name` is required.' };
    const url = coerceString(args['url']);
    const { app, refusal } = await ctx.computerService.launchApp(
      callContext(ctx),
      name,
      url,
      args['newInstance'] === true,
    );
    if (refusal || !app) {
      return { ok: false, refusal: refusal?.code, message: refusal?.message };
    }
    return {
      ok: true,
      appId: app.appId,
      name: app.name,
      pid: app.pid,
      note: 'The window is ready to drive. Take a computer_snapshot next — clicking and setting values work without focusing it, so there is usually no need to bring it to the front.',
    };
  },
});

const createBringToFrontTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_bring_to_front',
  description:
    'Restore and focus an application’s window. This DELIBERATELY takes the foreground away from whatever the ' +
    'user is doing, so it is not part of the normal flow: clicking and setting values work on a background ' +
    'window, and tools that need focus acquire and release it themselves for that one action. Use this only ' +
    'when a tool refuses because the window is minimised, or for a surface that must stay foreground across ' +
    'several calls, such as a remote-desktop session.',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Focus a desktop application window'),
  parametersSchema: {
    type: 'object',
    properties: { ...APP_TARGET_PROPERTIES },
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    return actionPayload(await ctx.computerService.bringToFront(callContext(ctx), ref));
  },
});

const FACTORIES: readonly ComputerToolFactory[] = [
  createCapabilitiesTool,
  createListAppsTool,
  createLaunchAppTool,
  createBringToFrontTool,
  createListWindowsTool,
  createSnapshotTool,
  createVerifyTool,
  createClickTool,
  createSetValueTool,
  createPerformActionTool,
  createTypeTextTool,
  createPressKeyTool,
  createPasteTextTool,
  createScrollTool,
  createDragTool,
  createClickPointTool,
];

export function buildComputerToolSet(ctx: ComputerToolContext): ToolDefinition[] {
  // Guarding centrally rather than per-tool so a new factory cannot forget it.
  return FACTORIES.map((factory) => {
    const tool = factory(ctx);
    return { ...tool, handler: guard(tool.name, tool.handler) };
  });
}

export const COMPUTER_TOOL_NAMES = [
  'computer_capabilities',
  'computer_list_apps',
  'computer_launch_app',
  'computer_bring_to_front',
  'computer_list_windows',
  'computer_snapshot',
  'computer_verify',
  'computer_click',
  'computer_set_value',
  'computer_perform_action',
  'computer_type_text',
  'computer_press_key',
  'computer_paste_text',
  'computer_scroll',
  'computer_drag',
  'computer_click_point',
] as const;

export type ComputerToolName = (typeof COMPUTER_TOOL_NAMES)[number];

export function isComputerToolName(name: unknown): name is ComputerToolName {
  return typeof name === 'string' && (COMPUTER_TOOL_NAMES as readonly string[]).includes(name);
}

export type { ComputerToolContext, ComputerToolFactory } from './computerToolTypes.js';
export { refusalPayload, snapshotPayload, actionPayload, projectElements } from './computerToolTypes.js';

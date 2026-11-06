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

import * as path from 'node:path';
import type { ToolDefinition } from '../../domain/ports/IAgentHarness.js';
import { TOOL_BINARY_KEY } from '../../domain/ports/IAgentHarness.js';
import type { ActionRequest } from '../../domain/ports/IComputerBridge.js';
import type { ComputerToolContext, ComputerToolFactory } from './computerToolTypes.js';
import {
  APP_TARGET_PROPERTIES,
  actionPayload,
  changesPayload,
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

const createSnapshotTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_snapshot',
  description:
    'Read a window\u2019s accessibility tree: one row per element, `[N]` being the elementIndex every other tool ' +
    'takes, with read-only text (a display, a status line) inline and the menu bar folded (menus run by path ' +
    'with computer_perform_action). Cheaper and more reliable than a screenshot. The snapshotId stays usable ' +
    'after you act — every action returns what changed — until an action reports `reindexed`; then snapshot ' +
    'again. Pass `query` when you know what you want ("Save", "A1"): it filters at the source. A window too ' +
    'large to return whole is `clipped`; narrow it with `query`.',
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
    // X-14 — the instruction has to reach the model with the image, not as
    // caption metadata the provider may place after it. Putting it in the text
    // payload is the only part of the ordering we control: the Claude factory
    // emits a text content block before the image blocks, while the Copilot SDK
    // takes text and binaries as separate fields and orders them itself.
    //
    // It asks for coordinates in the IMAGE's space on purpose. The image may be
    // downscaled from the window, and `ComputerService.scalePointsToDriverSpace`
    // scales them back using the factor recorded for that capture. Asking the
    // model to do the conversion instead would mean trusting it to multiply.
    const guidance =
      'An image of this window follows. Report any pixel coordinate in the space of ' +
      'THIS image — measure it off the image as shown, do not rescale it yourself; ' +
      'the capture may be downscaled and the conversion is handled for you. Prefer ' +
      'the element indices in the accessibility tree above; use the image only to ' +
      'answer what the tree cannot.';
    return {
      ...payload,
      imageGuidance: guidance,
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
    'steal keyboard focus, and the result is verified by reading the value back. On a popup button (a file ' +
    'format, a font, a list style) it chooses the item with that title in one call. Never use it on a field ' +
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
    'Choose a command from the app\u2019s menu bar, or press an element. A menu command is a path of menu titles ' +
    'joined by ">", exactly as the menus read — "File>New", "Format>Font>Bold", "File>Export To>CSV…" — and needs ' +
    'only the app (plus windowId when it has several windows), no snapshot. It runs through accessibility: no ' +
    'pointer, no focus change, no keystroke. Prefer it to keyboard shortcuts for app commands. Otherwise pass ' +
    'snapshotId + elementIndex with an action the element advertised in its `actions` array, e.g. "AXPress".',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Use a menu command or a control in a desktop application'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      windowId: { type: 'number', description: 'For a menu command: the window it applies to. Defaults to the focused window.' },
      snapshotId: { type: 'string', description: 'For an element action: snapshotId from the computer_snapshot that produced elementIndex.' },
      elementIndex: { type: 'number', description: 'For an element action: element index within that snapshot.' },
      actionName: {
        type: 'string',
        description: 'A menu path such as "File>Save As…", or an action from that element\u2019s `actions` array.',
      },
    },
    required: ['actionName'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const actionName = coerceString(args['actionName']);
    if (!actionName) return { ok: false, error: '`actionName` is required.' };
    if (actionName.includes('>')) {
      const path = actionName.split('>').map((part) => part.trim()).filter((part) => part.length > 0);
      if (path.length < 2) return { ok: false, error: 'A menu path names a menu and an item, e.g. "File>New".' };
      const result = await ctx.computerService.act(callContext(ctx), ref, {
        type: 'invokeMenu',
        target: windowTarget(args),
        path,
      });
      return actionPayload(result);
    }
    const snapshotId = coerceString(args['snapshotId']);
    const elementIndex = coerceInt(args['elementIndex']);
    if (!snapshotId || elementIndex === undefined) {
      return {
        ok: false,
        error: 'An element action needs `snapshotId` and `elementIndex`; a menu command is a path such as "File>New".',
      };
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
  'This is real keyboard/mouse input aimed at the window: it cannot be verified by itself, so check the ' +
  'outcome once when the sequence is done. Use a menu path (computer_perform_action) or the snapshot-based ' +
  'tools instead wherever the command or control is reachable that way.';

/**
 * The driver's Chromium/Electron escape hatch: it pixel-clicks this point to
 * establish real renderer focus before delivering input. Posted keystrokes
 * never reach those surfaces, so without it VS Code's terminal, Electron apps
 * and web views silently swallow everything.
 */
const FOCUS_POINT_PROPERTIES = {
  focusX: {
    type: 'number',
    description:
      'Window-local screenshot-pixel X to click first, establishing focus. Needed for Chromium/Electron surfaces (VS Code terminal, Slack, Discord) where posted input is dropped. Read it off the snapshot screenshot, same convention as computer_click_point. Pass with focusY.',
  },
  focusY: { type: 'number', description: 'Window-local screenshot-pixel Y (see focusX).' },
} as const;

/** Reads the optional Chromium/Electron focus point off tool arguments. */
function focusPoint(args: Record<string, unknown>): { x: number; y: number } | undefined {
  const x = args['focusX'];
  const y = args['focusY'];
  return typeof x === 'number' && typeof y === 'number' ? { x, y } : undefined;
}

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
      snapshotId: {
        type: 'string',
        description:
          'Snapshot the element came from. Pass with elementIndex for XAML/WinUI hosts (Windows 11 File Explorer, Settings, Calculator, modern Notepad), which drop plain typed characters and must be written through the element.',
      },
      elementIndex: {
        type: 'number',
        description: 'Index of the text field to write into. Requires snapshotId.',
      },
      ...FOCUS_POINT_PROPERTIES,
    },
    required: ['text'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const text = typeof args['text'] === 'string' ? args['text'] : undefined;
    if (text === undefined) return { ok: false, error: '`text` is required.' };
    const focus = focusPoint(args);
    const snapshotId = coerceString(args['snapshotId']);
    const elementIndex = args['elementIndex'];
    const element =
      snapshotId && typeof elementIndex === 'number' ? { snapshotId, elementIndex } : undefined;
    const result = await ctx.computerService.act(callContext(ctx), ref, {
      type: 'typeText',
      target: windowTarget(args),
      text,
      ...(focus ? { focus } : {}),
      ...(element ? { element } : {}),
    });
    return actionPayload(result);
  },
});

/** Spellings a model reaches for, mapped to our closed modifier union. */
const MODIFIER_ALIASES: ReadonlyMap<string, 'Alt' | 'Control' | 'Meta' | 'Shift'> = new Map([
  ['alt', 'Alt'], ['opt', 'Alt'], ['option', 'Alt'],
  ['ctrl', 'Control'], ['control', 'Control'],
  ['cmd', 'Meta'], ['command', 'Meta'], ['meta', 'Meta'], ['super', 'Meta'], ['win', 'Meta'], ['windows', 'Meta'],
  ['shift', 'Shift'],
]);

/**
 * Splits a chord written into `key` — `"ctrl+\`"`, `"Meta+S"` — into modifiers
 * and the key itself.
 *
 * Models write shortcuts the way humans do, and the schema cannot stop them.
 * Forwarding the whole string as a key NAME is what broke: the driver could not
 * resolve `ctrl+\``, fell back to synthetic input, and typed a bare `c` into the
 * focused editor of the user's repository.
 *
 * Only leading segments that are known modifiers are consumed, so a literal
 * `"+"` and unrecognised names survive untouched.
 */
export function parseKeyChord(raw: string): {
  key: string;
  modifiers: ReadonlyArray<'Alt' | 'Control' | 'Meta' | 'Shift'>;
} {
  const trimmed = raw.trim();
  const unparsed = { key: trimmed, modifiers: [] as const };
  if (!trimmed.includes('+') || trimmed === '+') return unparsed;

  let key: string;
  let modifierPart: string;
  if (trimmed.endsWith('+')) {
    // The key IS '+', so what precedes it must still end with a separator.
    const body = trimmed.slice(0, -1);
    if (!body.endsWith('+')) return unparsed;
    key = '+';
    modifierPart = body.slice(0, -1);
  } else {
    const split = trimmed.lastIndexOf('+');
    key = trimmed.slice(split + 1).trim();
    modifierPart = trimmed.slice(0, split);
  }

  const modifiers: Array<'Alt' | 'Control' | 'Meta' | 'Shift'> = [];
  for (const segment of modifierPart.split('+')) {
    const found = MODIFIER_ALIASES.get(segment.trim().toLowerCase());
    // One unrecognised segment means this was never a chord.
    if (!found) return unparsed;
    if (!modifiers.includes(found)) modifiers.push(found);
  }
  return key.length > 0 ? { key, modifiers } : unparsed;
}

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
      key: {
        type: 'string',
        description:
          'Key name, e.g. "Enter", "Escape", "a". A chord such as "Control+`" is also accepted and split.',
      },
      modifiers: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Modifiers held during the press: Meta (⌘ Command on macOS, the Windows key elsewhere), Control, Alt ' +
          '(⌥ Option), Shift. "cmd", "ctrl", "option" and the like are accepted too.',
      },
      ...FOCUS_POINT_PROPERTIES,
    },
    required: ['key'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const rawKey = coerceString(args['key']);
    if (!rawKey) return { ok: false, error: '`key` is required.' };
    const chord = parseKeyChord(rawKey);
    const raw = Array.isArray(args['modifiers']) ? args['modifiers'] : [];
    const declared = raw.flatMap((m) => {
      const found = typeof m === 'string' ? MODIFIER_ALIASES.get(m.trim().toLowerCase()) : undefined;
      return found ? [found] : [];
    });
    const modifiers = [...new Set([...declared, ...chord.modifiers])];
    const focus = focusPoint(args);
    const result = await ctx.computerService.act(callContext(ctx), ref, {
      type: 'pressKey',
      target: windowTarget(args),
      key: chord.key,
      modifiers: modifiers.length > 0 ? modifiers : undefined,
      ...(focus ? { focus } : {}),
    });
    return actionPayload(result);
  },
});

const createLaunchAppTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_launch_app',
  description:
    'Start a desktop application that is not currently running, and wait until it has a window. Use this when ' +
    'computer_list_apps does not show the app you need. Give the display name, e.g. "Excel", "Notepad", ' +
    '"Calculator". Pass `url` to open a web page in the default browser instead of navigating one by hand. ' +
    'To open a SPECIFIC file or folder, pass its absolute path in `arguments` — e.g. name "TextEdit" with ' +
    'arguments ["/Users/me/notes.txt"], or name "Code" with arguments ["C:\\\\src\\\\myrepo"], opens it in ' +
    'one call. A macOS document app started bare is given a new untitled document. Launching the app bare and then ' +
    'clicking through its Recent list or a file manager costs many more calls and usually lands on the ' +
    'wrong window. Returns the appId to use with the other computer_* tools.',
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
      newDocument: {
        type: 'boolean',
        description:
          'Also create a new blank document and return ITS window — the app\u2019s own New command (File menu or ' +
          '\u2318N / Ctrl+N), accepting a template chooser or start screen with its default. Use it whenever the ' +
          'task makes a new document: never type into a window the app already had open.',
      },
      newInstance: {
        type: 'boolean',
        description:
          'Start a separate copy of the app instead of reusing a running one. Use when the app may already ' +
          'be open with the user’s own work in it, so you get your own window rather than typing into theirs.',
      },
      arguments: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Command-line arguments for the app. The direct way to open a document or folder: ' +
          'name "explorer.exe" with arguments ["C:\\\\Users\\\\me\\\\project"] opens that folder in one call, ' +
          'instead of navigating a file manager by hand. Prefer this over driving an address bar.',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const name = coerceString(args['name']);
    if (!name) return { ok: false, error: '`name` is required.' };
    const url = coerceString(args['url']);
    const launchArgs = Array.isArray(args['arguments'])
      ? args['arguments'].filter((a): a is string => typeof a === 'string')
      : undefined;
    const { app, window, refusal, steps } = await ctx.computerService.launchApp(
      callContext(ctx),
      name,
      url,
      args['newInstance'] === true,
      launchArgs,
      args['newDocument'] === true,
    );
    if (refusal || !app) {
      return { ok: false, refusal: refusal?.code, message: refusal?.message, ...(steps?.length ? { steps: steps.join(' → ') } : {}) };
    }
    return {
      ok: true,
      appId: app.appId,
      name: app.name,
      pid: app.pid,
      ...(window ? { windowId: window.id, windowTitle: window.title } : {}),
      ...(args['newDocument'] === true && window ? { newDocument: `Created "${window.title}" (${steps?.join(' → ') ?? ''}). Work only in this window.` } : {}),
      note: window
        ? `The launch opened window ${window.id} ("${window.title}"). Pass that windowId to every ` +
          'later call: this app can host several windows in one process, and without the id you will ' +
          'read or click whichever one the user happens to have in front. Take a computer_snapshot ' +
          'next — clicking and setting values work without focusing it.'
        : `${app.name} is running but has no window, even after it was activated and asked for a new ` +
          'document. Open the document you need by launching it again with the file path in `arguments`, ' +
          'or tell the user the app shows no window — a snapshot, menu or key has nothing to aim at.',
    };
  },
});

/** One step of `computer_run_steps`, as the model writes it. */
function planStep(
  raw: unknown,
  target: ReturnType<typeof windowTarget>,
  snapshotId: string | undefined,
): { step: ActionRequest } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Each step must be an object.' };
  const step = raw as Record<string, unknown>;
  const elementIndex = coerceInt(step['elementIndex']);
  const name = coerceString(step['name']);
  const byName = elementIndex === undefined && name !== undefined
    ? { name, ...(coerceString(step['role']) ? { role: coerceString(step['role'])! } : {}), ...(coerceInt(step['nth']) !== undefined ? { nth: coerceInt(step['nth'])! } : {}) }
    : undefined;
  const element = () =>
    snapshotId === undefined || elementIndex === undefined
      ? { error: `${String(step['kind'])} needs \`elementIndex\` (with the call's \`snapshotId\`) or the element's \`name\`.` }
      : null;
  switch (step['kind']) {
    case 'click': {
      if (byName) return { step: { type: 'clickNamed', target, ...byName } };
      const missing = element();
      if (missing) return missing;
      return {
        step: {
          type: 'click',
          snapshotId: snapshotId!,
          elementIndex: elementIndex!,
          ...(step['button'] === 'right' ? { button: 'right' as const } : {}),
          ...(coerceInt(step['clickCount']) === 2 ? { clickCount: 2 } : {}),
        },
      };
    }
    case 'set_value': {
      const value = typeof step['value'] === 'string' ? step['value'] : undefined;
      if (value === undefined) return { error: 'set_value needs `value`.' };
      if (byName) return { step: { type: 'setValueNamed', target, ...byName, value } };
      const missing = element();
      if (missing) return missing;
      return { step: { type: 'setValue', snapshotId: snapshotId!, elementIndex: elementIndex!, value } };
    }
    case 'menu': {
      const path = typeof step['path'] === 'string' ? step['path'].split('>').map((p) => p.trim()).filter(Boolean) : [];
      if (path.length < 2) return { error: 'menu needs `path` such as "File>Save…".' };
      return { step: { type: 'invokeMenu', target, path } };
    }
    case 'click_point': {
      const x = coerceInt(step['x']);
      const y = coerceInt(step['y']);
      if (x === undefined || y === undefined) return { error: 'click_point needs `x` and `y`.' };
      return { step: { type: 'clickPoint', target, x, y, button: step['button'] === 'right' ? 'right' : 'left' } };
    }
    case 'type_text':
    case 'paste_text': {
      const text = typeof step['text'] === 'string' ? step['text'] : undefined;
      if (text === undefined) return { error: `${String(step['kind'])} needs \`text\`.` };
      if (step['kind'] === 'paste_text') return { step: { type: 'pasteText', target, text } };
      return {
        step: {
          type: 'typeText',
          target,
          text,
          ...(snapshotId !== undefined && elementIndex !== undefined ? { element: { snapshotId, elementIndex } } : {}),
        },
      };
    }
    case 'press_key': {
      const rawKey = coerceString(step['key']);
      if (!rawKey) return { error: 'press_key needs `key`.' };
      const chord = parseKeyChord(rawKey);
      return {
        step: {
          type: 'pressKey',
          target,
          key: chord.key,
          modifiers: chord.modifiers.length > 0 ? chord.modifiers : undefined,
        },
      };
    }
    case 'drag': {
      const fromX = coerceInt(step['x']);
      const fromY = coerceInt(step['y']);
      const toX = coerceInt(step['toX']);
      const toY = coerceInt(step['toY']);
      if (fromX === undefined || fromY === undefined || toX === undefined || toY === undefined) {
        return { error: 'drag needs `x`, `y` (from) and `toX`, `toY`.' };
      }
      return { step: { type: 'drag', target, from: { x: fromX, y: fromY }, to: { x: toX, y: toY } } };
    }
    case 'scroll':
      return {
        step: {
          type: 'scroll',
          target,
          deltaX: coerceInt(step['deltaX']) ?? 0,
          deltaY: coerceInt(step['deltaY']) ?? 0,
          x: coerceInt(step['x']),
          y: coerceInt(step['y']),
        },
      };
    default:
      return { error: `Unknown step kind ${JSON.stringify(step['kind'])}.` };
  }
}

const createRunStepsTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_run_steps',
  description:
    'THE way to act: up to 64 steps against one window in ONE call, then what changed in the window. Steps: ' +
    'click / set_value — an element by `elementIndex` (with `snapshotId`) or by its label `name` (+ optional `role`, ' +
    '`nth`; no snapshot needed: {kind:"click", name:"Equals"}); menu (`path` "File>New"); type_text (into ' +
    '`elementIndex`, else the focused field; "\\n" = new line); press_key ("Return", "Tab", "Meta+S"); ' +
    'paste_text; click_point / drag (`x`,`y` → `toX`,`toY`, pixels of a snapshot screenshot); scroll. Put every step ' +
    'you already know in one call. Stops at the first step that fails and says which.',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Run several steps in a desktop application'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      windowId: { type: 'number', description: 'Target window.' },
      snapshotId: { type: 'string', description: 'The snapshot the steps\u2019 elementIndex values come from.' },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 64,
        items: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['click', 'set_value', 'menu', 'type_text', 'press_key', 'paste_text', 'click_point', 'drag', 'scroll'],
            },
            elementIndex: { type: 'number' },
            name: { type: 'string', description: 'Element label, instead of elementIndex.' },
            role: { type: 'string', description: 'With name: button, textfield, cell, menuitem, checkbox…' },
            nth: { type: 'number', description: 'With name: which match, 0-based.' },
            value: { type: 'string' },
            path: { type: 'string' },
            text: { type: 'string' },
            key: { type: 'string' },
            x: { type: 'number' },
            y: { type: 'number' },
            toX: { type: 'number' },
            toY: { type: 'number' },
            button: { type: 'string', enum: ['left', 'right'] },
            clickCount: { type: 'number' },
            deltaX: { type: 'number' },
            deltaY: { type: 'number' },
          },
          required: ['kind'],
          additionalProperties: false,
        },
      },
    },
    required: ['steps'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const rawSteps = Array.isArray(args['steps']) ? args['steps'] : [];
    if (rawSteps.length === 0) return { ok: false, error: '`steps` needs at least one step.' };
    const target = windowTarget(args);
    const snapshotId = coerceString(args['snapshotId']);
    const steps: ActionRequest[] = [];
    for (const [index, raw] of rawSteps.entries()) {
      const parsed = planStep(raw, target, snapshotId);
      if ('error' in parsed) return { ok: false, error: `Step ${index + 1}: ${parsed.error}` };
      steps.push(parsed.step);
    }
    const result = await ctx.computerService.actPlan(callContext(ctx), ref, steps);
    const done = result.results.filter((r) => r.ok).length;
    const last = result.results.at(-1);
    return {
      ok: result.ok,
      done: `${done}/${steps.length}`,
      ...(last?.ok ? changesPayload(last) : {}),
      ...(result.refusal
        ? { refusal: result.refusal.code, message: result.refusal.message, stoppedAtStep: (result.stoppedAt ?? 0) + 1 }
        : {}),
    };
  },
});

const createSaveAsTool: ComputerToolFactory = (ctx): ToolDefinition => ({
  name: 'computer_save_as',
  description:
    'Save or export the document in a window to an exact folder and file name in ONE call, through the app\u2019s own ' +
    'save dialog, and confirm the file exists on disk. Use it for every Save, Save As and Export: it opens the ' +
    'dialog with `menu` (default "File>Save…"; e.g. "File>Export To>CSV…", "File>Export To>PDF…"), goes to the ' +
    'folder, sets the name and the File Format, presses Save/Export, and checks the file. Do not drive save ' +
    'dialogs by hand.',
  owner: ctx.owner ?? 'computer-tools',
  requiredPermissions: permission('Save a document from a desktop application'),
  parametersSchema: {
    type: 'object',
    properties: {
      ...APP_TARGET_PROPERTIES,
      windowId: { type: 'number', description: 'The document\u2019s window.' },
      folder: { type: 'string', description: 'Absolute folder path the file must land in.' },
      name: { type: 'string', description: 'File name with extension, e.g. "notes.csv". Never a path.' },
      menu: { type: 'string', description: 'Menu path that opens the dialog, e.g. "File>Export To>CSV…". Default "File>Save…".' },
      format: { type: 'string', description: 'File Format popup item, when the dialog has one, e.g. "Plain Text".' },
      replace: { type: 'boolean', description: 'Overwrite a file that already exists there. Default false.' },
    },
    required: ['windowId', 'folder', 'name'],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ref = toAppRef(args);
    if ('error' in ref) return { ok: false, error: ref.error };
    const windowId = coerceInt(args['windowId']);
    const folder = coerceString(args['folder']);
    const name = coerceString(args['name']);
    if (windowId === undefined || !folder || !name) return { ok: false, error: '`windowId`, `folder` and `name` are required.' };
    if (!path.isAbsolute(folder)) return { ok: false, error: '`folder` must be an absolute path.' };
    if (name.includes('/') || name.includes('\\')) return { ok: false, error: '`name` is a file name, not a path; put the folder in `folder`.' };
    const menu = coerceString(args['menu'])?.split('>').map((part) => part.trim()).filter(Boolean);
    const result = await ctx.computerService.saveAs(callContext(ctx), ref, windowId, {
      folder,
      name,
      ...(menu && menu.length > 1 ? { menu } : {}),
      ...(coerceString(args['format']) ? { format: coerceString(args['format'])! } : {}),
      ...(args['replace'] === true ? { replace: true } : {}),
    });
    return result.ok
      ? { ok: true, saved: result.path, steps: result.steps.join(' → '), reindexed: 'The window changed: snapshot it again before addressing elements.' }
      : { ok: false, refusal: result.refusal?.code, message: result.refusal?.message };
  },
});

const FACTORIES: readonly ComputerToolFactory[] = [
  createLaunchAppTool,
  createSnapshotTool,
  createClickTool,
  createSetValueTool,
  createPerformActionTool,
  createTypeTextTool,
  createPressKeyTool,
  createRunStepsTool,
  createSaveAsTool,
];

export function buildComputerToolSet(ctx: ComputerToolContext): ToolDefinition[] {
  // Guarding centrally rather than per-tool so a new factory cannot forget it.
  return FACTORIES.map((factory) => {
    const tool = factory(ctx);
    return { ...tool, alwaysLoad: true, handler: guard(tool.name, tool.handler) };
  });
}

export const COMPUTER_TOOL_NAMES = [
  'computer_launch_app',
  'computer_snapshot',
  'computer_click',
  'computer_set_value',
  'computer_perform_action',
  'computer_type_text',
  'computer_press_key',
  'computer_run_steps',
  'computer_save_as',
] as const;

export type ComputerToolName = (typeof COMPUTER_TOOL_NAMES)[number];

export function isComputerToolName(name: unknown): name is ComputerToolName {
  return typeof name === 'string' && (COMPUTER_TOOL_NAMES as readonly string[]).includes(name);
}

export type { ComputerToolContext, ComputerToolFactory } from './computerToolTypes.js';
export { refusalPayload, snapshotPayload, actionPayload, projectElements } from './computerToolTypes.js';

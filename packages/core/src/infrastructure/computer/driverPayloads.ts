// ────────────────────────────────────────────────────────────────
// driverPayloads — parsers for cua-driver's `list_apps`, `list_windows`, and
// `get_window_state` responses.
//
// VERIFIED against cua-driver 0.19.3 / contract 0.6.0 on win32-x64
// (see scripts/probe-cua-state.mjs). Field names are snake_case and stable
// within a contract version; `contractVersion` from `metadata()` is the thing
// to re-check when bumping the dependency.
//
// The driver owns element indexing natively — `get_window_state` returns
// `snapshot_id` plus per-element `element_index` / `element_token`, and the
// action tools accept them directly. This module therefore only translates
// shapes; it never invents an addressing scheme.
// ────────────────────────────────────────────────────────────────

import type { ComputerAppInfo, ComputerElement, ComputerWindowInfo } from '@generatorai/shared';
import type { ComputerRefusal } from '../../domain/ports/IComputerBridge.js';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const asNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // UniFFI surfaces u64 window ids as bigint through some transports.
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return undefined;
};

const asBool = (v: unknown): boolean => v === true;

/** Thrown when a payload has no recognisable structure at all. */
export class UnrecognisedDriverPayloadError extends Error {
  constructor(tool: string, keys: string[]) {
    super(
      `cua-driver returned a ${tool} payload this build does not recognise (keys: ${keys.join(', ') || 'none'}). ` +
        'Re-pin driverPayloads.ts against this driver version.',
    );
    this.name = 'UnrecognisedDriverPayloadError';
  }
}

function parseJson(tool: string, raw: string): Json {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UnrecognisedDriverPayloadError(tool, []);
  }
  if (!isObject(parsed)) throw new UnrecognisedDriverPayloadError(tool, []);
  return parsed;
}

function parseFrame(source: Json): { x: number; y: number; w: number; h: number } | undefined {
  const frame = isObject(source['frame'])
    ? (source['frame'] as Json)
    : isObject(source['bounds'])
      ? (source['bounds'] as Json)
      : null;
  if (!frame) return undefined;
  const x = asNumber(frame['x']);
  const y = asNumber(frame['y']);
  // `get_window_state` uses w/h; `list_windows` uses width/height.
  const w = asNumber(frame['w']) ?? asNumber(frame['width']);
  const h = asNumber(frame['h']) ?? asNumber(frame['height']);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return { x, y, w, h };
}

/**
 * `list_apps` → running applications only.
 *
 * The driver also reports installed-but-not-running apps (`running: false`,
 * `pid: 0`). Those are filtered out: a pid of 0 cannot be targeted, and
 * surfacing them would invite the agent to try.
 */
/**
 * `verify_state` → a definitive answer, or an honest `unknown`.
 *
 * Observed payload:
 * `{ status, samples, stable, elapsed_ms,
 *    predicates: [{ index, status, unknown_reason?, observed_json? }] }`
 *
 * `unknown_reason` is carried through verbatim because it is the difference
 * between "the app says no" and "we could not look" — `multi_match` means the
 * selector was ambiguous (a label of `A1` also matches `A10`), while
 * `observation_unavailable` means the provider never answered.
 */
export function parseVerifyState(structuredJson: string): {
  outcome: 'satisfied' | 'unsatisfied' | 'unknown';
  results: Array<{ outcome: 'satisfied' | 'unsatisfied' | 'unknown'; detail?: string; matches?: number }>;
} {
  const root = parseJson('verify_state', structuredJson);
  const toOutcome = (value: unknown): 'satisfied' | 'unsatisfied' | 'unknown' =>
    value === 'satisfied' || value === 'unsatisfied' ? value : 'unknown';

  const raw = Array.isArray(root['predicates']) ? root['predicates'] : [];
  const results = raw.map((entry) => {
    if (!isObject(entry)) return { outcome: 'unknown' as const };
    const reason = asString(entry['unknown_reason']);
    // `observed_json` carries the match count, which is the whole story behind
    // multi_match: without it "ambiguous" gives the agent nothing to act on.
    let matches: number | undefined;
    const observed = asString(entry['observed_json']);
    if (observed) {
      try {
        const parsed: unknown = JSON.parse(observed);
        if (isObject(parsed)) matches = asNumber(parsed['matches']);
      } catch {
        // Diagnostic only.
      }
    }
    return {
      outcome: toOutcome(entry['status']),
      ...(reason ? { detail: reason } : {}),
      ...(matches !== undefined ? { matches } : {}),
    };
  });

  return { outcome: toOutcome(root['status']), results };
}

/**
 * Recorder state. Every field is optional in practice: a driver that has never
 * recorded reports nulls throughout, and a missing payload is normal for a
 * build without the recorder rather than a fault, so this never throws.
 *
 * Windows paths come back in `\\?\` extended form. It is valid but leaks into
 * UI and log lines as noise, so it is stripped here.
 */
export function parseRecordingState(structuredJson: string | null): {
  recording: boolean;
  outputDir?: string;
  nextTurn?: number;
  videoPath?: string;
  detail?: string;
} {
  if (!structuredJson) return { recording: false };
  let root: Json;
  try {
    root = parseJson('get_recording_state', structuredJson);
  } catch {
    return { recording: false };
  }

  const plain = (v: unknown): string | undefined => asString(v)?.replace(/^\\\\\?\\/, '');
  const outputDir = plain(root['output_dir']);
  const videoPath = plain(root['last_video_path']);
  const nextTurn = asNumber(root['next_turn']);
  const detail = asString(root['last_error']);

  return {
    recording: asBool(root['recording']) || asBool(root['enabled']),
    ...(outputDir ? { outputDir } : {}),
    ...(nextTurn !== undefined ? { nextTurn } : {}),
    ...(videoPath ? { videoPath } : {}),
    ...(detail ? { detail } : {}),
  };
}

export function parseListApps(structuredJson: string): ComputerAppInfo[] {
  const root = parseJson('list_apps', structuredJson);
  const raw = root['apps'];
  if (!Array.isArray(raw)) throw new UnrecognisedDriverPayloadError('list_apps', Object.keys(root));

  const apps: ComputerAppInfo[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    if (!asBool(entry['running'])) continue;
    const pid = asNumber(entry['pid']);
    if (pid === undefined || pid === 0) continue;

    const launchPath = asString(entry['launch_path']);
    // On Windows `bundle_id` is the executable path, so it doubles as the
    // stable identity; `name` alone is spoofable.
    const id = asString(entry['bundle_id']) ?? launchPath ?? asString(entry['name']) ?? String(pid);
    apps.push({
      id,
      name: asString(entry['name']) ?? id,
      pid,
      executablePath: launchPath ?? (id.includes('\\') || id.includes('/') ? id : undefined),
      frontmost: asBool(entry['active']),
      windowCount: Array.isArray(entry['windows']) ? entry['windows'].length : 0,
    });
  }
  return apps;
}

/** `list_windows` → every top-level window, each carrying its owning pid. */
/** The window level macOS draws popup and context menus at (kCGPopUpMenuWindowLevel). */
const MENU_WINDOW_LAYER = 101;

export function parseListWindows(structuredJson: string): Map<number, ComputerWindowInfo[]> {
  const root = parseJson('list_windows', structuredJson);
  const raw = root['windows'];
  if (!Array.isArray(raw)) throw new UnrecognisedDriverPayloadError('list_windows', Object.keys(root));

  // The driver reports stacking order, not focus, and HIGHER z_index is closer
  // to the front — measured: the desktop's "Program Manager" is 0 and the
  // frontmost window is the maximum. A null means the order is unavailable and
  // the contract says callers must not infer one.
  const staged = new Map<number, Array<{ window: ComputerWindowInfo; z: number | undefined }>>();
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const pid = asNumber(entry['pid']);
    const id = asNumber(entry['window_id']);
    if (pid === undefined || id === undefined) continue;

    const list = staged.get(pid) ?? [];
    list.push({
      window: {
        id,
        title: asString(entry['title']) ?? '',
        index: list.length,
        focused: false,
        minimised: asBool(entry['minimized']),
        bounds: parseFrame(entry),
        onScreen: asBool(entry['is_on_screen']),
        ...(typeof entry['layer'] === 'number' && entry['layer'] !== 0 ? { floating: true } : {}),
        // macOS draws popup and context menus at the pop-up menu level (101), untitled.
        ...(typeof entry['layer'] === 'number' && entry['layer'] >= MENU_WINDOW_LAYER && !asString(entry['title']) ? { menu: true } : {}),
      },
      z: asBool(entry['is_on_screen']) ? asNumber(entry['z_index']) : undefined,
    });
    staged.set(pid, list);
  }

  const byPid = new Map<number, ComputerWindowInfo[]>();
  for (const [pid, entries] of staged) {
    let front: { window: ComputerWindowInfo; z: number } | undefined;
    for (const entry of entries) {
      if (entry.z === undefined) continue;
      if (!front || entry.z > front.z) front = { window: entry.window, z: entry.z };
    }
    if (front) front.window.focused = true;
    byPid.set(pid, entries.map((e) => e.window));
  }
  return byPid;
}

export interface ParsedWindowState {
  snapshotId: string;
  pid: number;
  windowId: number;
  elements: ComputerElement[];
  /** Non-null when the UIA walk was clipped by max_elements / max_depth. */
  truncated: { elements: number; depth: number } | null;
  screenshot: { width: number; height: number; mimeType: string } | null;
  /** Read-only text the driver lists only in `tree_markdown` (no index): `readOnlyText`. */
  text: string[];
  /** Elements in the whole walk — more than `elements` under a `query` projection. */
  total: number;
  /** The driver's compact Markdown rendering, tidied (`compactTree`). */
  tree?: string;
}

/**
 * The driver's Markdown tree, tidied for the agent: AppKit leaks raw action
 * descriptors ("name:Move previous⏎target:0x0⏎selector:(null)") into the
 * action list, split across lines, and `id=`/`help=` attributes repeat what the
 * label already says. Both are dropped; the rows, indices, labels, values,
 * read-only text and the remaining actions stay as the driver wrote them.
 */
export function compactTree(markdown: string): string {
  return markdown
    .replace(/,?name:[^\],]*?target:0x[0-9a-f]+\s*selector:\([^)]*\)/gi, '')
    .replace(/ ?help="[^"]*"/g, '')
    .replace(/(\[|\s)id=.*?(?=\s?actions=\[|\])/g, '$1')
    .replace(/\[\s*actions=\[([^\]]*)\]\s*\]/g, (_m, list: string) => {
      const kept = list.split(',').map((a) => a.trim()).filter((a) => a.length > 0);
      return kept.length > 0 ? `[${kept.join(',')}]` : '';
    })
    .replace(/ ?\[\s*\]/g, '')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/** Bounds on the read-only text handed to the model: it is untrusted, and a long document should not flood it. */
const MAX_TEXT_LINES = 60;
const MAX_TEXT_CHARS = 4000;

/**
 * The read-only text of a window, from the driver's `tree_markdown` — its un-indexed lines with a value, e.g.
 * `    - AXStaticText = "408" (Edit field)`. The structured `elements` carry only what can be acted on, so a
 * calculator's display, a status message or a label was invisible to the agent. Secure fields never appear: the
 * driver does not print their values, and lines from secure roles are skipped here as well.
 */
export function readOnlyText(markdown: string): string[] {
  const out: string[] = [];
  let chars = 0;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    // Indexed lines (`- [12] AXButton …`) are elements already.
    const m = /^- (?!\[\d+\])([A-Za-z][\w.]*) = "((?:[^"\\]|\\.)*)"(?: \((.*)\))?$/.exec(line);
    if (!m) continue;
    const [, role, value, label] = m;
    if (!value || SECURE_ROLES.has(role!.toLowerCase())) continue;
    const entry = label ? `${label}: ${value}` : value!;
    if (chars + entry.length > MAX_TEXT_CHARS || out.length >= MAX_TEXT_LINES) break;
    out.push(entry);
    chars += entry.length;
  }
  return out;
}

/** Roles the platforms use for password fields, normalised to lower case. */
const SECURE_ROLES = new Set(['passwordbox', 'password', 'securetextfield', 'axsecuretextfield']);

/**
 * `get_window_state` → the indexed accessibility tree for one window.
 *
 * `snapshot_id` and `element_index` are the driver's own; they are passed
 * straight back to `click` / `set_value` / `type_text`, so this parser must
 * never renumber them.
 */
export function parseWindowState(structuredJson: string, filtered = false): ParsedWindowState {
  const root = parseJson('get_window_state', structuredJson);
  const snapshotId = asString(root['snapshot_id']);
  const pid = asNumber(root['pid']);
  const windowId = asNumber(root['window_id']);
  const raw = root['elements'];
  if (snapshotId === undefined || pid === undefined || windowId === undefined || !Array.isArray(raw)) {
    throw new UnrecognisedDriverPayloadError('get_window_state', Object.keys(root));
  }

  const elements: ComputerElement[] = [];
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const index = asNumber(entry['element_index']);
    if (index === undefined) continue;

    const role = asString(entry['role']) ?? 'unknown';
    const traits: string[] = [];
    if (entry['enabled'] === false) traits.push('disabled');
    if (asBool(entry['focused'])) traits.push('focused');
    if (asBool(entry['selected'])) traits.push('selected');

    const secure = SECURE_ROLES.has(role.toLowerCase()) || asBool(entry['is_password']);
    const value = asString(entry['value']) ?? null;

    elements.push({
      index,
      role,
      title: asString(entry['name']),
      label: asString(entry['label']),
      secure,
      // Redacted at the boundary so no downstream consumer can observe a
      // password field's contents, even transiently.
      value: secure ? null : value,
      placeholder: asString(entry['placeholder']),
      traits,
      // The accessibility actions the element advertises (AXPress, AXShowMenu…)
      // — the allowlist computer_perform_action is checked against. AppKit
      // leaks raw descriptors ("Name:Move previous⏎Target:0x0…") in here.
      actions: Array.isArray(entry['actions'])
        ? entry['actions'].filter((a): a is string => typeof a === 'string' && /^[A-Za-z]+$/.test(a))
        : [],
      childCount: asNumber(entry['child_count']) ?? 0,
      bounds: parseFrame(entry),
      ...(asString(entry['element_token']) ? { token: asString(entry['element_token']) } : {}),
    });
  }

  // `elements_complete` is false whenever the returned set is smaller than the
  // walk — and it stays false even when nothing was dropped, so the counts are
  // the only honest signal. A `query` projection is a filter, not truncation:
  // reporting it as dropped elements makes the agent distrust its own filter
  // and re-read the whole window.
  const total = asNumber(root['total_element_count']) ?? elements.length;
  const returned = asNumber(root['returned_element_count']) ?? elements.length;
  const dropped = filtered ? 0 : Math.max(0, total - returned);
  const truncated = dropped > 0 ? { elements: dropped, depth: 0 } : null;

  const width = asNumber(root['screenshot_width']);
  const height = asNumber(root['screenshot_height']);

  return {
    snapshotId,
    pid,
    windowId,
    elements,
    truncated,
    text: readOnlyText(asString(root['tree_markdown']) ?? ''),
    ...(asString(root['tree_markdown']) ? { tree: compactTree(asString(root['tree_markdown'])!) } : {}),
    total,
    screenshot:
      width !== undefined && height !== undefined
        ? { width, height, mimeType: asString(root['screenshot_mime_type']) ?? 'image/png' }
        : null,
  };
}

/**
 * `get_window_state` answered `degraded` with no snapshot and no elements: the driver refused to guess which
 * accessibility tree belongs to the window (`ax_window_unresolved`), and its `escalation` says what would work —
 * usually foreground delivery. A refusal, never an unrecognised payload. Null for any readable state.
 */
export function unreadableWindow(structuredJson: string): ComputerRefusal | null {
  const root = parseJson('get_window_state', structuredJson);
  const elements = root['elements'];
  if (root['degraded'] !== true || root['snapshot_id'] !== undefined) return null;
  if (Array.isArray(elements) && elements.length > 0) return null;
  const reason = (asString(root['degraded_reason']) ?? '').split(/(?<=\.)\s/)[0]?.trim();
  const escalation = isObject(root['escalation']) ? (root['escalation'] as Json) : undefined;
  const foreground = escalation ? asString(escalation['recommended']) === 'foreground' : false;
  return {
    code: foreground ? 'background_unavailable' : 'target_lost',
    message:
      `The driver could not read this window's controls${reason ? ` (${reason})` : ''}. ` +
      (foreground
        ? 'It recommends foreground delivery: bring the window to the front, or pick a different window of this app, then snapshot again.'
        : 'Snapshot again once the app settles, or pick a different window of this app.'),
  };
}

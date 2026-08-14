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

export function parseListApps(structuredJson: string): ComputerAppInfo[] {  const root = parseJson('list_apps', structuredJson);
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
export function parseListWindows(structuredJson: string): Map<number, ComputerWindowInfo[]> {
  const root = parseJson('list_windows', structuredJson);
  const raw = root['windows'];
  if (!Array.isArray(raw)) throw new UnrecognisedDriverPayloadError('list_windows', Object.keys(root));

  const byPid = new Map<number, ComputerWindowInfo[]>();
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const pid = asNumber(entry['pid']);
    const id = asNumber(entry['window_id']);
    if (pid === undefined || id === undefined) continue;

    const list = byPid.get(pid) ?? [];
    list.push({
      id,
      title: asString(entry['title']) ?? '',
      index: list.length,
      // The driver reports stacking order, not focus. z_index 0 is topmost
      // among on-screen windows, which is the closest honest signal.
      focused: asNumber(entry['z_index']) === 0 && asBool(entry['is_on_screen']),
      minimised: asBool(entry['minimized']),
      bounds: parseFrame(entry),
    });
    byPid.set(pid, list);
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
      // The driver does not enumerate per-element actions; what an element
      // supports is implied by its role plus the tool that targets it.
      actions: [],
      childCount: asNumber(entry['child_count']) ?? 0,
      bounds: parseFrame(entry),
      ...(asString(entry['element_token']) ? { token: asString(entry['element_token']) } : {}),
    });
  }

  // `elements_complete` is false whenever the returned set is smaller than the
  // walk — which a `query` projection always is. Reporting that as truncation
  // tells the agent elements were dropped for size, so it distrusts its own
  // filter and re-reads the whole window. A zero-element truncation is noise
  // for the same reason.
  const total = asNumber(root['total_element_count']) ?? elements.length;
  const dropped = filtered ? 0 : Math.max(0, total - elements.length);
  const complete = root['elements_complete'] !== false;
  const truncated = !complete && dropped > 0 ? { elements: dropped, depth: 0 } : null;

  const width = asNumber(root['screenshot_width']);
  const height = asNumber(root['screenshot_height']);

  return {
    snapshotId,
    pid,
    windowId,
    elements,
    truncated,
    screenshot:
      width !== undefined && height !== undefined
        ? { width, height, mimeType: asString(root['screenshot_mime_type']) ?? 'image/png' }
        : null,
  };
}

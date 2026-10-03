// What the system surfaces draw (MX-01 Live Activity, MX-02 Live Update; 06 §7.3, MD-33, MD-65, MD-67, MD-90) —
// pure, so the content and the start / update / end decisions are tested without a device:
//   • `planLiveSurfaces` — given the surfaces now on screen and the live map: which items to show (start or update),
//     which ending items to leave as they are while their outcome is resolved, which to end with their final state
//     (dismissed after the MD-90 window) and which to drop at once (forgotten, unfollowed, switched off, displaced).
//   • `toLiveActivityProps` — one item as the props of the expo-widgets Live Activity layout; `toAndroidLiveUpdate`
//     — as the generatorai-live notification record. Always the lock-screen form (`redactForLockScreen`): the Lock
//     Screen, the Dynamic Island and the status-bar chip are visible while the phone is locked.
import {
  isLiveTerminal,
  liveDismissal,
  redactForLockScreen,
  type LiveMap,
  type LivePhase,
  type LiveSegment,
  type LiveState,
} from '@generatorai/client-core';
import { mobileIconDef, type MobileIconConcept } from '@generatorai/design-tokens';
import { STATUS_STATE_DEFS, type StatusState, type StatusTone } from '@generatorai/shared';

import type { WidgetPalette } from '../native/widgetPalette';

// ── Planning ────────────────────────────────────────────────────

export interface LiveSurfacePlan {
  /** Start or update, most urgent first (MD-90 order). */
  show: LiveState[];
  /** Ending items that already have a surface: unchanged until their outcome arrives (MD-182). */
  hold: string[];
  /** End with the final state, removed from the Lock Screen at `at` (MD-90: 15 min, failures 30 min). */
  finish: { key: string; state: LiveState; at: Date }[];
  /** End at once. */
  drop: string[];
}

export function planLiveSurfaces(active: Iterable<string>, map: LiveMap, candidates: readonly LiveState[]): LiveSurfacePlan {
  const shown = new Set(candidates.map((s) => s.key));
  const plan: LiveSurfacePlan = { show: [...candidates], hold: [], finish: [], drop: [] };
  for (const key of active) {
    if (shown.has(key)) continue;
    const state = map[key];
    const end = state ? liveDismissal(state) : null;
    if (state && end) plan.finish.push({ key, state, at: end.at });
    else if (state?.endedAt && !isLiveTerminal(state.phase)) plan.hold.push(key);
    else plan.drop.push(key);
  }
  return plan;
}

// ── Shared content ──────────────────────────────────────────────

/** The status state a phase is drawn as (cancelled = the shared "skipped" glyph and tone, word "Cancelled"). */
export function phaseStatus(phase: LivePhase): StatusState {
  return phase === 'cancelled' ? 'skipped' : phase;
}

const TONE_KEY: Record<StatusTone, keyof WidgetPalette> = { 'fg-2': 'fg2', 'fg-3': 'fg3', run: 'run', ok: 'ok', warn: 'warn', err: 'err' };
const SEGMENT_KEY: Record<LiveSegment, keyof WidgetPalette> = { done: 'ok', current: 'run', needs_you: 'warn', failed: 'err', pending: 'line' };

export function phaseTone(phase: LivePhase, palette: WidgetPalette): string {
  return palette[TONE_KEY[STATUS_STATE_DEFS[phaseStatus(phase)].tone]];
}

export function segmentColors(segments: readonly LiveSegment[] | undefined, palette: WidgetPalette): string[] {
  return (segments ?? []).map((s) => palette[SEGMENT_KEY[s]]);
}

/** SF Symbol of the phase's status glyph. */
export function phaseSymbol(phase: LivePhase): string {
  const concept = STATUS_STATE_DEFS[phaseStatus(phase)].glyph as MobileIconConcept;
  return mobileIconDef(concept)?.sfSymbol ?? 'circle';
}

/** "3/6" when both ends are known. */
export function progressText(s: LiveState): string | undefined {
  return s.step?.index && s.step.count ? `${s.step.index}/${s.step.count}` : undefined;
}

/** The text equivalent of the segments (MD-67): "Stage 3 of 6" for runs. */
export function stageText(s: LiveState): string | undefined {
  if (s.entity === 'chat' || !s.step?.index || !s.step.count) return undefined;
  return `Stage ${s.step.index} of ${s.step.count}`;
}

/** Headline and detail lines: the gate (or the step) first, the status word with the stage under it. */
export function liveLines(s: LiveState): { headline: string; detail?: string } {
  const label = s.step?.label;
  if (s.ask) return { headline: s.ask.summary, detail: [s.statusWord, label].filter(Boolean).join(' · ') };
  if (label && !isLiveTerminal(s.phase)) return { headline: label, detail: s.statusWord };
  return label ? { headline: s.statusWord, detail: label } : { headline: s.statusWord };
}

// ── iOS Live Activity (expo-widgets) ────────────────────────────

export type LiveActivityPalette = Pick<WidgetPalette, 'fg' | 'fg2' | 'fg3' | 'line' | 'surface' | 'raised' | 'accent' | 'onAccent'>;

/** JSON props of the `RunActivity` layout. Strings and numbers only: the layout runs in the widget extension. */
export interface LiveActivityProps {
  title: string;
  /** "#248", only when the API provides a run number (MG-29). */
  number?: string;
  /** Shared status word (MD-25) with its glyph and tone: never colour alone. */
  status: string;
  symbol: string;
  tone: string;
  headline: string;
  detail?: string;
  /** "3/6" for the compact trailing region. */
  progress?: string;
  /** "Stage 3 of 6", the segments' text equivalent. */
  stage?: string;
  /** "Next: Run test suite". */
  next?: string;
  /** One colour per stage (hidden from VoiceOver). */
  segments: string[];
  /** Epoch ms the elapsed timer counts from. */
  startedAt: number;
  ended: boolean;
  /** The gate's deep link while it needs you: the "Review" button (never an inline approve, MD-31). */
  reviewUrl?: string;
  palette: LiveActivityPalette;
}

export function toLiveActivityProps(state: LiveState, palette: WidgetPalette): LiveActivityProps {
  const s = redactForLockScreen(state);
  const lines = liveLines(s);
  const props: LiveActivityProps = {
    title: s.title,
    status: s.statusWord,
    symbol: phaseSymbol(s.phase),
    tone: phaseTone(s.phase, palette),
    headline: lines.headline,
    segments: segmentColors(s.segments, palette),
    startedAt: Date.parse(s.startedAt),
    ended: isLiveTerminal(s.phase),
    palette: {
      fg: palette.fg, fg2: palette.fg2, fg3: palette.fg3, line: palette.line,
      surface: palette.surface, raised: palette.raised, accent: palette.accent, onAccent: palette.onAccent,
    },
  };
  if (s.runNumber !== undefined) props.number = `#${s.runNumber}`;
  if (lines.detail) props.detail = lines.detail;
  const progress = progressText(s);
  if (progress) props.progress = progress;
  const stage = stageText(s);
  if (stage) props.stage = stage;
  if (s.next && !isLiveTerminal(s.phase)) props.next = `Next: ${s.next}`;
  if (s.ask) props.reviewUrl = s.deepLink;
  return props;
}

// ── Android Live Update (modules/generatorai-live) ──────────────

/** Mirrors `LiveUpdateRecord` in GeneratorAILiveModule (Kotlin). Colours are ARGB ints. */
export interface AndroidLiveUpdate {
  key: string;
  /** Stable notification id per live key. */
  id: number;
  /** The gate, step or status (the notification title). */
  title: string;
  /** "Nightly audit · Needs you · Apply upgrades". */
  text: string;
  /** "Run #248" when the API gives a number. */
  subText?: string;
  /** Status-bar chip (Android 16 promoted notifications): "Needs you 3/6". */
  chip?: string;
  segments: { length: number; color: number }[];
  /** Tracker position on the segments' scale (each segment is SEGMENT_LENGTH long). */
  progress: number;
  /** No stages: an indeterminate bar while it is live. */
  indeterminate: boolean;
  tracker: 'needs_you' | 'running' | 'failed' | 'done' | 'cancelled';
  /** Chronometer base: the start. */
  whenMs: number;
  /** False for the final state (dismissible, timed out after the MD-90 window). */
  ongoing: boolean;
  deepLink: string;
  reviewUrl?: string;
  reviewLabel: string;
}

export const SEGMENT_LENGTH = 100;

/** `#rgb`, `#rrggbb` or CSS `#rrggbbaa` → a signed 32-bit ARGB int (Android `@ColorInt`); 0 when unreadable. */
export function hexToArgb(hex: string): number {
  const m = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(hex.trim());
  if (!m) return 0;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const rgb = parseInt(h.slice(0, 6), 16);
  const alpha = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 0xff;
  return ((alpha << 24) | rgb) | 0;
}

/** A stable positive notification id for a live key (FNV-1a), clear of the low ids other notifications use. */
export function liveNotificationId(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 0x10000000 + ((hash >>> 0) % 0x0fffffff);
}

/** The stages to draw: the run's own segments, or ones derived from "step n of N". */
function stagesOf(s: LiveState): LiveSegment[] {
  if (s.segments?.length) return [...s.segments];
  const index = s.step?.index;
  const count = s.step?.count;
  if (!index || !count || count > 12) return [];
  const current: LiveSegment = s.phase === 'needs_you' ? 'needs_you' : s.phase === 'failed' ? 'failed' : isLiveTerminal(s.phase) ? 'done' : 'current';
  return Array.from({ length: count }, (_, i) => (i < index - 1 ? 'done' : i === index - 1 ? current : 'pending'));
}

function trackerOf(phase: LivePhase): AndroidLiveUpdate['tracker'] {
  if (phase === 'needs_you') return 'needs_you';
  if (phase === 'failed') return 'failed';
  if (phase === 'succeeded') return 'done';
  if (phase === 'cancelled') return 'cancelled';
  return 'running';
}

export function toAndroidLiveUpdate(state: LiveState, palette: WidgetPalette): AndroidLiveUpdate {
  const s = redactForLockScreen(state);
  const lines = liveLines(s);
  const ended = isLiveTerminal(s.phase);
  const stages = stagesOf(s);
  const at = stages.findIndex((x) => x === 'current' || x === 'needs_you' || x === 'failed');
  const progress = stages.length === 0 ? 0 : at < 0 ? stages.length * SEGMENT_LENGTH : at * SEGMENT_LENGTH + SEGMENT_LENGTH / 2;
  const update: AndroidLiveUpdate = {
    key: s.key,
    id: liveNotificationId(s.key),
    title: lines.headline,
    text: [s.title, lines.detail].filter(Boolean).join(' · '),
    segments: stages.map((x) => ({ length: SEGMENT_LENGTH, color: hexToArgb(palette[SEGMENT_KEY[x]]) })),
    progress,
    indeterminate: stages.length === 0 && !ended,
    tracker: trackerOf(s.phase),
    whenMs: Date.parse(s.startedAt),
    ongoing: !ended,
    deepLink: s.deepLink,
    reviewLabel: 'Review',
  };
  if (s.runNumber !== undefined) update.subText = `Run #${s.runNumber}`;
  if (!ended) update.chip = [s.statusWord, progressText(s)].filter(Boolean).join(' ');
  if (s.ask) update.reviewUrl = s.deepLink;
  return update;
}

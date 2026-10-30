// The home-screen widgets' data (MX-03, MWidgets; 06 §7.4, MD-33, MD-65): one snapshot of a server's live items,
// written to every widget through expo-widgets (App Group storage). Pure, so content and the write policy are tested
// without a device. Titles, status words and stage names only — the lock-screen form, because widgets are visible
// on a locked phone.
import { isLiveTerminal, redactForLockScreen, type LiveMap, type LiveState } from '@generatorai/client-core';

import type { WidgetPalette } from '../native/widgetPalette';
import { liveLines, phaseSymbol, stageText } from './liveSurfaceModel';

/** Rows per list (the medium widget's height). */
export const WIDGET_ROWS = 3;
/** Ordinary changes wait this long (WidgetKit's daily reload budget); Needs-you changes write at once (06 §7.4). */
export const WIDGET_DEBOUNCE_MS = 60_000;

export interface WidgetItem {
  key: string;
  title: string;
  sub: string;
  /** SF Symbol of the status glyph (always next to a word: tinted and clear modes keep the meaning). */
  symbol: string;
  /** Epoch ms, for the elapsed timer of running rows. */
  startedAt: number;
  url: string;
}

export interface WidgetSnapshot {
  /** Empty when no server is paired: the widgets ask to open the app. */
  serverId: string;
  serverName: string;
  /** Epoch ms of the data ("Updated 14:06"). */
  updatedAt: number;
  counts: { needsYou: number; running: number };
  needsYou: WidgetItem[];
  running: WidgetItem[];
  /** Home. */
  homeUrl: string;
  palette: WidgetPalette;
}

const byStart = (a: LiveState, b: LiveState): number => Date.parse(a.startedAt) - Date.parse(b.startedAt) || (a.key < b.key ? -1 : 1);

function itemOf(state: LiveState): WidgetItem {
  const s = redactForLockScreen(state);
  const sub = s.ask ? s.ask.summary : (stageText(s) ?? liveLines(s).headline);
  return {
    key: s.key,
    title: s.runNumber !== undefined ? `${s.title} #${s.runNumber}` : s.title,
    sub,
    symbol: phaseSymbol(s.phase),
    startedAt: Date.parse(s.startedAt),
    url: s.deepLink,
  };
}

export function homeUrl(serverId: string): string {
  return serverId ? `generatorai:///?server=${encodeURIComponent(serverId)}` : 'generatorai:///';
}

/**
 * The snapshot for one server: its Needs-you items (oldest ask first) and running items (longest-running first),
 * three each, with the counts the attention feed reports (or the items' own counts when it has none).
 */
export function buildWidgetSnapshot(input: {
  map: LiveMap;
  server: { id: string; name: string } | null;
  counts?: { needsYou: number; running: number } | null;
  palette: WidgetPalette;
  now: number;
}): WidgetSnapshot {
  const { map, server, palette, now } = input;
  const states = server ? Object.values(map).filter((s) => s.serverId === server.id && !s.endedAt && !isLiveTerminal(s.phase)) : [];
  const needs = states.filter((s) => s.phase === 'needs_you').sort(byStart);
  const running = states.filter((s) => s.phase === 'running').sort(byStart);
  return {
    serverId: server?.id ?? '',
    serverName: server?.name ?? '',
    updatedAt: now,
    counts: input.counts ? { needsYou: input.counts.needsYou, running: input.counts.running } : { needsYou: needs.length, running: running.length },
    needsYou: needs.slice(0, WIDGET_ROWS).map(itemOf),
    running: running.slice(0, WIDGET_ROWS).map(itemOf),
    homeUrl: homeUrl(server?.id ?? ''),
    palette,
  };
}

/** What a write must compare: everything but the timestamp. */
export function snapshotFingerprint(s: WidgetSnapshot): string {
  return JSON.stringify({ ...s, updatedAt: 0 });
}

/** A change of the Needs-you rows or count is written at once; anything else waits for the debounce. */
export function isUrgentWidgetChange(prev: WidgetSnapshot | null, next: WidgetSnapshot): boolean {
  if (!prev) return true;
  if (prev.serverId !== next.serverId || prev.counts.needsYou !== next.counts.needsYou) return true;
  return prev.needsYou.map((i) => i.key).join('|') !== next.needsYou.map((i) => i.key).join('|');
}

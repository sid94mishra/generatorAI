// ────────────────────────────────────────────────────────────────
// Diff view preferences — wrap, font size, layout.
//
// One store for every diff on screen, the same shape as the markdown
// agent's `codeWrapStore`: a reader who pinches a diff to 14pt wants the
// next file at 14pt too, and the choice must survive a relaunch.
//
// Module-level state + `useSyncExternalStore`, persisted through the generic
// prefs API. Storage failures (web preview, tests) fall back to defaults.
// ────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from 'react';

import { prefs } from '../../storage/prefs';
import { DEFAULT_DIFF_FONT, clampFont } from './diffModel';

export type DiffLayout = 'auto' | 'unified' | 'split';

export interface DiffPrefs {
  wrap: boolean;
  fontSize: number;
  layout: DiffLayout;
}

const KEY_WRAP = 'generatorai.diff-wrap';
const KEY_FONT = 'generatorai.diff-font';
const KEY_LAYOUT = 'generatorai.diff-layout';

let state: DiffPrefs | null = null;
const listeners = new Set<() => void>();

function read(): DiffPrefs {
  if (state === null) {
    try {
      const font = Number(prefs.getString(KEY_FONT) ?? DEFAULT_DIFF_FONT);
      const layout = prefs.getString(KEY_LAYOUT);
      state = {
        wrap: prefs.getBoolean(KEY_WRAP, true),
        fontSize: clampFont(Number.isFinite(font) ? font : DEFAULT_DIFF_FONT),
        layout: layout === 'unified' || layout === 'split' ? layout : 'auto',
      };
    } catch {
      state = { wrap: true, fontSize: DEFAULT_DIFF_FONT, layout: 'auto' };
    }
  }
  return state;
}

function commit(next: DiffPrefs): void {
  state = next;
  try {
    prefs.setBoolean(KEY_WRAP, next.wrap);
    prefs.setString(KEY_FONT, String(next.fontSize));
    prefs.setString(KEY_LAYOUT, next.layout);
  } catch {
    // Persistence is best-effort; the in-memory value still applies.
  }
  for (const listener of listeners) listener();
}

export function getDiffPrefs(): DiffPrefs {
  return read();
}

export function setDiffWrap(wrap: boolean): void {
  const current = read();
  if (current.wrap !== wrap) commit({ ...current, wrap });
}

export function setDiffFontSize(size: number): void {
  const current = read();
  const fontSize = clampFont(size);
  if (current.fontSize !== fontSize) commit({ ...current, fontSize });
}

export function setDiffLayout(layout: DiffLayout): void {
  const current = read();
  if (current.layout !== layout) commit({ ...current, layout });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDiffPrefs(): DiffPrefs {
  return useSyncExternalStore(subscribe, read, read);
}

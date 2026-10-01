// ────────────────────────────────────────────────────────────────
// useDockState — one page scope's dock tabs (list, selection, caps, focus
// requests), persisted under `storageKey` (`generatorai:dock:<scope>:<id>`).
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DockFocusRequest, DockRegistry } from './dockRegistry.js';
import {
  addDockTab,
  atCap,
  capNoticeText,
  closeDockTab,
  defaultTabId,
  focusDockTab,
  focusHitsCap,
  readDockState,
  reconcileDockState,
  type DockStoredState,
  type DockTabRef,
} from './dockState.js';

/** How long the cap refusal stays up. */
export const CAP_NOTICE_MS = 6000;

export interface UseDockStateOptions {
  storageKey: string;
  registry: DockRegistry;
  defaultTabType: string;
  focusRequest?: DockFocusRequest | null | undefined;
  /** A tab closed for good (not an unmount or a scope switch): drop what it remembered. */
  onTabClose?: ((tab: DockTabRef) => void) | undefined;
}

export interface DockStateApi {
  state: DockStoredState;
  capNotice: string | null;
  select: (id: string) => void;
  add: (type: string) => void;
  close: (id: string) => void;
}

export function useDockState({
  storageKey,
  registry,
  defaultTabType,
  focusRequest,
  onTabClose,
}: UseDockStateOptions): DockStateApi {
  // The key is held WITH the data so a scope switch swaps both atomically;
  // otherwise the persist effect would write the previous chat's tabs into the
  // next chat's slot in between.
  const [scoped, setScoped] = useState(() => ({
    key: storageKey,
    data: readDockState(storageKey, registry, defaultTabType),
  }));
  // Render-phase adjustments (React's pattern for deriving from props): the
  // first painted frame of a new scope already shows that scope's tabs, and a
  // registry change (Tasks once the chat turns out to be an orchestrator) is
  // reconciled before it paints.
  if (scoped.key !== storageKey) {
    setScoped({ key: storageKey, data: readDockState(storageKey, registry, defaultTabType) });
  } else {
    const reconciled = reconcileDockState(scoped.data, registry, defaultTabType);
    if (reconciled !== scoped.data) setScoped({ key: scoped.key, data: reconciled });
  }
  const state = scoped.data;
  const stateRef = useRef(state);
  stateRef.current = state;

  const update = useCallback((fn: (prev: DockStoredState) => DockStoredState) => {
    setScoped((prev) => ({ key: prev.key, data: fn(prev.data) }));
  }, []);

  useEffect(() => {
    if (scoped.key !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(scoped.data));
    } catch {
      /* quota / private mode: the layout is just not remembered */
    }
  }, [storageKey, scoped]);

  // N7 — a cap that refuses in silence reads as a bug: say why nothing opened.
  const [capNotice, setCapNotice] = useState<string | null>(null);
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceCap = useCallback((label: string, max: number) => {
    setCapNotice(capNoticeText(label, max));
    if (capTimer.current) clearTimeout(capTimer.current);
    capTimer.current = setTimeout(() => setCapNotice(null), CAP_NOTICE_MS);
  }, []);
  useEffect(
    () => () => {
      if (capTimer.current) clearTimeout(capTimer.current);
    },
    [],
  );

  const registryRef = useRef(registry);
  registryRef.current = registry;
  const defaultTabTypeRef = useRef(defaultTabType);
  defaultTabTypeRef.current = defaultTabType;
  const onTabCloseRef = useRef(onTabClose);
  onTabCloseRef.current = onTabClose;

  const select = useCallback((id: string) => update((prev) => (prev.active === id ? prev : { ...prev, active: id })), [update]);

  const add = useCallback(
    (type: string) => {
      const reg = registryRef.current;
      const def = reg[type];
      if (!def) return;
      // Decided OUTSIDE the updater: the notice is a state write of its own and
      // React may run an updater twice (StrictMode).
      if (def.allowMultiple && def.maxInstances !== undefined && atCap(stateRef.current, type, reg)) {
        announceCap(def.label, def.maxInstances);
      }
      update((prev) => addDockTab(prev, type, reg));
    },
    [update, announceCap],
  );

  const close = useCallback(
    (id: string) => {
      const closing = stateRef.current.tabs.find((t) => t.id === id);
      if (!closing) return;
      update((prev) => closeDockTab(prev, id));
      // After scheduling the removal, before it commits: owners drop per-tab state.
      onTabCloseRef.current?.(closing);
    },
    [update],
  );

  // One add/focus cycle per request token (the object may be recreated).
  const lastToken = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest || lastToken.current === focusRequest.token) return;
    lastToken.current = focusRequest.token;
    const reg = registryRef.current;
    const def = reg[focusRequest.type];
    if (!def) {
      // A link to a tab this surface does not offer (Tasks without background
      // work, Computer without consent) lands on the default tab, not on
      // whichever tab happened to be open last.
      const fallback = defaultTabId(defaultTabTypeRef.current);
      update((prev) => (prev.tabs.some((t) => t.id === fallback) ? { ...prev, active: fallback } : prev));
      return;
    }
    if (def.maxInstances !== undefined && focusHitsCap(stateRef.current, focusRequest, reg)) {
      announceCap(def.label, def.maxInstances);
    }
    update((prev) => focusDockTab(prev, focusRequest, reg));
  }, [focusRequest, update, announceCap]);

  return { state, capNotice, select, add, close };
}

// ────────────────────────────────────────────────────────────────
// Dock tab state — pure functions (persisted per chat / run under
// `generatorai:dock:<scope>:<id>`, D-27). `useDockState` wraps them.
// ────────────────────────────────────────────────────────────────

import type { DockFocusRequest, DockRegistry } from './dockRegistry.js';

export interface DockTabRef {
  id: string;
  type: string;
}

/** The persisted shape: the ordered tab list and the selected id. */
export interface DockStoredState {
  tabs: DockTabRef[];
  active: string;
}

/**
 * A globally unique tab id. Tab state is scoped per chat / run, but the id
 * also addresses process-wide resources (the native `WebContentsView` map and
 * its `persist:browser-<tabId>` partition, a terminal's session), so ids must
 * not repeat across scopes — a timestamp alone can within one millisecond.
 */
export function mintTabId(type: string): string {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Id of the default tab (the one the dock opens on). */
export const defaultTabId = (defaultTabType: string) => `${defaultTabType}-1`;

function sameTabs(a: readonly DockTabRef[], b: readonly DockTabRef[]): boolean {
  return a.length === b.length && a.every((t, i) => t.id === b[i]!.id && t.type === b[i]!.type);
}

/**
 * Sanitises stored (or current) state against the registry:
 * - drops tabs whose type is not registered (or malformed entries);
 * - puts the default tab first (re-inserting `<default>-1` when missing), then
 *   one instance of each pinned type in registry order (minting ids for the
 *   missing ones), then every other tab in its stored order;
 * - fixes a stale `active` (falls back to the first tab).
 * Returns the SAME object when nothing changed, so callers can compare by identity.
 */
export function reconcileDockState(
  raw: Partial<DockStoredState> | null | undefined,
  registry: DockRegistry,
  defaultTabType: string,
  mint: (type: string) => string = mintTabId,
): DockStoredState {
  const stored = raw && Array.isArray(raw.tabs) ? raw.tabs : [];
  const valid = stored.filter(
    (t): t is DockTabRef => !!t && typeof t.id === 'string' && typeof t.type === 'string' && !!registry[t.type],
  );

  const leadTypes = [defaultTabType, ...Object.keys(registry).filter((type) => type !== defaultTabType && registry[type]!.pinned)];
  const lead: DockTabRef[] = [];
  const used = new Set<string>();
  for (const type of leadTypes) {
    if (!registry[type]) continue;
    const existing = valid.find((t) => t.type === type);
    if (existing) {
      lead.push(existing);
      used.add(existing.id);
    } else {
      lead.push({ id: type === defaultTabType ? defaultTabId(type) : mint(type), type });
    }
  }
  const tabs = [...lead, ...valid.filter((t) => !used.has(t.id))];
  if (tabs.length === 0) return { tabs, active: '' };
  const active = typeof raw?.active === 'string' && tabs.some((t) => t.id === raw.active) ? raw.active : tabs[0]!.id;

  if (raw && Array.isArray(raw.tabs) && sameTabs(raw.tabs, tabs) && raw.active === active) {
    return raw as DockStoredState;
  }
  return { tabs, active };
}

/** Reads and reconciles one scope's stored state (unavailable or corrupt storage → defaults). */
export function readDockState(storageKey: string, registry: DockRegistry, defaultTabType: string): DockStoredState {
  let raw: Partial<DockStoredState> | null = null;
  try {
    const text = window.localStorage.getItem(storageKey);
    raw = text ? (JSON.parse(text) as Partial<DockStoredState>) : null;
  } catch {
    raw = null;
  }
  return reconcileDockState(raw, registry, defaultTabType);
}

/** Whether the tab at `id` may be closed: not the default tab, not a pinned type's first instance. */
export function isClosable(state: DockStoredState, id: string, registry: DockRegistry, defaultTabType: string): boolean {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab || tab.type === defaultTabType) return false;
  if (registry[tab.type]?.pinned && state.tabs.find((t) => t.type === tab.type)?.id === id) return false;
  return true;
}

/** Closing a tab selects the previous one when it was active. */
export function closeDockTab(state: DockStoredState, id: string): DockStoredState {
  const idx = state.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  const active = state.active === id ? (state.tabs[idx - 1]?.id ?? tabs[0]?.id ?? state.active) : state.active;
  return { tabs, active };
}

export const countOfType = (state: DockStoredState, type: string) => state.tabs.filter((t) => t.type === type).length;

/** Whether adding one more `type` would pass its cap. */
export function atCap(state: DockStoredState, type: string, registry: DockRegistry): boolean {
  const max = registry[type]?.maxInstances;
  return max !== undefined && countOfType(state, type) >= max;
}

/**
 * The "+" menu's add: a singleton that is open is focused; at the cap the
 * OLDEST instance is focused (never a silent no-op); otherwise a new instance.
 */
export function addDockTab(
  state: DockStoredState,
  type: string,
  registry: DockRegistry,
  mint: (type: string) => string = mintTabId,
): DockStoredState {
  const def = registry[type];
  if (!def) return state;
  const existing = state.tabs.find((t) => t.type === type);
  if (existing && (!def.allowMultiple || atCap(state, type, registry))) return { ...state, active: existing.id };
  const id = mint(type);
  return { tabs: [...state.tabs, { id, type }], active: id };
}

/**
 * A focus request. An explicit `tabId` addresses ONE instance: focus it if
 * open, else add it (or, at the cap, focus the oldest instance). Without one,
 * any open instance of the type is reused — repeated requests (a
 * `session_created` on every reconnect) never stack duplicates.
 */
export function focusDockTab(
  state: DockStoredState,
  request: Pick<DockFocusRequest, 'type' | 'tabId'>,
  registry: DockRegistry,
  mint: (type: string) => string = mintTabId,
): DockStoredState {
  const { type, tabId } = request;
  if (!registry[type]) return state;
  if (tabId) {
    if (state.tabs.some((t) => t.id === tabId)) return { ...state, active: tabId };
    if (atCap(state, type, registry)) {
      const oldest = state.tabs.find((t) => t.type === type);
      return oldest ? { ...state, active: oldest.id } : state;
    }
    return { tabs: [...state.tabs, { id: tabId, type }], active: tabId };
  }
  const existing = state.tabs.find((t) => t.type === type);
  if (existing) return { ...state, active: existing.id };
  const id = mint(type);
  return { tabs: [...state.tabs, { id, type }], active: id };
}

/** Whether a focus request will be refused by the cap (so the refusal can be announced). */
export function focusHitsCap(state: DockStoredState, request: Pick<DockFocusRequest, 'type' | 'tabId'>, registry: DockRegistry): boolean {
  return (
    request.tabId !== undefined &&
    !state.tabs.some((t) => t.id === request.tabId) &&
    atCap(state, request.type, registry)
  );
}

/** 1-based ordinal of each tab among its own type (`Browser 2`). */
export function ordinals(tabs: readonly DockTabRef[]): Map<string, number> {
  const counts: Record<string, number> = {};
  const map = new Map<string, number>();
  for (const t of tabs) {
    counts[t.type] = (counts[t.type] ?? 0) + 1;
    map.set(t.id, counts[t.type]!);
  }
  return map;
}

/** The instance-cap refusal, said out loud (N7). */
export function capNoticeText(label: string, max: number): string {
  return `${max} ${label} tab${max === 1 ? '' : 's'} is the limit — close one to open another.`;
}

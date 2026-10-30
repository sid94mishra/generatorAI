// ────────────────────────────────────────────────────────────────
// Composer tool-toggle registry (03 §1.5 / §3.2; D-35 extension point for the
// Workflow Overhaul).
//
// A per-chat on/off switch for one platform tool set, shown in the composer's
// "Tools in this chat" popover (F-composer-14). The composer never knows the
// entries: owners register them at module load from side-effect-only files in
// `app/registries/`, and the popover renders whatever is registered, in
// `order`, hiding entries whose `available(chat)` is false. With nothing
// available the popover's button is not rendered at all (D-36: no dead
// controls).
//
// ── API (typed; the entry type is the shared contract, so mobile can consume
//    the same ids) ─────────────────────────────────────────────────────────
//
//   import { registerComposerTool } from '@/blocks/composer/toolToggles.js';
//
//   registerComposerTool({
//     id: 'workflows',                       // ComposerToolToggleId (ui-contract)
//     label: 'Workflows',
//     hint: 'Let this chat run workflows · off by default · on for orchestrators',
//     icon: 'workflows',                     // icon concept (D-17)
//     order: 40,                             // popover order, ascending
//     defaultFor: (chat) => !!chat.orchestratorMode,
//     available: (chat) => true,             // hide when the tool cannot apply
//     read: (chat) => /* current value from the chat */,
//     write: (chatId, on) => /* persist; resolve when stored */,
//   });
//
// `register…` returns an unregister function (tests, HMR). Registering an id
// twice replaces the earlier entry. `read` falls back to `defaultFor` when the
// chat stores no value — the owner decides; the registry only calls them.
//
// First entries: none yet. Browser / Computer use / Widgets need per-chat
// platform-tool storage that is honoured mid-conversation; today a chat's
// capability delta is frozen into its agent snapshot at session start, so a
// toggle would not take effect (D-36; 05-gap-matrix "per-chat tool toggles").
// The Workflow Overhaul (P06) registers Workflows here.
// ────────────────────────────────────────────────────────────────

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { Chat } from '@generatorai/shared';
import type { ComposerToolToggle, ComposerToolToggleId } from '@generatorai/shared/ui-contract';
import { toast } from '@/ui/primitives/Toast/Toast.js';

/** The chat shape tool toggles are evaluated against. */
export type ComposerToolChat = Chat;

export type ComposerToolEntry = ComposerToolToggle<ComposerToolChat>;

const entries = new Map<ComposerToolToggleId, ComposerToolEntry>();
const listeners = new Set<() => void>();
let snapshot: readonly ComposerToolEntry[] = [];

function publish(): void {
  snapshot = [...entries.values()].sort((a, b) => a.order - b.order);
  for (const l of listeners) l();
}

/** Add (or replace) a toggle. Returns a function that removes it again. */
export function registerComposerTool(entry: ComposerToolEntry): () => void {
  entries.set(entry.id, entry);
  publish();
  return () => {
    if (entries.get(entry.id) === entry) {
      entries.delete(entry.id);
      publish();
    }
  };
}

/** Every registered toggle, in `order`. */
export function listComposerTools(): readonly ComposerToolEntry[] {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface ComposerToolState {
  entry: ComposerToolEntry;
  on: boolean;
  pending: boolean;
}

/**
 * The toggles that apply to `chat` with their current value, and a setter
 * that persists through the entry's `write` (errors toast, D-30).
 */
export function useComposerTools(chat: ComposerToolChat | undefined): {
  tools: ComposerToolState[];
  setTool: (id: ComposerToolToggleId, on: boolean) => Promise<void>;
} {
  const registered = useSyncExternalStore(subscribe, listComposerTools, listComposerTools);
  const [pending, setPending] = useState<ReadonlySet<ComposerToolToggleId>>(() => new Set());
  const tools = useMemo(() => {
    if (!chat) return [];
    return registered
      .filter((entry) => entry.available(chat))
      .map((entry) => ({ entry, on: entry.read(chat), pending: pending.has(entry.id) }));
  }, [chat, registered, pending]);

  const setTool = useCallback(
    async (id: ComposerToolToggleId, on: boolean) => {
      const entry = entries.get(id);
      if (!chat || !entry) return;
      setPending((prev) => new Set(prev).add(id));
      try {
        await entry.write(chat.id, on);
      } catch (err) {
        toast.error(`Could not turn ${entry.label} ${on ? 'on' : 'off'}`, {
          description: err instanceof Error ? err.message : 'The change was not saved.',
        });
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [chat],
  );

  return { tools, setTool };
}

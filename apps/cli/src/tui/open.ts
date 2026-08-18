// ────────────────────────────────────────────────────────────────
// Opening an entity into a pane.
//
// Pressing Enter on a row has to do three things: work out what kind of pane
// the row deserves, fetch whatever that pane needs beyond the list row, and
// attach the right event stream. Doing that inside each pane component would
// mean nine copies of the same logic and nine chances to attach the wrong
// scope.
// ────────────────────────────────────────────────────────────────

import type { Api, PaneContent, TimelineState } from '@generatorai/cli-core';
import { shortId, timelineFromHistory } from '@generatorai/cli-core';
import { getStore, paneLeaves, type TuiActions } from './store.js';

export interface Opener {
  /** Pane kind the row opens into. */
  kind: PaneContent['kind'];
  /** How to build the pane, including any extra fetch it needs. */
  build(row: Record<string, unknown>, api: Api): Promise<PaneContent>;
  /**
   * Stored history for the pane's timeline.
   *
   * The live stream only carries what happens from now on, so without this
   * every existing conversation opens claiming it has no messages.
   */
  history?(row: Record<string, unknown>, api: Api): Promise<TimelineState | null>;
}

const OPENERS: Partial<Record<PaneContent['kind'], Opener>> = {
  chats: {
    kind: 'chat',
    async build(row, api) {
      const id = String(row['id']);
      const chat = await api.chats.get(id);
      // A chat streams on its SESSION scope when it has one: the chat scope
      // carries lifecycle events, the session scope carries the tokens.
      return {
        kind: 'chat',
        entityId: id,
        title: chat.name || `chat ${shortId(id)}`,
        attachment: chat.sessionId
          ? { scope: 'session', id: chat.sessionId }
          : { scope: 'chat', id },
        state: { model: chat.model, permissionMode: chat.permissionMode },
      };
    },
    async history(row, api) {
      const messages = await api.chats.messages(String(row['id']));
      return timelineFromHistory(Array.isArray(messages) ? messages : []);
    },
  },

  runs: {
    kind: 'run',
    async build(row) {
      const id = String(row['id']);
      return {
        kind: 'run',
        entityId: id,
        title: String(row['name'] ?? `run ${shortId(id)}`),
        attachment: { scope: 'run', id },
        state: { status: row['status'] },
      };
    },
    async history(row, api) {
      // A finished run emits nothing on the stream, so without its stages the
      // pane sits on "Waiting for events…" forever.
      const stages = await api.runs.stages(String(row['id']));
      const items = (Array.isArray(stages) ? stages : []).map((stage, index) => {
        const s = stage as unknown as Record<string, unknown>;
        return {
          id: String(s['id'] ?? `stage-${index}`),
          kind: 'stage' as const,
          text: `${String(s['stageName'] ?? s['name'] ?? 'stage')} — ${String(s['status'] ?? '')}`,
          complete: true,
          at: Date.parse(String(s['createdAt'] ?? '')) || Date.now(),
          stageName: String(s['stageName'] ?? s['name'] ?? ''),
        };
      });
      return { ...timelineFromHistory([]), items, runStatus: String(row['status'] ?? '') };
    },
  },

  workflows: {
    kind: 'workflow',
    async build(row, api) {
      const id = String(row['id']);
      const full = (await api.definitions.get(id)) as unknown as {
        name?: string;
        stages?: Array<{ id: string; name: string }>;
        edges?: Array<{ fromStageId: string; toStageId: string; edgeType?: string }>;
      };
      return {
        kind: 'workflow',
        entityId: id,
        title: full.name ?? String(row['name'] ?? shortId(id)),
        state: { stages: full.stages ?? [], edges: full.edges ?? [] },
      };
    },
  },

  automations: {
    kind: 'automation',
    async build(row, api) {
      const id = String(row['id']);
      const detail = await api.automations.get(id);
      return {
        kind: 'inspector',
        entityId: id,
        title: String(row['name'] ?? `automation ${shortId(id)}`),
        state: detail as Record<string, unknown>,
      };
    },
  },

  projects: {
    kind: 'project',
    async build(row, api) {
      const id = String(row['id']);
      const [project, codebases] = await Promise.all([
        api.projects.get(id),
        api.projects.codebases.list(id).catch(() => []),
      ]);
      return {
        kind: 'inspector',
        entityId: id,
        title: String(row['name'] ?? `project ${shortId(id)}`),
        state: { ...(project as unknown as Record<string, unknown>), codebases },
      };
    },
  },

  workspaces: {
    kind: 'changes',
    async build(row, api) {
      const id = String(row['id']);
      const changes = await api.workspaces.changes(id).catch(() => [] as unknown);
      const files = Array.isArray(changes)
        ? (changes as Array<Record<string, unknown>>)
        : ((changes as { files?: Array<Record<string, unknown>> }).files ?? []);
      return {
        kind: 'changes',
        entityId: id,
        title: `changes ${shortId(id)}`,
        state: { files },
      };
    },
  },

  agents: {
    kind: 'agent',
    async build(row) {
      return {
        kind: 'inspector',
        entityId: String(row['id']),
        title: String(row['name'] ?? 'agent'),
        state: row,
      };
    },
  },

  scripts: {
    kind: 'script',
    async build(row, api) {
      const id = String(row['id']);
      const [script, profiles] = await Promise.all([
        api.scripts.get(id),
        api.scripts.profiles(id).catch(() => []),
      ]);
      return {
        kind: 'inspector',
        entityId: id,
        title: String(row['name'] ?? `script ${shortId(id)}`),
        state: { ...(script as unknown as Record<string, unknown>), profiles },
      };
    },
  },

  extensions: {
    kind: 'extension',
    async build(row, api) {
      const id = String(row['id']);
      const detail = await api.extensions.get(id).catch(() => row);
      return {
        kind: 'inspector',
        entityId: id,
        title: String(row['name'] ?? `extension ${shortId(id)}`),
        state: detail as Record<string, unknown>,
      };
    },
  },
};

export function openerFor(kind: PaneContent['kind']): Opener | undefined {
  return OPENERS[kind];
}

export interface OpenEntityOptions {
  opener: Opener;
  row: Record<string, unknown>;
  api: Api;
  open(content: PaneContent, mode?: 'tab' | 'split-v' | 'split-h' | 'replace'): void;
  actions: TuiActions;
}

/**
 * Opens a row, showing a placeholder immediately.
 *
 * The pane appears before its detail request resolves. Waiting for the fetch
 * makes Enter feel broken on a slow link — the user presses it again, and the
 * second press opens a second tab.
 */
export async function openEntity(options: OpenEntityOptions): Promise<void> {
  const { opener, row, api, open, actions } = options;
  const id = String(row['id'] ?? '');

  open(
    {
      kind: opener.kind,
      entityId: id,
      title: String(row['name'] ?? shortId(id)),
    },
    'tab',
  );

  try {
    const content = await opener.build(row, api);
    // `replace` targets the pane just opened, which is the focused one.
    open(content, 'replace');

    if (opener.history) {
      // Resolved after the pane exists so its id is known, and awaited
      // separately so a slow history fetch never delays the pane itself.
      const paneId = focusedPaneId();
      void opener
        .history(row, api)
        .then((timeline) => {
          if (timeline && paneId) actions.seedTimeline(paneId, timeline);
        })
        .catch(() => {
          // History is an enhancement; the live stream still works without it.
        });
    }
  } catch (error) {
    actions.toast(
      `Could not open: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}

function focusedPaneId(): string | null {
  try {
    const state = getStore().getState();
    const tab = state.workbench.tabs.find((t) => t.id === state.workbench.activeTabId);
    return tab?.focusedPaneId ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetches history for panes that came back from a saved layout.
 *
 * Restoring rebuilds the pane tree but runs none of the openers, so a
 * reopened chat sits on "No messages yet" for the whole session — the exact
 * failure `openEntity` fetches history to avoid.
 */
export async function rehydrateRestoredPanes(api: Api, actions: TuiActions): Promise<void> {
  const state = getStore().getState();
  const panes = state.workbench.tabs.flatMap((tab) => paneLeaves(tab.root));

  await Promise.all(
    panes.map(async (pane) => {
      const entityId = pane.content.entityId;
      if (!entityId) return;
      if ((state.timelines[pane.id]?.items.length ?? 0) > 0) return;

      const opener = Object.values(OPENERS).find((o) => o.kind === pane.content.kind);
      if (!opener?.history) return;

      try {
        const timeline = await opener.history({ id: entityId }, api);
        if (timeline) actions.seedTimeline(pane.id, timeline);
      } catch {
        // History is an enhancement; the live stream still works without it.
      }
    }),
  );
}

// ────────────────────────────────────────────────────────────────
// Opening an entity into a pane.
//
// Pressing Enter on a row has to do three things: work out what kind of pane
// the row deserves, fetch whatever that pane needs beyond the list row, and
// attach the right event stream. Doing that inside each pane component would
// mean nine copies of the same logic and nine chances to attach the wrong
// scope.
// ────────────────────────────────────────────────────────────────

import type { Api, PaneContent, TimelineState, WorkbenchState } from '@generatorai/cli-core';
import { epochOr, shortId, timelineFromHistory } from '@generatorai/cli-core';
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
      return workflowPaneContent(id, String(row['name'] ?? shortId(id)), api);
    },
  },

  automations: {
    kind: 'automation',
    // Phase 6 item 6 — previously `kind: 'inspector'`, a static JSON dump
    // with no live stream and no way to reach the workflow runs an
    // execution actually spawned.
    async build(row, api) {
      const id = String(row['id']);
      const [automation, executions] = await Promise.all([
        api.automations.get(id),
        api.automations.executions(id).catch(() => []),
      ]);
      const list = (Array.isArray(executions) ? executions : []) as unknown as Array<Record<string, unknown>>;
      // Newest first — matches every other entity list in this app and
      // puts whatever is currently running at the top, not buried under
      // however many historical executions exist.
      const createdAt = (row: Record<string, unknown>): string | number | undefined => {
        const value = row['createdAt'];
        return typeof value === 'string' || typeof value === 'number' ? value : undefined;
      };
      const sorted = [...list].sort((a, b) => epochOr(createdAt(b)) - epochOr(createdAt(a)));
      // No automation-WIDE stream scope exists server-side — the real
      // bridge (`apps/server/src/composition-root.ts`) republishes
      // `automation_execution.*` per EXECUTION (`scope:'automation',
      // id:<executionId>`). Attaching to whichever execution is still
      // running/pending, if any, is the closest this pane can get to "a
      // real live view" without a live subscription per row.
      const live = sorted.find((e) => e['status'] === 'running' || e['status'] === 'pending');
      return {
        kind: 'automation',
        entityId: id,
        title: String(row['name'] ?? `automation ${shortId(id)}`),
        ...(live ? { attachment: { scope: 'automation' as const, id: String(live['id']) } } : {}),
        state: { automation: automation as Record<string, unknown>, executions: sorted, selectedExecutionIndex: 0 },
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
      // The real response (`ChangeSummary`, `client.ts:423-428`) is
      // `{workspaceId, hasGit, repos: ChangeRepoEntry[], stats}` — never a
      // bare array, and never a top-level `files`. Every file lives one
      // level down, grouped by repo (worktree alias); `ChangesPane` wants a
      // flat list, so flatten the same way `workspace.changes`'s own CLI
      // handler already does (`workspace.ts:263-269`). Without this, every
      // workspace pane opened from the TUI showed "No changes" regardless
      // of the workspace's actual state.
      const changes = await api.workspaces.changes(id).catch(() => null);
      const files =
        changes?.repos.flatMap((repo) => repo.files.map((file) => ({ alias: repo.alias, ...file }))) ?? [];
      return {
        kind: 'changes',
        entityId: id,
        title: `changes ${shortId(id)}`,
        // Phase 7 item 2 — the `'workspace'` stream scope makes this pane
        // live rather than a one-shot snapshot: `workspace.changed` and
        // `checkpoint.restored` bump the timeline's `workspaceRevision`,
        // which `App.tsx` watches to refetch the file list. Before the scope
        // existed there was nothing to attach to and the list went stale the
        // moment the agent wrote a file.
        attachment: { scope: 'workspace', id },
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

/**
 * The workflow-authoring pane's content (Phase 7 items 4/5/6).
 *
 * Exported and shared with `App.tsx` because every authoring action ends the
 * same way — the definition on the server has changed, so the pane must be
 * rebuilt from it. Rebuilding through one function keeps the initial open and
 * every subsequent reload structurally identical; two copies would drift the
 * moment one of them gained a field.
 *
 * `selectedStageId` is preserved across a reload when the stage still exists:
 * a cursor that jumps back to the first stage after every edit makes editing
 * three stages in a row unusable.
 */
export async function workflowPaneContent(
  id: string,
  fallbackTitle: string,
  api: Api,
  keepStageId?: string,
): Promise<PaneContent> {
  const full = (await api.definitions.get(id)) as unknown as {
    name?: string;
    variables?: Record<string, unknown>;
    stages?: Array<{ id: string; name: string }>;
    edges?: Array<{ id?: string; fromStageId: string; toStageId: string; edgeType?: string }>;
  };
  const stages = full.stages ?? [];
  const selectedStageId =
    keepStageId && stages.some((stage) => stage.id === keepStageId)
      ? keepStageId
      : (stages[0]?.id ?? null);

  return {
    kind: 'workflow',
    entityId: id,
    title: full.name ?? fallbackTitle,
    state: {
      stages,
      edges: full.edges ?? [],
      variables: full.variables ?? {},
      selectedStageId,
    },
  };
}

export interface OpenEntityOptions {
  opener: Opener;
  row: Record<string, unknown>;
  api: Api;
  open(
    content: PaneContent,
    mode?: 'tab' | 'split-v' | 'split-h' | 'replace',
    targetPaneId?: string,
  ): string;
  actions: TuiActions;
}

/**
 * Opens a row, showing a placeholder immediately.
 *
 * The pane appears before its detail request resolves. Waiting for the fetch
 * makes Enter feel broken on a slow link — the user presses it again, and the
 * second press opens a second tab.
 *
 * The pane id `open()` returns for the placeholder is the stable handle used
 * for everything that follows — NOT "whatever pane is focused when the async
 * work resolves". Before this fix, `'replace'` re-resolved the current focus
 * at that later point, so a second Enter-press opening a second placeholder
 * tab (or any other focus change) while the first request's `build()` was
 * still in flight made the first request's content land on the WRONG pane —
 * whichever one happened to be focused when it resolved, not its own.
 */
/**
 * The pane already showing this entity, if one is open (open question #1).
 *
 * Matched on `(kind, entityId)` — the same entity opened as a DIFFERENT kind
 * of pane is a different view of it and should genuinely coexist (a
 * workspace has both a `changes` pane and a `workspace` file-tree pane, and
 * opening one must not steal the other's tab).
 *
 * Exported so the behaviour is testable without mounting the shell.
 */
export function findOpenPane(
  workbench: WorkbenchState,
  kind: PaneContent['kind'],
  entityId: string,
): string | null {
  if (!entityId) return null;
  for (const tab of workbench.tabs) {
    for (const leaf of paneLeaves(tab.root)) {
      if (leaf.content.kind === kind && leaf.content.entityId === entityId) return leaf.id;
    }
  }
  return null;
}

export async function openEntity(options: OpenEntityOptions): Promise<void> {
  const { opener, row, api, open, actions } = options;
  const id = String(row['id'] ?? '');

  const paneId = open(
    {
      kind: opener.kind,
      entityId: id,
      title: String(row['name'] ?? shortId(id)),
    },
    'tab',
  );

  try {
    const content = await opener.build(row, api);
    open(content, 'replace', paneId);

    if (opener.history) {
      // Awaited separately so a slow history fetch never delays the pane
      // itself — `paneId` is already known, no post-hoc lookup needed.
      void opener
        .history(row, api)
        .then((timeline) => {
          if (timeline) actions.seedTimeline(paneId, timeline);
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

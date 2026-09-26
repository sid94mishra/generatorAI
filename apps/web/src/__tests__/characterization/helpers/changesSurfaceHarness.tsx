// ────────────────────────────────────────────────────────────────
// ChangesSurface characterization harness (09-verification.md §5.3).
//
// Shared by every `ChangesSurface.*.characterization.test.tsx`. Holds:
//   • `cs` — one mutable data-layer state object the hook mocks read from,
//     so a test sets `cs.summary = …` and (re)renders;
//   • the mock factories for `@/hooks/queries`, `@/hooks/sourceQueries`,
//     `@/hooks/reviewQueries` and `@/lib/desktop` (platform detection);
//   • the `DiffCodeView` stub 09 §5.3 allows: a plain list of rows that calls
//     the real `renderHeader` for each source, so every per-file control
//     (Keep, Undo, Open in editor …) is the production markup;
//   • fixture builders for summaries, mounts, checkpoints and threads.
//
// The test files wire these with `vi.mock(path, () => import(helper).then…)`,
// so `vi.mock` stays in the test file (where Vitest hoists it) while the
// bodies live here once. This module must therefore NEVER import app code
// that reaches a mocked module (providers, hooks …): the mock factory awaits
// this module, so such an import deadlocks the run. Rendering lives in
// ./changesSurfaceRender.tsx for that reason.
// ────────────────────────────────────────────────────────────────

import { useImperativeHandle, type ReactNode, type Ref } from 'react';
import { vi } from 'vitest';
import type {
  ChangeSummary,
  ChangeSummaryFile,
  ChangeSummaryRepo,
  CheckpointRecord,
  DiscardChangesResult,
} from '@/types/changes.js';
import type { ReviewThread } from '@/types/review.js';

// ── Mutable data-layer state ───────────────────────────────────

export interface MutationMock {
  mutateAsync: ReturnType<typeof vi.fn>;
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
}

function mutation(): MutationMock {
  return { mutateAsync: vi.fn().mockResolvedValue({}), mutate: vi.fn(), isPending: false };
}

export interface MountFixture {
  alias: string;
  path: string;
  status?: string;
  git?: { baseCommit?: string; baseRef?: string; branch?: string };
}

export interface ChangesSurfaceState {
  summary: ChangeSummary | undefined;
  summaryLoading: boolean;
  summaryRefetch: ReturnType<typeof vi.fn>;
  mounts: MountFixture[];
  checkpoints: CheckpointRecord[];
  editors: Array<{ id: string; available: boolean }>;
  isDesktop: boolean;
  threads: ReviewThread[];
  discard: MutationMock;
  review: MutationMock;
  openInEditor: MutationMock;
  restore: MutationMock;
  createThread: MutationMock;
  submitReview: MutationMock;
  deleteThread: MutationMock;
  /** Every `scrollToItem(id)` the surface asked the (stubbed) viewer for. */
  scrolledTo: string[];
  /** Width the ResizeObserver stub reports for the surface root (null = never fires). */
  observedWidth: number | null;
  /** When set, per-file body fetches wait for this promise (lazy-load timing). */
  fileGate: Promise<unknown> | null;
}

export const cs: ChangesSurfaceState = {} as ChangesSurfaceState;

export function resetChangesSurfaceState(): void {
  Object.assign(cs, {
    summary: undefined,
    summaryLoading: false,
    summaryRefetch: vi.fn(),
    mounts: [],
    checkpoints: [],
    editors: [],
    isDesktop: false,
    threads: [],
    discard: mutation(),
    review: mutation(),
    openInEditor: mutation(),
    restore: mutation(),
    createThread: mutation(),
    submitReview: mutation(),
    deleteThread: mutation(),
    scrolledTo: [],
    observedWidth: null,
    fileGate: null,
  } satisfies ChangesSurfaceState);
  cs.discard.mutateAsync.mockResolvedValue(discardOk());
  cs.createThread.mutateAsync.mockResolvedValue({ id: 'thread-new' });
  cs.submitReview.mutateAsync.mockResolvedValue({ prompt: 'PROMPT', delivered: true });
}
resetChangesSurfaceState();

// ── Hook mocks (data layer) ────────────────────────────────────

/** Spy on the summary hook so tests can read the `{ base, head }` it was called with. */
export const useWorkspaceChangeSummaryMock = vi.fn(
  (_workspaceId: string | undefined, _opts?: { base?: string; head?: string }) => ({
    data: cs.summary,
    isLoading: cs.summaryLoading,
    isRefetching: false,
    refetch: cs.summaryRefetch,
  }),
);

export function queriesMock(original: Record<string, unknown>): Record<string, unknown> {
  return {
    ...original,
    useWorkspaceChangeSummary: (
      workspaceId: string | undefined,
      opts?: { base?: string; head?: string },
    ) => useWorkspaceChangeSummaryMock(workspaceId, opts),
    useWorkspaceCheckpoints: () => ({
      data: { checkpoints: cs.checkpoints },
      isLoading: false,
    }),
    useDiscardWorkspaceChanges: () => cs.discard,
    useReviewWorkspaceChanges: () => cs.review,
    useEditors: () => ({ data: cs.editors }),
    useOpenInEditor: () => cs.openInEditor,
    useRestoreWorkspaceCheckpoint: () => cs.restore,
    // Source control (SourceControlPanel): no repos → it renders nothing.
    useWorkspaceReadiness: () => ({ data: { workspaceId: 'ws-1', repos: [] }, isLoading: false }),
    useRunScmFlow: () => mutation(),
    useGenerateScmText: () => mutation(),
    useScmConflictAction: () => mutation(),
  };
}

export function sourceQueriesMock(original: Record<string, unknown>): Record<string, unknown> {
  return {
    ...original,
    useWorkspaceInfo: () => ({
      data: { id: 'ws-1', mounts: cs.mounts },
      isLoading: false,
    }),
  };
}

export function reviewQueriesMock(original: Record<string, unknown>): Record<string, unknown> {
  return {
    ...original,
    useReviewThreads: () => ({ data: { threads: cs.threads }, isLoading: false }),
    useCreateReviewThread: () => cs.createThread,
    useAddReviewComment: () => mutation(),
    useUpdateReviewComment: () => mutation(),
    useUpdateReviewThreadStatus: () => mutation(),
    useDeleteReviewThread: () => cs.deleteThread,
    useSubmitReview: () => cs.submitReview,
  };
}

/** Platform detection: `isDesktop` is read live from `cs`. */
export function desktopMock(original: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...original };
  Object.defineProperty(out, 'isDesktop', { get: () => cs.isDesktop, enumerable: true });
  return out;
}

// ── DiffCodeView stub (allowed by 09 §5.3) ─────────────────────

interface StubSource {
  id: string;
  alias: string;
  path: string;
  collapsed?: boolean;
  newContents?: string | null;
  annotations?: Array<{ metadata: Record<string, unknown>; side: string; lineNumber: number }>;
}

interface StubProps {
  sources: StubSource[];
  ref?: Ref<{ clearSelection(): void; scrollToItem(id: string): void }>;
  viewMode?: string;
  wrapLines?: boolean;
  renderHeader?: (item: { id: string; path: string; alias: string }) => ReactNode;
  renderAnnotation?: (a: unknown, item: { id: string; path: string; alias: string }) => ReactNode;
  onSelectRange?: (
    id: string,
    range: { start: number; end: number; side: 'additions' | 'deletions' },
    anchor: { x: number; y: number } | null,
  ) => void;
  emptyState?: ReactNode;
}

/**
 * A list of rows: one `diff-row` per source, the real header, and — when the
 * source is expanded — a `diff-body` marker. `ref` is honoured only by the
 * main viewer (the kept viewer gets none), which is exactly how the surface
 * wires them.
 */
export function DiffCodeViewStub({
  sources,
  ref,
  viewMode,
  wrapLines,
  renderHeader,
  renderAnnotation,
  onSelectRange,
  emptyState,
}: StubProps) {
  const instance = ref ? 'main' : 'kept';
  useImperativeHandle(
    ref,
    () => ({
      clearSelection() {},
      scrollToItem(id: string) {
        cs.scrolledTo.push(id);
      },
    }),
    [],
  );
  if (sources.length === 0) return <>{emptyState ?? null}</>;
  return (
    <div
      data-testid={`diff-viewer-${instance}`}
      data-view-mode={viewMode}
      data-wrap-lines={String(!!wrapLines)}
    >
      {sources.map((s) => (
        <div key={s.id} data-testid="diff-row" data-id={s.id} data-collapsed={String(!!s.collapsed)}>
          {renderHeader?.({ id: s.id, path: s.path, alias: s.alias })}
          {!s.collapsed && <div data-testid="diff-body">{s.newContents ?? ''}</div>}
          {onSelectRange && (
            <button
              type="button"
              onClick={() => onSelectRange(s.id, { start: 1, end: 2, side: 'additions' }, { x: 10, y: 10 })}
            >
              {`stub-select ${s.id}`}
            </button>
          )}
          {s.annotations?.map((a, i) => (
            <div key={i} data-testid="diff-annotation">
              {renderAnnotation?.(a, { id: s.id, path: s.path, alias: s.alias })}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── ResizeObserver stub (the surface-width measurement) ────────

/**
 * The surface measures ITSELF with a ResizeObserver
 * (ChangesSurface.tsx:254-263). This stub reports `cs.observedWidth` for
 * that element as soon as it is observed.
 */
export function installResizeObserverStub(): () => void {
  const original = globalThis.ResizeObserver;
  class StubResizeObserver {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(el: Element): void {
      // Only the surface's own root (it contains the header count); Radix
      // popovers observe their triggers too and must keep the no-op.
      if (cs.observedWidth == null || !el.querySelector('[data-testid="changes-count"]')) return;
      const entry = { target: el, contentRect: { width: cs.observedWidth } } as unknown as ResizeObserverEntry;
      this.cb([entry], this as unknown as ResizeObserver);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
  return () => {
    globalThis.ResizeObserver = original;
  };
}

/**
 * happy-dom has no `Worker`. The real `DiffProviders` (kept, not mocked)
 * builds @pierre/diffs' highlight worker pool on mount; with the viewer
 * stubbed nothing is ever posted to it, so an inert Worker is enough. An
 * environment shim, like the ResizeObserver one in vitest.setup.ts.
 */
export function installWorkerStub(): () => void {
  const g = globalThis as { Worker?: unknown };
  const original = g.Worker;
  class InertWorker {
    onmessage: unknown = null;
    onerror: unknown = null;
    postMessage(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
    terminate(): void {}
  }
  g.Worker = InertWorker;
  return () => {
    g.Worker = original;
  };
}

// ── Fixtures ───────────────────────────────────────────────────

export function file(path: string, overrides: Partial<ChangeSummaryFile> = {}): ChangeSummaryFile {
  return {
    path,
    status: 'modified',
    additions: 3,
    deletions: 1,
    isBinary: false,
    isTooLarge: false,
    oldBlob: `old-${path}`,
    newBlob: `new-${path}`,
    ...overrides,
  };
}

export function repo(
  alias: string,
  files: ChangeSummaryFile[],
  overrides: Partial<ChangeSummaryRepo> = {},
): ChangeSummaryRepo {
  return {
    alias,
    kind: 'mount',
    hasBaseline: true,
    base: { kind: 'checkpoint', id: `cp-base-${alias}`, treeish: `tree-${alias}` },
    head: { kind: 'working', id: `cp-head-${alias}` },
    stats: {
      files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
    },
    files,
    ...overrides,
  };
}

export function summaryOf(repos: ChangeSummaryRepo[]): ChangeSummary {
  return {
    workspaceId: 'ws-1',
    hasGit: true,
    base: repos[0]?.base ?? { kind: 'baseline', id: 'cp-base' },
    head: repos[0]?.head ?? { kind: 'working', id: 'cp-head' },
    repos,
    stats: {
      files: repos.reduce((n, r) => n + r.stats.files, 0),
      additions: repos.reduce((n, r) => n + r.stats.additions, 0),
      deletions: repos.reduce((n, r) => n + r.stats.deletions, 0),
    },
  };
}

export function mount(alias: string, overrides: Partial<MountFixture> = {}): MountFixture {
  return { alias, path: `/work/${alias}`, status: 'ready', ...overrides };
}

export function checkpoint(id: string, overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    id,
    workspaceId: 'ws-1',
    repoAlias: 'app',
    seq: 1,
    kind: 'turn',
    label: `Turn ${id}`,
    refKind: 'git_tree',
    refValue: `ref-${id}`,
    treeSha: `sha-${id}`,
    fileCount: 1,
    additions: 1,
    deletions: 0,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

export function thread(id: string, overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id,
    workspaceId: 'ws-1',
    scope: 'chat',
    scopeId: 'chat-1',
    repoAlias: 'app',
    path: 'src/a.ts',
    baseCheckpointId: 'cp-base',
    headCheckpointId: 'cp-head',
    side: 'additions',
    startLine: 1,
    endLine: 1,
    anchorText: 'x',
    anchorHash: 'h',
    status: 'pending',
    reviewRound: 1,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    comments: [],
    ...overrides,
  } as ReviewThread;
}

export function discardOk(overrides: Partial<DiscardChangesResult> = {}): DiscardChangesResult {
  return {
    workspaceId: 'ws-1',
    mounts: [{ alias: 'app', ok: true, restored: 1, deleted: 0 }],
    restoredCount: 1,
    deletedCount: 0,
    discardedCount: 1,
    skipped: [],
    ...overrides,
  };
}

/** Platform stub for the lazy per-file body fetch (`useDiffSources` → `getWorkspaceChangeFile`). */
export function makeChangesPlatform() {
  return {
    getWorkspaceChangeFile: vi.fn(async (_ws: string, path: string) => {
      if (cs.fileGate) await cs.fileGate;
      return {
        path,
        alias: 'app',
        old: { name: path, contents: `old ${path}\n` },
        new: { name: path, contents: `new ${path}\n` },
        isBinary: false,
        isTooLarge: false,
        cacheKey: `k-${path}`,
      };
    }),
  };
}

/** A promise whose settlement the test controls. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** DOM APIs Radix Select/Popover touch that happy-dom lacks (as in ui/Select.test.tsx). */
export function installDomShims(): void {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto['hasPointerCapture'] !== 'function') {
    proto['hasPointerCapture'] = () => false;
    proto['setPointerCapture'] = () => {};
    proto['releasePointerCapture'] = () => {};
  }
}

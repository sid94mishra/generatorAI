// ────────────────────────────────────────────────────────────────
// chatPageFakes — the data layer ChatPage characterization tests drive.
//
// ChatPage (09 §5.4, 03 §6.4) is mounted for real. Only the data layer is
// faked, and every fake here is a controllable, React-aware store so a test
// can change "what the server said" mid-test and watch the page react:
//
//   - `@/hooks/queries`        useChat / useChatMessages / usePendingInteractions /
//                              useBackgroundTasks / useHarnessConfig + mutations
//   - `@/hooks/sourceQueries`  useWorkspaceInfo / usePrepareChatWorkspace
//   - `@/hooks/harnessQueries` model catalog (undefined = "not conclusive")
//   - `@/hooks/composerQueries` computer-use flag, slash commands, @-file index
//   - `@/stores/sseManager`    connectChatSession (spy; no network)
//   - `@/platform/muxStream`   openMultiplexedStream as a fake emitter
//   - `fetch`                  the browser descriptor probe (+ 404 for the rest)
//
// Every other hook in those modules stays REAL (spread from the original
// module) and talks to `MockPlatformClient` through the provider tree.
// `useStreamStore` is always the real store, driven through its actions.
//
// This file must NOT import any app module (not even transitively): the
// vi.mock factories import it, and a factory that pulls in the module it is
// mocking (PlatformProvider → HttpPlatformClient → muxStream, …) deadlocks.
// The render half lives in `renderChatPage.tsx` for that reason.
// ────────────────────────────────────────────────────────────────

import { useSyncExternalStore } from 'react';
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { Chat, ChatMessage } from '@generatorai/shared';

// ── Controllable data store ─────────────────────────────────────

export interface ChatQueryState {
  data: Chat | undefined;
  isLoading: boolean;
  error: Error | null;
}

export interface PendingGate {
  interactionId: string;
  kind: string;
  status: string;
}

export interface FakeData {
  /** Chat records by id. Missing id → `{ data: undefined, isLoading: false }`. */
  chats: Record<string, ChatQueryState>;
  /** Full message history per chat; `useChatMessages` returns the LAST `limit`. */
  messages: Record<string, ChatMessage[]>;
  messagesLoading: boolean;
  pendingInteractions: PendingGate[] | undefined;
  pendingFetchedAt: number;
  backgroundTasks: Array<{ taskId: string; taskName: string; status: string; reviewRounds: number }>;
  computerUseEnabled: boolean;
  /** `GET /api/workspaces/:id/browser/descriptor` body; `null` → 404. */
  browserDescriptor: unknown;
}

function initialData(): FakeData {
  return {
    chats: {},
    messages: {},
    messagesLoading: false,
    pendingInteractions: [],
    pendingFetchedAt: 0,
    backgroundTasks: [],
    computerUseEnabled: false,
    browserDescriptor: null,
  };
}

let data: FakeData = initialData();
let version = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function useVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** Read the fake server state. */
export function fakeData(): FakeData {
  return data;
}

/** Change the fake server state and re-render every consumer (inside `act`). */
export function setFakeData(patch: Partial<FakeData> | ((d: FakeData) => Partial<FakeData>)): void {
  const next = typeof patch === 'function' ? patch(data) : patch;
  act(() => {
    data = { ...data, ...next };
    version += 1;
    for (const l of listeners) l();
  });
}

// ── Mutations (stable spies) ────────────────────────────────────

function makeMutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(async () => undefined),
    isPending: false,
    reset: vi.fn(),
  };
}

export const mutations = {
  sendChatPrompt: makeMutation(),
  updateChat: makeMutation(),
  cancelChat: makeMutation(),
  decidePlan: makeMutation(),
  answerQuestion: makeMutation(),
  answerPermission: makeMutation(),
  prepareWorkspace: makeMutation(),
};

// ── Hook spies (so tests can assert call arguments) ─────────────

export const hookCalls = {
  useChatMessages: vi.fn<(chatId: string | undefined, limit: number) => void>(),
  usePendingInteractions: vi.fn<(chatId: string | undefined, enabled: boolean) => void>(),
  useBackgroundTasks: vi.fn<(chatId: string | undefined, enabled: boolean) => void>(),
};

// ── Fake modules (spread over the real ones by the vi.mock factories) ──

// React Query hands out referentially stable results and ChatPage's memos and
// effects rely on that (a fresh array every render loops the composer), so
// each fake result is cached against the exact inputs it was built from.
const memo = new Map<string, { deps: unknown[]; value: unknown }>();
function stable<V>(key: string, deps: unknown[], make: () => V): V {
  const hit = memo.get(key);
  if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => d === deps[i])) return hit.value as V;
  const value = make();
  memo.set(key, { deps, value });
  return value;
}

const EMPTY_QUERY = { data: undefined, isLoading: false, error: null };
const EMPTY_CATALOG = { data: undefined, isLoading: false, isError: false, error: null };
const NO_WORKSPACE_INFO = { data: undefined, isLoading: false };
const NO_FILES = { files: [], isLoading: false };
const NO_COMMANDS: never[] = [];

export function fakeQueriesModule<T extends object>(original: T): T {
  return {
    ...original,
    useChat: (chatId: string | undefined) => {
      useVersion();
      if (!chatId) return EMPTY_QUERY;
      return data.chats[chatId] ?? EMPTY_QUERY;
    },
    useChatMessages: (chatId: string | undefined, limit = 100) => {
      useVersion();
      hookCalls.useChatMessages(chatId, limit);
      const all = chatId ? data.messages[chatId] : undefined;
      return stable(`messages:${chatId}:${limit}`, [all, data.messagesLoading], () => ({
        data: data.messagesLoading ? undefined : (all ?? []).slice(Math.max(0, (all ?? []).length - limit)),
        isLoading: data.messagesLoading,
      }));
    },
    usePendingInteractions: (chatId: string | undefined, enabled = true) => {
      useVersion();
      hookCalls.usePendingInteractions(chatId, enabled);
      return stable(`pending:${chatId}`, [enabled, data.pendingInteractions, data.pendingFetchedAt], () =>
        enabled
          ? { data: data.pendingInteractions, dataUpdatedAt: data.pendingFetchedAt }
          : { data: undefined, dataUpdatedAt: 0 },
      );
    },
    useBackgroundTasks: (chatId: string | undefined, enabled = true) => {
      useVersion();
      hookCalls.useBackgroundTasks(chatId, enabled);
      return stable(`bg:${chatId}`, [enabled, data.backgroundTasks], () => ({
        data: enabled && chatId ? { tasks: data.backgroundTasks } : undefined,
        isLoading: false,
      }));
    },
    useHarnessConfig: () => EMPTY_QUERY,
    useSendChatPrompt: () => mutations.sendChatPrompt,
    useUpdateChat: () => mutations.updateChat,
    useCancelChat: () => mutations.cancelChat,
    useDecidePlan: () => mutations.decidePlan,
    useAnswerQuestion: () => mutations.answerQuestion,
    useAnswerPermission: () => mutations.answerPermission,
  } as T;
}

export function fakeSourceQueriesModule<T extends object>(original: T): T {
  return {
    ...original,
    useWorkspaceInfo: () => NO_WORKSPACE_INFO,
    usePrepareChatWorkspace: () => mutations.prepareWorkspace,
  } as T;
}

export function fakeHarnessQueriesModule<T extends object>(original: T): T {
  // An undefined catalog is "not conclusive": the composer keeps the chat's
  // model instead of substituting one (and persisting it through updateChat).
  return {
    ...original,
    useModels: () => EMPTY_CATALOG,
    useHarnessProviders: () => EMPTY_CATALOG,
    useModelPickerCatalog: () => EMPTY_CATALOG,
  } as T;
}

export function fakeComposerQueriesModule<T extends object>(original: T): T {
  return {
    ...original,
    useComputerUseSettings: () => {
      useVersion();
      return stable('computer-use', [data.computerUseEnabled], () => ({
        data: { enabled: data.computerUseEnabled },
        isLoading: false,
      }));
    },
    useSlashCommands: () => NO_COMMANDS,
    useWorkspaceFileIndex: () => NO_FILES,
  } as T;
}

// ── SSE / mux fakes ─────────────────────────────────────────────

export const connectChatSessionSpy = vi.fn<(chatId: string, sessionId: string, platform: unknown) => () => void>(
  () => () => undefined,
);

interface MuxSubscription {
  scope: string;
  id: string;
  handlers: { onMessage?: (e: { lastEventId: string; data: string }) => void };
  filter: readonly string[] | undefined;
  closed: boolean;
}

export const muxSubscriptions: MuxSubscription[] = [];

export function fakeMuxStreamModule<T extends object>(original: T): T {
  return {
    ...original,
    openMultiplexedStream: (
      scope: string,
      id: string,
      handlers: MuxSubscription['handlers'],
      filter?: readonly string[],
    ) => {
      const sub: MuxSubscription = { scope, id, handlers, filter, closed: false };
      muxSubscriptions.push(sub);
      return {
        close: () => {
          sub.closed = true;
        },
      };
    },
  } as T;
}

/** Push one frame to every OPEN subscriber of `<scope>:<id>` (e.g. `browser:ws-1`). */
export function emitMux(channel: string, payload: { kind: string; [k: string]: unknown }): void {
  act(() => {
    for (const sub of muxSubscriptions) {
      if (sub.closed || `${sub.id}` !== channel) continue;
      sub.handlers.onMessage?.({ lastEventId: '1', data: JSON.stringify(payload) });
    }
  });
}

// ── fetch ───────────────────────────────────────────────────────

export const fetchSpy = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/\/browser\/descriptor$/.test(url) && data.browserDescriptor != null) {
    return new Response(JSON.stringify(data.browserDescriptor), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({ error: 'not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
});

// ── WebSocket ───────────────────────────────────────────────────
// The browser screencast and the terminal open sockets of their own; a socket
// that never connects keeps them in their "connecting" state without network.

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  binaryType = 'blob';
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
}

// ── Layout metrics ──────────────────────────────────────────────
// happy-dom lays nothing out: every scroll metric is 0 and a scrollTop write
// is a no-op. These stubs give elements a fixed scroll geometry and record
// every scrollTop write, so "stick to bottom" and "jump to latest" become
// observable. `restore()` must run in afterEach.

type MetricKey = 'scrollTop' | 'scrollHeight' | 'clientHeight' | 'clientWidth';

function overridePrototype(keys: MetricKey[], define: (key: MetricKey) => PropertyDescriptor): () => void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(proto, k)] as const);
  for (const k of keys) Object.defineProperty(proto, k, { configurable: true, ...define(k) });
  return () => {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(proto, k, d);
      else delete proto[k];
    }
  };
}

export function installScrollMetrics(scrollHeight = 2000, clientHeight = 500) {
  const tops = new WeakMap<Element, number>();
  const writes: Array<{ el: Element; value: number }> = [];
  const restore = overridePrototype(['scrollTop', 'scrollHeight', 'clientHeight'], (k) => {
    if (k === 'scrollTop') {
      return {
        get(this: Element) {
          return tops.get(this) ?? 0;
        },
        set(this: Element, v: number) {
          tops.set(this, v);
          writes.push({ el: this, value: v });
        },
      };
    }
    return { get: () => (k === 'scrollHeight' ? scrollHeight : clientHeight) };
  });
  return {
    writes,
    /** Nearest ancestor of `node` that has been scrolled programmatically. */
    scrollerOf(node: Element): Element | null {
      const written = new Set(writes.map((w) => w.el));
      for (let el: Element | null = node; el; el = el.parentElement) if (written.has(el)) return el;
      return null;
    },
    writesTo(el: Element): number {
      return writes.filter((w) => w.el === el).length;
    },
    /** The user drags the scrollbar: position changes, then `scroll` fires. */
    userScrollTo(el: Element, top: number): void {
      act(() => {
        tops.set(el, top);
        el.dispatchEvent(new Event('scroll'));
      });
    },
    restore,
  };
}

/** Give every element a layout width (the right pane's host needs one to size itself). */
export function installClientWidth(width: number): () => void {
  return overridePrototype(['clientWidth'], () => ({ get: () => width }));
}

// ── Fixtures ────────────────────────────────────────────────────

export const CHAT_ID = 'chat-1';
export const SESSION_ID = 'sess-1';
export const WORKSPACE_ID = 'ws-1';

export function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    name: 'Characterized chat',
    sessionId: SESSION_ID,
    workspaceId: WORKSPACE_ID,
    tags: [],
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Chat;
}

let msgSeq = 0;
export function makeMessage(role: ChatMessage['role'], content: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  msgSeq += 1;
  return {
    id: `m-${msgSeq}`,
    sessionId: SESSION_ID,
    chatId: CHAT_ID,
    role,
    content,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, msgSeq)),
    ...overrides,
  };
}

/** `n` alternating user/assistant messages with unique, findable content. */
export function makeConversation(n: number): ChatMessage[] {
  return Array.from({ length: n }, (_, i) => makeMessage(i % 2 === 0 ? 'user' : 'assistant', `msg #${i + 1}`));
}

/** Register a loaded chat record. */
export function withChat(chat: Chat): Chat {
  data = { ...data, chats: { ...data.chats, [chat.id]: { data: chat, isLoading: false, error: null } } };
  return chat;
}

// ── Reset (call in beforeEach) ──────────────────────────────────

export function resetHarness(): void {
  data = initialData();
  version += 1;
  memo.clear();
  listeners.clear();
  msgSeq = 0;
  muxSubscriptions.length = 0;
  for (const m of Object.values(mutations)) {
    m.mutate.mockReset();
    m.mutateAsync.mockReset();
    m.mutateAsync.mockImplementation(async () => undefined);
    m.isPending = false;
  }
  for (const spy of Object.values(hookCalls)) spy.mockReset();
  connectChatSessionSpy.mockClear();
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
  FakeWebSocket.instances.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  window.localStorage.clear();
}


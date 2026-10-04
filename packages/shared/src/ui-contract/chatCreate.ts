// ────────────────────────────────────────────────────────────────
// New-chat draft contract (D-36; 04-screen-map.md §0, §R-1; 07-phases.md
// P5-09, P5-10).
//
// `CreateChatDraft` is the one shape every create surface agrees on: Home's
// `QuickComposer` (F-home-02), the 640 `NewChatDialog` (quick start) and the
// full `/chats/new` `ChatCreatePage` (T-03). A caller outside `features/chats`
// (Home) builds only the handful of fields it has — as a `Partial<…>`, since
// it never touches `name`/`description`/`tags`/`who`/`orchestratorMode`/
// `sources` — and hands it over in router state (`{ draft }`) without
// importing anything from `features/chats` (04 §0 cross-feature rule).
// `chatNameFromPrompt` is the one place a chat name is derived from a typed
// prompt, so Home's quick-create and the two full create surfaces agree on
// what a chat started from "Fix the flaky test…" ends up being called.
//
// Deliberately NOT the wire shape: `sources` here is the lightweight, plain
// mount intent (what the server needs), not `DraftSource` (`blocks/sources`),
// which additionally carries live, UI-only capability facts (can this be a
// worktree, its branch list, whether it is dirty…). `features/chats/create`
// owns the mapping in both directions. `sourceMode` is Home's coarser
// equivalent — one mode for every codebase in the project, since its quick
// composer does not pick individual sources.
//
// Types only, dependency-free: no imports — safe for the Electron main
// bundle (see chats.ts's header for the same rule).
// ────────────────────────────────────────────────────────────────

/** Who runs the chat: a bare model, a bound agent, or an orchestrator. */
export type ChatCreateWho = 'model' | 'agent' | 'orchestrator';

/** How a source mount is materialised. Mirrors `blocks/sources`' `SourceMode`. */
export type ChatCreateSourceMode = 'in-place' | 'worktree';

/** Which branch a mount ends up on. Mirrors `blocks/sources`' `BranchMode`. */
export type ChatCreateBranchMode = 'current' | 'existing' | 'new';

/** One mount the chat's workspace is built from. */
export interface ChatCreateDraftSource {
  kind: 'codebase' | 'folder';
  /** `kind: 'codebase'` only. */
  codebaseId?: string;
  /** `kind: 'folder'` only — an absolute path. */
  path?: string;
  alias: string;
  mode: ChatCreateSourceMode;
  branchMode: ChatCreateBranchMode;
  /** `branchMode: 'new'`; empty means the server's `generatorai/<slug>` default. */
  newBranch?: string;
  /** `branchMode: 'existing'`. */
  branch?: string;
  /** `branchMode: 'new'`; empty means the current HEAD. */
  baseRef?: string;
}

/** The integrated browser's starting visibility and guardrails. */
export interface ChatCreateBrowserSettings {
  visibility: 'headless' | 'visible' | 'off';
  evalAllowed?: boolean;
  allowedHostsCsv?: string;
}

/** Everything either create surface can fill in before the chat exists. */
export interface CreateChatDraft {
  /** The typed task; sent as the chat's first message once created. */
  prompt: string;
  /** Empty = named from `prompt` on submit. */
  name: string;
  description: string;
  tags: string[];
  who: ChatCreateWho;
  /** `who: 'agent' | 'orchestrator'`. */
  agentRef?: string;
  /** Forced on for an orchestrator agent; freely toggleable for `who: 'model'`. */
  orchestratorMode: boolean;
  /**
   * The first message runs in plan mode: the agent proposes a plan and waits for its review before it changes
   * anything. Per turn only — later messages use the chat's default mode.
   */
  planFirst?: boolean;
  /** Model id, `''` = the caller's default. */
  model: string;
  reasoningEffort?: string;
  contextTier?: string;
  projectId?: string;
  /** Alias of the source that becomes the agent's working directory. */
  primaryAlias?: string;
  sources: ChatCreateDraftSource[];
  browser?: ChatCreateBrowserSettings;
  /** Home's coarser "Where" — one mode for every codebase in its project. */
  sourceMode?: ChatCreateSourceMode;
}

/** A fresh, empty draft — the dialog and page both start from this. */
export const EMPTY_CREATE_CHAT_DRAFT: CreateChatDraft = {
  prompt: '',
  name: '',
  description: '',
  tags: [],
  who: 'agent',
  orchestratorMode: false,
  model: '',
  sources: [],
};

/** A chat name from the first line of a prompt, clipped to `max` characters at a word break. */
export function chatNameFromPrompt(prompt: string, max = 60): string {
  const line = prompt.trim().split('\n')[0]?.trim() ?? '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

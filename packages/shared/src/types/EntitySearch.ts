// ────────────────────────────────────────────────────────────────
// Palette entity search (G-18, docs/redesign/05-gap-matrix.md §G-18).
//
// `GET /api/search?q=&types=chat,project,agent,workflow,automation,script
// &limit=20` — the CommandPalette's "typing 'run nig' yields a Workflows
// group ... and Recent chats" behaviour. Server-side substring matching over
// names/descriptions/tags, scored by prefix match and recency, one merged
// list ranked across every requested type. Settings entries and navigation
// targets are matched CLIENT-side (they are not server entities) — not part
// of this response. Recents are composed on the client from `GET /chats?
// sort=activity&limit=5` (G-02) plus the attention feed (G-01).
//
// Each type respects its own read scope (05 §G-18 "The results respect each
// type's read scope") — a principal missing a type's read scope simply never
// sees that group; the route filters `types` down to what the caller can
// read before running any query.
//
// React-free wire types only; web, desktop, CLI and mobile share them.
// ────────────────────────────────────────────────────────────────

import type { StatusState } from '../status/states.js';

export type SearchEntityType = 'chat' | 'project' | 'agent' | 'workflow' | 'automation' | 'script';

export const SEARCH_ENTITY_TYPES: readonly SearchEntityType[] = [
  'chat',
  'project',
  'agent',
  'workflow',
  'automation',
  'script',
];

/** Inline action a palette row can offer for this result. `open` navigates to `href`. */
export type SearchResultAction = 'open' | 'run' | 'new_chat';

export interface SearchResult {
  type: SearchEntityType;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  status?: StatusState;
  actions?: SearchResultAction[];
}

export interface SearchQuery {
  q: string;
  /** Default: every type the caller can read. */
  types?: SearchEntityType[];
  /** Default 20, clamped to 50. */
  limit?: number;
}

export interface SearchResponse {
  results: SearchResult[];
}

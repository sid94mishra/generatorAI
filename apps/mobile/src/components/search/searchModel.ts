// ────────────────────────────────────────────────────────────────
// Global search — the pure half.
//
// The web app's command palette (apps/web/src/components/layout/
// CommandPalette.tsx) is a keyboard launcher over navigation and actions.
// On a phone the equivalent question is "where is that chat / run / agent",
// so this indexes the entities the app already lists and ranks them with the
// same fuzzy matcher the pickers use (`lib/fuzzyMatch.ts`) — typo-tolerant,
// punctuation-blind, exact and prefix hits first.
//
// Everything here is plain data in, plain data out: the screen hands in the
// React Query caches, this returns sections to render. Tested in
// `__tests__/searchModel.test.ts`.
// ────────────────────────────────────────────────────────────────

import {
  isArchived,
  toEpochMs,
  type AgentSummary,
  type AutomationSummary,
  type ChatSummary,
  type ProjectSummary,
  type WorkflowRunSummary,
  type WorkflowSummary,
} from '@generatorai/client-core';

import { fuzzyScore } from '../../lib/fuzzyMatch';

export type SearchKind = 'chat' | 'run' | 'workflow' | 'project' | 'automation' | 'agent';

export type SearchItem =
  | { kind: 'chat'; id: string; raw: ChatSummary; fields: string[]; updatedAt: number; archived: boolean }
  | { kind: 'run'; id: string; raw: WorkflowRunSummary; fields: string[]; updatedAt: number; archived: false }
  | { kind: 'workflow'; id: string; raw: WorkflowSummary; fields: string[]; updatedAt: number; archived: false }
  | { kind: 'project'; id: string; raw: ProjectSummary; fields: string[]; updatedAt: number; archived: false }
  | { kind: 'automation'; id: string; raw: AutomationSummary; fields: string[]; updatedAt: number; archived: false }
  | { kind: 'agent'; id: string; raw: AgentSummary; fields: string[]; updatedAt: number; archived: false };

export interface SearchSources {
  chats?: readonly ChatSummary[] | undefined;
  runs?: readonly WorkflowRunSummary[] | undefined;
  workflows?: readonly WorkflowSummary[] | undefined;
  projects?: readonly ProjectSummary[] | undefined;
  automations?: readonly AutomationSummary[] | undefined;
  agents?: readonly AgentSummary[] | undefined;
}

export const SECTION_TITLES: Record<SearchKind, string> = {
  chat: 'Chats',
  run: 'Runs',
  workflow: 'Workflows',
  project: 'Projects',
  automation: 'Automations',
  agent: 'Agents',
};

/** Tie-break order when two sections' best hits score the same. */
const KIND_ORDER: readonly SearchKind[] = ['chat', 'run', 'workflow', 'project', 'automation', 'agent'];

const epoch = (value: Parameters<typeof toEpochMs>[0]): number => toEpochMs(value) ?? 0;
const words = (values: Array<string | null | undefined>): string[] =>
  values.filter((v): v is string => typeof v === 'string' && v.length > 0);

/**
 * Flatten the caches into one searchable list. `fields` are ordered most to
 * least authoritative — `fuzzyScore` weights earlier fields higher, so a hit
 * on a name beats the same hit on a description or tag.
 */
export function buildSearchIndex(sources: SearchSources): SearchItem[] {
  const out: SearchItem[] = [];
  for (const chat of sources.chats ?? []) {
    out.push({
      kind: 'chat',
      id: chat.id,
      raw: chat,
      fields: words([chat.name, ...(chat.tags ?? []), chat.model]),
      updatedAt: epoch(chat.updatedAt),
      archived: isArchived(chat),
    });
  }
  for (const run of sources.runs ?? []) {
    out.push({
      kind: 'run',
      id: run.id,
      raw: run,
      fields: words([run.name, run.status, run.id]),
      updatedAt: epoch(run.updatedAt),
      archived: false,
    });
  }
  for (const workflow of sources.workflows ?? []) {
    out.push({
      kind: 'workflow',
      id: workflow.id,
      raw: workflow,
      fields: words([workflow.name, workflow.description, ...(workflow.tags ?? [])]),
      updatedAt: epoch(workflow.updatedAt),
      archived: false,
    });
  }
  for (const project of sources.projects ?? []) {
    out.push({
      kind: 'project',
      id: project.id,
      raw: project,
      fields: words([project.name, project.description]),
      updatedAt: epoch(project.createdAt),
      archived: false,
    });
  }
  for (const automation of sources.automations ?? []) {
    out.push({
      kind: 'automation',
      id: automation.id,
      raw: automation,
      fields: words([automation.name, automation.description, automation.triggerType]),
      updatedAt: epoch(automation.lastRunAt ?? automation.createdAt),
      archived: false,
    });
  }
  for (const agent of sources.agents ?? []) {
    out.push({
      kind: 'agent',
      id: agent.id,
      raw: agent,
      fields: words([agent.name, agent.slug, agent.description]),
      updatedAt: 0,
      archived: false,
    });
  }
  return out;
}

export interface SearchSection {
  kind: SearchKind;
  title: string;
  items: SearchItem[];
  /** How many matched in total — `items` may be capped. */
  total: number;
}

export interface RankOptions {
  /** Rows shown per section. Default 5; the rest are counted in `total`. */
  perSection?: number;
  /** Archived chats still match, but sink below live ones. */
  archivedPenalty?: number;
}

/**
 * Rank the index against a query and group it into sections.
 *
 * Within a section: score, then most recently touched, then input order.
 * Sections are ordered by their best hit, so typing an agent's exact name
 * puts Agents first rather than burying it under five loosely-matching chats.
 * An empty query returns no sections — the screen shows recent searches.
 */
export function rankSearch(items: readonly SearchItem[], query: string, options: RankOptions = {}): SearchSection[] {
  const q = query.trim();
  if (!q) return [];
  const perSection = Math.max(1, options.perSection ?? 5);
  const penalty = options.archivedPenalty ?? 250;

  const byKind = new Map<SearchKind, Array<{ item: SearchItem; score: number; index: number }>>();
  items.forEach((item, index) => {
    const base = fuzzyScore(q, ...item.fields);
    if (base === null) return;
    const score = item.archived ? base - penalty : base;
    const bucket = byKind.get(item.kind) ?? [];
    bucket.push({ item, score, index });
    byKind.set(item.kind, bucket);
  });

  const sections: Array<SearchSection & { best: number }> = [];
  for (const [kind, bucket] of byKind) {
    bucket.sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt || a.index - b.index);
    sections.push({
      kind,
      title: SECTION_TITLES[kind],
      items: bucket.slice(0, perSection).map((entry) => entry.item),
      total: bucket.length,
      best: bucket[0]!.score,
    });
  }
  sections.sort((a, b) => b.best - a.best || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return sections.map(({ best: _best, ...section }) => section);
}

// ── Recent searches ──────────────────────────────────────────────

export const RECENT_SEARCHES_KEY = 'generatorai.recent-searches';
export const MAX_RECENT_SEARCHES = 8;

/** Decode the stored list; anything malformed reads as "no recents". */
export function parseRecentSearches(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

/**
 * Put a query at the front of the recents. Case-insensitive de-duplication
 * (the newer spelling wins); one-character queries are not worth keeping.
 */
export function pushRecentSearch(list: readonly string[], query: string, max = MAX_RECENT_SEARCHES): string[] {
  const q = query.trim();
  if (q.length < 2) return [...list];
  const key = q.toLowerCase();
  return [q, ...list.filter((entry) => entry.trim().toLowerCase() !== key)].slice(0, max);
}

export function removeRecentSearch(list: readonly string[], query: string): string[] {
  const key = query.trim().toLowerCase();
  return list.filter((entry) => entry.trim().toLowerCase() !== key);
}

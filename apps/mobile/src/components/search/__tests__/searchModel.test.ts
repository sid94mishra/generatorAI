import { describe, expect, it } from 'vitest';
import type {
  AgentSummary,
  ChatSummary,
  ProjectSummary,
  WorkflowRunSummary,
  WorkflowSummary,
} from '@generatorai/client-core';

import {
  MAX_RECENT_SEARCHES,
  buildSearchIndex,
  parseRecentSearches,
  pushRecentSearch,
  rankSearch,
  removeRecentSearch,
} from '../searchModel';

const chat = (id: string, name: string, updatedAt: string, status = 'active'): ChatSummary =>
  ({ id, name, sessionId: null, status, createdAt: updatedAt, updatedAt }) as ChatSummary;

const run = (id: string, name: string, updatedAt: string): WorkflowRunSummary =>
  ({ id, name, workflowDefinitionId: 'w', status: 'running', createdAt: updatedAt, updatedAt }) as WorkflowRunSummary;

const workflow = (id: string, name: string, description?: string): WorkflowSummary =>
  ({ id, name, description, createdAt: 0, updatedAt: 0 }) as WorkflowSummary;

const project = (id: string, name: string): ProjectSummary => ({ id, name, createdAt: 0 }) as ProjectSummary;

const agent = (id: string, name: string, slug: string): AgentSummary =>
  ({ id, name, slug, description: '', scope: 'global', role: 'agent', enabled: true }) as AgentSummary;

describe('rankSearch', () => {
  const index = buildSearchIndex({
    chats: [
      chat('c1', 'Fix login redirect', '2026-09-01T00:00:00Z'),
      chat('c2', 'Release notes draft', '2026-09-10T00:00:00Z'),
      chat('c3', 'Login page polish', '2026-09-12T00:00:00Z'),
      chat('c4', 'Login archived thread', '2026-09-13T00:00:00Z', 'archived'),
    ],
    runs: [run('r1', 'Nightly release', '2026-09-11T00:00:00Z')],
    workflows: [workflow('w1', 'Release pipeline', 'Tags and publishes')],
    projects: [project('p1', 'Generator mobile')],
    agents: [agent('a1', 'Reviewer', 'code-reviewer')],
  });

  it('returns nothing for a blank query', () => {
    expect(rankSearch(index, '   ')).toEqual([]);
  });

  it('groups hits by kind and orders sections by their best hit', () => {
    const sections = rankSearch(index, 'reviewer');
    expect(sections.map((s) => s.kind)).toEqual(['agent']);
    expect(sections[0]!.title).toBe('Agents');
  });

  it('tolerates typos via subsequence matching', () => {
    const sections = rankSearch(index, 'relase');
    const kinds = sections.map((s) => s.kind);
    expect(kinds).toContain('workflow');
    expect(kinds).toContain('chat');
  });

  it('breaks score ties by recency and sinks archived chats', () => {
    const [chats] = rankSearch(index, 'login');
    expect(chats!.kind).toBe('chat');
    // "Login page polish" (prefix, newer) and "Fix login redirect" (contains).
    expect(chats!.items.map((i) => i.id)).toEqual(['c3', 'c1', 'c4']);
  });

  it('caps each section but reports the total', () => {
    const many = buildSearchIndex({
      chats: Array.from({ length: 9 }, (_, i) => chat(`c${i}`, `Deploy ${i}`, `2026-09-0${i + 1}T00:00:00Z`)),
    });
    const [section] = rankSearch(many, 'deploy', { perSection: 3 });
    expect(section!.items).toHaveLength(3);
    expect(section!.total).toBe(9);
    // Most recent first among equal scores.
    expect(section!.items[0]!.id).toBe('c8');
  });

  it('matches secondary fields such as agent slugs and descriptions', () => {
    expect(rankSearch(index, 'code-reviewer')[0]!.items[0]!.id).toBe('a1');
    expect(rankSearch(index, 'publishes')[0]!.kind).toBe('workflow');
  });

  it('puts an exact name in another section ahead of loose chat matches', () => {
    const sections = rankSearch(index, 'Generator mobile');
    expect(sections[0]!.kind).toBe('project');
  });
});

describe('recent searches', () => {
  it('parses defensively', () => {
    expect(parseRecentSearches(undefined)).toEqual([]);
    expect(parseRecentSearches('not json')).toEqual([]);
    expect(parseRecentSearches('{"a":1}')).toEqual([]);
    expect(parseRecentSearches('["a", 3, "", "b"]')).toEqual(['a', 'b']);
  });

  it('pushes to the front, de-duplicates case-insensitively and caps', () => {
    let list: string[] = [];
    list = pushRecentSearch(list, 'login');
    list = pushRecentSearch(list, 'release');
    list = pushRecentSearch(list, 'LOGIN ');
    expect(list).toEqual(['LOGIN', 'release']);
    expect(pushRecentSearch(list, 'x')).toEqual(list);
    for (let i = 0; i < 20; i++) list = pushRecentSearch(list, `query ${i}`);
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    expect(list[0]).toBe('query 19');
  });

  it('removes an entry', () => {
    expect(removeRecentSearch(['Login', 'release'], 'login')).toEqual(['release']);
  });
});

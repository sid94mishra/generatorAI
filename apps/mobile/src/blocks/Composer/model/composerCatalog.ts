// ────────────────────────────────────────────────────────────────
// Slash / mention source — merging and ranking.
//
// Mirrors `apps/web/src/hooks/composerQueries.ts` + `composer/builtins.ts`:
//
//   builtins   /browser, /terminal   — wrap the text into an instruction AND
//                                       surface the pane
//   skills     /<skill>              — "Use the "x" skill for…"; the Computer
//                                       Use skill is offered only when the
//                                       server has it enabled and names the
//                                       STAGED skill id, never the display name
//   prompts    /<prompt>             — template fetched lazily on send
//   navigate   /changes /files /plan /tasks — mobile-only pane openers, kept
//                                       from v1 so nothing the phone already
//                                       had disappears
//   agents     @<agent>              — inserts the agent's ref as text
//   files      @<path>               — attaches the file's content (web parity)
//
// Matching uses client-core's canonical subsequence matcher; native labels
// and pane navigation are presentation adapters only.
// ────────────────────────────────────────────────────────────────

import {
  BUILTIN_COMMANDS as SHARED_BUILTINS,
  skillToCommand, computerUseSkillToCommand, promptToCommand,
  fuzzyMatch, type SlashCommand,
} from '@generatorai/client-core';
import { filterPaths } from './composerMenu';
import type { SlashItem } from './types';

export interface ArtifactLike {
  id: string;
  name: string;
  description?: string;
  source?: 'system' | 'project';
}

export interface AgentLike {
  ref: string;
  name: string;
  description?: string;
  enabled?: boolean;
}

export interface SlashSourceInput {
  skills?: readonly ArtifactLike[];
  prompts?: readonly ArtifactLike[];
  agents?: readonly AgentLike[];
  /** Locally disabled skills — mirrors web's `catalogPrefsStore`. */
  disabledSkillIds?: readonly string[];
  /** Server-side Computer Use enablement + the staged skill id it gates. */
  computerUse?: { enabled: boolean; skillId: string };
  loadPromptTemplate?: (artifact: ArtifactLike) => Promise<string>;
}

/** Shared commands with native menu labels and pane routing. */
function nativeCommand(command: SlashCommand): SlashItem {
  return { ...command, label: `/${command.name}` };
}
export const BUILTIN_COMMANDS: readonly SlashItem[] = SHARED_BUILTINS.map(command => ({
  ...nativeCommand(command),
  ...(command.name === 'browser' || command.name === 'terminal' ? { pane: command.name } : {}),
}));

/** Mobile pane openers (v1 behaviour, kept). Not sent to the model. */
export const NAVIGATE_COMMANDS: readonly SlashItem[] = [
  { id: 'nav:changes', name: 'changes', label: '/changes', description: 'Review file changes', kind: 'navigate', source: 'builtin', pane: 'changes' },
  { id: 'nav:files', name: 'files', label: '/files', description: 'Browse workspace files', kind: 'navigate', source: 'builtin', pane: 'files' },
  { id: 'nav:plan', name: 'plan', label: '/plan', description: 'Open the plan document', kind: 'navigate', source: 'builtin', pane: 'plan' },
  { id: 'nav:tasks', name: 'tasks', label: '/tasks', description: 'Background tasks', kind: 'navigate', source: 'builtin', pane: 'tasks' },
];

export function skillToItem(a: ArtifactLike): SlashItem {
  return nativeCommand(skillToCommand({ ...a, source: a.source ?? 'system' }));
}

export function computerUseSkillToItem(a: ArtifactLike): SlashItem {
  return nativeCommand(computerUseSkillToCommand(a));
}

export function promptToItem(a: ArtifactLike, loadTemplate: () => Promise<string>): SlashItem {
  return {
    ...nativeCommand(promptToCommand({ ...a, source: a.source ?? 'system' }, loadTemplate)),
    argHint: 'Add optional details, or send to run the prompt…',
  };
}

export function agentToItem(a: AgentLike): SlashItem {
  return {
    id: `agent:${a.ref}`,
    name: a.name,
    label: `@${a.name}`,
    ...(a.description ? { description: a.description } : {}),
    kind: 'agent',
    source: a.ref.startsWith('project:') ? 'project' : 'system',
    agentRef: a.ref,
  };
}

export function fileToItem(path: string, alias?: string): SlashItem {
  const base = path.slice(path.lastIndexOf('/') + 1) || path;
  return {
    id: `file:${alias ?? ''}:${path}`,
    name: base,
    label: base,
    description: alias ? `${alias} · ${path}` : path,
    kind: 'file',
    source: 'workspace',
    path,
    ...(alias ? { alias } : {}),
  };
}

/** The full `/` list, in web's insertion order: builtins, skills, prompts, then pane openers. */
export function buildSlashItems(input: SlashSourceInput): SlashItem[] {
  const out: SlashItem[] = [...BUILTIN_COMMANDS];
  const disabled = new Set(input.disabledSkillIds ?? []);

  for (const s of input.skills ?? []) {
    if (disabled.has(s.id)) continue;
    if (input.computerUse && s.id === input.computerUse.skillId) {
      if (!input.computerUse.enabled) continue;
      out.push(computerUseSkillToItem(s));
      continue;
    }
    out.push(skillToItem(s));
  }

  for (const p of input.prompts ?? []) {
    const load = input.loadPromptTemplate;
    out.push(promptToItem(p, () => (load ? load(p) : Promise.resolve(''))));
  }

  out.push(...NAVIGATE_COMMANDS);
  return out;
}

/** Ranked `/` matches. Empty query keeps catalogue order. */
export function rankSlashItems(items: readonly SlashItem[], query: string, limit = 24): SlashItem[] {
  const q = query.trim();
  if (!q) return items.slice(0, limit);
  return items.filter(i => fuzzyMatch(q, i.name) || fuzzyMatch(q, i.description ?? '')).slice(0, limit);
}

/**
 * Ranked `@` matches: agents first (few, and a name match is unambiguous),
 * then files via the four-tier path ranking from v1.
 */
export function rankMentionItems(
  query: string,
  files: readonly { path: string; alias?: string }[],
  agents: readonly AgentLike[] = [],
  limit = 20,
): SlashItem[] {
  const q = query.trim();
  const enabledAgents = agents.filter((a) => a.enabled !== false);
  const agentItems = (q ? enabledAgents.filter(a => fuzzyMatch(q, a.name) || fuzzyMatch(q, a.ref)) : enabledAgents)
    .slice(0, 4)
    .map(agentToItem);

  const byPath = new Map<string, { path: string; alias?: string }>();
  for (const f of files) byPath.set(f.path, f);
  const paths = filterPaths([...byPath.keys()], q, limit);
  const fileItems = paths.map((p) => {
    const f = byPath.get(p)!;
    return fileToItem(f.path, f.alias);
  });

  return [...agentItems, ...fileItems].slice(0, limit);
}

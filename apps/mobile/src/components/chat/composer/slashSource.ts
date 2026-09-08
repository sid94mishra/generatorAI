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
// Ranking uses the shared `fuzzyFilter`, so "sonet"-style typos still reach
// the right command — the web's plain subsequence match is a subset of it.
// ────────────────────────────────────────────────────────────────

import { fuzzyFilter } from '../../../lib/fuzzyMatch';
import { filterPaths } from '../composerMenu';
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

/** Web's `BUILTIN_COMMANDS`, verbatim in prompt wording. */
export const BUILTIN_COMMANDS: readonly SlashItem[] = [
  {
    id: 'builtin:browser',
    name: 'browser',
    label: '/browser',
    description: 'Drive the integrated browser to test or verify a flow',
    kind: 'command',
    source: 'builtin',
    pane: 'browser',
    argHint: 'Describe what to open, click, or verify in the browser…',
    format: (input) =>
      `Use the integrated browser to complete the task below. Open the relevant page(s), interact as needed (navigate, click, type), and verify the outcome. Report what you observed, including screenshots or issues found.\n\nTask: ${input.trim()}`,
  },
  {
    id: 'builtin:terminal',
    name: 'terminal',
    label: '/terminal',
    description: 'Run commands in the integrated terminal and report output',
    kind: 'command',
    source: 'builtin',
    pane: 'terminal',
    argHint: 'Describe the command or task to run in the terminal…',
    format: (input) =>
      `Use the integrated terminal to run the command(s) needed for the task below. Show the exact command(s) you run, then report the output and the result.\n\nTask: ${input.trim()}`,
  },
];

/** Mobile pane openers (v1 behaviour, kept). Not sent to the model. */
export const NAVIGATE_COMMANDS: readonly SlashItem[] = [
  { id: 'nav:changes', name: 'changes', label: '/changes', description: 'Review file changes', kind: 'navigate', source: 'builtin', pane: 'changes' },
  { id: 'nav:files', name: 'files', label: '/files', description: 'Browse workspace files', kind: 'navigate', source: 'builtin', pane: 'files' },
  { id: 'nav:plan', name: 'plan', label: '/plan', description: 'Open the plan document', kind: 'navigate', source: 'builtin', pane: 'plan' },
  { id: 'nav:tasks', name: 'tasks', label: '/tasks', description: 'Background tasks', kind: 'navigate', source: 'builtin', pane: 'tasks' },
];

export function skillToItem(a: ArtifactLike): SlashItem {
  const source = a.source ?? 'system';
  return {
    id: `skill:${source}:${a.id}`,
    name: a.name,
    label: `/${a.name}`,
    description: a.description || 'Skill',
    kind: 'skill',
    source,
    argHint: `Describe the task for the "${a.name}" skill…`,
    format: (input) => {
      const task = input.trim();
      return task
        ? `Use the "${a.name}" skill for the following task.\n\n${task}`
        : `Use the "${a.name}" skill.`;
    },
  };
}

/**
 * Names the STAGED skill (`generatorai-computer-use`), not the display name:
 * a user-level skill from another vendor also calls itself `computer-use`.
 */
export function computerUseSkillToItem(a: ArtifactLike): SlashItem {
  return {
    id: `skill:system:${a.id}`,
    name: a.name,
    label: `/${a.name}`,
    description: a.description || 'Operate desktop applications on this machine',
    kind: 'skill',
    source: 'system',
    argHint: 'Describe the desktop task — which app, and what to do…',
    format: (input) => {
      const task = input.trim();
      const header =
        'Use the generatorai-computer-use skill and the computer_* tools to drive the desktop for this task.';
      return task ? `${header}\n\n${task}` : header;
    },
  };
}

export function promptToItem(a: ArtifactLike, loadTemplate: () => Promise<string>): SlashItem {
  const source = a.source ?? 'system';
  return {
    id: `prompt:${source}:${a.id}`,
    name: a.name,
    label: `/${a.name}`,
    description: a.description || 'Prompt',
    kind: 'prompt',
    source,
    argHint: 'Add optional details, or send to run the prompt…',
    loadTemplate,
    format: (input, template) => {
      const body = (template ?? '').trim();
      const extra = input.trim();
      if (body && extra) return `${body}\n\n${extra}`;
      return body || extra;
    },
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
  return fuzzyFilter(items, q, (i) => [i.name, i.description]).slice(0, limit);
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
  const agentItems = (q ? fuzzyFilter(enabledAgents, q, (a) => [a.name, a.ref]) : enabledAgents)
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

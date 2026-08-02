// ────────────────────────────────────────────────────────────────
// Built-in slash commands + factories that turn skills / prompts
// (config artifacts) into slash commands. Kept pure + framework-free
// so it is trivially unit-testable.
// ────────────────────────────────────────────────────────────────

import type { SlashCommand } from './types.js';

/**
 * Built-in commands that map to integrated tools. They wrap the user's free
 * text into a clear instruction so the agent drives the integrated browser /
 * terminal. These are always available (no project required).
 */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    id: 'builtin:browser',
    name: 'browser',
    description: 'Drive the integrated browser to test or verify a flow',
    kind: 'command',
    source: 'builtin',
    argHint: 'Describe what to open, click, or verify in the browser…',
    takesInput: true,
    format: (input) =>
      `Use the integrated browser to complete the task below. Open the relevant page(s), interact as needed (navigate, click, type), and verify the outcome. Report what you observed, including screenshots or issues found.\n\nTask: ${input.trim()}`,
  },
  {
    id: 'builtin:terminal',
    name: 'terminal',
    description: 'Run commands in the integrated terminal and report output',
    kind: 'command',
    source: 'builtin',
    argHint: 'Describe the command or task to run in the terminal…',
    takesInput: true,
    format: (input) =>
      `Use the integrated terminal to run the command(s) needed for the task below. Show the exact command(s) you run, then report the output and the result.\n\nTask: ${input.trim()}`,
  },
];

/** Turn a skill config artifact into a slash command. */
export function skillToCommand(a: {
  id: string;
  name: string;
  description?: string;
  source: 'system' | 'project';
}): SlashCommand {
  return {
    id: `skill:${a.source}:${a.id}`,
    name: a.name,
    description: a.description || 'Skill',
    kind: 'skill',
    source: a.source,
    argHint: `Describe the task for the "${a.name}" skill…`,
    takesInput: true,
    format: (input) => {
      const task = input.trim();
      return task
        ? `Use the "${a.name}" skill for the following task.\n\n${task}`
        : `Use the "${a.name}" skill.`;
    },
  };
}

/**
 * Turn a prompt config artifact into a slash command. The template body is
 * fetched lazily via `loadTemplate` (only when the command is actually sent),
 * keeping the menu cheap even with many prompts. User-typed input is appended
 * so a prompt can be parameterised inline.
 */
export function promptToCommand(
  a: { id: string; name: string; description?: string; source: 'system' | 'project' },
  loadTemplate: () => Promise<string>,
): SlashCommand {
  return {
    id: `prompt:${a.source}:${a.id}`,
    name: a.name,
    description: a.description || 'Prompt',
    kind: 'prompt',
    source: a.source,
    argHint: 'Add optional details, or press Enter to run the prompt…',
    takesInput: true,
    loadTemplate,
    format: (input, template) => {
      const body = (template ?? '').trim();
      const extra = input.trim();
      if (body && extra) return `${body}\n\n${extra}`;
      return body || extra;
    },
  };
}

/** Case-insensitive subsequence fuzzy match used by both menus. */
export function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ────────────────────────────────────────────────────────────────
// Composer slash commands and @-mention files (03 §3.2 F-composer-15/16).
//
// Built-in commands, the factories that turn skills / prompts (config
// artifacts) into slash commands, and the fuzzy matcher both composer menus
// use. Pure and framework-free so web and mobile share one list (moved from
// the web composer in P4-08).
// ────────────────────────────────────────────────────────────────

export type SlashCommandKind = 'prompt' | 'skill' | 'agent' | 'command';

/**
 * A slash command surfaced in the composer's `/` menu. Prompts and skills are
 * modeled as commands too ("prompts are also considered slash commands").
 * Built-in commands (`/browser`, `/terminal`) wrap the user's free text into
 * an instruction the agent can act on.
 */
export interface SlashCommand {
  /** Stable id (e.g. `builtin:browser`, `system:<artifactId>`). */
  id: string;
  /** Trigger token without the leading slash (e.g. `browser`). */
  name: string;
  description?: string;
  kind: SlashCommandKind;
  source: 'system' | 'project' | 'builtin';
  /** Placeholder shown in the textarea once the command is active. */
  argHint?: string;
  /** Whether the command accepts free-text input after selection. */
  takesInput: boolean;
  /**
   * Builds the final prompt sent to the agent from the user's typed input.
   * For prompt-template commands the resolved template text is passed as
   * `template` (already fetched by the caller); builtins/skills ignore it.
   */
  format: (input: string, template?: string) => string;
  /** Optional lazy loader for a prompt template's body (fetched on send). */
  loadTemplate?: () => Promise<string>;
}

export type MentionFileSource = 'workspace' | 'source' | 'artifacts' | 'worktree';

/** A repo/workspace file discoverable through the `@` mention menu. */
export interface MentionFile {
  /** Relative path within its source root. */
  path: string;
  source: MentionFileSource;
  /** Worktree alias when `source === 'worktree'`. */
  worktreeAlias?: string;
  /** Basename used for display + fuzzy matching. */
  label: string;
}

/** The `/` menu's groups, in the order the menu shows them (ComposerStates "Input aids"). */
export type SlashCommandGroup = 'tools' | 'skills' | 'prompts';

export const SLASH_COMMAND_GROUPS: readonly SlashCommandGroup[] = ['tools', 'skills', 'prompts'];

/** Which `/` menu group a command belongs to: builtins are tools, then skills, then prompts. */
export function slashCommandGroup(cmd: Pick<SlashCommand, 'source' | 'kind'>): SlashCommandGroup {
  if (cmd.source === 'builtin') return 'tools';
  if (cmd.kind === 'skill') return 'skills';
  return 'prompts';
}

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
 * The Computer Use skill command.
 *
 * Only NAMES the skill — the body is registered with the harness server-side
 * (see `ChatManagementService.registerComputerUseSkill`) so the model loads it
 * on demand. An earlier version inlined the whole manual here, which buried the
 * user's actual sentence under two thousand words in their own transcript.
 */
export function computerUseSkillToCommand(a: {
  id: string;
  name: string;
  description?: string;
}): SlashCommand {
  return {
    id: `skill:system:${a.id}`,
    name: a.name,
    description: a.description || 'Operate desktop applications on this machine',
    kind: 'skill',
    source: 'system',
    argHint: 'Describe the desktop task — which app, and what to do…',
    takesInput: true,
    format: (input) => {
      const task = input.trim();
      // Names the STAGED skill, not the display name: a user-level skill from
      // another vendor also calls itself `computer-use`, and naming that here
      // would hand the task to a CLI that bypasses every gate we built.
      const header =
        'Use the generatorai-computer-use skill and the computer_* tools to drive the desktop for this task.';
      return task ? `${header}\n\n${task}` : header;
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

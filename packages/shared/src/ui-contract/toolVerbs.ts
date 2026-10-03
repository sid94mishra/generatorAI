// ────────────────────────────────────────────────────────────────
// Tool-step kinds and verbs (03-component-inventory-domain.md §2.4 B-17/B-18;
// 08 M-11).
//
// Every row of the transcript's step rail is one KIND with one past-tense VERB
// ("Read", "Searched", "Ran", "Edited" …) and, while it is still in flight,
// one present-tense verb ("Reading", "Running" …). Web draws them in
// `blocks/transcript`; mobile draws the same words from this table.
//
// `toolStepKind` classifies a raw tool name. It replaces the substring rules
// that lived in the web timeline (`deriveTimeline.inferKind`): exact matches
// for the SDKs' own tools first, then the orchestrator's and the in-process
// browser/computer tools by prefix, then the old substring fallbacks.
//
// Types, constants and pure functions only; dependency-free.
// ────────────────────────────────────────────────────────────────

/** Every kind a step row can be. `think` … `error` are not tools but share the rail. */
export const STEP_KINDS = [
  'read',
  'search',
  'edit',
  'run',
  'browser',
  'computer',
  'widget',
  'plan',
  'delegate',
  'tool',
  'memory',
  'think',
  'subagent',
  'note',
  'warning',
  'error',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface StepVerbDef {
  /** Past tense, shown once the step settled ("Read", "Ran"). */
  done: string;
  /** Present tense, shown while the step runs ("Reading", "Running"). */
  live: string;
  /** Group headline for `n` folded steps ("Read 3 files"). */
  group: (n: number) => string;
  /** Group headline while any folded step still runs ("Reading files"). */
  groupLive: string;
  /** Whether consecutive steps of this kind fold into one group row (`MIN_GROUP` 2). */
  groupable: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The verb table. Board vocabulary (B-17): Read · Searched · Ran · Edited ·
 * Opened browser · Took screenshot · Focused window · Revised plan · Delegated ·
 * Running · Explore · Worker.
 */
export const STEP_VERBS: Record<StepKind, StepVerbDef> = {
  read: { done: 'Read', live: 'Reading', group: (n) => `Read ${plural(n, 'file')}`, groupLive: 'Reading files', groupable: true },
  search: { done: 'Searched', live: 'Searching', group: (n) => `Searched ${plural(n, 'time')}`, groupLive: 'Searching', groupable: true },
  edit: { done: 'Edited', live: 'Editing', group: (n) => `Edited ${plural(n, 'file')}`, groupLive: 'Editing files', groupable: true },
  run: { done: 'Ran', live: 'Running', group: (n) => `Ran ${plural(n, 'command')}`, groupLive: 'Running commands', groupable: true },
  browser: { done: 'Opened browser', live: 'Browsing', group: (n) => `${plural(n, 'browser action')}`, groupLive: 'Browsing', groupable: true },
  computer: { done: 'Used computer', live: 'Using computer', group: (n) => `${plural(n, 'computer action')}`, groupLive: 'Using computer', groupable: true },
  widget: { done: 'Updated widget', live: 'Updating widget', group: (n) => `${plural(n, 'widget action')}`, groupLive: 'Updating widgets', groupable: true },
  plan: { done: 'Revised plan', live: 'Revising plan', group: (n) => `Revised plan ${plural(n, 'time')}`, groupLive: 'Revising plan', groupable: false },
  delegate: { done: 'Delegated', live: 'Delegating', group: (n) => `Delegated ${plural(n, 'task')}`, groupLive: 'Delegating', groupable: false },
  tool: { done: 'Called', live: 'Calling', group: (n) => `${plural(n, 'tool call')}`, groupLive: 'Calling tools', groupable: true },
  memory: { done: 'Updated memory', live: 'Updating memory', group: (n) => `${plural(n, 'memory operation')}`, groupLive: 'Updating memory', groupable: true },
  think: { done: 'Thought', live: 'Thinking', group: (n) => `${plural(n, 'thought')}`, groupLive: 'Thinking', groupable: false },
  subagent: { done: 'Explore', live: 'Exploring', group: (n) => `${plural(n, 'sub-agent')}`, groupLive: 'Sub-agents running', groupable: false },
  note: { done: 'Note', live: 'Note', group: (n) => `${plural(n, 'note')}`, groupLive: 'Notes', groupable: false },
  warning: { done: 'Warning', live: 'Warning', group: (n) => `${plural(n, 'warning')}`, groupLive: 'Warnings', groupable: false },
  error: { done: 'Error', live: 'Error', group: (n) => `${plural(n, 'error')}`, groupLive: 'Errors', groupable: false },
};

/**
 * Per-tool verbs that are more precise than their kind's ("Took screenshot",
 * "Focused window"). Keys are lower-cased tool names with any `mcp__server__`
 * prefix removed.
 */
export const TOOL_VERB_OVERRIDES: Readonly<Record<string, { done: string; live: string }>> = {
  open_browser_page: { done: 'Opened browser', live: 'Opening browser' },
  navigate_page: { done: 'Opened browser', live: 'Opening browser' },
  screenshot_page: { done: 'Took screenshot', live: 'Taking screenshot' },
  read_page: { done: 'Read page', live: 'Reading page' },
  click_element: { done: 'Clicked', live: 'Clicking' },
  type_in_page: { done: 'Typed', live: 'Typing' },
  computer_snapshot: { done: 'Took screenshot', live: 'Taking screenshot' },
  computer_bring_to_front: { done: 'Focused window', live: 'Focusing window' },
  computer_launch_app: { done: 'Launched app', live: 'Launching app' },
  computer_click: { done: 'Clicked', live: 'Clicking' },
  computer_click_point: { done: 'Clicked', live: 'Clicking' },
  computer_type_text: { done: 'Typed', live: 'Typing' },
  render_widget: { done: 'Rendered widget', live: 'Rendering widget' },
  update_plan: { done: 'Revised plan', live: 'Revising plan' },
  todowrite: { done: 'Revised plan', live: 'Revising plan' },
  spawn_background_agent: { done: 'Delegated', live: 'Delegating' },
};

/** The orchestrator tool that creates a background worker. */
export const SPAWN_WORKER_TOOL = 'spawn_background_agent';

/**
 * Display name for a tool. MCP tools arrive as `mcp__<server>__<tool>`; the
 * last segment is what the user recognises (the server stays visible in the
 * expanded args).
 */
export function humanizeToolName(tool: string): string {
  if (tool.startsWith('mcp__')) {
    const parts = tool.split('__');
    return parts[parts.length - 1] || tool;
  }
  return tool;
}

/**
 * The orchestrator's spawn tool, bare or MCP-namespaced: the Claude provider
 * reaches the platform tools through an MCP server, so its calls arrive as
 * `mcp__generatorai-tools__spawn_background_agent`.
 */
export function isSpawnWorkerTool(tool: string): boolean {
  return humanizeToolName(tool) === SPAWN_WORKER_TOOL;
}

/** The orchestrator tools whose results carry worker digests (bare or MCP-namespaced). */
export function isCheckWorkersTool(tool: string): boolean {
  const name = humanizeToolName(tool);
  return name === 'check_background_agents' || name === 'check_background_agent';
}

/** The harness's built-in shell tools — their output is a real command console. */
export function isShellTool(tool: string): boolean {
  return /^(bash|powershell|shell)$/i.test(tool);
}

/** The in-process browser tools (`packages/core` browser MCP). */
const BROWSER_TOOLS = new Set([
  'open_browser_page',
  'navigate_page',
  'read_page',
  'screenshot_page',
  'click_element',
  'hover_element',
  'drag_element',
  'type_in_page',
  'handle_dialog',
  'run_playwright_code',
]);

/** Classify a raw tool name into a step kind (the icon and the verb follow from the kind). */
export function toolStepKind(toolName: string): StepKind {
  const raw = humanizeToolName(toolName);
  const n = raw.toLowerCase();
  // Exact SDK tool names first.
  if (n === 'task' || n === 'agent') return 'subagent';
  if (n === SPAWN_WORKER_TOOL) return 'delegate';
  if (n === 'todowrite' || n === 'update_plan' || n === 'exit_plan_mode') return 'plan';
  if (isShellTool(n)) return 'run';
  if (n.startsWith('computer_')) return 'computer';
  if (BROWSER_TOOLS.has(n)) return 'browser';
  if (n.endsWith('_widget') || n.startsWith('widget_')) return 'widget';
  // Substring fallbacks (the historical rules).
  if (n.includes('read')) return 'read';
  if (n.includes('write') || n.includes('edit') || n.includes('create')) return 'edit';
  if (n.includes('search') || n.includes('grep') || n.includes('find') || n.includes('glob')) return 'search';
  if (n.includes('shell') || n.includes('exec') || n.includes('run') || n.includes('bash') || n.includes('pwsh')) return 'run';
  if (n.includes('memory') || n.includes('remember')) return 'memory';
  if (n.includes('subagent') || n.includes('agent') || n.includes('explore')) return 'subagent';
  return 'tool';
}

/**
 * The verb a tool-call row shows: a per-tool override, else the kind's verb,
 * else — for a generic `tool` kind — the tool's own (humanized) name, which
 * says more than "Called".
 */
export function toolStepVerb(toolName: string, live: boolean): string {
  const raw = humanizeToolName(toolName);
  const override = TOOL_VERB_OVERRIDES[raw.toLowerCase()];
  if (override) return live ? override.live : override.done;
  const kind = toolStepKind(toolName);
  if (kind === 'tool' || kind === 'subagent') return raw;
  const def = STEP_VERBS[kind];
  return live ? def.live : def.done;
}

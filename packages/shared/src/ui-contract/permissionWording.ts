// ────────────────────────────────────────────────────────────────
// What a tool-permission gate says (D-107): a title that names the action in
// plain words ("Run this command?", "Open a page in the browser?",
// "Allow github: Create issue?") and a kind label for the card's corner
// ("Shell command", "Browser", "MCP · github"). Every gate used to read
// "Allow this command?" with the raw permission type (`other`) beside it.
//
// The server stamps both on the gate payload; web and mobile cards and the
// attention ask read them from there (or call this for older payloads).
// Pure; built on the tool-verb registry.
// ────────────────────────────────────────────────────────────────

import { humanizeToolName, toolDisplayName, toolStepKind } from './toolVerbs.js';

/** The permission types a gate carries (`ToolPermissionType`). */
export type PermissionWordingType = 'file_write' | 'file_read' | 'shell_exec' | 'network' | 'other';

export interface PermissionWording {
  /** The card's question ("Run this command?"). */
  title: string;
  /** What kind of access, for the card's corner ("Shell command"). */
  kindLabel: string;
}

const BROWSER_TITLES: Readonly<Record<string, string>> = {
  open_browser_page: 'Open a page in the browser?',
  navigate_page: 'Open a page in the browser?',
  read_page: 'Read the browser page?',
  screenshot_page: 'Take a screenshot of the page?',
  click_element: 'Click in the browser page?',
  hover_element: 'Hover in the browser page?',
  drag_element: 'Drag in the browser page?',
  type_in_page: 'Type into the browser page?',
  handle_dialog: 'Answer a browser dialog?',
  run_playwright_code: 'Run code in the browser?',
};

/** D-146 — the platform's GitHub tools that ask before they act. */
const GITHUB_TITLES: Readonly<Record<string, string>> = {
  github_create_issue: 'Create a GitHub issue?',
  github_comment_issue: 'Comment on a GitHub issue?',
  github_close_issue: 'Close a GitHub issue?',
  github_merge_pull_request: 'Merge this pull request?',
};

/** U-76 — starting a workflow run asks in the asking modes; its name reads as a shell "run" otherwise. */
const WORKFLOW_TITLES: Readonly<Record<string, string>> = {
  run_workflow: 'Start a workflow run?',
};

/** `mcp__<server>__<tool>` → the server's name; undefined for any other tool. */
function mcpServerOf(toolName: string): string | undefined {
  if (!toolName.startsWith('mcp__')) return undefined;
  const parts = toolName.split('__');
  return parts.length >= 3 ? parts.slice(1, -1).join('__') || undefined : undefined;
}

/** The title and kind label of a permission gate for `toolName`. */
/** D-181 — the platform writes, worded as what they do to GeneratorAI. */
const PLATFORM_TITLES: Readonly<Record<string, string>> = {
  create_chat: 'Start a new chat?',
  send_to_chat: 'Send a message to another chat?',
  trigger_automation: 'Start this automation?',
};

export function permissionWording(toolName: string, type: PermissionWordingType | string): PermissionWording {
  const raw = humanizeToolName(toolName);
  const name = raw.toLowerCase();
  const display = toolDisplayName(toolName);
  const server = mcpServerOf(toolName);
  // The platform's own tools reach Claude through its in-process MCP server: worded as the tool, not a connector.
  const connector = server && server !== 'generatorai-tools' ? server : undefined;

  if (type === 'shell_exec') return { title: 'Run this command?', kindLabel: 'Shell command' };
  if (type === 'file_write') return { title: /^(write|create|create_file|write_file)$/.test(name) ? 'Create this file?' : 'Change this file?', kindLabel: 'File change' };
  if (type === 'file_read') return { title: 'Read this file?', kindLabel: 'File read' };
  if (type === 'network') return { title: name.includes('search') ? 'Search the web?' : 'Fetch this page?', kindLabel: 'Network' };
  if (connector) return { title: `Allow ${connector}: ${display}?`, kindLabel: `MCP · ${connector}` };

  const github = GITHUB_TITLES[name];
  if (github) return { title: github, kindLabel: 'GitHub' };
  const workflow = WORKFLOW_TITLES[name];
  if (workflow) return { title: workflow, kindLabel: 'Workflow' };
  // D-181 — a platform write says what it does to GeneratorAI.
  if (PLATFORM_TITLES[name]) return { title: PLATFORM_TITLES[name]!, kindLabel: 'GeneratorAI' };
  const kind = toolStepKind(toolName);
  if (kind === 'browser') return { title: BROWSER_TITLES[name] ?? 'Use the browser?', kindLabel: 'Browser' };
  if (kind === 'computer') return { title: `Control the computer: ${display}?`, kindLabel: 'Computer' };
  if (kind === 'widget') return { title: name === 'render_widget' ? 'Show a widget?' : `${display}?`, kindLabel: 'Widget' };
  if (kind === 'run') return { title: 'Run this command?', kindLabel: 'Shell command' };
  if (kind === 'edit') return { title: 'Change this file?', kindLabel: 'File change' };
  if (kind === 'read') return { title: 'Read this?', kindLabel: 'Read' };
  return { title: `Allow ${display}?`, kindLabel: 'Tool' };
}

// ── Computer use consent (the Computer tab's approval card, desktop and mobile) ──
// The driver's action names (`launch_app`, `setValue`, `plan`…) are not words a person reads.

const COMPUTER_ACTION: Record<string, { verb: string; title: (app: string) => string; detail: string }> = {
  launch_app: { verb: 'Open', title: (a) => `Open ${a}?`, detail: 'Starts the app, or finds it if it is already running.' },
  snapshot: { verb: 'Read', title: (a) => `Read the ${a} window?`, detail: 'Reads the controls and text of this one window — never your whole screen.' },
  list_windows: { verb: 'List', title: (a) => `List the ${a} windows?`, detail: 'Reads the titles and positions of its windows.' },
  verify: { verb: 'Check', title: (a) => `Check the ${a} window?`, detail: 'Reads the window again to confirm the last step worked.' },
  bring_to_front: { verb: 'Raise', title: (a) => `Bring ${a} to the front?`, detail: 'Moves its window in front of your other windows.' },
  click: { verb: 'Click', title: (a) => `Click in ${a}?`, detail: 'Clicks one control in the window.' },
  clickPoint: { verb: 'Click', title: (a) => `Click in ${a}?`, detail: 'Clicks a point in the window.' },
  setValue: { verb: 'Fill', title: (a) => `Fill a field in ${a}?`, detail: 'Writes a value into one field.' },
  performAction: { verb: 'Use', title: (a) => `Use a control in ${a}?`, detail: 'Triggers one control, such as pressing or expanding it.' },
  typeText: { verb: 'Type', title: (a) => `Type in ${a}?`, detail: 'Types text into the window.' },
  pressKey: { verb: 'Keys', title: (a) => `Press keys in ${a}?`, detail: 'Sends a key or shortcut to the window.' },
  pasteText: { verb: 'Paste', title: (a) => `Paste into ${a}?`, detail: 'Pastes text into the window.' },
  scroll: { verb: 'Scroll', title: (a) => `Scroll in ${a}?`, detail: 'Scrolls the window.' },
  drag: { verb: 'Drag', title: (a) => `Drag in ${a}?`, detail: 'Drags from one point of the window to another.' },
};

/** "Open Calculator?" — the approval card's title for one computer action, or several (`steps`) in one request. */
export function computerConsentTitle(action: string, appLabel: string, steps?: number): string {
  const app = appLabel || 'this app';
  if (action === 'plan' || steps) return `Run ${steps ?? 'these'} steps in ${app}?`;
  return COMPUTER_ACTION[action]?.title(app) ?? `Use ${app}?`;
}

/** One sentence on what the action does — the card's line under the title. */
export function computerConsentDetail(action: string, appLabel: string, steps?: number): string {
  if (action === 'plan' || steps) return `${steps ?? 'Several'} actions in ${appLabel || 'this app'}, approved together.`;
  return COMPUTER_ACTION[action]?.detail ?? `A desktop action in ${appLabel || 'this app'}.`;
}

/** A plan step's short verb ("Click", "Type"…), for the step list. */
export function computerActionVerb(action: string): string {
  return COMPUTER_ACTION[action]?.verb ?? action;
}

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
  const kind = toolStepKind(toolName);
  if (kind === 'browser') return { title: BROWSER_TITLES[name] ?? 'Use the browser?', kindLabel: 'Browser' };
  if (kind === 'computer') return { title: `Control the computer: ${display}?`, kindLabel: 'Computer' };
  if (kind === 'widget') return { title: name === 'render_widget' ? 'Show a widget?' : `${display}?`, kindLabel: 'Widget' };
  if (kind === 'run') return { title: 'Run this command?', kindLabel: 'Shell command' };
  if (kind === 'edit') return { title: 'Change this file?', kindLabel: 'File change' };
  if (kind === 'read') return { title: 'Read this?', kindLabel: 'Read' };
  return { title: `Allow ${display}?`, kindLabel: 'Tool' };
}

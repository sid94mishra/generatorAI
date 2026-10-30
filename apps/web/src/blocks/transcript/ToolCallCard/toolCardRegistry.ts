// ────────────────────────────────────────────────────────────────
// Tool-card registry (03-domain §1.5, §2.4 B-18; D-35 extension point).
//
// Every tool call renders as a step row. A registry entry can change how a
// tool's row reads (verb, target, result, icon), say which dock surface it
// opens in, and add a CARD under the row — the extension point the Workflow
// Overhaul uses for `run_workflow` (WF-12), `check_workflow_run` (WF-13) and
// `create_workflow_draft` (WF-14) without reopening the transcript.
//
//   import { registerToolCard } from '@/blocks/transcript';
//   const off = registerToolCard({
//     id: 'workflow.run',
//     match: 'run_workflow',
//     icon: 'workflows',
//     verb: () => 'Started workflow',
//     target: (step) => String((step.args as { name?: string })?.name ?? ''),
//     Card: WorkflowRunCard,            // (props: ToolCardProps) => ReactNode
//   });
//
// Resolution: an exact `match` string beats a RegExp or predicate; among
// entries of the same kind the most recently registered wins, so a later
// registration overrides a built-in. `registerToolCard` returns an
// unregister function (tests, hot reload). Register from `app/registries/`
// at module load — never from inside a component.
// ────────────────────────────────────────────────────────────────

import type { ComponentType, ReactNode } from 'react';
import type { IconConcept } from '@generatorai/design-tokens';
import type { TimelineStep } from '@generatorai/client-core';
import { humanizeToolName, isShellTool } from '@generatorai/shared/ui-contract';
import type { TranscriptActions } from '../transcriptContext.js';

/** What a registered card receives. */
export interface ToolCardProps {
  /** The step the tool call became (args, result, status, fileOp …). */
  step: TimelineStep;
  ctx: ToolCardContext;
}

export interface ToolCardContext {
  /** The surface's click-throughs and gate handlers (read-only surfaces provide none). */
  actions: TranscriptActions;
  /** The turn is still streaming. */
  live: boolean;
}

/** Dock surface a tool's row opens in (drives the row's trailing action). */
export type ToolCardOpenIn = 'terminal' | 'changes' | 'browser';

export interface ToolCardEntry {
  /** Unique id; registering the same id again replaces the entry. */
  id: string;
  /** Tool name (exact, after `mcp__server__` humanizing), a RegExp over it, or a predicate. */
  match: string | RegExp | ((tool: string) => boolean);
  /** Row glyph when the step is neutral (status glyphs still win for done/failed/running). */
  icon?: IconConcept;
  /** Row verb ("Ran", "Started workflow"). Default: the ui-contract verb for the tool. */
  verb?: (step: TimelineStep) => string;
  /** Row target (mono). Default: the arg-derived target. */
  target?: (step: TimelineStep) => string;
  /** Row result ("6 matches", "v2 → v3"). */
  result?: (step: TimelineStep) => ReactNode;
  /** Card drawn under the row (header "Called `tool` · subject", body, footer). */
  Card?: ComponentType<ToolCardProps>;
  /** Subject shown in the card header after the tool name. */
  subject?: (step: TimelineStep) => string;
  /** The dock surface the row's trailing action opens. */
  openIn?: ToolCardOpenIn;
}

const entries = new Map<string, ToolCardEntry>();
/** Registration order, for "latest wins". */
let order: string[] = [];

/** Add (or replace, by `id`) a tool-card entry. Returns an unregister function. */
export function registerToolCard(entry: ToolCardEntry): () => void {
  entries.set(entry.id, entry);
  order = [...order.filter((id) => id !== entry.id), entry.id];
  return () => {
    if (entries.get(entry.id) === entry) {
      entries.delete(entry.id);
      order = order.filter((id) => id !== entry.id);
    }
  };
}

function matches(entry: ToolCardEntry, tool: string, name: string): 'exact' | 'pattern' | null {
  const { match } = entry;
  if (typeof match === 'string') return match === tool || match === name ? 'exact' : null;
  if (match instanceof RegExp) return match.test(tool) || match.test(name) ? 'pattern' : null;
  return match(tool) || match(name) ? 'pattern' : null;
}

/** The entry for a tool name, or null. Exact beats pattern; latest registration wins. */
export function resolveToolCard(tool: string | undefined): ToolCardEntry | null {
  if (!tool) return null;
  const name = humanizeToolName(tool);
  let pattern: ToolCardEntry | null = null;
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const entry = entries.get(order[i]!);
    if (!entry) continue;
    const kind = matches(entry, tool, name);
    if (kind === 'exact') return entry;
    if (kind === 'pattern' && !pattern) pattern = entry;
  }
  return pattern;
}

/** Every registered entry, latest first (Storybook, tests). */
export function listToolCards(): ToolCardEntry[] {
  return [...order].reverse().flatMap((id) => {
    const entry = entries.get(id);
    return entry ? [entry] : [];
  });
}

// ── Built-in entries (the redesign's own tools, 03 §1.5 "First entries") ──

const FILE_EDIT_TOOLS = /^(edit|multiedit|write|notebookedit|create_file|str_replace_editor|apply_patch)$/i;

/** The redesign's entries: shell (terminal), file edits (changes), browser tools. */
export const BUILTIN_TOOL_CARDS: readonly ToolCardEntry[] = [
  { id: 'builtin.shell', match: (tool) => isShellTool(tool), icon: 'terminal', openIn: 'terminal' },
  { id: 'builtin.file-edit', match: FILE_EDIT_TOOLS, icon: 'edit', openIn: 'changes' },
  {
    id: 'builtin.browser',
    match: /^(open_browser_page|navigate_page|read_page|screenshot_page|click_element|hover_element|drag_element|type_in_page|handle_dialog|run_playwright_code)$/,
    icon: 'browser',
    openIn: 'browser',
  },
];

for (const entry of BUILTIN_TOOL_CARDS) registerToolCard(entry);

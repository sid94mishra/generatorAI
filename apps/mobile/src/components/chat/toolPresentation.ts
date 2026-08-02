// ────────────────────────────────────────────────────────────────
// Tool-call presentation.
//
// A transcript full of rows reading `str_replace_editor` is unreadable on a
// phone, where there is no room for the argument JSON that would explain it.
// This maps a raw tool name plus its arguments to a human label and a
// one-line summary — usually the file or command being acted on, which is
// the only detail that matters at a glance.
//
// Pure functions, no React, so the mapping is unit-testable and cannot drift
// with the renderer.
// ────────────────────────────────────────────────────────────────

export type ToolKind =
  | 'read'
  | 'edit'
  | 'create'
  | 'delete'
  | 'search'
  | 'shell'
  | 'web'
  | 'task'
  | 'think'
  | 'other';

interface Rule {
  kind: ToolKind;
  label: string;
  match: RegExp;
}

// Order matters: the first match wins, so specific patterns precede generic
// ones ("create_file" must not be caught by the /file/ read rule).
//
// Every keyword is anchored to a token boundary (start/end of string, or an
// underscore/dash/dot). Without that, `cat` matches "frobniCATe" and `find`
// matches "findings" — so an unknown tool silently renders as "Read file",
// which is worse than showing its raw name.
const B = String.raw`(?:^|[_\-.\s])`;
const E = String.raw`(?:$|[_\-.\s])`;

function anchored(...words: string[]): RegExp {
  return new RegExp(`${B}(?:${words.join('|')})${E}`, 'i');
}

const RULES: Rule[] = [
  { kind: 'create', label: 'Create file', match: anchored('create', 'new', 'write', 'touch') },
  { kind: 'delete', label: 'Delete', match: anchored('delete', 'remove', 'rm', 'unlink') },
  {
    kind: 'edit',
    label: 'Edit file',
    match: anchored('edit', 'replace', 'patch', 'apply', 'insert', 'str'),
  },
  { kind: 'read', label: 'Read file', match: anchored('read', 'cat', 'view', 'open', 'get') },
  {
    kind: 'search',
    label: 'Search',
    match: anchored('grep', 'search', 'find', 'glob', 'ripgrep', 'semantic', 'list'),
  },
  {
    kind: 'shell',
    label: 'Run command',
    match: anchored('bash', 'sh', 'shell', 'terminal', 'exec', 'run', 'powershell', 'cmd'),
  },
  { kind: 'web', label: 'Fetch', match: anchored('fetch', 'http', 'browser', 'navigate', 'url', 'web') },
  { kind: 'task', label: 'Task', match: anchored('todo', 'task', 'plan', 'subagent', 'agent') },
  { kind: 'think', label: 'Think', match: anchored('think', 'reason', 'reflect') },
];

export function toolKind(tool: string): ToolKind {
  for (const rule of RULES) if (rule.match.test(tool)) return rule.kind;
  return 'other';
}

/** "str_replace_editor" → "Edit file"; unknown names are humanised. */
export function toolLabel(tool: string): string {
  for (const rule of RULES) if (rule.match.test(tool)) return rule.label;
  return tool
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

const SUMMARY_KEYS = [
  'path',
  'filePath',
  'file_path',
  'file',
  'filename',
  'target',
  'command',
  'cmd',
  'query',
  'pattern',
  'url',
  'description',
  'prompt',
] as const;

/**
 * The single most informative argument, trimmed to one line.
 *
 * Falls back to nothing rather than dumping JSON: a truncated JSON blob in a
 * collapsed row is noise, and the full arguments are one tap away anyway.
 */
export function toolSummary(args: unknown): string | null {
  if (typeof args === 'string') return firstLine(args);
  if (!args || typeof args !== 'object') return null;

  const record = args as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return firstLine(value);
  }
  return null;
}

function firstLine(text: string): string {
  const line = text.split('\n', 1)[0]?.trim() ?? '';
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

/** True when a tool result is a unified diff worth rendering as one. */
export function looksLikeDiff(result: unknown): result is string {
  if (typeof result !== 'string') return false;
  return /^(diff --git |--- |@@ -\d)/m.test(result) && result.includes('@@');
}

/** `1.4s`, `340ms`, `2m 05s` — never a bare millisecond count. */
export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

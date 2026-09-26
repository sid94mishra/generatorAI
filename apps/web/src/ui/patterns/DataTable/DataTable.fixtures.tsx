// Story-only sample data and column definitions in the shape of the ChatsList
// board (docs/redesign/boards/web/ChatsList.dc.html). Stories are demo
// scaffolding (D-45); nothing in the app imports this file.

import type { StatusState } from '@generatorai/shared';
import { Avatar } from '../../primitives/Avatar/Avatar.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { Link } from '../../primitives/Link/Link.js';
import { StatusBadge } from '../../primitives/StatusBadge/StatusBadge.js';
import type { DataTableColumn } from './DataTable.js';

export interface SampleChat {
  id: string;
  title: string;
  project: string;
  agent: string;
  state: StatusState | 'archived';
  added: number | null;
  removed: number | null;
  activity: string;
}

const BASE: Omit<SampleChat, 'id'>[] = [
  { title: 'Fix flaky checkout test', project: 'payments-service', agent: 'Bug Fixer', state: 'needs_you', added: 18, removed: 8, activity: '3m' },
  { title: 'Upgrade React Flow to v12', project: 'web-dashboard', agent: 'Orchestrator', state: 'running', added: 146, removed: 92, activity: 'now' },
  { title: 'Memory leak in worker', project: 'payments-service', agent: 'Bug Fixer', state: 'running', added: 6, removed: 1, activity: 'now' },
  { title: 'Audit IAM policies', project: 'infra-terraform', agent: 'Security Auditor', state: 'succeeded', added: 212, removed: 48, activity: '1h' },
  { title: 'Draft release notes 2.4', project: 'docs-site', agent: 'Release Scribe', state: 'succeeded', added: 96, removed: 12, activity: '2h' },
  { title: 'Refactor pricing module', project: 'payments-service', agent: 'Bug Fixer', state: 'failed', added: 38, removed: 4, activity: '2h' },
  { title: 'Write tests for currency rounding', project: 'payments-service', agent: 'Test Writer', state: 'succeeded', added: 120, removed: 0, activity: '4h' },
  { title: 'Review dark-mode token PR 1176', project: 'web-dashboard', agent: 'Code Reviewer', state: 'succeeded', added: null, removed: null, activity: '5h' },
  { title: 'Bump terraform aws provider to 6.x', project: 'infra-terraform', agent: 'Bug Fixer', state: 'succeeded', added: 14, removed: 14, activity: 'Yesterday' },
  { title: 'Explain checkout state machine', project: 'payments-service', agent: 'Orchestrator', state: 'succeeded', added: null, removed: null, activity: 'Yesterday' },
  { title: 'Add retry budget to webhooks', project: 'payments-service', agent: 'Bug Fixer', state: 'succeeded', added: 54, removed: 9, activity: 'Sep 21' },
  { title: 'Docs search indexing', project: 'docs-site', agent: 'Test Writer', state: 'archived', added: 31, removed: 2, activity: 'Sep 19' },
];

/** `count` rows cycling through the board's twelve. */
export function sampleChats(count = BASE.length): SampleChat[] {
  return Array.from({ length: count }, (_, i) => {
    const base = BASE[i % BASE.length]!;
    return { ...base, id: `chat-${i + 1}`, title: i < BASE.length ? base.title : `${base.title} (${Math.floor(i / BASE.length) + 1})` };
  });
}

export const CHAT_COLUMNS: DataTableColumn<SampleChat>[] = [
  {
    id: 'title',
    header: 'Title',
    width: 'minmax(240px,1fr)',
    cell: (row) => (
      <Link href={`#${row.id}`} className="truncate">
        {row.title}
      </Link>
    ),
  },
  { id: 'project', header: 'Project', width: 156, mono: true, hideBelow: 1080, cell: (row) => <span className="truncate text-small text-fg-2">{row.project}</span> },
  {
    id: 'agent',
    header: 'Agent',
    width: 166,
    cell: (row) => (
      <span className="flex min-w-0 items-center gap-2 text-fg-2">
        <Avatar name={row.agent} size={20} decorative />
        <span className="truncate">{row.agent}</span>
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    width: 120,
    cell: (row) =>
      row.state === 'archived' ? (
        <StatusBadge state="skipped" label="Archived" />
      ) : (
        <StatusBadge state={row.state} context="chat" />
      ),
  },
  {
    id: 'changes',
    header: 'Changes',
    width: 80,
    align: 'end',
    hideBelow: 1080,
    cell: (row) =>
      row.added === null ? (
        <span className="font-mono text-micro text-fg-3">—</span>
      ) : (
        <span className="font-mono text-micro">
          <span className="text-ok">+{row.added}</span> <span className="text-err">−{row.removed}</span>
        </span>
      ),
  },
  { id: 'activity', header: 'Activity', width: 88, align: 'end', mono: true, sortable: true, cell: (row) => row.activity },
];

export function chatRowActions(row: SampleChat) {
  return (
    <>
      <IconButton size="sm" icon="archive" label={`Archive ${row.title}`} tooltip={false} />
      <IconButton size="sm" icon="more" label={`More for ${row.title}`} tooltip={false} />
    </>
  );
}

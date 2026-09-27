// ────────────────────────────────────────────────────────────────
// CodebaseDetail · Files (P5-05; F-projects-09; 04 §4.5 #51). A lazily
// loaded tree of the codebase (the server lists one directory per request,
// .gitignore applied) beside a preview: Markdown renders, with a Rendered /
// Source switch; anything else is highlighted source with line numbers.
//
// Not the B-08 FileTree block: that tree needs every path up front, and this
// API is per-directory — walking a large repository eagerly would be one
// request per folder before anything shows.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { FileEntry } from '@generatorai/shared';
import { useCodebaseFileContent, useCodebaseFiles } from '@/hooks/projectQueries.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { CodeBlock } from '@/ui/patterns/CodeBlock/CodeBlock.js';
import { langFromPath } from '@/ui/patterns/CodeBlock/langFromPath.js';
import { Markdown } from '@/ui/patterns/Markdown/Markdown.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Card } from '@/ui/primitives/Card/Card.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { SearchInput } from '@/ui/primitives/SearchInput/SearchInput.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';
import { SkeletonRows } from '@/ui/primitives/Skeleton/Skeleton.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { formatBytes } from '../projectFormat.js';

/** Past this size a file shows as plain text: highlighting it would stall the page. */
const HIGHLIGHT_LIMIT = 200_000;
const INDENT_PX = 14;

interface TreeProps {
  projectId: string;
  codebaseId: string;
  filter: string;
  selected: string | null;
  onSelect: (path: string) => void;
}

function TreeNode({ entry, depth, ...props }: TreeProps & { entry: FileEntry; depth: number }) {
  const [open, setOpen] = useState(false);
  const dir = entry.type === 'directory';
  const { data: children, isLoading } = useCodebaseFiles(open && dir ? props.projectId : undefined, props.codebaseId, entry.path);
  const q = props.filter.trim().toLowerCase();
  const visible = (children ?? []).filter((c) => !q || c.type === 'directory' || c.name.toLowerCase().includes(q));
  const isSelected = !dir && props.selected === entry.path;
  const pad = { paddingLeft: depth * INDENT_PX + 8 };

  return (
    <li>
      <Button
        variant="ghost"
        size="sm"
        fullWidth
        onClick={() => (dir ? setOpen((v) => !v) : props.onSelect(entry.path))}
        aria-expanded={dir ? open : undefined}
        aria-current={isSelected ? 'true' : undefined}
        className={cn('justify-start pr-2 text-fg', isSelected && 'bg-selected')}
        style={pad}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Icon concept={dir ? (open ? 'chevron-down' : 'chevron-right') : 'file'} size={12} className="shrink-0 text-fg-3" />
          {dir ? <Icon concept={open ? 'folder-open' : 'projects'} size={14} className="shrink-0 text-fg-3" /> : null}
          <span className="min-w-0 flex-1 truncate text-left">{entry.name}</span>
          {!dir && entry.size !== undefined ? <span className="shrink-0 font-mono text-micro text-fg-3">{formatBytes(entry.size)}</span> : null}
        </span>
      </Button>
      {dir && open ? (
        isLoading ? (
          <div className="flex items-center gap-1.5 py-1 text-micro text-fg-3" style={{ paddingLeft: (depth + 1) * INDENT_PX + 8 }}>
            <Spinner size={12} /> Loading…
          </div>
        ) : visible.length === 0 ? (
          <p className="py-1 text-micro text-fg-3" style={{ paddingLeft: (depth + 1) * INDENT_PX + 8 }}>
            {children && children.length > 0 ? 'No matches' : 'Empty folder'}
          </p>
        ) : (
          <ul>
            {visible.map((child) => (
              <TreeNode key={child.path} entry={child} depth={depth + 1} {...props} />
            ))}
          </ul>
        )
      ) : null}
    </li>
  );
}

function Preview({ projectId, codebaseId, path }: { projectId: string; codebaseId: string; path: string }) {
  const { data: content, isLoading, error } = useCodebaseFileContent(projectId, codebaseId, path);
  const [mode, setMode] = useState<'rendered' | 'source'>('rendered');
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const markdown = ext === 'md' || ext === 'mdx';
  const name = path.split('/').pop() ?? path;

  let body;
  if (isLoading) body = <SkeletonRows rows={8} label="Loading file" />;
  else if (error) body = <EmptyState tone="error" icon="warning" title="Couldn't load the file" description={String(error)} />;
  else if (content === undefined) body = null;
  else if (markdown && mode === 'rendered') body = <Markdown>{content}</Markdown>;
  else
    body = (
      <CodeBlock lang={content.length > HIGHLIGHT_LIMIT ? undefined : langFromPath(path)} copy={content} lineNumbers>
        {content}
      </CodeBlock>
    );

  return (
    <Card className="flex min-w-0 flex-1 flex-col" data-testid="codebase-file-preview">
      <Card.Header
        action={
          markdown ? (
            <SegmentedControl<'rendered' | 'source'>
              value={mode}
              onValueChange={setMode}
              label="Markdown view"
              items={[
                { value: 'rendered', label: 'Rendered' },
                { value: 'source', label: 'Source' },
              ]}
            />
          ) : undefined
        }
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="shrink-0 text-ui font-semibold">{name}</span>
          <span className="truncate font-mono text-micro text-fg-3">{path}</span>
        </div>
      </Card.Header>
      <Card.Body>{body}</Card.Body>
    </Card>
  );
}

export function FilesTab({ projectId, codebaseId }: { projectId: string; codebaseId: string }) {
  const { data: root, isLoading, error } = useCodebaseFiles(projectId, codebaseId);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const q = filter.trim().toLowerCase();
  const visible = (root ?? []).filter((e) => !q || e.type === 'directory' || e.name.toLowerCase().includes(q));

  return (
    <div className="flex items-start gap-4">
      <Card className="flex w-side-rail shrink-0 flex-col">
        <div className="border-b border-line-soft p-2">
          <SearchInput value={filter} onValueChange={setFilter} label="Filter files" placeholder="Filter loaded files" shortcut={null} />
        </div>
        <nav aria-label="Codebase files" className="p-1.5">
          {isLoading ? (
            <SkeletonRows rows={6} label="Loading files" />
          ) : error ? (
            <EmptyState tone="error" icon="warning" title="Couldn't list the files" description={String(error)} />
          ) : visible.length === 0 ? (
            <p className="p-3 text-center text-small text-fg-3">{root && root.length > 0 ? 'No matches' : 'No files in this codebase.'}</p>
          ) : (
            <ul>
              {visible.map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  projectId={projectId}
                  codebaseId={codebaseId}
                  filter={filter}
                  selected={selected}
                  onSelect={setSelected}
                />
              ))}
            </ul>
          )}
        </nav>
      </Card>
      {selected ? (
        <Preview projectId={projectId} codebaseId={codebaseId} path={selected} />
      ) : (
        <EmptyState framed className="min-w-0 flex-1" icon="file" title="Select a file" description="Pick a file in the tree to preview it." />
      )}
    </div>
  );
}

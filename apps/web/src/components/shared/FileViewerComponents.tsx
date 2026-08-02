// ────────────────────────────────────────────────────────────────
// Shared File Viewer Components — reusable file tree, file viewer
// modal, changes viewer modal, and utilities used by both
// RunArtifactsPanel (workflows) and ChatFilesPanel (chats).
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useMemo, memo } from 'react';
import {
  FolderOpen,
  Folder,
  FolderGit2,
  ChevronRight,
  ChevronDown,
  Loader2,
  Download,
  DownloadCloud,
  GitCommit,
  Eye,
  Circle,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils.js';
import hljs from 'highlight.js';
import { Modal, Button } from '@/components/ui/index.js';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer.js';
import { FileCodeView } from '@/components/diff/FileCodeView.js';
import { FileTypeIcon } from '@/components/shared/fileIcons.js';

// ── Types ──

export type FileSource = 'workspace' | 'artifacts' | 'uploads' | 'worktree' | 'source';

export interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  children: TreeNode[];
  source: FileSource;
  worktreeAlias?: string;
}

export interface ChangeEntry {
  path: string;
  status: string; // 'added' | 'modified' | 'deleted' | 'renamed' | 'new'
  diff: string;
  source: FileSource;
}

export interface DiffLine {
  type: 'context' | 'addition' | 'deletion' | 'header';
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

// ── Build tree from flat paths ──

export function buildFileTree(
  files: string[],
  source: FileSource,
  worktreeAlias?: string,
): TreeNode[] {
  const root: TreeNode[] = [];

  for (const filePath of files) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      const isLast = i === parts.length - 1;
      const pathSoFar = parts.slice(0, i + 1).join('/');

      let existing = current.find((n) => n.name === name && n.isFolder === !isLast);
      if (!existing) {
        existing = {
          name,
          path: pathSoFar,
          isFolder: !isLast,
          children: [],
          source,
          worktreeAlias,
        };
        current.push(existing);
      }
      if (!isLast) {
        current = existing!.children;
      }
    }
  }

  function sortTree(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.isFolder) sortTree(node.children);
    }
  }
  sortTree(root);
  return root;
}

// ── File icon helper ──
// Delegates to the shared Material Icon Theme mapping (fileIcons.tsx) so the
// chat/workflow file trees show the same editor-style icons as the codebase
// browser. The 3.5 size matches these dense tree rows.

export function getFileIcon(name: string) {
  return <FileTypeIcon name={name} className="h-3.5 w-3.5" />;
}

export function getLanguage(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.d.ts') || lower.endsWith('.d.mts') || lower.endsWith('.d.cts')) return 'typescript';
  const ext = lower.split('.').pop() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', sh: 'bash', rs: 'rust', go: 'go', java: 'java',
    cs: 'csharp', cpp: 'cpp', c: 'c', rb: 'ruby', php: 'php',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml',
    md: 'markdown', html: 'html', css: 'css', scss: 'scss',
    sql: 'sql', graphql: 'graphql', dockerfile: 'dockerfile',
  };
  return map[ext] || 'text';
}

/** Syntax-highlight a code string using highlight.js. Returns HTML string. */
export function highlightCode(code: string, language: string): string {
  if (!code || language === 'text' || language === 'markdown') return '';
  try {
    if (hljs.getLanguage(language)) {
      return hljs.highlight(code, { language }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return '';
  }
}

/** Parse a unified diff string into annotated lines */
export function parseUnifiedDiff(rawDiff: string): DiffLine[] {
  if (!rawDiff) return [];
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of rawDiff.split('\n')) {
    if (raw.startsWith('diff --git') || raw.startsWith('index ') || raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('\\')) {
      lines.push({ type: 'header', content: raw, oldLineNo: null, newLineNo: null });
    } else if (raw.startsWith('@@')) {
      const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1]!, 10);
        newLine = parseInt(match[2]!, 10);
      }
      lines.push({ type: 'header', content: raw, oldLineNo: null, newLineNo: null });
    } else if (raw.startsWith('+')) {
      lines.push({ type: 'addition', content: raw.substring(1), oldLineNo: null, newLineNo: newLine });
      newLine++;
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'deletion', content: raw.substring(1), oldLineNo: oldLine, newLineNo: null });
      oldLine++;
    } else {
      lines.push({ type: 'context', content: raw.startsWith(' ') ? raw.substring(1) : raw, oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
    }
  }
  return lines;
}

/** Status code → badge color and label */
export function getStatusBadge(status: string): { label: string; color: string; dotColor: string } {
  switch (status) {
    case 'added': return { label: 'A', color: 'bg-green-500/10 text-green-500', dotColor: 'fill-green-500 text-green-500' };
    case 'deleted': return { label: 'D', color: 'bg-red-500/10 text-red-500', dotColor: 'fill-red-500 text-red-500' };
    case 'renamed': return { label: 'R', color: 'bg-blue-500/10 text-blue-500', dotColor: 'fill-blue-500 text-blue-500' };
    case 'modified': return { label: 'M', color: 'bg-yellow-500/10 text-yellow-500', dotColor: 'fill-yellow-500 text-yellow-500' };
    default: return { label: 'N', color: 'bg-green-500/10 text-green-500', dotColor: 'fill-green-500 text-green-500' };
  }
}

// ── Highlighted Code Block ──

export const HighlightedCodeBlock = memo(function HighlightedCodeBlock({ code, language }: { code: string; language: string }) {
  const highlighted = useMemo(() => {
    const html = highlightCode(code, language);
    if (!html) return null;
    return html.split('\n');
  }, [code, language]);

  if (!highlighted) {
    return (
      <pre className="p-4 text-xs leading-relaxed font-mono text-[var(--color-foreground)]">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div className="w-full overflow-x-auto font-mono text-xs leading-relaxed">
      <table className="w-full border-collapse">
        <tbody>
          {highlighted.map((lineHtml, i) => (
            <tr key={i} className="hover:bg-[var(--color-accent)]/50">
              <td className="select-none border-r border-[var(--color-border)] px-3 py-0 text-right text-[var(--color-muted-foreground)]/60 w-10">
                {i + 1}
              </td>
              <td className="px-4 py-0">
                <span dangerouslySetInnerHTML={{ __html: lineHtml || ' ' }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

// ── Tree Node Component ──

export interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  onFileClick: (path: string, source: FileSource, worktreeAlias?: string) => void;
  selectedFile: string | null;
  /** Optional download handler */
  onDownload?: (path: string, source: FileSource, worktreeAlias?: string) => void;
}

export const TreeNodeItem = memo(function TreeNodeItem({ node, depth, onFileClick, selectedFile, onDownload }: TreeNodeItemProps) {
  const [expanded, setExpanded] = useState(depth < 2);

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDownload?.(node.path, node.source, node.worktreeAlias);
    },
    [onDownload, node.path, node.source, node.worktreeAlias],
  );

  if (node.isFolder) {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-[11px] hover:bg-[var(--color-accent)] transition-colors"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0 text-[var(--color-muted-foreground)]" />
          )}
          {expanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-yellow-500" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-yellow-500" />
          )}
          <span className="truncate font-medium text-[var(--color-foreground)]">{node.name}</span>
          <span className="ml-auto text-[9px] text-[var(--color-muted-foreground)]">
            {node.children.length}
          </span>
        </button>
        {expanded && (
          <div>
            {node.children.map((child) => (
              <TreeNodeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                onFileClick={onFileClick}
                selectedFile={selectedFile}
                onDownload={onDownload}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedFile === node.path;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onFileClick(node.path, node.source, node.worktreeAlias)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onFileClick(node.path, node.source, node.worktreeAlias))}
      className={cn(
        'group flex w-full items-center gap-1 rounded px-1 py-0.5 text-[11px] cursor-pointer transition-colors',
        isSelected ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'hover:bg-[var(--color-accent)]',
      )}
      style={{ paddingLeft: `${depth * 12 + 16}px` }}
    >
      {getFileIcon(node.name)}
      <span className="truncate text-[var(--color-foreground)]">{node.name}</span>
      {node.source === 'workspace' && (
        <Circle className="ml-0.5 h-2 w-2 shrink-0 fill-green-500 text-green-500" aria-label="New file" />
      )}
      {node.source === 'artifacts' && (
        <Circle className="ml-0.5 h-2 w-2 shrink-0 fill-blue-500 text-blue-500" aria-label="Generated" />
      )}
      {onDownload && (
        <button
          onClick={handleDownload}
          title={`Download ${node.name}`}
          className="ml-auto hidden p-0.5 rounded hover:bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] group-hover:block"
        >
          <Download className="h-3 w-3" />
        </button>
      )}
    </div>
  );
});

// ── File Tree Section (collapsible source group) ──

export interface FileTreeSectionProps {
  title: string;
  icon: React.ReactNode;
  badge: { count: number; color: string };
  files: string[];
  source: FileSource;
  worktreeAlias?: string;
  defaultExpanded?: boolean;
  onFileClick: (path: string, source: FileSource, worktreeAlias?: string) => void;
  selectedFile: string | null;
  emptyMessage: string;
  onDownload?: (path: string, source: FileSource, worktreeAlias?: string) => void;
  onDownloadAll?: (files: string[], source: FileSource, worktreeAlias?: string) => void;
}

export function FileTreeSection({
  title, icon, badge, files, source, worktreeAlias, defaultExpanded = true,
  onFileClick, selectedFile, emptyMessage, onDownload, onDownloadAll,
}: FileTreeSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const tree = useMemo(() => buildFileTree(files, source, worktreeAlias), [files, source, worktreeAlias]);

  const handleDownloadAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDownloadAll?.(files, source, worktreeAlias);
    },
    [onDownloadAll, files, source, worktreeAlias],
  );

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-[var(--color-foreground)]">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex flex-1 items-center gap-2 text-left hover:opacity-80"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {icon}
          <span className="text-xs">{title}</span>
        </button>
        {files.length > 0 && (
          <>
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.color}`}>
              {badge.count}
            </span>
            {onDownloadAll && (
              <button
                onClick={handleDownloadAll}
                title="Download all"
                className="p-0.5 rounded hover:bg-[var(--color-muted)] text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              >
                <DownloadCloud className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}
      </div>

      {expanded && (
        <div className="border-t border-[var(--color-border)] py-1 max-h-64 overflow-y-auto">
          {files.length === 0 ? (
            <p className="py-3 text-center text-[11px] text-[var(--color-muted-foreground)]">{emptyMessage}</p>
          ) : (
            tree.map((node) => (
              <TreeNodeItem
                key={node.path}
                node={node}
                depth={0}
                onFileClick={onFileClick}
                selectedFile={selectedFile}
                onDownload={onDownload}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── File Viewer Modal ──

export interface FileViewerModalProps {
  filePath: string;
  source: FileSource;
  worktreeAlias?: string;
  onClose: () => void;
  /** Hook to load file content — caller provides this to decouple from specific API */
  fileContent: { content: string | null; truncated: boolean; size: number } | undefined;
  isLoading: boolean;
  error?: unknown;
  onDownload?: () => void;
}

export function FileViewerModal({ filePath, source, worktreeAlias, onClose, fileContent, isLoading, error, onDownload }: FileViewerModalProps) {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const lang = getLanguage(fileName);

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex min-w-0 items-center gap-2">
          {getFileIcon(fileName)}
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{filePath}</span>
          {source === 'workspace' && (
            <span className="rounded-full bg-success-muted px-2 py-0.5 text-[10px] font-medium text-success">New</span>
          )}
          {source === 'artifacts' && (
            <span className="rounded-full bg-info-muted px-2 py-0.5 text-[10px] font-medium text-info">Generated</span>
          )}
          {onDownload && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDownload}
              title="Download"
              aria-label="Download"
            >
              <Download className="h-4 w-4" />
            </Button>
          )}
        </span>
      }
      footer={
        fileContent ? (
          <div className="flex w-full items-center justify-between text-[10px] text-muted-foreground">
            <span>{lang}</span>
            <span>{(fileContent.size / 1024).toFixed(1)} KB</span>
          </div>
        ) : undefined
      }
    >
      {/* Content — full-bleed inside the Modal body */}
      <div className="-mx-5 -my-4 h-[calc(100%+2rem)] overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted-foreground)]" />
          </div>
        ) : error ? (
          <div className="p-6 text-center text-sm text-red-500">Failed to load file content</div>
        ) : fileContent?.truncated ? (
          <div className="p-6 text-center text-sm text-[var(--color-muted-foreground)]">
            File too large to preview ({(fileContent.size / 1024).toFixed(0)} KB). Use download instead.
          </div>
        ) : fileContent?.content != null ? (
          lang === 'markdown' ? (
            <div className="p-4">
              <MarkdownRenderer content={fileContent.content} />
            </div>
          ) : (
            // Shared viewer: virtualized + Shiki, matching the Changes panel.
            // The modal supplies its own title bar, so the built-in header is
            // suppressed to avoid showing the filename twice.
            <FileCodeView
              name={filePath}
              contents={fileContent.content}
              cacheKey={`${source}:${filePath}:${fileContent.content.length}`}
              hideHeader
              style={{ height: '100%', overflow: 'auto' }}
            />
          )
        ) : (
          <div className="p-6 text-center text-sm text-[var(--color-muted-foreground)]">No content</div>
        )}
      </div>
    </Modal>
  );
}

// ── Changes Viewer Modal ──

export interface ChangesViewerModalProps {
  onClose: () => void;
  changeEntries: ChangeEntry[];
  isLoading: boolean;
  hasGit: boolean;
  /** Hook to fetch file content for a given entry — caller provides implementation */
  renderFileContent: (entry: ChangeEntry) => React.ReactNode;
  /** File index to open initially (e.g. when a specific file was clicked). */
  initialIndex?: number;
}

export function ChangesViewerModal({ onClose, changeEntries, isLoading, hasGit, renderFileContent, initialIndex = 0 }: ChangesViewerModalProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  if (changeEntries.length === 0 && !isLoading) {
    return (
      <Modal
        open
        onClose={onClose}
        size="xl"
        title={
          <span className="flex items-center gap-2">
            <GitCommit className="h-4 w-4 text-green-500" />
            All Changes
            <span className="text-xs font-normal text-muted-foreground">No changes detected</span>
          </span>
        }
      >
        <div className="flex items-center justify-center py-16 text-sm text-[var(--color-muted-foreground)]">
          No changes found.
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={
        <span className="flex items-center gap-2">
          <GitCommit className="h-4 w-4 text-green-500" />
          All Changes
          <span className="text-xs font-normal text-muted-foreground">
            {isLoading ? 'Loading...' : `${changeEntries.length} file${changeEntries.length !== 1 ? 's' : ''} ${hasGit ? 'changed' : 'generated'}`}
          </span>
          {hasGit && (
            <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-500">git diff</span>
          )}
          {!hasGit && !isLoading && (
            <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-medium text-muted-foreground">all files</span>
          )}
        </span>
      }
    >
      {/* Full-bleed two-pane layout inside the Modal body */}
      <div className="-mx-5 -my-4 flex h-[calc(100%+2rem)] flex-col overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-muted-foreground)]" />
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* File list sidebar */}
            <div className="w-56 shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-card)]">
              {changeEntries.map((entry, i) => {
                const name = entry.path.split(/[/\\]/).pop() ?? entry.path;
                const badge = getStatusBadge(entry.status);
                return (
                  <button
                    key={entry.path}
                    onClick={() => setCurrentIndex(i)}
                    className={cn(
                      'flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] transition-colors',
                      i === currentIndex
                        ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                        : 'hover:bg-[var(--color-accent)] text-[var(--color-foreground)]',
                    )}
                  >
                    {getFileIcon(name)}
                    <span className="truncate">{name}</span>
                    {hasGit ? (
                      <span className={`ml-auto rounded px-1 text-[9px] font-bold ${badge.color}`}>{badge.label}</span>
                    ) : (
                      <Circle className={`ml-auto h-2 w-2 shrink-0 ${badge.dotColor}`} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-hidden flex flex-col">
              {changeEntries[currentIndex] && renderFileContent(changeEntries[currentIndex])}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Change File Content Renderer (shared rendering logic) ──

export interface ChangeFileContentRendererProps {
  entry: ChangeEntry;
  hasGit: boolean;
  fileContent: { content: string | null; truncated: boolean; size: number } | undefined;
  isLoading: boolean;
}

export function ChangeFileContentRenderer({ entry, hasGit, fileContent, isLoading }: ChangeFileContentRendererProps) {
  const fileName = entry.path.split(/[/\\]/).pop() ?? entry.path;
  const lang = getLanguage(fileName);
  const badge = getStatusBadge(entry.status);

  const diffLines = useMemo(() => parseUnifiedDiff(entry.diff), [entry.diff]);
  const showGitDiff = hasGit && diffLines.length > 0;

  // Pre-compute syntax highlighting for diff lines
  const highlightedDiffLines = useMemo(() => {
    if (!showGitDiff || lang === 'text' || lang === 'markdown') return null;
    const contentLines = diffLines.filter((l) => l.type !== 'header');
    const rawCode = contentLines.map((l) => l.content).join('\n');
    const html = highlightCode(rawCode, lang);
    if (!html) return null;
    const htmlLines = html.split('\n');
    const result = new Map<number, string>();
    let ci = 0;
    for (let i = 0; i < diffLines.length; i++) {
      if (diffLines[i]!.type !== 'header') {
        result.set(i, htmlLines[ci] ?? '');
        ci++;
      }
    }
    return result;
  }, [diffLines, showGitDiff, lang]);

  // Pre-compute syntax highlighting for fallback view
  const highlightedFallback = useMemo(() => {
    if (!fileContent?.content || lang === 'text' || lang === 'markdown') return null;
    const html = highlightCode(fileContent.content, lang);
    if (!html) return null;
    return html.split('\n');
  }, [fileContent?.content, lang]);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-muted)]/30 px-4 py-1.5">
        {getFileIcon(fileName)}
        <span className="text-xs font-mono text-[var(--color-foreground)]">{entry.path}</span>
        <span className={`ml-2 rounded-full px-2 py-0.5 text-[9px] font-medium ${badge.color}`}>
          {entry.status === 'new' ? 'NEW' : entry.status.toUpperCase()}
        </span>
        {fileContent && <span className="ml-auto text-[10px] text-[var(--color-muted-foreground)]">{(fileContent.size / 1024).toFixed(1)} KB</span>}
      </div>

      <div className="flex-1 overflow-auto">
        {showGitDiff ? (
          <div className="w-full overflow-x-auto font-mono text-[11px] leading-5">
            {diffLines.map((line, i) => {
              if (line.type === 'header') {
                return (
                  <div key={i} className="bg-blue-500/5 px-4 py-0.5 text-blue-400 select-none">
                    {line.content}
                  </div>
                );
              }
              const bgColor =
                line.type === 'addition' ? 'bg-green-500/10' :
                line.type === 'deletion' ? 'bg-red-500/10' : '';
              const textColor =
                line.type === 'addition' ? 'text-green-500' :
                line.type === 'deletion' ? 'text-red-500' : 'text-[var(--color-muted-foreground)]';
              const prefix =
                line.type === 'addition' ? '+' :
                line.type === 'deletion' ? '-' : ' ';

              const hlHtml = highlightedDiffLines?.get(i);

              return (
                <div key={i} className={`flex ${bgColor}`}>
                  <span className="w-10 shrink-0 select-none border-r border-[var(--color-border)] px-1 text-right text-[var(--color-muted-foreground)]/50">
                    {line.oldLineNo ?? ''}
                  </span>
                  <span className="w-10 shrink-0 select-none border-r border-[var(--color-border)] px-1 text-right text-[var(--color-muted-foreground)]/50">
                    {line.newLineNo ?? ''}
                  </span>
                  <span className={`w-5 shrink-0 select-none text-center ${textColor}`}>{prefix}</span>
                  {hlHtml ? (
                    <pre className="flex-1 px-2 text-[var(--color-foreground)]" dangerouslySetInnerHTML={{ __html: hlHtml || ' ' }} />
                  ) : (
                    <pre className="flex-1 px-2 text-[var(--color-foreground)]">{line.content || ' '}</pre>
                  )}
                </div>
              );
            })}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
          </div>
        ) : fileContent?.truncated ? (
          <div className="p-6 text-center text-xs text-[var(--color-muted-foreground)]">
            Too large to preview ({(fileContent.size / 1024).toFixed(0)} KB)
          </div>
        ) : fileContent?.content != null ? (
          lang === 'markdown' ? (
            <div className="p-4">
              <MarkdownRenderer content={fileContent.content} />
            </div>
          ) : (
            <div className="flex w-full overflow-x-auto font-mono text-[11px] leading-5">
              <div className="shrink-0 select-none border-r border-[var(--color-border)] bg-green-500/5 px-2 py-2 text-right text-[var(--color-muted-foreground)]">
                {fileContent.content.split('\n').map((_: string, i: number) => (
                  <div key={i} className="text-green-600/60">{i + 1}</div>
                ))}
              </div>
              <div className="flex-1 py-2">
                {highlightedFallback ? (
                  highlightedFallback.map((lineHtml: string, i: number) => (
                    <div key={i} className="flex">
                      <span className="w-5 shrink-0 select-none text-center text-green-500">+</span>
                      <pre className="flex-1 px-2 text-[var(--color-foreground)] bg-green-500/5" dangerouslySetInnerHTML={{ __html: lineHtml || ' ' }} />
                    </div>
                  ))
                ) : (
                  fileContent.content.split('\n').map((line: string, i: number) => (
                    <div key={i} className="flex">
                      <span className="w-5 shrink-0 select-none text-center text-green-500">+</span>
                      <pre className="flex-1 px-2 text-[var(--color-foreground)] bg-green-500/5">{line || ' '}</pre>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        ) : (
          <div className="p-6 text-center text-xs text-[var(--color-muted-foreground)]">No content</div>
        )}
      </div>
    </>
  );
}

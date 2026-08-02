// ────────────────────────────────────────────────────────────────
// MarkdownRenderer — Renders markdown with syntax-highlighted code blocks
// Uses highlight.js via rehype-highlight for syntax highlighting
// Each code block includes a copy button
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useRef, useEffect, isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useHighlightTheme } from '@/hooks/useHighlightTheme.js';

/** Extract raw text from a DOM element (used for copy-to-clipboard on highlighted code) */
function extractDomText(el: HTMLElement | null): string {
  return el?.textContent ?? '';
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/** Shared component overrides for ReactMarkdown. */
const MARKDOWN_COMPONENTS = {
  pre: PreBlock,
  // Let rehype-highlight handle <code> inside <pre>; only style inline code
  code: InlineCode,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] underline hover:opacity-80">
      {children}
    </a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto">
      <table className="w-full">{children}</table>
    </div>
  ),
} as const;

/**
 * MarkdownBody — the ReactMarkdown core (no `.markdown-content` wrapper, no
 * theme hook). Memoized on `content` so block-level streaming can skip
 * re-parsing blocks whose source slice hasn't changed.
 */
export const MarkdownBody = React.memo(function MarkdownBody({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkPreserveMeta]}
      rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
});

export const MarkdownRenderer = React.memo(function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  useHighlightTheme();
  return (
    <div className={cn('markdown-content text-sm', className)}>
      <MarkdownBody content={content} />
    </div>
  );
});

// ── Inline Code ──

function InlineCode({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  // If the code has an hljs class, it's a code block handled by PreBlock
  if (className && /hljs|language-/.test(className)) {
    return <code className={className} {...props}>{children}</code>;
  }

  return (
    <code
      className="rounded-md bg-[var(--color-muted)] px-1.5 py-0.5 font-mono text-[0.85em] font-medium"
      {...props}
    >
      {children}
    </code>
  );
}

/**
 * Remark plugin: preserve the code fence `meta` string (filename) so it
 * survives the MDAST → HAST conversion as a `data-meta` attribute on <code>.
 * remark-rehype reads `data.hProperties` and copies them to HAST properties.
 */
function remarkPreserveMeta() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    (function walk(node: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
      if (node.type === 'code' && node.meta) {
        node.data = node.data || {};
        node.data.hProperties = node.data.hProperties || {};
        node.data.hProperties['data-meta'] = node.meta;
      }
      if (node.children) {
        for (const child of node.children) walk(child);
      }
    })(tree);
  };
}

// ── Pre Block with Copy Button + Language Label + Filename ──

function PreBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement> & { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);

  const language = extractLanguage(children);
  const filename = extractFilename(children);

  const handleCopy = useCallback(() => {
    const text = extractDomText(codeRef.current);
    navigator.clipboard.writeText(text.replace(/\n$/, '')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      console.warn('Clipboard write failed');
    });
  }, []);

  return (
    <div className="group relative my-3 rounded-lg border border-[var(--color-border)] overflow-hidden shadow-sm">
      {/* Language label + Filename + Copy button */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-muted)] px-4 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] shrink-0">
            {language ?? 'code'}
          </span>
          {filename && (
            <span className="text-[11px] font-medium text-[var(--color-foreground)] opacity-70 truncate font-mono" title={filename}>
              {filename}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-[var(--color-muted-foreground)] transition-all hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] shrink-0"
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-[var(--color-success)]" />
              <span className="text-[var(--color-success)]">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </button>
      </div>
      <pre
        ref={codeRef}
        className="overflow-x-auto p-4 bg-[var(--color-muted)]/60 hljs-pre"
        {...props}
      >
        {children}
      </pre>
    </div>
  );
}

/** Extract language name from inner <code> element's className */
function extractLanguage(children: React.ReactNode): string | null {
  if (!isValidElement(children)) return null;
  const className = (children.props as { className?: string })?.className ?? '';
  const match = /language-([\w-]+)/.exec(className);
  return match?.[1] ?? null;
}

/** Extract filename from inner <code> element's data-meta attribute (set by remarkPreserveMeta) */
function extractFilename(children: React.ReactNode): string | null {
  if (!isValidElement(children)) return null;
  const meta = (children.props as Record<string, unknown>)?.['data-meta'];
  if (typeof meta === 'string' && meta.trim()) return meta.trim();
  return null;
}

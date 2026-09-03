// ────────────────────────────────────────────────────────────────
// MarkdownRenderer — markdown with syntax-highlighted code blocks.
//
// ── W27 / P0-47: highlighting is not on this thread ──────────────
// `rehype-highlight` used to run inside the unified pipeline, which runs
// inside React's render, which runs on the thread that paints. On the chat
// path that is the worst possible place for it: a fenced block is re-rendered
// on every token that arrives after it, so a 200-line code block in a
// streaming answer is re-highlighted dozens of times, synchronously, while
// the user is watching the text move.
//
// The plugin is gone. Code blocks render as plain text immediately and are
// repainted with colour when the worker answers (`lib/highlight/client.ts`).
// The first paint is never blocked on highlighting, and a cache hit — which
// is what every re-render of an unchanged block is — paints coloured on the
// first frame, so there is no flash.
//
// Each code block still includes a copy button.
// ────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useRef, useEffect, useMemo, isValidElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { highlightCode, peekHighlight, type HighlightToken } from '@/lib/highlight/client.js';
// `languageNames`, not `languages`: the latter imports every grammar, and this
// module runs on the main thread. See that file's header.
import { resolveLanguage } from '@/lib/highlight/languageNames.js';

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
 *
 * No `rehypePlugins`. Highlighting happens in a worker and is applied by
 * `InlineCode` below — see this file's header for why.
 */
export const MarkdownBody = React.memo(function MarkdownBody({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkPreserveMeta]}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
});

export const MarkdownRenderer = React.memo(function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn('markdown-content text-sm', className)}>
      <MarkdownBody content={content} />
    </div>
  );
});

// ── Inline Code / fenced blocks ──

/**
 * Flatten a ReactMarkdown `<code>` child into the source text.
 *
 * With no rehype plugin in the pipeline this is a string (or an array of
 * strings), never a nested element tree — but the recursion is cheap and a
 * silently truncated code block would be a much worse bug than a redundant
 * branch.
 */
function codeText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(codeText).join('');
  if (isValidElement(node)) return codeText((node.props as { children?: React.ReactNode }).children);
  return '';
}

function InlineCode({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) {
  const language = resolveLanguage(/language-([\w+-]+)/.exec(className ?? '')?.[1]);

  // A fenced block: PreBlock owns the chrome, this owns the colour.
  if (className && /language-/.test(className)) {
    return (
      <HighlightedCode className={className} language={language} code={codeText(children)} {...props} />
    );
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
 * A fenced code block, highlighted off the main thread.
 *
 * The initial state is a synchronous CACHE read, not `null`. That is what
 * makes streaming look right: every re-render of an already-highlighted block
 * — which is what a token arriving below it causes — paints coloured on its
 * first frame. Only genuinely new text spends one frame as plain text.
 *
 * Tokens are rendered as real elements. Nothing here goes through
 * `dangerouslySetInnerHTML`; see `tokenize.ts` for why that matters on the
 * one path that renders model-authored content.
 */
function HighlightedCode({
  className,
  language,
  code,
  ...props
}: React.HTMLAttributes<HTMLElement> & { language: string | null; code: string }) {
  const [tokens, setTokens] = useState<HighlightToken[] | null>(() =>
    language ? peekHighlight(language, code) : null,
  );

  useEffect(() => {
    if (!language) {
      setTokens(null);
      return;
    }
    const cached = peekHighlight(language, code);
    if (cached) {
      setTokens(cached);
      return;
    }
    // Clear first: showing the PREVIOUS block's colours over this block's text
    // while the worker answers is worse than a frame of plain text.
    setTokens(null);
    let live = true;
    void highlightCode(language, code).then((next) => {
      // The block changed (another chunk arrived) while the worker was busy.
      // Its answer is for text that is no longer on screen.
      if (live && next.length > 0) setTokens(next);
    });
    return () => {
      live = false;
    };
  }, [language, code]);

  const rendered = useMemo(() => {
    if (!tokens) return code;
    return tokens.map(([cls, text], i) =>
      cls ? (
        // The index IS the identity here: tokens are positional, the whole
        // list is replaced on every change, and nothing in a token is stable
        // enough to key on.
        <span key={i} className={cls}>
          {text}
        </span>
      ) : (
        <React.Fragment key={i}>{text}</React.Fragment>
      ),
    );
  }, [tokens, code]);

  return (
    <code className={cn(className, tokens ? 'hljs' : undefined)} {...props}>
      {rendered}
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

// ────────────────────────────────────────────────────────────────
// C-23 CodeBlock (03 §3 C-23; D-33, D-38 Shiki 4).
//
// `font-mono text-small` lh 1.5, pad 8 10, `rounded-control`, `bg-sunken`,
// 1px `border-line-soft`. `tone="err"` tints the text `text-err` (inline tool
// errors). Optional header row (language/path + a copy `ib-sm`). Optional
// `wrap` for long lines that should not scroll.
//
// Highlighting is Shiki 4, lazily imported and grammar-per-language (see
// `./highlighter.ts` — nothing here statically imports `shiki`, so it never
// lands in the initial bundle, 09 §8.1). While the grammar chunk loads (or for
// an unsupported `lang`), the code renders as plain escaped text — never a
// blocked/empty block. A `lang` that `resolveLang` does not know never loads
// Shiki at all. `lineNumbers` adds a `text-fg-3` gutter (not with `wrap`: a
// wrapped line would no longer line up with its number). `collapse` caps a
// tall block (a 10 KB JSON payload in an agent's answer) at `max-h-80` with a
// "Show all" footer, so one block never buries the message around it.
// ────────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn.js';
import { Button } from '../../primitives/Button/Button.js';
import { IconButton } from '../../primitives/IconButton/IconButton.js';
import { highlightCode, peekHighlightedCode, resolveLang, withPreChrome } from './highlighter.js';

export interface CodeBlockProps {
  /** Raw source text. */
  children: string;
  /** A key from `./highlighter.ts`'s `LANG_LOADERS`, or any string (falls back to plain text). */
  lang?: string;
  tone?: 'default' | 'err';
  /** Language/path row, e.g. `src/App.tsx`. */
  header?: ReactNode;
  /** Shows a copy button; the text it copies (usually the same as `children`). */
  copy?: string;
  /** Wraps long lines instead of scrolling horizontally. */
  wrap?: boolean;
  /** Shows a line-number gutter (ignored with `wrap`). */
  lineNumbers?: boolean;
  /** Starts a block taller than `max-h-80` clamped, with a "Show all" / "Show less" footer. */
  collapse?: boolean;
  className?: string;
}

/** A chrome-and-highlighting code block: header, `bg-sunken` body, optional copy button. */
export function CodeBlock({
  children,
  lang,
  tone = 'default',
  header,
  copy,
  wrap = false,
  lineNumbers = false,
  collapse = false,
  className,
}: CodeBlockProps) {
  const highlightLang = resolveLang(lang);
  // A block highlighted before (a remount after a view-mode switch, the live turn becoming the persisted one) paints at once.
  const [html, setHtml] = useState<string | null>(() => (highlightLang ? (peekHighlightedCode(children, highlightLang) ?? null) : null));
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    const myGeneration = generation.current;
    const cached = highlightLang ? peekHighlightedCode(children, highlightLang) : undefined;
    setHtml(cached ?? null);
    if (!highlightLang || cached !== undefined) return;
    highlightCode(children, highlightLang).then((result) => {
      if (generation.current === myGeneration) setHtml(result);
    });
  }, [children, highlightLang]);

  const showGutter = lineNumbers && !wrap;
  const body = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const clamped = collapse && !expanded;

  // Measured, not counted: a wrapped JSON value is three source lines and eighty on screen.
  useLayoutEffect(() => {
    const el = body.current;
    if (!collapse || !el || expanded) return;
    // The scroller child (overflow-x-auto implies overflow-y) holds the height, not the row itself.
    const measure = () => setOverflows([el, ...el.children].some((c) => c.scrollHeight > el.clientHeight + 1));
    measure();
    // Re-measure as the highlighted HTML, fonts or the column width settle.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    return () => observer.disconnect();
  }, [collapse, expanded, children, html, wrap]);

  return (
    <div
      className={cn(
        'overflow-hidden rounded-control border border-line-soft bg-sunken font-mono text-small leading-normal',
        tone === 'err' && 'text-err',
        className,
      )}
    >
      {header != null || copy != null ? (
        <div className="flex h-control items-center gap-2 border-b border-line-soft px-2.5 text-fg-3">
          <span className="min-w-0 flex-1 truncate">{header}</span>
          {copy != null ? <CopyButton text={copy} /> : null}
        </div>
      ) : null}
      <div ref={body} className={cn('flex py-2', showGutter ? 'pr-2.5' : 'px-2.5', clamped && 'max-h-80 overflow-hidden')}>
        {showGutter ? (
          <pre
            aria-hidden="true"
            className="m-0 shrink-0 select-none border-r border-line-soft bg-transparent px-2.5 text-right text-fg-3"
          >
            {lineNumberColumn(children)}
          </pre>
        ) : null}
        <div className={cn('min-w-0 flex-1 overflow-x-auto', showGutter && 'pl-2.5', wrap && 'overflow-x-hidden', clamped && 'overflow-y-hidden')}>
          {html != null ? (
            // Shiki's own output: text content is escaped by the tokenizer, and colours come only from
            // the fixed `SYNTAX_THEME` this file controls (never from the highlighted source). Its `<pre>`
            // wrapper is re-chromed by `withPreChrome` instead of reached into with an arbitrary selector.
            <div dangerouslySetInnerHTML={{ __html: withPreChrome(html, wrap) }} />
          ) : (
            <pre className={cn('m-0 bg-transparent p-0', wrap ? 'whitespace-pre-wrap' : 'whitespace-pre')}>{children}</pre>
          )}
        </div>
      </div>
      {collapse && (overflows || expanded) ? (
        <div className="flex items-center border-t border-line-soft px-1 py-0.5">
          <Button variant="ghost" size="sm" icon={expanded ? 'chevron-up' : 'chevron-down'} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Show less' : wrap ? 'Show all' : `Show all ${children.split('\n').length} lines`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** `1\n2\n…` — one number per source line, laid out by the same `leading-normal` as the code. */
function lineNumberColumn(code: string): string {
  const count = code.split('\n').length;
  return Array.from({ length: count }, (_, i) => String(i + 1)).join('\n');
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? 'check' : 'copy'}
      label={copied ? 'Copied' : 'Copy'}
      size="sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    />
  );
}

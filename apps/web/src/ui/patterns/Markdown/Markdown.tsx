// ────────────────────────────────────────────────────────────────
// Markdown — transcript / card prose on Streamdown 2 (D-33, D-38; 02 §5.3).
//
// Streamdown parses (remark-gfm), sanitises (rehype-sanitize + rehype-harden,
// its defaults are kept) and, while `streaming`, repairs incomplete markdown
// (remend: an unterminated ``` fence, `**bold`, a half-typed link) and splits
// the source into blocks that are each memoised — a new token re-renders only
// the tail block. When the stream ends the blocks stay: every settled block
// keeps its memoised render and only the tail re-renders once more
// (D-88 — re-parsing a 4,000-word answer as one document was a 100+ ms long
// task at the end of every large response, and again on every remount). Only
// a document that needs a single parse — constructs that span blocks: link
// reference definitions, footnotes — is rendered with `mode="static"`.
//
// Every element is rendered by an override below, styled with design
// utilities only; nothing relies on Streamdown's own class names (they are
// not in this app's Tailwind sources). Its chrome is switched off:
// `controls={false}` (table/code/image copy+download), `linkSafety` off (a
// modal with its own styling), `lineNumbers={false}`. Its code plugin
// (`@streamdown/code`, a second Shiki) is not installed: fenced code goes to
// the kit CodeBlock, whose Shiki grammars load lazily per language — and not
// at all while a fence is still streaming (plain text until it closes). No
// mermaid / math plugins.
//
// No streaming caret (D-160): the transcript's paced reveal fades the newest
// words in, which says where the text grows; a bar hopping word to word and
// line to line read as flicker.
// ────────────────────────────────────────────────────────────────

import { isValidElement, useCallback, type ReactNode } from 'react';
import {
  Streamdown,
  useIsCodeFenceIncomplete,
  type Components,
  type ExtraProps,
  type LinkSafetyConfig,
} from 'streamdown';
import { cn } from '../../lib/cn.js';
import { Checkbox } from '../../primitives/Checkbox/Checkbox.js';
import { InlineCode } from '../../primitives/InlineCode/InlineCode.js';
import { CodeBlock } from '../CodeBlock/CodeBlock.js';
import { needsWholeDocument, splitMarkdownBlocks } from './markdownBlocks.js';

export interface MarkdownProps {
  /** Markdown source. */
  children: string;
  /** True while tokens are still arriving: incomplete markdown is repaired (Streamdown) and only the tail block re-parses. */
  streaming?: boolean;
  /** `prose` (default) = 14/1.6 transcript prose; `compact` = text-small for cards/previews. */
  size?: 'prose' | 'compact';
  className?: string;
}

type MarkdownSize = NonNullable<MarkdownProps['size']>;

/** Renders markdown source as styled, sanitised prose; see the file header. */
export function Markdown({ children, streaming = false, size = 'prose', className }: MarkdownProps) {
  // Rendered on every revealed frame: with blocks split correctly only the tail
  // re-parses (D-88), and the paced reveal (D-91) sets the cadence. A deferred
  // source was tried and dropped — under load it skipped frames and then
  // committed thousands of characters at once, the very burst pacing removes.
  const source = children;
  const parseBlocks = useCallback((markdown: string) => splitMarkdownBlocks(markdown), []);

  return (
    // `data-gai-md`: inside a live turn its blocks, table rows and list items ease in (D-152).
    <div className={cn('min-w-0 break-words text-fg', size === 'prose' ? 'text-body' : 'text-small', className)} data-gai-md="">
      <Streamdown
        mode={streaming || !needsWholeDocument(source) ? 'streaming' : 'static'}
        isAnimating={streaming}
        parseIncompleteMarkdown={streaming}
        parseMarkdownIntoBlocksFn={parseBlocks}
        components={COMPONENTS[size]}
        controls={false}
        linkSafety={LINK_SAFETY_OFF}
        lineNumbers={false}
        className={ROOT_SPACING[size]}
      >
        {source}
      </Streamdown>
    </div>
  );
}

const LINK_SAFETY_OFF: LinkSafetyConfig = { enabled: false };

/** Vertical rhythm between top-level blocks (replaces Streamdown's own `space-y-4` via its tailwind-merge). */
const ROOT_SPACING: Record<MarkdownSize, string> = { prose: 'space-y-2', compact: 'space-y-1.5' };

// ── Element overrides ────────────────────────────────────────────

type El<K extends keyof React.JSX.IntrinsicElements> = React.JSX.IntrinsicElements[K] & ExtraProps;

/** The text of a code element's children (a string with no highlighting plugin in the pipeline). */
function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

function isInPageLink(href: string | undefined): boolean {
  return !!href && href.startsWith('#');
}

/** remend's placeholder href for a link whose URL has not finished streaming. */
const INCOMPLETE_LINK = 'streamdown:incomplete-link';

const LINK_CLASS = 'text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg';

function MdLink({ node: _node, href, children, className, target: _target, rel: _rel, ...rest }: El<'a'>) {
  if (!href || href === INCOMPLETE_LINK) {
    return <span className={cn(LINK_CLASS, className)}>{children}</span>;
  }
  // Every link except an in-page anchor (footnotes) leaves the app — a relative
  // path in a README is not an app route — so it opens a new tab without a
  // referrer. rehype-harden's own target/rel are replaced by this rule.
  const external = !isInPageLink(href);
  return (
    <a
      {...rest}
      href={href}
      className={cn(LINK_CLASS, className)}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {children}
    </a>
  );
}

/**
 * rehype-harden replaces a blocked link/image with a `<span class="text-gray-…">`
 * indicator ("x [blocked]"); sanitising strips every other span class, so a
 * classed span is always that indicator — restyle it with the kit's muted text.
 */
function MdSpan({ node: _node, className, title: _title, ...rest }: El<'span'>) {
  return <span {...rest} className={className ? 'text-fg-3' : undefined} />;
}

/**
 * GFM task-list items: the only input element the sanitiser lets through is a
 * disabled checkbox. Render it as the kit Checkbox (read-only, named by state).
 */
function MdInput({ type, checked }: El<'input'>) {
  if (type !== 'checkbox') return null;
  return (
    <Checkbox
      checked={!!checked}
      disabled
      size="sm"
      aria-label={checked ? 'Done' : 'Not done'}
      className="mr-1.5 align-middle"
    />
  );
}

function MdImg({ node: _node, className, alt, ...rest }: El<'img'>) {
  return <img {...rest} alt={alt ?? ''} loading="lazy" className={cn('inline-block max-w-full rounded-control', className)} />;
}

function MdTable({ node: _node, className, children, ...rest }: El<'table'>) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table {...rest} className={cn('w-full border-collapse text-left', className)}>
        {children}
      </table>
    </div>
  );
}

/** Block code → kit CodeBlock (language header, copy, lazy Shiki); inline → kit InlineCode. */
function makeCode(size: MarkdownSize) {
  return function MdCode({ node, className, children, ...rest }: El<'code'>) {
    const incomplete = useIsCodeFenceIncomplete();
    // Streamdown's `pre` marks the code element of a fenced/indented block with `data-block`.
    if (!('data-block' in rest)) {
      return (
        <InlineCode dense={size === 'compact'} className={className} {...rest}>
          {children}
        </InlineCode>
      );
    }
    const lang = /language-([^\s]+)/.exec(className ?? '')?.[1];
    const meta = node?.properties?.metastring;
    const code = textOf(children).replace(/\n$/, '');
    return (
      <CodeBlock
        // Highlight once the fence has closed; a streaming fence stays plain text.
        lang={incomplete ? undefined : lang}
        // JSON wraps (U-49): a payload's long string values (a PR description, a summary) stay readable in
        // full instead of running off the side; code keeps its lines, where indentation carries meaning.
        wrap={lang === 'json'}
        // A long fence (a whole payload, a full file) starts clamped once it has closed.
        collapse={!incomplete}
        copy={code}
        header={
          <>
            {lang ?? 'text'}
            {typeof meta === 'string' && meta.trim() ? <span className="ml-2 text-fg-2">{meta.trim()}</span> : null}
          </>
        }
      >
        {code}
      </CodeBlock>
    );
  };
}

function strip<K extends keyof React.JSX.IntrinsicElements>(tag: K, base: string) {
  return function MdElement({ node: _node, className, ...rest }: El<K>) {
    const Tag = tag as React.ElementType;
    return <Tag {...rest} className={cn(base, className) || undefined} />;
  };
}

function makeList(tag: 'ul' | 'ol', size: MarkdownSize) {
  const marker = tag === 'ul' ? 'list-disc' : 'list-decimal';
  return function MdList({ node: _node, className, ...rest }: El<'ul'>) {
    const Tag = tag as React.ElementType;
    // GFM task lists carry `contains-task-list`: the checkbox is the marker.
    const taskList = className?.includes('contains-task-list');
    return (
      <Tag
        {...rest}
        className={cn(
          'marker:text-fg-3',
          size === 'prose' ? 'space-y-1' : 'space-y-0.5',
          taskList ? 'list-none pl-0' : [marker, 'pl-5'],
          className,
        )}
      />
    );
  };
}

function makeComponents(size: MarkdownSize): Components {
  const prose = size === 'prose';
  return {
    h1: strip('h1', cn('mt-4 first:mt-0', prose ? 'text-title' : 'text-ui font-semibold')),
    h2: strip('h2', cn('mt-3.5 first:mt-0 font-semibold', prose ? 'text-body' : 'text-ui')),
    h3: strip('h3', cn('mt-3 first:mt-0 font-semibold', prose ? 'text-ui' : 'text-small')),
    h4: strip('h4', cn('mt-3 first:mt-0 font-semibold text-fg-2', prose ? 'text-ui' : 'text-small')),
    h5: strip('h5', cn('mt-3 first:mt-0 font-semibold text-fg-2', prose ? 'text-ui' : 'text-small')),
    h6: strip('h6', cn('mt-3 first:mt-0 font-semibold text-fg-3', prose ? 'text-ui' : 'text-small')),
    p: strip('p', ''),
    a: MdLink,
    ul: makeList('ul', size),
    ol: makeList('ol', size),
    li: strip('li', prose ? 'space-y-2' : 'space-y-1'),
    blockquote: strip('blockquote', 'space-y-2 border-l-2 border-line pl-3 text-fg-2'),
    hr: strip('hr', 'my-4 border-0 border-t border-line-soft'),
    table: MdTable,
    thead: strip('thead', ''),
    tbody: strip('tbody', ''),
    tr: strip('tr', ''),
    th: strip('th', 'border-b border-line px-2.5 py-1.5 text-small font-medium text-fg-2'),
    td: strip('td', 'border-b border-line-soft px-2.5 py-1.5 align-top'),
    strong: strip('strong', 'font-semibold'),
    em: strip('em', 'italic'),
    del: strip('del', 'line-through'),
    sup: strip('sup', ''),
    sub: strip('sub', ''),
    img: MdImg,
    span: MdSpan,
    input: MdInput,
    code: makeCode(size),
  } as Components;
}

/** One stable map per size: `Block`'s memo compares `components` key by key. */
const COMPONENTS: Record<MarkdownSize, Components> = {
  prose: makeComponents('prose'),
  compact: makeComponents('compact'),
};

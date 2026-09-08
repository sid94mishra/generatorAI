// ────────────────────────────────────────────────────────────────
// Markdown renderer.
//
// `react-markdown` is a DOM renderer and cannot run here. `marked` lexes the
// source; `markdownModel.ts` turns the tokens into a small render tree; this
// file maps that tree one-to-one onto React Native components. Everything
// with a decision in it (what a list item contains, whether a link may open,
// how a streaming block is closed) lives in the model, where node can test
// it. This file is layout and styling only.
//
// Coverage is the GFM surface a coding agent emits: headings, paragraphs,
// emphasis, inline code, ordered/unordered/nested/task lists, blockquotes,
// rules, tables, fenced code, images, links. Anything unrecognised renders
// as its source text — an unknown construct should look plain, never
// disappear.
//
// Links are gated by `linkPolicy.ts` (D18): only http, https, mailto and
// the app's own scheme open; anything else is inert text with a "blocked"
// tone. Long-press copies either kind.
//
// Streaming: with `streaming` set, the LAST block is treated as in flight —
// unterminated emphasis is closed so it never flashes raw `**`, its code
// block is not highlighted, and its image is not sized. Settled blocks
// upstream are memoised by the caller on identity; here the parse itself
// is memoised on source so a recycled row re-mounts for free.
// ────────────────────────────────────────────────────────────────

import React, { createContext, memo, useCallback, useContext, useMemo, useState } from 'react';
import { Linking, ScrollView, Text, View, type TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { useTheme } from '../../theme/ThemeProvider';
import { MAX_SCALE } from '../ui/accessibility';
import { haptics } from '../ui/haptics';
import { useToast } from '../ui/Toast';
import { CodeBlock, withAlpha } from './CodeBlock';
import { blockedLinkReason, classifyLink } from './linkPolicy';
import { ImageLightbox, MarkdownImage, type LightboxImage } from './MarkdownImage';
import {
  inlineText,
  parseMarkdown,
  type BlockNode,
  type ColumnAlign,
  type InlineNode,
  type ListItemNode,
} from './markdownModel';

export interface MarkdownProps {
  content: string;
  /** The final block is still arriving. See the header. */
  streaming?: boolean;
  /**
   * Replace the default `Linking.openURL` for allowed links — e.g. to route
   * `generatorai://` deep links through the router. Blocked links never
   * reach this.
   */
  onLinkPress?: (href: string) => void;
}

// ── Environment ─────────────────────────────────────────────────

interface MarkdownEnv {
  openLink(href: string): void;
  copyLink(href: string): void;
  blockedLink(href: string): void;
  openImage(image: LightboxImage): void;
}

const noop = (): void => {};
const MarkdownContext = createContext<MarkdownEnv>({
  openLink: noop,
  copyLink: noop,
  blockedLink: noop,
  openImage: noop,
});

/** Inherited text tone: blockquote content is muted. */
const ToneContext = createContext<'default' | 'muted'>('default');

// ── Root ────────────────────────────────────────────────────────

export function Markdown({ content, streaming = false, onLinkPress }: MarkdownProps): React.ReactElement {
  const toast = useToast();
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);

  const tree = useMemo(() => parseMarkdown(content, { streaming }), [content, streaming]);

  const env = useMemo<MarkdownEnv>(
    () => ({
      openLink(href) {
        if (onLinkPress) {
          onLinkPress(href);
          return;
        }
        Linking.openURL(href).catch(() => {
          toast({ message: 'Nothing can open this link', tone: 'error' });
        });
      },
      copyLink(href) {
        haptics.commit();
        Clipboard.setStringAsync(href)
          .then(() => toast({ message: 'Link copied', tone: 'success' }))
          .catch(() => toast({ message: 'Could not copy', tone: 'error' }));
      },
      blockedLink(href) {
        haptics.warn();
        toast({ message: blockedLinkReason(classifyLink(href)), tone: 'info' });
      },
      openImage: setLightbox,
    }),
    [onLinkPress, toast],
  );

  const closeLightbox = useCallback(() => setLightbox(null), []);
  const last = tree.length - 1;

  return (
    <MarkdownContext.Provider value={env}>
      <View className="gap-2">
        {tree.map((node, i) => (
          // Positional keys: the tree is replaced wholesale on every parse and
          // nothing in a node is stable enough to key on.
          <Block key={i} node={node} depth={0} streaming={streaming && i === last} />
        ))}
      </View>
      <ImageLightbox image={lightbox} onClose={closeLightbox} />
    </MarkdownContext.Provider>
  );
}

export default Markdown;

// ── Blocks ──────────────────────────────────────────────────────

const BODY_TEXT = 'text-base leading-relaxed';

const HEADING_CLASS: Record<1 | 2 | 3 | 4 | 5 | 6, string> = {
  1: 'text-2xl font-bold leading-tight',
  2: 'text-xl font-semibold leading-tight',
  3: 'text-lg font-semibold leading-tight',
  4: 'text-md font-semibold leading-tight',
  5: 'text-base font-semibold leading-tight',
  6: 'text-sm font-semibold uppercase tracking-wide leading-tight',
};

const Block = memo(function Block({
  node,
  depth,
  streaming,
}: {
  node: BlockNode;
  /** List nesting depth; drives the bullet glyph. */
  depth: number;
  streaming: boolean;
}): React.ReactElement | null {
  const tone = useContext(ToneContext);
  const colorClass = tone === 'muted' ? 'text-muted-foreground' : 'text-foreground';

  switch (node.type) {
    case 'heading':
      return (
        <Text
          selectable
          accessibilityRole="header"
          maxFontSizeMultiplier={MAX_SCALE.control}
          className={`${HEADING_CLASS[node.depth]} ${node.depth === 6 ? 'text-muted-foreground' : colorClass} ${
            node.depth <= 2 ? 'mt-1' : ''
          }`}
        >
          <Inline nodes={node.children} />
        </Text>
      );

    case 'paragraph':
      return (
        <Text selectable className={`${BODY_TEXT} ${colorClass}`}>
          <Inline nodes={node.children} />
        </Text>
      );

    case 'code':
      return <CodeBlock code={node.code} language={node.lang} meta={node.meta} streaming={streaming} />;

    case 'list':
      return <List node={node} depth={depth} streaming={streaming} />;

    case 'blockquote':
      return (
        <ToneContext.Provider value="muted">
          <View className="gap-2 border-l-2 border-border pl-3">
            {node.children.map((child, i) => (
              <Block key={i} node={child} depth={depth} streaming={streaming && i === node.children.length - 1} />
            ))}
          </View>
        </ToneContext.Provider>
      );

    case 'table':
      return <Table node={node} />;

    case 'hr':
      return <View className="my-1 h-px bg-border" />;

    case 'image':
      return <BlockImage src={node.src} alt={node.alt} allowed={node.allowed} streaming={streaming} />;

    case 'raw':
      return (
        <Text selectable className={`${BODY_TEXT} ${colorClass}`}>
          {node.text}
        </Text>
      );

    default:
      return null;
  }
});

function BlockImage({
  src,
  alt,
  allowed,
  streaming,
}: {
  src: string;
  alt: string;
  allowed: boolean;
  streaming: boolean;
}): React.ReactElement {
  const { openImage } = useContext(MarkdownContext);
  return <MarkdownImage src={src} alt={alt} allowed={allowed} streaming={streaming} onOpen={openImage} />;
}

// ── Lists ───────────────────────────────────────────────────────

const BULLETS = ['•', '◦', '▪'] as const;

function List({
  node,
  depth,
  streaming,
}: {
  node: Extract<BlockNode, { type: 'list' }>;
  depth: number;
  streaming: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const lastNumber = node.start + node.items.length - 1;
  // Marker column width: wide enough for the largest number in the list so
  // "9." and "10." align their text, not their dots.
  const markerWidth = node.ordered ? String(lastNumber).length * 8 + 10 : 16;

  return (
    <View className="gap-1">
      {node.items.map((item, i) => (
        <ListItem
          key={i}
          item={item}
          marker={marker(node, item, i, depth)}
          markerWidth={item.task ? 20 : markerWidth}
          markerColor={item.task && item.checked ? colors.success : undefined}
          depth={depth}
          streaming={streaming && i === node.items.length - 1}
        />
      ))}
    </View>
  );
}

function marker(list: Extract<BlockNode, { type: 'list' }>, item: ListItemNode, index: number, depth: number): string {
  if (item.task) return item.checked ? '☑' : '☐';
  if (list.ordered) return `${list.start + index}.`;
  return BULLETS[depth % BULLETS.length]!;
}

function ListItem({
  item,
  marker: glyph,
  markerWidth,
  markerColor,
  depth,
  streaming,
}: {
  item: ListItemNode;
  marker: string;
  markerWidth: number;
  markerColor: string | undefined;
  depth: number;
  streaming: boolean;
}): React.ReactElement {
  const last = item.children.length - 1;
  return (
    <View
      className="flex-row gap-2"
      accessibilityState={item.task ? { checked: item.checked } : undefined}
      accessibilityRole={item.task ? 'checkbox' : undefined}
    >
      {/* Markers are muted in every tone: they index the text, they are not it. */}
      <Text
        className={`${BODY_TEXT} text-right text-muted-foreground`}
        style={[{ minWidth: markerWidth }, markerColor ? { color: markerColor } : null]}
      >
        {glyph}
      </Text>
      <View className="flex-1 gap-1">
        {item.children.map((child, i) => (
          <Block key={i} node={child} depth={depth + 1} streaming={streaming && i === last} />
        ))}
      </View>
    </View>
  );
}

// ── Tables ──────────────────────────────────────────────────────

const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

function alignStyle(align: ColumnAlign): TextStyle | undefined {
  if (align === 'right') return { textAlign: 'right' };
  if (align === 'center') return { textAlign: 'center' };
  return undefined;
}

function Table({ node }: { node: Extract<BlockNode, { type: 'table' }> }): React.ReactElement {
  const { colors } = useTheme();
  // Zebra at half the `subtle` tone: a full-strength band reads as a header.
  const zebra = useMemo(() => withAlpha(colors.subtle, 0.5), [colors.subtle]);

  // Horizontal scroll: a table wide enough to matter never fits a phone, and
  // wrapping every cell destroys the alignment that makes it a table. Cells
  // wrap only inside their estimated column width.
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      className="rounded-lg border border-border"
      accessibilityLabel={`Table with ${node.rows.length} rows`}
    >
      <View>
        <View className="flex-row bg-subtle">
          {node.header.map((cell, c) => (
            <Text
              key={c}
              selectable
              maxFontSizeMultiplier={MAX_SCALE.control}
              className="px-3 py-2 text-sm font-semibold text-foreground"
              style={[{ width: node.widths[c] }, TABULAR, alignStyle(node.align[c] ?? null)]}
            >
              <Inline nodes={cell} />
            </Text>
          ))}
        </View>
        {node.rows.map((row, r) => (
          <View
            key={r}
            className="flex-row border-t border-border"
            style={r % 2 === 1 ? { backgroundColor: zebra } : undefined}
          >
            {row.map((cell, c) => (
              <Text
                key={c}
                selectable
                maxFontSizeMultiplier={MAX_SCALE.control}
                className="px-3 py-2 text-sm text-foreground"
                style={[{ width: node.widths[c] }, TABULAR, alignStyle(node.align[c] ?? null)]}
              >
                <Inline nodes={cell} />
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Inline ──────────────────────────────────────────────────────

/** Inline spans, rendered as nested <Text> so they wrap as one paragraph. */
function Inline({ nodes }: { nodes: InlineNode[] }): React.ReactElement {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return node.text;
          case 'strong':
            return (
              <Text key={i} className="font-semibold">
                <Inline nodes={node.children} />
              </Text>
            );
          case 'em':
            return (
              <Text key={i} className="italic">
                <Inline nodes={node.children} />
              </Text>
            );
          case 'del':
            return (
              <Text key={i} className="line-through">
                <Inline nodes={node.children} />
              </Text>
            );
          case 'code':
            return (
              <Text key={i} className="rounded bg-subtle font-mono text-sm text-foreground">
                {` ${node.text} `}
              </Text>
            );
          case 'link':
            return <Link key={i} node={node} />;
          case 'image':
            return <InlineImage key={i} node={node} />;
          case 'br':
            return '\n';
          default:
            return null;
        }
      })}
    </>
  );
}

const BLOCKED_LINK_STYLE: TextStyle = { textDecorationLine: 'underline', textDecorationStyle: 'dotted' };

function Link({ node }: { node: Extract<InlineNode, { type: 'link' }> }): React.ReactElement {
  const env = useContext(MarkdownContext);
  const label = inlineText(node.children);

  if (!node.allowed) {
    return (
      <Text
        accessibilityLabel={`Blocked link: ${label}`}
        accessibilityHint="Long press to copy the address"
        className="text-muted-foreground"
        style={BLOCKED_LINK_STYLE}
        onPress={() => env.blockedLink(node.href)}
        onLongPress={() => env.copyLink(node.href)}
      >
        <Inline nodes={node.children} />
      </Text>
    );
  }

  return (
    <Text
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint="Long press to copy the address"
      className="text-primary underline"
      onPress={() => env.openLink(node.href)}
      onLongPress={() => env.copyLink(node.href)}
    >
      <Inline nodes={node.children} />
    </Text>
  );
}

/**
 * An image in the middle of a sentence. RN cannot flow an `Image` inside
 * `Text` at an intrinsic size, so it renders as its alt text and opens the
 * viewer on tap — the image itself is one tap away rather than squeezed into
 * a line box.
 */
function InlineImage({ node }: { node: Extract<InlineNode, { type: 'image' }> }): React.ReactElement {
  const env = useContext(MarkdownContext);
  const label = node.alt || 'image';
  if (!node.allowed) {
    return (
      <Text accessibilityLabel={`Blocked image: ${label}`} className="italic text-muted-foreground">
        [{label}]
      </Text>
    );
  }
  return (
    <Text
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      accessibilityHint="Opens full screen"
      className="text-primary underline"
      onPress={() => env.openImage({ src: node.src, alt: node.alt })}
    >
      [{label}]
    </Text>
  );
}

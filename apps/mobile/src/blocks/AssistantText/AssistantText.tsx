// MB-10 AssistantText (03 MB-10; MD-40 gated → the `marked` renderer restyled on the kit until the M1-07 spike
// decides): markdown rendered block by block from `markdownModel` (headings, paragraphs, emphasis, inline code,
// lists incl. tasks, blockquotes, rules, tables with horizontal scroll, fenced code as MP-42 CodeBlocks with copy
// and wrap, links through `linkPolicy`, images). Streaming-safe: the last block is parsed as in flight. Selectable.
import React, { memo, useMemo, useState } from 'react';
import { Image, Linking, ScrollView, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { CodeText } from '../../ui/primitives/CodeText';
import { Link } from '../../ui/primitives/Link';
import { Pressable } from '../../ui/primitives/Pressable';
import { Separator } from '../../ui/primitives/Separator';
import { Text } from '../../ui/primitives/Text';
import type { TextRole } from '../../ui/primitives/Text/Text.types';
import { toast } from '../../ui/primitives/Toast';
import { blockedLinkReason, classifyLink } from './model/linkPolicy';
import { inlineText, parseMarkdown, type BlockNode, type InlineNode, type ListItemNode } from './model/markdownModel';

export interface AssistantTextProps {
  text: string;
  /** The final block is still arriving (no highlighting or image sizing for it). */
  streaming?: boolean;
  /** Allowed `generatorai://` links go here (the caller validates and routes them); external links open in-app. */
  onLinkPress?: (href: string) => void;
  testID?: string;
}

const HEADING_ROLE: Record<number, TextRole> = { 1: 'title', 2: 'headline', 3: 'detailTitle' };

interface Env {
  openLink: (href: string) => void;
}

function openLinkWith(onLinkPress: AssistantTextProps['onLinkPress']): (href: string) => void {
  return (href) => {
    const decision = classifyLink(href);
    if (!decision.allowed) {
      toast({ kind: 'error', message: blockedLinkReason(decision) });
      return;
    }
    if (decision.scheme === 'generatorai' && onLinkPress) return onLinkPress(decision.href);
    if (decision.scheme === 'mailto') {
      void Linking.openURL(decision.href).catch(() => toast({ kind: 'error', message: "Couldn't open that link." }));
      return;
    }
    void WebBrowser.openBrowserAsync(decision.href).catch(() => toast({ kind: 'error', message: "Couldn't open that link." }));
  };
}

function Inline({ nodes, env }: { nodes: InlineNode[]; env: Env }): React.ReactElement {
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.type) {
          case 'text':
            return <React.Fragment key={i}>{node.text}</React.Fragment>;
          case 'br':
            return <React.Fragment key={i}>{'\n'}</React.Fragment>;
          case 'strong':
            return (
              <Text key={i} role="transcript" weight={600}>
                <Inline nodes={node.children} env={env} />
              </Text>
            );
          case 'em':
            return (
              <Text key={i} role="transcript" className="italic">
                <Inline nodes={node.children} env={env} />
              </Text>
            );
          case 'del':
            return (
              <Text key={i} role="transcript" className="line-through">
                <Inline nodes={node.children} env={env} />
              </Text>
            );
          case 'code':
            return <CodeText key={i} form="inline" code={node.text} />;
          case 'link':
            return node.allowed ? (
              <Link key={i} label={inlineText(node.children) || node.href} onPress={() => env.openLink(node.href)} />
            ) : (
              <Text key={i} role="transcript" tone="fg-3" className="line-through">
                <Inline nodes={node.children} env={env} />
              </Text>
            );
          case 'image':
            return <React.Fragment key={i}>{node.alt ? `[${node.alt}]` : ''}</React.Fragment>;
          default:
            return null;
        }
      })}
    </>
  );
}

function Paragraph({ nodes, env, role = 'transcript', tone }: { nodes: InlineNode[]; env: Env; role?: TextRole; tone?: 'fg' | 'fg-2' }): React.ReactElement {
  return (
    <Text role={role} tone={tone} selectable>
      <Inline nodes={nodes} env={env} />
    </Text>
  );
}

/** An allowed image, sized to its own aspect ratio once known; tap opens it. */
function MarkdownImage({ src, alt }: { src: string; alt: string }): React.ReactElement {
  const [ratio, setRatio] = useState<number | null>(null);
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={alt || 'Image'} frame="none" onPress={() => void WebBrowser.openBrowserAsync(src).catch(() => undefined)} className="overflow-hidden rounded-card bg-sunken">
      <Image
        source={{ uri: src }}
        accessibilityIgnoresInvertColors
        onLoad={(e) => setRatio(e.nativeEvent.source.width / Math.max(1, e.nativeEvent.source.height))}
        className="w-full"
        style={{ aspectRatio: ratio ?? 16 / 9 }}
        resizeMode="contain"
      />
    </Pressable>
  );
}

function ListBlock({ ordered, start, items, env }: { ordered: boolean; start: number; items: ListItemNode[]; env: Env }): React.ReactElement {
  return (
    <View className="gap-1">
      {items.map((item, i) => (
        <View key={i} className="flex-row gap-2">
          <Text role={item.task ? 'body' : ordered ? 'mono' : 'transcript'} tone="fg-2" className="min-w-5">
            {item.task ? (item.checked ? '☑' : '☐') : ordered ? `${start + i}.` : '•'}
          </Text>
          <View className="flex-1 gap-1">
            {item.children.map((child, j) => (
              <Block key={j} node={child} env={env} streaming={false} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function Table({ node, env }: { node: Extract<BlockNode, { type: 'table' }>; env: Env }): React.ReactElement {
  const cell = (nodes: InlineNode[], key: number, header: boolean, width: number) => (
    <View key={key} style={{ width }} className="border-e border-line-soft px-2 py-1.5">
      <Text role="subhead" weight={header ? 600 : 400} selectable>
        <Inline nodes={nodes} env={env} />
      </Text>
    </View>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator className="rounded-card border border-line-soft">
      <View>
        <View className="flex-row border-b border-line bg-raised">{node.header.map((h, i) => cell(h, i, true, node.widths[i] ?? 120))}</View>
        {node.rows.map((row, r) => (
          <View key={r} className="flex-row border-b border-line-soft">
            {row.map((c, i) => cell(c, i, false, node.widths[i] ?? 120))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Block({ node, env, streaming }: { node: BlockNode; env: Env; streaming: boolean }): React.ReactElement | null {
  switch (node.type) {
    case 'heading':
      return (
        <Text role={HEADING_ROLE[node.depth] ?? 'detailTitle'} weight={600} accessibilityRole="header" selectable>
          <Inline nodes={node.children} env={env} />
        </Text>
      );
    case 'paragraph':
      return <Paragraph nodes={node.children} env={env} />;
    case 'code':
      return <CodeText form="block" code={node.code} language={streaming ? undefined : (node.lang ?? undefined)} copyable />;
    case 'list':
      return <ListBlock ordered={node.ordered} start={node.start} items={node.items} env={env} />;
    case 'blockquote':
      return (
        <View className="gap-2 border-s-2 border-line-strong ps-3">
          {node.children.map((child, i) => (
            <Block key={i} node={child} env={env} streaming={false} />
          ))}
        </View>
      );
    case 'table':
      return <Table node={node} env={env} />;
    case 'hr':
      return <Separator />;
    case 'image':
      return node.allowed && !streaming ? <MarkdownImage src={node.src} alt={node.alt} /> : <Text role="footnote" tone="fg-3">{node.alt || node.src}</Text>;
    case 'raw':
      return (
        <Text role="transcript" selectable>
          {node.text}
        </Text>
      );
    default:
      return null;
  }
}

export const AssistantText = memo(function AssistantText({ text, streaming = false, onLinkPress, testID }: AssistantTextProps): React.ReactElement {
  const tree = useMemo(() => parseMarkdown(text, { streaming }), [text, streaming]);
  const env = useMemo<Env>(() => ({ openLink: openLinkWith(onLinkPress) }), [onLinkPress]);
  const last = tree.length - 1;
  return (
    <View testID={testID} className="gap-3">
      {tree.map((node, i) => (
        <Block key={i} node={node} env={env} streaming={streaming && i === last} />
      ))}
    </View>
  );
});

/** Plain text of markdown (Copy, read aloud). */
export function assistantPlainText(text: string): string {
  return parseMarkdown(text)
    .map((node) => (node.type === 'paragraph' || node.type === 'heading' ? inlineText(node.children) : node.type === 'code' ? node.code : node.type === 'raw' ? node.text : ''))
    .filter(Boolean)
    .join('\n\n');
}

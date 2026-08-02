// ────────────────────────────────────────────────────────────────
// Markdown renderer.
//
// `react-markdown` is a DOM renderer and cannot run here, so `marked`
// produces a token tree and this maps it to RN components.
//
// Scope is what the agent actually emits: paragraphs, headings, lists,
// fenced and inline code, blockquotes, links, tables, task lists, rules.
// Anything unrecognised falls back to its raw text — an unknown construct
// should look plain, never disappear.
// ────────────────────────────────────────────────────────────────

import React, { useMemo } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { marked, type Token, type Tokens } from 'marked';

import { CodeBlock } from './CodeBlock';

export function Markdown({ content }: { content: string }): React.ReactElement {
  const tokens = useMemo(() => {
    try {
      return marked.lexer(content);
    } catch {
      // Malformed markdown must render as text, not crash the transcript.
      return [{ type: 'paragraph', raw: content, text: content } as Token];
    }
  }, [content]);

  return (
    <View className="gap-2">
      {tokens.map((token, i) => (
        <TokenView key={i} token={token} />
      ))}
    </View>
  );
}

function TokenView({ token }: { token: Token }): React.ReactElement | null {
  switch (token.type) {
    case 'heading': {
      const t = token as Tokens.Heading;
      const size = t.depth <= 1 ? 'text-xl' : t.depth === 2 ? 'text-lg' : 'text-md';
      return <Text className={`${size} font-semibold text-foreground`}>{t.text}</Text>;
    }

    case 'paragraph':
      return (
        <Text className="text-base leading-relaxed text-foreground">
          <Inline tokens={(token as Tokens.Paragraph).tokens ?? []} />
        </Text>
      );

    case 'code': {
      const t = token as Tokens.Code;
      return <CodeBlock code={t.text} language={t.lang ?? undefined} />;
    }

    case 'list': {
      const t = token as Tokens.List;
      return (
        <View className="gap-1 pl-1">
          {t.items.map((item, i) => (
            <View key={i} className="flex-row gap-2">
              <Text className="text-muted-foreground">
                {item.task ? (item.checked ? '☑' : '☐') : t.ordered ? `${(t.start || 1) + i}.` : '•'}
              </Text>
              <Text className="flex-1 text-base leading-relaxed text-foreground">
                <Inline tokens={item.tokens ?? []} />
              </Text>
            </View>
          ))}
        </View>
      );
    }

    case 'blockquote':
      return (
        <View className="border-l-2 border-border pl-3">
          {((token as Tokens.Blockquote).tokens ?? []).map((child, i) => (
            <TokenView key={i} token={child} />
          ))}
        </View>
      );

    case 'table': {
      const t = token as Tokens.Table;
      // Horizontal scroll: a table wide enough to matter never fits a phone,
      // and wrapping cells destroys the alignment that makes it a table.
      return (
        <ScrollView horizontal showsHorizontalScrollIndicator className="rounded-lg border border-border">
          <View>
            <View className="flex-row bg-subtle">
              {t.header.map((cell, i) => (
                <Text key={i} className="min-w-[110px] px-3 py-2 text-sm font-semibold text-foreground">
                  {cell.text}
                </Text>
              ))}
            </View>
            {t.rows.map((row, r) => (
              <View key={r} className="flex-row border-t border-border">
                {row.map((cell, c) => (
                  <Text key={c} className="min-w-[110px] px-3 py-2 text-sm text-muted-foreground">
                    {cell.text}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    }

    case 'hr':
      return <View className="h-px bg-border" />;

    case 'space':
      return null;

    default: {
      // Never drop content: an unrecognised construct renders as its source.
      const raw = (token as { raw?: string }).raw;
      return raw ? <Text className="text-base text-foreground">{raw}</Text> : null;
    }
  }
}

/** Inline spans, rendered as nested <Text> so they wrap as one paragraph. */
function Inline({ tokens }: { tokens: Token[] }): React.ReactElement {
  return (
    <>
      {tokens.map((token, i) => {
        switch (token.type) {
          case 'strong':
            return (
              <Text key={i} className="font-semibold">
                <Inline tokens={(token as Tokens.Strong).tokens ?? []} />
              </Text>
            );
          case 'em':
            return (
              <Text key={i} className="italic">
                <Inline tokens={(token as Tokens.Em).tokens ?? []} />
              </Text>
            );
          case 'del':
            return (
              <Text key={i} className="line-through">
                <Inline tokens={(token as Tokens.Del).tokens ?? []} />
              </Text>
            );
          case 'codespan':
            return (
              <Text key={i} className="rounded bg-subtle font-mono text-sm text-foreground">
                {` ${(token as Tokens.Codespan).text} `}
              </Text>
            );
          case 'link': {
            const t = token as Tokens.Link;
            return (
              <Text
                key={i}
                className="text-primary underline"
                onPress={() => void Linking.openURL(t.href)}
              >
                <Inline tokens={t.tokens ?? []} />
              </Text>
            );
          }
          case 'br':
            return <Text key={i}>{'\n'}</Text>;
          case 'text':
          default:
            return <Text key={i}>{(token as Tokens.Text).text ?? (token as { raw?: string }).raw ?? ''}</Text>;
        }
      })}
    </>
  );
}

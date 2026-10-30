// MP-42 CodeText (03 MP-42): inline code inside prose, or a block — rounded-code, bg-sunken, mono, selectable,
// horizontally scrollable unless wrapped, with an optional header (language, wrap, Copy) and bounded token colouring
// (ui/lib/highlight: over its budget the block renders plain).
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text as RNText, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { highlight, languageLabel, type TokenKind } from '../../lib/highlight';
import { useThemeColors, type ThemeColors } from '../../lib/themeColors';
import { IconButton } from '../IconButton';
import { Text } from '../Text';
import type { CodeTextProps } from './CodeText.types';

export type { CodeTextProps } from './CodeText.types';

/** Token kind → syntax colour (ThemeColors.syntax, MD-39); undefined = the block's fg. */
export function tokenColour(kind: TokenKind, syntax: ThemeColors['syntax']): string | undefined {
  switch (kind) {
    case 'keyword':
      return syntax.keyword;
    case 'string':
      return syntax.string;
    case 'comment':
    case 'meta':
      return syntax.comment;
    case 'number':
      return syntax.number;
    case 'literal':
      return syntax.constant;
    case 'type':
      return syntax.type;
    case 'tag':
      return syntax.tag;
    case 'attr':
      return syntax.attribute;
    case 'property':
      return syntax.variable;
    case 'heading':
      return syntax.function;
    case 'added':
      return syntax.inserted;
    case 'removed':
      return syntax.deleted;
    default:
      return undefined;
  }
}

export function codeBlockLabel(code: string, language?: string): string {
  const lines = code.split('\n').length;
  return ['Code', language ? languageLabel(language) : undefined, `${lines} line${lines === 1 ? '' : 's'}`].filter(Boolean).join(', ');
}

function InlineCode({ code, tone = 'fg', testID }: Pick<CodeTextProps, 'code' | 'tone' | 'testID'>): React.ReactElement {
  return (
    <RNText testID={testID} className={tone === 'err' ? 'bg-selected font-mono text-mono text-err' : 'bg-selected font-mono text-mono text-fg'}>
      {code}
    </RNText>
  );
}

function CodeBlock({ code, language, wrap, onToggleWrap, copyable = false, tone = 'fg', maxLines, testID }: Omit<CodeTextProps, 'form'>): React.ReactElement {
  const colors = useThemeColors();
  const [ownWrap, setOwnWrap] = useState(false);
  const wrapped = wrap ?? ownWrap;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  const shown = useMemo(() => (maxLines ? code.split('\n').slice(0, maxLines).join('\n') : code), [code, maxLines]);
  const lit = useMemo(() => (tone === 'err' ? null : highlight(shown, language)), [shown, language, tone]);
  const body = (
    <RNText selectable className={tone === 'err' ? 'font-mono text-mono text-err' : 'font-mono text-mono text-fg'}>
      {lit
        ? lit.lines.map((line, i) => (
            <RNText key={i}>
              {line.spans.map((span, j) => {
                const colour = tokenColour(span.kind, colors.syntax);
                return colour ? (
                  <RNText key={j} style={{ color: colour }}>
                    {span.text}
                  </RNText>
                ) : (
                  span.text
                );
              })}
              {i < lit.lines.length - 1 ? '\n' : ''}
            </RNText>
          ))
        : shown}
    </RNText>
  );
  const showHeader = Boolean(language) || copyable || onToggleWrap !== undefined || wrap === undefined;
  return (
    <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={codeBlockLabel(code, language)} className="overflow-hidden rounded-code border border-line-soft bg-sunken">
      {showHeader ? (
        <View className="flex-row items-center justify-between ps-3">
          <Text role="caption" tone="fg-3" chrome>
            {language ? languageLabel(language) : ''}
          </Text>
          <View className="flex-row">
            <IconButton
              icon="wrap"
              size="sm"
              label={wrapped ? 'Turn off line wrap' : 'Wrap lines'}
              selected={wrapped}
              onPress={() => (onToggleWrap ? onToggleWrap() : setOwnWrap((v) => !v))}
            />
            {copyable ? (
              <IconButton
                icon={copied ? 'check' : 'copy'}
                size="sm"
                label={copied ? 'Copied' : 'Copy code'}
                onPress={() => {
                  void Clipboard.setStringAsync(code).then(() => setCopied(true)).catch(() => undefined);
                }}
              />
            ) : null}
          </View>
        </View>
      ) : null}
      {wrapped ? (
        <View className="px-3 pb-2.5 pt-1">{body}</View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="px-3 pb-2.5 pt-1">
          {body}
        </ScrollView>
      )}
    </View>
  );
}

export function CodeText(props: CodeTextProps): React.ReactElement {
  return props.form === 'inline' ? <InlineCode code={props.code} tone={props.tone} testID={props.testID} /> : <CodeBlock {...props} />;
}

export { CodeBlock, InlineCode };

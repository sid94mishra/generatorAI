// ────────────────────────────────────────────────────────────────
// Stream block renderer.
//
// One component per block type from the shared model — the SAME model web
// and desktop render, so the transcripts agree. Every completed block is
// memoised on object identity: the reducers replace a block object whenever
// it changes, so an unchanged reference genuinely means unchanged content,
// and a streaming turn re-renders exactly one row regardless of how long the
// conversation is.
//
// Mobile-specific choices:
//   • rows are cards with a 28pt leading icon rather than a desktop timeline
//     rail, because a 1px rail at 393pt reads as an artefact;
//   • collapsed by default once settled, expanded while live — reasoning and
//     tool arguments are interesting in flight and noise afterwards;
//   • a diff-shaped tool result is rendered as a tinted diff, which is the
//     one place syntax colour genuinely aids comprehension on a small screen.
// ────────────────────────────────────────────────────────────────

import React, { memo, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import {
  AlertCircle,
  Brain,
  ChevronDown,
  ChevronRight,
  Code2,
  FilePlus2,
  FileText,
  Globe,
  LayoutGrid,
  ListTree,
  Search,
  Sparkles,
  TerminalSquare,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react-native';
import type { StreamBlock } from '@generatorai/client-core';

import { Markdown } from '../markdown/Markdown';
import { Touchable } from '../ui/Touchable';
import { Badge } from '../ui/primitives';
import { Spinner } from '../ui/States';
import {
  formatDuration,
  looksLikeDiff,
  toolKind,
  toolLabel,
  toolSummary,
  type ToolKind,
} from './toolPresentation';
import { useTheme } from '../../theme/ThemeProvider';

export const BlockView = memo(
  function BlockView({ block }: { block: StreamBlock }): React.ReactElement | null {
    switch (block.type) {
      case 'text':
        return <Markdown content={block.content} />;
      case 'thinking':
        return <ThinkingBlockView block={block} />;
      case 'tool_call':
        return <ToolCallBlockView block={block} />;
      case 'system':
        return <SystemBlockView block={block} />;
      case 'widget':
        return <WidgetBlockView block={block} />;
      default:
        // Plan and question blocks are decisions, not narration. They render
        // as pinned cards above the composer so they cannot scroll out of
        // reach mid-turn.
        return null;
    }
  },
  (prev, next) => prev.block === next.block,
);

function Row({
  icon,
  title,
  subtitle,
  right,
  expanded,
  onToggle,
  tone = 'default',
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  tone?: 'default' | 'danger';
  children?: React.ReactNode;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View
      className={`overflow-hidden rounded-2xl border ${
        tone === 'danger' ? 'border-danger bg-danger-muted' : 'border-border bg-card'
      }`}
    >
      <Touchable
        accessibilityLabel={`${title}${expanded ? ', collapse' : ', expand'}`}
        accessibilityState={{ expanded }}
        haptic="select"
        scale="large"
        onPress={onToggle}
        className="min-h-11 flex-row items-center gap-2.5 px-3 py-2"
      >
        <View className="h-7 w-7 items-center justify-center rounded-xl bg-subtle">{icon}</View>
        <View className="flex-1 gap-0.5">
          <Text numberOfLines={1} className="text-sm font-medium text-foreground">
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} className="font-mono text-xs text-muted-foreground">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
        {expanded ? (
          <ChevronDown size={16} color={colors['muted-foreground']} />
        ) : (
          <ChevronRight size={16} color={colors['muted-foreground']} />
        )}
      </Touchable>
      {expanded && children ? (
        <Animated.View entering={FadeIn.duration(120)} className="border-t border-border-muted">
          {children}
        </Animated.View>
      ) : null}
    </View>
  );
}

function ThinkingBlockView({
  block,
}: {
  block: Extract<StreamBlock, { type: 'thinking' }>;
}): React.ReactElement {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(!block.isComplete);

  return (
    <Row
      icon={<Brain size={14} color={block.isComplete ? colors['muted-foreground'] : colors.primary} />}
      title={block.isComplete ? 'Thought' : 'Thinking…'}
      right={block.isComplete ? null : <Spinner />}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <Text className="px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">{block.text}</Text>
    </Row>
  );
}

const TOOL_ICON: Record<ToolKind, React.ComponentType<{ size?: number; color?: string }>> = {
  read: FileText,
  edit: Code2,
  create: FilePlus2,
  delete: Trash2,
  search: Search,
  shell: TerminalSquare,
  web: Globe,
  task: ListTree,
  think: Sparkles,
  other: Wrench,
};

function ToolCallBlockView({
  block,
}: {
  block: Extract<StreamBlock, { type: 'tool_call' }>;
}): React.ReactElement {
  return (
    <ToolRow
      tool={block.tool}
      args={block.args}
      result={block.result}
      running={block.status === 'running'}
    />
  );
}

/**
 * A tool call, from either source.
 *
 * Live turns produce `tool_call` blocks; history carries the same calls on the
 * assistant message's `metadata.toolCalls`. Both render through here so a
 * completed turn looks identical whether it is streaming or replayed from the
 * database — which is what stopped mobile transcripts from losing every tool
 * call the moment the turn ended.
 */
export function ToolRow({
  tool,
  args,
  result,
  running,
}: {
  tool: string;
  args: unknown;
  result?: unknown;
  running: boolean;
}): React.ReactElement {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const Icon = TOOL_ICON[toolKind(tool)];
  const summary = toolSummary(args);

  return (
    <Row
      icon={<Icon size={14} color={running ? colors.primary : colors['muted-foreground']} />}
      title={toolLabel(tool)}
      subtitle={summary}
      right={
        running ? (
          <Spinner />
        ) : (
          // The raw tool name is what a developer actually wants to confirm,
          // and the humanised label above deliberately hides it.
          <Text numberOfLines={1} className="max-w-24 font-mono text-xs text-muted-foreground">
            {tool}
          </Text>
        )
      }
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <View className="gap-3 px-3 py-2.5">
        <Labelled label="Arguments" value={args} />
        {result !== undefined ? (
          looksLikeDiff(result) ? (
            <View className="gap-1">
              <Text className="text-xs uppercase tracking-wide text-muted-foreground">Result</Text>
              <DiffPreview patch={result} />
            </View>
          ) : (
            <Labelled label="Result" value={result} />
          )
        ) : null}
      </View>
    </Row>
  );
}

/**
 * Truncated so a multi-megabyte tool result cannot lock the UI thread while
 * `JSON.stringify` walks it and RN lays out the text.
 */
function Labelled({ label, value }: { label: string; value: unknown }): React.ReactElement {
  const text = typeof value === 'string' ? value : safeStringify(value);
  const clipped = text.length > 4000 ? `${text.slice(0, 4000)}\n… truncated` : text;
  return (
    <View className="gap-1">
      <Text className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Text>
      <View className="rounded-xl bg-canvas-bg p-2.5">
        <Text className="font-mono text-xs leading-code text-muted-foreground">{clipped}</Text>
      </View>
    </View>
  );
}

/**
 * Minimal unified-diff rendering: gutter tint per line, capped at 200 lines.
 *
 * Full syntax highlighting is not available on RN (no Shiki/TextMate), so the
 * add/remove tint carries the meaning instead. Beyond 200 lines the row
 * points at the Changes surface, which is virtualised and can take it.
 */
function DiffPreview({ patch }: { patch: string }): React.ReactElement {
  const lines = patch.split('\n');
  const shown = lines.slice(0, 200);

  return (
    <View className="overflow-hidden rounded-xl bg-canvas-bg py-1">
      {shown.map((line, i) => {
        const add = line.startsWith('+') && !line.startsWith('+++');
        const del = line.startsWith('-') && !line.startsWith('---');
        const hunk = line.startsWith('@@');
        return (
          <Text
            key={i}
            numberOfLines={1}
            className={`px-2 font-mono text-xs leading-code ${
              add
                ? 'bg-success-muted text-success'
                : del
                  ? 'bg-danger-muted text-danger'
                  : hunk
                    ? 'text-info'
                    : 'text-muted-foreground'
            }`}
          >
            {line || ' '}
          </Text>
        );
      })}
      {lines.length > shown.length ? (
        <Text className="px-2 pt-1 text-xs text-muted-foreground">
          {lines.length - shown.length} more lines — open Changes to read the whole diff.
        </Text>
      ) : null}
    </View>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    // Circular structures are common in tool payloads.
    return String(value);
  }
}

function SystemBlockView({
  block,
}: {
  block: Extract<StreamBlock, { type: 'system' }>;
}): React.ReactElement {
  const { colors } = useTheme();

  if (block.category === 'subagent') {
    return (
      <View className="flex-row items-start gap-2.5 rounded-2xl border border-border bg-raised px-3 py-2.5">
        <Users size={14} color={colors.info} />
        <View className="flex-1 gap-1">
          <Badge label="Subagent" tone="info" />
          <Text className="text-sm text-muted-foreground">{block.message}</Text>
        </View>
      </View>
    );
  }

  const isError = block.category === 'error';
  return (
    <View
      className={`flex-row items-start gap-2.5 rounded-2xl border px-3 py-2.5 ${
        isError ? 'border-danger bg-danger-muted' : 'border-border-muted bg-subtle'
      }`}
    >
      {isError ? (
        <AlertCircle size={14} color={colors.danger} />
      ) : (
        <TerminalSquare size={14} color={colors['muted-foreground']} />
      )}
      <Text className={`flex-1 text-sm ${isError ? 'text-foreground' : 'text-muted-foreground'}`}>
        {block.message}
      </Text>
    </View>
  );
}

/**
 * Widgets are agent-authored React components served from a separate origin
 * and executed inside a sandboxed iframe. React Native has no iframe, and a
 * WebView cannot reproduce the origin isolation the security model depends
 * on — so mobile states the limitation instead of rendering something that
 * looks interactive and is not.
 */
function WidgetBlockView({
  block,
}: {
  block: Extract<StreamBlock, { type: 'widget' }>;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View className="gap-2 rounded-2xl border border-border bg-card px-3 py-3">
      <View className="flex-row items-center gap-2.5">
        <View className="h-7 w-7 items-center justify-center rounded-xl bg-subtle">
          <LayoutGrid size={14} color={colors['muted-foreground']} />
        </View>
        <Text className="flex-1 text-sm font-medium text-foreground">
          {block.title ?? block.component}
        </Text>
        <Badge label="Desktop only" tone="neutral" />
      </View>
      <Text className="text-xs leading-relaxed text-muted-foreground">
        This is an interactive widget. It runs in a sandboxed frame on a separate origin, which this
        app cannot host safely — open the chat on desktop or web to use it.
      </Text>
    </View>
  );
}

export { formatDuration };

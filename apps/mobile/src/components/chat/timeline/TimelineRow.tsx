// ────────────────────────────────────────────────────────────────
// TimelineRow — one transcript row, for every kind `deriveTimeline` emits.
//
// Perf contract (plan §7.2):
//   • `TimelineRowView` is memoised with `rowsEqual`: a settled row's props
//     compare equal across derivations, so a streaming turn re-renders
//     exactly the rows that changed.
//   • The LIVE text / thinking row does not take its content as a prop at
//     all. It subscribes to its own block through a per-block selector into
//     the stream store, so a token landing re-renders that one component —
//     not the list, not the screen.
//   • Tool arguments and results are stringified lazily, on expand, and
//     capped at 4 KB. Inline diffs are capped at 160 lines.
//
// Density: steps are borderless one-line rows (`RowFrame` "line"); only
// failures, waits, running sub-agents and source-control results are cards.
// A settled turn's activity arrives folded as a `work` row ("Ran 2
// commands, read 3 files · 42s"); the turn's actions sit under its FINAL
// prose only.
// ────────────────────────────────────────────────────────────────

import React, { memo, useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import * as Clipboard from 'expo-clipboard';
import {
  AlertCircle,
  Bot,
  Brain,
  Code2,
  Copy,
  FileDiff,
  FileImage,
  FilePlus2,
  Ellipsis,
  FileText,
  GitFork,
  Globe,
  LayoutGrid,
  ListChecks,
  ListTree,
  PauseCircle,
  Search,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  TriangleAlert,
  Users,
  Volume2,
  Webhook,
  Wrench,
} from 'lucide-react-native';
import type { StreamBlock, StreamHookInvocation, StreamUsage } from '@generatorai/client-core';

import { Markdown } from '../../markdown/Markdown';
import { Badge } from '../../ui/primitives';
import { Button, IconButton } from '../../ui/Button';
import { ContextMenu, useContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { Spinner } from '../../ui/States';
import { useToast } from '../../ui/Toast';
import { useTheme } from '../../../theme/ThemeProvider';
import { useStreamStore } from '../../../stream/streamStore';
import { UsageFooter } from '../UsageFooter';
import { formatDuration, type ToolKind } from '../toolPresentation';
import { InlineDiff } from './InlineDiff';
import { CARD_ICON_AXIS, NestedRows, RowEnterContext, RowFrame, statusColor, type RowTone } from './RowFrame';
import { useChatMotion } from '../chatMotion';
import { ScmResultRow } from './ScmResultRow';
import { useTimelineActions } from './TimelineActions';
import {
  countSteps,
  rowsEqual,
  type StepGroup,
  type StepStatus,
  type TimelineRow,
  type ToolFamily,
  type ToolStep,
  type WorkSummary,
  formatWorkDuration,
  workLabel,
  workTitle,
} from './deriveTimeline';
import { READ_ALOUD_ENABLED } from '../featureFlags';

/** 4 KB per value — a multi-megabyte result must not lock the UI thread. */
const MAX_VALUE_CHARS = 4000;

type IconComponent = React.ComponentType<{ size?: number; color?: string }>;

const KIND_ICON: Record<ToolKind, IconComponent> = {
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

const FAMILY_ICON: Record<ToolFamily, IconComponent> = {
  read: FileText,
  search: Search,
  edit: Code2,
  delete: Trash2,
  shell: TerminalSquare,
  web: Globe,
  agent: Bot,
  other: Wrench,
};

function toneFor(status: StepStatus): RowTone {
  if (status === 'failed') return 'danger';
  if (status === 'waiting') return 'primary';
  return 'default';
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function clip(text: string, max = MAX_VALUE_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}\n… truncated` : text;
}

async function copyText(text: string, toast: ReturnType<typeof useToast>): Promise<void> {
  await Clipboard.setStringAsync(text);
  toast({ message: 'Copied.', tone: 'success' });
}

// ── Dispatcher ───────────────────────────────────────────────────

export const TimelineRowView = memo(
  function TimelineRowView({
    row,
    turnId,
  }: {
    row: TimelineRow;
    /**
     * The server turn this row belongs to, when it came from history.
     *
     * Only the settled prose row uses it — it is the anchor for "Fork from
     * here". Live rows have no server turn id yet, and rows derived from
     * tool calls are not a place anyone means to branch from.
     */
    turnId?: string | undefined;
  }): React.ReactElement | null {
    return (
      <RowEnterContext.Provider value={row.id.startsWith('live:')}>
        <RowBody row={row} turnId={turnId} />
      </RowEnterContext.Provider>
    );
  },
  (prev, next) => prev.turnId === next.turnId && rowsEqual(prev.row, next.row),
);

function RowBody({ row, turnId }: { row: TimelineRow; turnId?: string | undefined }): React.ReactElement | null {
  switch (row.kind) {
    case 'thinking':
      return row.live ? <LiveThinkingRow blockId={row.block.blockId} /> : <ThinkingRow block={row.block} />;
    case 'text':
      return row.live ? (
        <LiveTextRow blockId={row.block.blockId} />
      ) : (
        <TextRow content={row.block.content} turnId={turnId} final={Boolean(row.final)} />
      );
    case 'tool':
      return <ToolStepRow step={row.step} />;
    case 'group':
      return <GroupRow group={row.group} />;
    case 'work':
      return <WorkRow work={row.work} turnId={turnId} />;
    case 'system':
      return <SystemRow block={row.block} tone={row.tone} />;
    case 'widget':
      return <WidgetRow block={row.block} />;
    case 'waiting':
      return <WaitingRow gate={row.gate} />;
    case 'stopped':
      return <StoppedRow />;
    case 'hook':
      return <HookRow hook={row.hook} />;
    case 'usage':
      return <UsageRow usage={row.usage} />;
    case 'scm_result':
      return <ScmResultRow block={row.block} />;
    default:
      return null;
  }
}

/**
 * A settled turn's folded activity. Collapsed it is one quiet line naming
 * what the agent did ("Ran 2 commands, read 3 files"); expanded it lists
 * the steps beside a rule that hangs from this row's icon.
 */
function WorkRow({ work, turnId }: { work: WorkSummary; turnId?: string | undefined }): React.ReactElement {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const title = workTitle(work);
  const right =
    work.failed > 0 || work.durationMs !== undefined ? (
      <View className="flex-row items-center gap-1.5">
        {work.failed > 0 ? <Badge label={`${work.failed} failed`} tone="danger" /> : null}
        {work.durationMs !== undefined ? (
          <Text className="text-xs text-muted-foreground">{formatWorkDuration(work.durationMs)}</Text>
        ) : null}
      </View>
    ) : null;
  return (
    <RowFrame
      icon={<ListChecks size={16} color={work.failed > 0 ? colors.danger : colors['muted-foreground']} />}
      title={title}
      right={right}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      accessibilityLabel={workLabel(work)}
      flushChildren
      titleLines={2}
    >
      <NestedRows>
        <View className="gap-1 pb-1">
          {work.rows.map((row) => (
            <RowBody key={row.id} row={row} turnId={turnId} />
          ))}
        </View>
      </NestedRows>
    </RowFrame>
  );
}

function UsageRow({ usage }: { usage: StreamUsage }): React.ReactElement {
  const { previousUsage } = useTimelineActions();
  return <UsageFooter usage={usage} previous={previousUsage ?? null} />;
}

// ── Live blocks (per-block store selectors) ──────────────────────

function useLiveBlock<T extends StreamBlock['type']>(blockId: number, type: T): Extract<StreamBlock, { type: T }> | undefined {
  const { streamKey } = useTimelineActions();
  return useStreamStore(
    useCallback(
      (s) => {
        const blocks = s.streams[streamKey ?? '']?.blocks;
        if (!blocks) return undefined;
        // The live block is at the tail; walking back finds it in O(1).
        for (let i = blocks.length - 1; i >= 0; i -= 1) {
          const b = blocks[i]!;
          if (b.blockId === blockId) return b.type === type ? (b as Extract<StreamBlock, { type: T }>) : undefined;
        }
        return undefined;
      },
      [streamKey, blockId, type],
    ),
  );
}

function LiveTextRow({ blockId }: { blockId: number }): React.ReactElement | null {
  const block = useLiveBlock(blockId, 'text');
  if (!block) return null;
  // Native text: the growing block re-lays out inside the platform text
  // view, not the JS tree.
  return <Markdown content={block.content} streaming />;
}

function LiveThinkingRow({ blockId }: { blockId: number }): React.ReactElement | null {
  const block = useLiveBlock(blockId, 'thinking');
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(true);
  if (!block) return null;
  return (
    <RowFrame
      icon={<Brain size={14} color={colors.primary} />}
      title="Thinking…"
      right={<Spinner />}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
    >
      <Text className="px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">{block.text}</Text>
    </RowFrame>
  );
}

// ── Settled prose ────────────────────────────────────────────────

function useTextMenu(content: string, turnId?: string | undefined): ContextMenuItem[] {
  const toast = useToast();
  const { colors } = useTheme();
  const { readAloud, onCopyTranscript, onForkFrom } = useTimelineActions();
  return useMemo(() => {
    const items: ContextMenuItem[] = [
      {
        label: 'Copy text',
        icon: <Copy size={18} color={colors.foreground} />,
        onPress: () => void copyText(content, toast),
      },
    ];
    if (READ_ALOUD_ENABLED && readAloud && content.trim()) {
      items.push({
        label: 'Read aloud',
        icon: <Volume2 size={18} color={colors.foreground} />,
        onPress: () => readAloud(content),
      });
    }
    // History actions hang off the ANSWER, not the prompt: "fork from here"
    // means "keep everything up to and including this reply, then diverge".
    // They are only offered on a settled history row, which is the only kind
    // that knows its server turn id.
    if (onCopyTranscript) {
      items.push({
        label: 'Copy transcript',
        detail: 'The whole chat, as markdown.',
        testID: 'copy-transcript',
        icon: <Copy size={18} color={colors.foreground} />,
        onPress: onCopyTranscript,
      });
    }
    if (onForkFrom && turnId) {
      items.push({
        label: 'Fork from here',
        detail: 'A new chat that shares this one\u2019s files and its history up to this point.',
        testID: 'fork-chat',
        icon: <GitFork size={18} color={colors.foreground} />,
        onPress: () => onForkFrom(turnId),
      });
    }
    return items;
  }, [content, toast, colors.foreground, readAloud, onCopyTranscript, onForkFrom, turnId]);
}

/**
 * Settled prose. Long-press anywhere opens its menu. The FINAL prose of a
 * settled turn also carries a small action bar — copy, read aloud, and "⋯"
 * for the rest (copy transcript, fork from here) — because a long-press is
 * undiscoverable. Interim prose between tool calls gets no bar: a "⋯" under
 * every paragraph was the loudest thing in the transcript.
 */
function TextRow({
  content,
  turnId,
  final,
}: {
  content: string;
  turnId?: string | undefined;
  final: boolean;
}): React.ReactElement {
  const items = useTextMenu(content, turnId);
  const { colors } = useTheme();
  const toast = useToast();
  const { readAloud } = useTimelineActions();
  const { open } = useContextMenu();
  return (
    <ContextMenu items={items} title="Agent message" accessibilityLabel={content}>
      <View className="gap-0.5">
        <Markdown content={content} />
        {final ? (
          <View className="-ml-2.5 flex-row items-center">
            <IconButton
              accessibilityLabel="Copy reply"
              variant="ghost"
              compact
              icon={<Copy size={15} color={colors['muted-foreground']} />}
              onPress={() => void copyText(content, toast)}
            />
            {READ_ALOUD_ENABLED && readAloud && content.trim() ? (
              <IconButton
                accessibilityLabel="Read reply aloud"
                variant="ghost"
                compact
                icon={<Volume2 size={16} color={colors['muted-foreground']} />}
                onPress={() => readAloud(content)}
              />
            ) : null}
            <IconButton
              testID="assistant-message-actions"
              accessibilityLabel="Message actions"
              accessibilityHint="Copy, copy the transcript, or fork from here"
              variant="ghost"
              compact
              icon={<Ellipsis size={16} color={colors['muted-foreground']} />}
              onPress={() => open(items, { title: 'Agent message' })}
            />
          </View>
        ) : null}
      </View>
    </ContextMenu>
  );
}

function ThinkingRow({ block }: { block: Extract<StreamBlock, { type: 'thinking' }> }): React.ReactElement {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const menu = useTextMenu(block.text);
  return (
    <RowFrame
      icon={<Brain size={14} color={colors['muted-foreground']} />}
      title="Thought"
      subtitle={expanded ? null : block.text.replace(/\s+/g, ' ').slice(0, 80)}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      menu={menu}
      menuTitle="Reasoning"
    >
      <Text selectable className="px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
        {block.text}
      </Text>
    </RowFrame>
  );
}

// ── Tool steps ───────────────────────────────────────────────────

function useStepMenu(step: ToolStep): ContextMenuItem[] {
  const toast = useToast();
  const { colors } = useTheme();
  const { openInChanges, openConsole } = useTimelineActions();
  return useMemo(() => {
    const items: ContextMenuItem[] = [];
    if (step.shell) {
      items.push({
        label: 'Copy command',
        icon: <Copy size={18} color={colors.foreground} />,
        onPress: () => void copyText(step.shell!.command, toast),
      });
      if (step.shell.output) {
        items.push({
          label: 'Copy output',
          icon: <Copy size={18} color={colors.foreground} />,
          onPress: () => void copyText(step.shell!.output, toast),
        });
      }
      if (openConsole) {
        items.push({
          label: 'Open in console',
          icon: <TerminalSquare size={18} color={colors.foreground} />,
          onPress: () => openConsole(step.callId),
        });
      }
    } else if (step.target) {
      items.push({
        label: step.fileOp ? 'Copy path' : 'Copy',
        icon: <Copy size={18} color={colors.foreground} />,
        onPress: () => void copyText(step.fileOp?.filePath ?? step.target, toast),
      });
    }
    // Stringified on demand, never on render.
    items.push({
      label: 'Copy as markdown',
      icon: <Copy size={18} color={colors.foreground} />,
      onPress: () => void copyText(stepMarkdown(step), toast),
    });
    if (step.fileOp && openInChanges) {
      const path = step.fileOp.filePath;
      items.push({
        label: 'Open in Changes',
        icon: <FileDiff size={18} color={colors.foreground} />,
        onPress: () => openInChanges(path),
      });
    }
    return items;
  }, [step, toast, colors.foreground, openInChanges, openConsole]);
}

function stepMarkdown(step: ToolStep): string {
  const parts = [`**${step.label}** ${step.target}`.trim()];
  if (step.shell) {
    parts.push('```\n' + step.shell.command + '\n```');
    if (step.shell.output) parts.push('```\n' + clip(step.shell.output) + '\n```');
  } else {
    if (step.block.args != null) parts.push('Args:\n```json\n' + clip(safeStringify(step.block.args)) + '\n```');
    if (step.block.result != null) parts.push('Result:\n```\n' + clip(safeStringify(step.block.result)) + '\n```');
  }
  return parts.join('\n\n');
}

export function ToolStepRow({ step, nested = false }: { step: ToolStep; nested?: boolean }): React.ReactElement {
  const { colors } = useTheme();
  const { openInChanges, openConsole, openImage } = useTimelineActions();
  const [expanded, setExpanded] = useState(false);
  const menu = useStepMenu(step);

  const isAgent = step.family === 'agent';
  const stepCount = isAgent ? countSteps(step.children) : 0;
  const Icon: IconComponent = isAgent ? Bot : step.family === 'other' ? KIND_ICON[step.kind] : FAMILY_ICON[step.family];
  // Colour means status: a sub-agent is tinted only while it runs.
  const tone: RowTone = isAgent && step.status === 'running' && !nested ? 'info' : toneFor(step.status);
  const color =
    isAgent && step.status === 'running'
      ? colors.info
      : step.status === 'running' || step.status === 'waiting'
        ? statusColor(step.status, colors as Record<string, string>)
        : step.status === 'failed'
          ? colors.danger
          : colors['muted-foreground'];

  // A sub-agent is named by its brief ("Write alpha.txt"), not "Agent: Sub-agent".
  const title = isAgent ? (step.agentName && step.agentName !== 'Sub-agent' ? step.agentName : 'Sub-agent') : step.label;
  const subtitle = isAgent
    ? stepCount > 0
      ? `${stepCount} ${stepCount === 1 ? 'step' : 'steps'}`
      : null
    : step.shell
      ? step.shell.command
      : step.target || null;

  const right = (
    <View className="flex-row items-center gap-1.5">
      {step.status === 'running' ? (
        <Spinner />
      ) : step.status === 'waiting' ? (
        <PauseCircle size={14} color={colors.primary} />
      ) : step.status === 'failed' ? (
        <Badge label="Failed" tone="danger" />
      ) : step.shell && step.shell.exitCode !== undefined ? (
        <Text className={`font-mono text-xs ${step.shell.exitCode === 0 ? 'text-muted-foreground' : 'text-danger'}`}>
          exit {step.shell.exitCode}
        </Text>
      ) : step.meta ? (
        <FileOpMeta meta={step.meta} fileOp={Boolean(step.fileOp)} />
      ) : step.image ? (
        <FileImage size={14} color={colors['muted-foreground']} />
      ) : null}
    </View>
  );

  const openFull = step.fileOp && openInChanges ? () => openInChanges(step.fileOp!.filePath) : undefined;
  // Mirrors RowFrame's grammar choice: a tinted top-level row is a card.
  const asCard = !nested && tone !== 'default';

  return (
    <RowFrame
      icon={<Icon size={nested ? 14 : 16} color={color} />}
      title={title}
      subtitle={subtitle}
      detail={step.errorMessage ?? null}
      right={right}
      tone={tone}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      menu={menu}
      menuTitle={title}
      nested={nested}
      flushChildren={isAgent}
    >
      {isAgent ? (
        <View className="gap-1.5 py-2 pr-2">
          {step.children && step.children.length > 0 ? (
            <NestedRows {...(asCard ? { axis: CARD_ICON_AXIS } : {})}>
              {step.children.map((child) => (
                <ToolStepRow key={child.id} step={child} nested />
              ))}
            </NestedRows>
          ) : (
            <Text className={`text-xs text-muted-foreground ${asCard ? 'px-3' : 'pl-8'}`}>
              {step.status === 'running' ? 'Starting…' : 'No steps were recorded.'}
            </Text>
          )}
          <View className={`gap-1.5 ${asCard ? 'px-3' : 'pl-8'}`}>
            <LazyValue label="Brief" value={step.block.args} />
            {step.block.result !== undefined ? <LazyValue label="Report" value={step.block.result} /> : null}
          </View>
        </View>
      ) : step.fileOp ? (
        <InlineDiff fileOp={step.fileOp} onOpenFull={openFull} />
      ) : step.shell ? (
        <ShellDetail step={step} onOpenConsole={openConsole ? () => openConsole(step.callId) : undefined} />
      ) : (
        <View className="gap-3 px-3 py-2.5">
          {step.image && openImage ? (
            <Button
              label={`View ${step.image.label}`}
              variant="secondary"
              size="sm"
              icon={<FileImage size={14} color={colors.foreground} />}
              onPress={() => openImage(step.image!)}
            />
          ) : null}
          <LazyValue label="Arguments" value={step.block.args} />
          {step.block.result !== undefined ? <LazyValue label="Result" value={step.block.result} /> : null}
        </View>
      )}
    </RowFrame>
  );
}

function FileOpMeta({ meta, fileOp }: { meta: string; fileOp: boolean }): React.ReactElement {
  if (!fileOp) return <Text className="font-mono text-xs text-muted-foreground">{meta}</Text>;
  const [add, del] = meta.split(' ');
  return (
    <Text className="font-mono text-xs">
      <Text className="text-success">{add}</Text> <Text className="text-danger">{del}</Text>
    </Text>
  );
}

function ShellDetail({ step, onOpenConsole }: { step: ToolStep; onOpenConsole?: (() => void) | undefined }): React.ReactElement {
  const { colors } = useTheme();
  const shell = step.shell!;
  // Six lines of the tail — where a failure explains itself — then the console.
  const preview = useMemo(() => {
    const lines = shell.output.split('\n').filter((l, i, all) => l.length > 0 || i < all.length - 1);
    return lines.slice(-8).join('\n');
  }, [shell.output]);
  return (
    <View className="gap-2 px-3 py-2.5">
      <View className="rounded-xl bg-canvas-bg p-2.5">
        <Text selectable className="font-mono text-xs leading-code text-foreground">
          $ {shell.command}
        </Text>
        {preview ? (
          <Text selectable numberOfLines={8} className="mt-1.5 font-mono text-xs leading-code text-muted-foreground">
            {preview}
          </Text>
        ) : shell.status === 'running' ? (
          <Text className="mt-1.5 text-xs text-muted-foreground">Running…</Text>
        ) : null}
      </View>
      <View className="flex-row items-center gap-2">
        {shell.durationMs !== undefined ? (
          <Text className="text-xs text-muted-foreground">{formatDuration(shell.durationMs)}</Text>
        ) : null}
        <View className="flex-1" />
        {onOpenConsole ? (
          <Button
            label="Open in console"
            variant="secondary"
            size="sm"
            icon={<TerminalSquare size={14} color={colors.foreground} />}
            onPress={onOpenConsole}
          />
        ) : null}
      </View>
    </View>
  );
}

/** Stringified on mount — and only mounted once the row is expanded. */
function LazyValue({ label, value }: { label: string; value: unknown }): React.ReactElement | null {
  const text = useMemo(() => (value == null ? '' : clip(safeStringify(value))), [value]);
  if (!text) return null;
  return (
    <View className="gap-1">
      <Text className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Text>
      <View className="rounded-xl bg-canvas-bg p-2.5">
        <Text selectable className="font-mono text-xs leading-code text-muted-foreground">
          {text}
        </Text>
      </View>
    </View>
  );
}

// ── Groups ───────────────────────────────────────────────────────

function GroupRow({ group }: { group: StepGroup }): React.ReactElement {
  const { colors } = useTheme();
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const Icon = FAMILY_ICON[group.family];
  const tone = toneFor(group.status);
  const menu = useMemo<ContextMenuItem[]>(
    () => [
      {
        label: 'Copy as markdown',
        icon: <Copy size={18} color={colors.foreground} />,
        onPress: () =>
          void copyText(
            [`**${group.label}**`, ...group.steps.map((s) => `- ${s.label} ${s.target}`.trim())].join('\n'),
            toast,
          ),
      },
    ],
    [group, colors.foreground, toast],
  );

  const right = (
    <View className="flex-row items-center gap-1.5">
      {group.failed > 0 ? <Badge label={`${group.failed} failed`} tone="danger" /> : null}
      {group.fileOps ? (
        <FileOpMeta meta={`+${group.fileOps.additions} −${group.fileOps.deletions}`} fileOp />
      ) : null}
      {/* No count pill: the label already says "Ran 2 commands". */}
      {group.status === 'running' ? (
        <Spinner />
      ) : group.status === 'waiting' ? (
        <PauseCircle size={14} color={colors.primary} />
      ) : null}
    </View>
  );

  return (
    <RowFrame
      icon={<Icon size={16} color={group.failed > 0 ? colors.danger : statusColor(group.status, colors as Record<string, string>)} />}
      title={group.label}
      subtitle={group.summary || null}
      right={right}
      tone={tone}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      menu={menu}
      menuTitle={group.label}
      accessibilityLabel={`${group.label}, ${group.steps.length} steps`}
      flushChildren
    >
      <NestedRows>
        {group.steps.map((step) => (
          <ToolStepRow key={step.id} step={step} nested />
        ))}
      </NestedRows>
    </RowFrame>
  );
}

// ── System / status rows ─────────────────────────────────────────

function SystemRow({
  block,
  tone,
}: {
  block: Extract<StreamBlock, { type: 'system' }>;
  tone: 'neutral' | 'info' | 'warning' | 'danger';
}): React.ReactElement {
  const { colors } = useTheme();
  const menu = useTextMenu(block.message);
  const icon =
    tone === 'danger' ? (
      <AlertCircle size={14} color={colors.danger} />
    ) : tone === 'warning' ? (
      <TriangleAlert size={14} color={colors.warning} />
    ) : tone === 'info' ? (
      <Users size={16} color={colors['muted-foreground']} />
    ) : (
      <TerminalSquare size={14} color={colors['muted-foreground']} />
    );
  const title = tone === 'danger' ? 'Error' : tone === 'warning' ? 'Warning' : tone === 'info' ? 'Sub-agent' : 'System';
  return (
    <RowFrame
      icon={icon}
      title={title}
      detail={block.message}
      // A sub-agent notice is information, not a status: no tint.
      tone={tone === 'neutral' || tone === 'info' ? 'default' : tone}
      menu={menu}
      menuTitle={title}
      accessibilityLabel={`${title}: ${block.message}`}
    />
  );
}

function WaitingRow({ gate }: { gate: 'permission' | 'question' | 'plan' }): React.ReactElement {
  const { colors } = useTheme();
  const detail =
    gate === 'permission'
      ? 'The agent needs your permission before it can run this tool.'
      : gate === 'question'
        ? 'The agent asked a question — answer it below to continue.'
        : 'A plan is ready for your review below.';
  return (
    <RowFrame
      icon={<PauseCircle size={14} color={colors.primary} />}
      title="Waiting for you"
      detail={detail}
      tone="primary"
      accessibilityLabel={`Waiting for you. ${detail}`}
    />
  );
}

function StoppedRow(): React.ReactElement {
  const { colors } = useTheme();
  const motion = useChatMotion();
  return (
    <Animated.View
      entering={motion.fadeIn(160)}
      exiting={motion.fadeOut(120)}
      accessibilityLiveRegion="polite"
      className="flex-row items-center justify-center gap-2 py-1"
    >
      {/* Filled, not an outline: a hollow 11pt square beside grey text reads
          as an empty checkbox, which is not what a stop marker should say. */}
      <Square size={10} color={colors['muted-foreground']} fill={colors['muted-foreground']} />
      <Text className="text-sm text-muted-foreground">Stopped by you before the response finished</Text>
    </Animated.View>
  );
}

function HookRow({ hook }: { hook: StreamHookInvocation }): React.ReactElement {
  const { colors } = useTheme();
  const tone: RowTone = hook.status === 'failed' ? 'danger' : 'default';
  const right =
    hook.status === 'running' ? (
      <Spinner />
    ) : (
      <Text className={`text-xs ${hook.status === 'failed' ? 'text-danger' : 'text-muted-foreground'}`}>
        {hook.status === 'failed' ? 'failed' : (formatDuration(hook.durationMs) ?? 'ok')}
      </Text>
    );
  return (
    <RowFrame
      icon={<Webhook size={14} color={hook.status === 'failed' ? colors.danger : colors['muted-foreground']} />}
      title={`Hook · ${hook.hookName}`}
      subtitle={hook.phase}
      right={right}
      tone={tone}
      nested
    />
  );
}

/**
 * Widgets run inside a sandboxed iframe on a separate origin. React Native
 * has no iframe and a WebView cannot reproduce that isolation, so mobile
 * states the limitation rather than rendering something that looks
 * interactive and is not.
 */
function WidgetRow({ block }: { block: Extract<StreamBlock, { type: 'widget' }> }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <RowFrame
      icon={<LayoutGrid size={14} color={colors['muted-foreground']} />}
      title={block.title ?? block.component}
      detail="Interactive widget — open this chat on desktop or web to use it."
      right={<Badge label="Desktop only" tone="neutral" />}
    />
  );
}

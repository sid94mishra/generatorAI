// ────────────────────────────────────────────────────────────────
// AgentConsole — the commands the agent ran, terminal-styled, native.
//
// The first tier of the two-tier terminal (plan §6.6). No WebView: the
// harness runs its shell commands in its own per-turn process, so there is
// no PTY to attach to — only a list of `tool_call` blocks with a command and,
// once complete, its output. A virtualised native list renders that at a
// fraction of the cost of the interactive terminal and works on every
// device, including ones without `exec:terminal`.
//
// "Open in terminal" — the second tier — is offered only when the device
// holds the scope, and it TYPES the command into a fresh shell rather than
// running it: the user presses Enter, or does not.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { ChevronDown, ChevronRight, SquareTerminal } from 'lucide-react-native';
import type { StreamBlock } from '@generatorai/client-core';

import { Touchable } from '../components/ui/Touchable';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/States';
import { useToast } from '../components/ui/Toast';
import { MAX_SCALE } from '../components/ui/accessibility';
import { useAuth } from '../auth/AuthProvider';
import { checkFeature } from '../auth/featureGate';
import { useTheme } from '../theme/ThemeProvider';
import { agentConsoleRows, type AgentConsoleRow } from './agentConsoleRows';

export function AgentConsole({
  blocks,
  workspaceId,
  selectedId = null,
  onOpenInTerminal,
}: {
  /** The chat's stream blocks; only shell tool calls are shown. */
  blocks: ReadonlyArray<StreamBlock>;
  /** Needed for the default "Open in terminal" navigation. */
  workspaceId?: string;
  /** A row to expand initially — the command chip the user tapped. */
  selectedId?: string | null;
  /** Override the default navigation to `/terminal/[workspaceId]`. */
  onOpenInTerminal?: (row: AgentConsoleRow) => void;
}): React.ReactElement {
  const { state } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();

  const rows = useMemo(() => agentConsoleRows(blocks), [blocks]);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(selectedId ? [selectedId] : []),
  );

  const scopes = state.status === 'authenticated' ? state.scopes : [];
  const canOpen =
    checkFeature('terminal', scopes).available && (Boolean(onOpenInTerminal) || Boolean(workspaceId));

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const copy = useCallback(
    (row: AgentConsoleRow) => {
      const text = row.output ? `${row.command}\n\n${row.output}` : row.command;
      void Clipboard.setStringAsync(text).then(() => toast({ message: 'Copied.', tone: 'success' }));
    },
    [toast],
  );

  const open = useCallback(
    (row: AgentConsoleRow) => {
      if (onOpenInTerminal) {
        onOpenInTerminal(row);
        return;
      }
      if (!workspaceId) return;
      router.push({
        pathname: '/terminal/[workspaceId]',
        params: { workspaceId, command: row.command },
      });
    },
    [onOpenInTerminal, workspaceId],
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No commands yet"
        message="Shell commands the agent runs in this chat appear here, with their output the moment each finishes."
        icon={<SquareTerminal size={22} color={colors['muted-foreground']} />}
      />
    );
  }

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.id}
      // Rows are cheap until expanded; keep the window small so a long chat
      // does not mount hundreds of monospace blocks at once.
      initialNumToRender={12}
      windowSize={5}
      removeClippedSubviews
      contentContainerStyle={{ padding: 8, gap: 6 }}
      ListHeaderComponent={
        <Text className="px-1 pb-1 text-[10px] text-muted-foreground">
          {rows.length} command{rows.length === 1 ? '' : 's'} — the agent runs these in its own
          shell; output appears when each finishes.
        </Text>
      }
      renderItem={({ item }) => (
        <ConsoleRow
          row={item}
          expanded={expanded.has(item.id)}
          onToggle={() => toggle(item.id)}
          onCopy={() => copy(item)}
          {...(canOpen ? { onOpen: () => open(item) } : {})}
        />
      )}
    />
  );
}

const STATUS_CLASS: Record<AgentConsoleRow['status'], string> = {
  running: 'bg-warning',
  complete: 'bg-success',
  failed: 'bg-danger',
};

const ConsoleRow = React.memo(function ConsoleRow({
  row,
  expanded,
  onToggle,
  onCopy,
  onOpen,
}: {
  row: AgentConsoleRow;
  expanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onOpen?: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const meta = [
    row.cwd ? shortenPath(row.cwd) : null,
    row.exitCode !== undefined ? `exit ${row.exitCode}` : null,
    row.durationMs !== undefined ? formatDuration(row.durationMs) : null,
    row.status === 'running' ? 'running…' : null,
  ].filter(Boolean);

  return (
    <View className="rounded-xl border border-border bg-card">
      <Touchable
        scale="large"
        haptic="select"
        onPress={onToggle}
        onLongPress={onCopy}
        accessibilityLabel={`${row.status === 'failed' ? 'Failed command' : 'Command'}: ${row.command}`}
        accessibilityHint={expanded ? 'Collapses the output. Long-press to copy.' : 'Expands the output. Long-press to copy.'}
        accessibilityState={{ expanded }}
        className="flex-row items-start gap-2 px-3 py-2"
      >
        <View className={`mt-1.5 h-2 w-2 rounded-full ${STATUS_CLASS[row.status]}`} />
        <View className="flex-1 gap-0.5">
          {row.description ? (
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_SCALE.chrome}
              className="text-[10px] text-muted-foreground"
            >
              {row.description}
            </Text>
          ) : null}
          <Text
            numberOfLines={expanded ? undefined : 2}
            selectable={expanded}
            className="font-mono text-xs text-foreground"
          >
            <Text className="text-muted-foreground">$ </Text>
            {row.command || '(no command)'}
          </Text>
          {meta.length > 0 ? (
            <Text numberOfLines={1} className="text-[10px] text-muted-foreground">
              {meta.join(' · ')}
            </Text>
          ) : null}
        </View>
        {expanded ? (
          <ChevronDown size={14} color={colors['muted-foreground']} />
        ) : (
          <ChevronRight size={14} color={colors['muted-foreground']} />
        )}
      </Touchable>

      {expanded ? (
        <View className="gap-2 border-t border-border-muted px-3 py-2">
          {row.output ? (
            <Text selectable className="font-mono text-[10px] leading-4 text-foreground">
              {row.output}
            </Text>
          ) : (
            <Text className="text-[10px] text-muted-foreground">
              {row.status === 'running' ? 'Waiting for the command to finish…' : 'No output.'}
            </Text>
          )}
          {onOpen && row.command ? (
            <Button
              label="Open in terminal"
              size="sm"
              variant="secondary"
              haptic="tap"
              accessibilityHint="Types this command into a new shell. It does not run until you press Enter."
              onPress={onOpen}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

function shortenPath(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.length <= 2 ? cwd : `…/${parts.slice(-2).join('/')}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

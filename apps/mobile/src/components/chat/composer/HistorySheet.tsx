// ────────────────────────────────────────────────────────────────
// Prompt history sheet — swipe up on the field, or `+` → History.
//
// Newest first, because the one the user wants is almost always the last
// one they sent. Tapping a row puts it in the field (nothing auto-sends).
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { View } from 'react-native';
import { History, Paperclip } from 'lucide-react-native';

import { Sheet, SheetRow } from '../../ui/Sheet';
import { EmptyState } from '../../ui/States';
import { useTheme } from '../../../theme/ThemeProvider';
import type { PromptHistoryEntry } from './types';

function relative(ts: number, now = Date.now()): string {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function HistorySheet({
  visible,
  onClose,
  entries,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  /** Newest first. */
  entries: readonly PromptHistoryEntry[];
  onPick: (entry: PromptHistoryEntry) => void;
}): React.ReactElement | null {
  const { colors } = useTheme();
  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={onClose} title="Recent prompts" detents={[0.55, 0.92]}>
      {entries.length === 0 ? (
        <EmptyState
          title="Nothing sent yet"
          message="Prompts you send from this chat appear here so you can reuse them."
          icon={<History size={22} color={colors['muted-foreground']} />}
        />
      ) : (
        <View className="pb-6">
          {entries.map((entry) => (
            <SheetRow
              key={entry.id}
              title={entry.text.length > 140 ? `${entry.text.slice(0, 140)}…` : entry.text}
              subtitle={[relative(entry.ts), entry.attachments?.length ? `${entry.attachments.length} attachment${entry.attachments.length === 1 ? '' : 's'}` : null]
                .filter(Boolean)
                .join(' · ')}
              onPress={() => onPick(entry)}
              right={
                entry.attachments?.length ? (
                  <Paperclip size={14} color={colors['muted-foreground']} />
                ) : undefined
              }
            />
          ))}
        </View>
      )}
    </Sheet>
  );
}

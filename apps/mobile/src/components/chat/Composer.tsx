// ────────────────────────────────────────────────────────────────
// Composer — the chat input.
//
// Every control the web composer exposes is reachable here. What differs is
// the layout: a phone gets ONE row of inline affordances (the two the user
// touches most, plus send), and everything else lives one tap away in a
// sheet. Cramming thirteen desktop pills onto 393pt is what made the previous
// version unusable.
//
//   row 1   attachments (chips)          — only when non-empty
//   row 2   slash / mention strip        — only while a trigger is open
//   row 3   the text field + mic
//   row 4   [+] [model ▾] [mode] [options] … [gauge] [send]
//
// The send control is a single morphing target rather than two swapped
// buttons: swapping moves the tap area under the user's thumb at exactly the
// moment they are reaching for it, which is how you get accidental cancels.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import {
  ArrowUp,
  Cpu,
  Mic,
  Paperclip,
  Plus,
  SlidersHorizontal,
  Square,
  Wand2,
  X,
} from 'lucide-react-native';
import type { AgentMode, ModelInfo } from '@generatorai/client-core';

import { Chip } from '../ui/Chip';
import { IconButton } from '../ui/Button';
import { ProgressRing } from '../ui/ProgressRing';
import { Touchable } from '../ui/Touchable';
import { haptics } from '../ui/haptics';
import { ModelSheet } from './ModelSheet';
import { TurnOptionsSheet } from './TurnOptionsSheet';
import {
  SLASH_COMMANDS,
  applyMenuSelection,
  detectMenu,
  filterCommands,
  filterPaths,
  type MenuState,
} from './composerMenu';
import { findModel, promptLimit } from '../../api/useModels';
import { useTheme } from '../../theme/ThemeProvider';

export interface ComposerProps {
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  disabledReason?: string | undefined;

  models: ModelInfo[] | undefined;
  modelsLoading: boolean;
  onRefreshModels?: (() => void) | undefined;
  selectedModelId: string | null;
  onSelectModel: (id: string) => void;

  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  effort: string | null;
  onEffortChange: (effort: string) => void;
  contextTier: 'default' | 'long_context';
  onContextTierChange: (tier: 'default' | 'long_context') => void;
  permissionMode: string;
  onPermissionModeChange: (mode: string) => void;

  contextTokens: number | null;
  codebaseCount: number;

  /** Paths offered for @-mentions. Empty when there is no workspace yet. */
  mentionPaths: readonly string[];
  /** Opens a Workbench section — how slash commands resolve on mobile. */
  onOpenSection: (section: string) => void;

  voiceAvailable: boolean;
  onVoice?: (() => void) | undefined;
  attachAvailable: boolean;
  onAttach?: (() => void) | undefined;

  attachments: Array<{ id: string; name: string }>;
  onRemoveAttachment: (id: string) => void;
}

export function Composer(props: ComposerProps): React.ReactElement {
  const { colors } = useTheme();
  const [sheet, setSheet] = useState<'none' | 'model' | 'options'>('none');
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);

  const {
    draft,
    onDraftChange,
    onSend,
    onStop,
    isStreaming,
    disabled = false,
    disabledReason,
    models,
    selectedModelId,
    mentionPaths,
    onOpenSection,
    attachments,
    onRemoveAttachment,
  } = props;

  const model = findModel(models, selectedModelId);
  const limit = promptLimit(model);
  const ratio = limit && props.contextTokens ? props.contextTokens / limit : 0;

  const menu = useMemo<MenuState | null>(() => detectMenu(draft, caret), [draft, caret]);

  const suggestions = useMemo(() => {
    if (!menu) return [];
    if (menu.kind === 'slash') {
      return filterCommands(menu.query).map((c) => ({
        key: c.id,
        label: c.label,
        hint: c.description,
      }));
    }
    return filterPaths(mentionPaths, menu.query).map((p) => ({
      key: p,
      label: p.slice(p.lastIndexOf('/') + 1),
      hint: p,
    }));
  }, [menu, mentionPaths]);

  const applySuggestion = useCallback(
    (key: string) => {
      if (!menu) return;
      haptics.select();

      if (menu.kind === 'slash') {
        // A slash command is an app action, not text: it opens a Workbench
        // section and removes itself from the draft rather than being sent to
        // the model, which would only see a word it does not understand.
        const command = SLASH_COMMANDS.find((c) => c.id === key);
        onDraftChange(draft.slice(menu.end).trimStart());
        setCaret(0);
        if (command?.section) onOpenSection(command.section);
        return;
      }

      // A mention inserts the repo-relative path as plain text. Mobile cannot
      // upload file CONTENT (that needs multipart plus `write:files`), but the
      // agent can read any path it is handed, so the path is the useful part.
      const next = applyMenuSelection(draft, menu, `${key} `);
      onDraftChange(next.text);
      setCaret(next.caret);
    },
    [menu, draft, onDraftChange, onOpenSection],
  );

  const canSend = draft.trim().length > 0 && !disabled;

  return (
    <View className="border-t border-border bg-background">
      {disabledReason ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} className="px-4 pt-2">
          <Text className="text-xs text-warning">{disabledReason}</Text>
        </Animated.View>
      ) : null}

      {attachments.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 10 }}
        >
          {attachments.map((file) => (
            <View
              key={file.id}
              className="h-8 flex-row items-center gap-1.5 rounded-full bg-subtle pl-2.5 pr-1"
            >
              <Paperclip size={12} color={colors['muted-foreground']} />
              <Text numberOfLines={1} className="max-w-40 text-xs text-muted-foreground">
                {file.name}
              </Text>
              <Touchable
                accessibilityLabel={`Remove ${file.name}`}
                haptic="select"
                onPress={() => onRemoveAttachment(file.id)}
                className="h-6 w-6 items-center justify-center rounded-full"
              >
                <X size={12} color={colors['muted-foreground']} />
              </Touchable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {menu && suggestions.length > 0 ? (
        <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(120)}>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingTop: 10 }}
          >
            {suggestions.map((s) => (
              <Touchable
                key={s.key}
                accessibilityLabel={s.hint}
                haptic="none"
                onPress={() => applySuggestion(s.key)}
                className="h-9 justify-center rounded-2xl border border-border bg-raised px-3"
              >
                <Text className="text-sm font-medium text-foreground">{s.label}</Text>
              </Touchable>
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}

      <Animated.View
        layout={LinearTransition.duration(160)}
        className={`m-3 rounded-3xl border bg-card ${focused ? 'border-primary' : 'border-border'}`}
      >
        <View className="flex-row items-end gap-1 px-3 pt-2.5">
          <TextInput
            accessibilityLabel="Message"
            multiline
            editable={!disabled}
            value={draft}
            onChangeText={onDraftChange}
            onSelectionChange={(e) => setCaret(e.nativeEvent.selection.start)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={disabled ? 'Waiting…' : 'Ask anything · / actions · @ files'}
            placeholderTextColor={colors['muted-foreground']}
            // Capped so a long paste cannot push the controls off screen; the
            // field scrolls internally past this height.
            className="max-h-40 min-h-9 flex-1 py-1 text-md leading-relaxed text-foreground"
          />
          {props.voiceAvailable && draft.length === 0 ? (
            <IconButton
              accessibilityLabel="Voice input"
              icon={<Mic size={18} color={colors['muted-foreground']} />}
              onPress={props.onVoice ?? (() => {})}
            />
          ) : null}
        </View>

        <View className="flex-row items-center gap-1.5 px-2 pb-2 pt-1">
          <IconButton
            accessibilityLabel="Add attachment"
            disabled={!props.attachAvailable}
            icon={<Plus size={18} color={colors['muted-foreground']} />}
            onPress={props.onAttach ?? (() => {})}
          />

          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, alignItems: 'center' }}
            className="flex-1"
          >
            <Chip
              accessibilityLabel="Choose model"
              label={model?.name ?? 'Model'}
              icon={<Cpu size={13} color={colors['muted-foreground']} />}
              onPress={() => setSheet('model')}
              showChevron
              // Long names ("Claude Opus 4.8", "GPT-5.6 Sol") otherwise push
              // the mode and options chips entirely out of view.
              maxWidth={140}
            />
            <Chip
              accessibilityLabel="Agent mode"
              label={props.mode === 'plan' ? 'Plan first' : 'Auto'}
              icon={
                <Wand2
                  size={13}
                  color={props.mode === 'plan' ? colors.primary : colors['muted-foreground']}
                />
              }
              active={props.mode === 'plan'}
              onPress={() => props.onModeChange(props.mode === 'plan' ? 'auto' : 'plan')}
            />
            <Chip
              accessibilityLabel="Turn options"
              label="Options"
              icon={<SlidersHorizontal size={13} color={colors['muted-foreground']} />}
              onPress={() => setSheet('options')}
            />
          </ScrollView>

          {limit ? (
            <Touchable
              accessibilityLabel={`Context usage ${Math.round(ratio * 100)} percent`}
              haptic="tap"
              onPress={() => setSheet('options')}
              className="px-1"
            >
              <ProgressRing ratio={ratio} />
            </Touchable>
          ) : null}

          <SendButton streaming={isStreaming} enabled={canSend} onSend={onSend} onStop={onStop} />
        </View>
      </Animated.View>

      <ModelSheet
        visible={sheet === 'model'}
        onClose={() => setSheet('none')}
        models={models}
        loading={props.modelsLoading}
        selectedId={selectedModelId}
        onSelect={props.onSelectModel}
        {...(props.onRefreshModels ? { onRefresh: props.onRefreshModels } : {})}
      />

      <TurnOptionsSheet
        visible={sheet === 'options'}
        onClose={() => setSheet('none')}
        model={model}
        mode={props.mode}
        onModeChange={props.onModeChange}
        effort={props.effort}
        onEffortChange={props.onEffortChange}
        contextTier={props.contextTier}
        onContextTierChange={props.onContextTierChange}
        permissionMode={props.permissionMode}
        onPermissionModeChange={props.onPermissionModeChange}
        contextTokens={props.contextTokens}
        codebaseCount={props.codebaseCount}
      />
    </View>
  );
}

function SendButton({
  streaming,
  enabled,
  onSend,
  onStop,
}: {
  streaming: boolean;
  enabled: boolean;
  onSend: () => void;
  onStop: () => void;
}): React.ReactElement {
  const { colors } = useTheme();
  const active = streaming || enabled;

  return (
    <Touchable
      accessibilityLabel={streaming ? 'Stop' : 'Send'}
      disabled={!active}
      haptic="commit"
      onPress={streaming ? onStop : onSend}
      className={`h-10 w-10 items-center justify-center rounded-full ${
        streaming ? 'bg-danger' : active ? 'bg-primary' : 'bg-emphasis'
      }`}
    >
      <Animated.View key={streaming ? 'stop' : 'send'} entering={FadeIn.duration(120)}>
        {streaming ? (
          <Square
            size={13}
            fill={colors['destructive-foreground']}
            color={colors['destructive-foreground']}
          />
        ) : (
          <ArrowUp
            size={18}
            color={active ? colors['primary-foreground'] : colors['muted-foreground']}
          />
        )}
      </Animated.View>
    </Touchable>
  );
}

// MB-01 Composer (Main, MChatRunning, MChatNoAgent, MComposerPlus, MComposerInput, MComposerVoice): the platform
// surface (iOS glass capsule, Android tonal card; MD-03) holding the attachment strip or the dictation pill, the
// active /command, the field (1–8 lines, never blocked from typing, D-29) and the action row — "+" menu (MD-63),
// the locked agent chip, the model chip that opens the Turn sheet, the mic, Send / Stop (MD-56). Above the card:
// the blocking bar (gate with "Cancel and send", workspace preparation) or the working strip, and the slash /
// mention popover. States come from the shared composer rules (`canSendComposer`, `hasComposerContent`).
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { canSendComposer, hasComposerContent } from '@generatorai/client-core';

import { ComposerField, ComposerPrimaryButton, ComposerSurface } from '../../ui/layout/ComposerSurface';
import { formatElapsed } from '../../ui/lib/format';
import { Menu } from '../../ui/native/Menu';
import type { MenuEntry } from '../../ui/native/Menu/Menu.types';
import { useSheet } from '../../ui/native/Sheet';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Button } from '../../ui/primitives/Button';
import { Chip } from '../../ui/primitives/Chip';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { Popover } from '../../ui/primitives/Popover';
import { Pressable } from '../../ui/primitives/Pressable';
import { Spinner } from '../../ui/primitives/Spinner';
import { Text } from '../../ui/primitives/Text';
import { currentTerminalSelection } from '../../services/terminal/terminalFocus';
import type { ComposerProps } from './Composer.types';
import { composerLabel, composerPlaceholder, composerPrimary, plusMenu, suggestionGroups, suggestionTag, type PlusItem } from './model/composerView';
import type { AttachmentSource, SlashItem } from './model/types';

export type { ComposerControlledProps, ComposerPane, ComposerProps, ComposerTurnProps } from './Composer.types';

/** One-second clock while a strip shows an elapsed time. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function toMenu(items: readonly PlusItem[]): MenuEntry[] {
  return items.map((i) =>
    'type' in i
      ? i
      : { id: i.id, label: i.label, icon: i.icon, ...(i.subtitle ? { subtitle: i.subtitle } : {}), ...(i.disabled ? { disabled: true } : {}), ...(i.children ? { children: toMenu(i.children) } : {}) },
  );
}

function SuggestionRow({ item, onSelect }: { item: SlashItem; onSelect: (item: SlashItem) => void }): React.ReactElement {
  return (
    <Pressable onPress={() => onSelect(item)} frame="none" accessibilityRole="button" accessibilityLabel={[item.label, item.description, suggestionTag(item)].filter(Boolean).join(', ')} className="min-h-row flex-row items-center gap-3 px-4 py-2">
      <View className="flex-1 gap-0.5">
        <Text role="mono" weight={500} numberOfLines={1}>
          {item.label}
        </Text>
        {item.description ? (
          <Text role="footnote" tone="fg-2" numberOfLines={1}>
            {item.description}
          </Text>
        ) : null}
      </View>
      <Text role="caption" tone="fg-3">
        {suggestionTag(item)}
      </Text>
    </Pressable>
  );
}

function DictationPill({ state, startedAt, error, onToggle, onCancel, onAccept }: { state: string; startedAt: number | null; error: string | null; onToggle: () => void; onCancel: () => void; onAccept: () => void }): React.ReactElement {
  const now = useNow(state === 'listening');
  const elapsed = startedAt ? formatElapsed(Math.max(0, now - startedAt)) : '0:00';
  const words = state === 'paused' ? 'Paused' : state === 'transcribing' ? 'Transcribing…' : state === 'error' ? (error ?? 'Dictation failed') : 'Listening…';
  return (
    <View className="flex-row items-center gap-2">
      <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={`${words}, ${elapsed}`} accessibilityHint={state === 'paused' ? 'Resumes dictation' : 'Pauses dictation'} className="min-h-control-sm flex-1 flex-row items-center gap-2 rounded-full bg-selected px-3">
        <Icon concept={state === 'paused' ? 'pause' : 'mic'} size={16} tone={state === 'error' ? 'err' : 'fg'} />
        <Text role="footnote" tone={state === 'error' ? 'err' : 'fg-2'} numberOfLines={1} className="flex-1">
          {words}
        </Text>
        <Text role="monoSm" tone="fg-3">
          {elapsed}
        </Text>
      </Pressable>
      <IconButton icon="x" label="Discard dictation" size="sm" onPress={onCancel} testID="composer-dictation-discard" />
      {/* MD-57: "keep the text" is a check, never the agent Stop square. */}
      <IconButton icon="check" label="Stop dictation and keep text" size="sm" variant="filled" onPress={onAccept} testID="composer-dictation-done" />
    </View>
  );
}

export function Composer(props: ComposerProps): React.ReactElement {
  const sheet = useSheet();
  const { draft, onDraftChange, attachments, disabled = false, isStreaming, gate, workspacePrep, working, variant = 'chat' } = props;
  const gated = Boolean(gate);
  const content = { text: draft, attachmentCount: attachments.length, hasCommand: Boolean(props.activeCommand), captureCount: 0 };
  const hasContent = hasComposerContent(content);
  const canSend = canSendComposer({ ...content, disabled, sending: Boolean(props.sending), pendingInteraction: gated, prepStatus: workspacePrep?.status });
  const primary = composerPrimary(isStreaming, props.stopState);
  const voiceLive = props.voiceState !== undefined && props.voiceState !== 'idle';
  const now = useNow(isStreaming);
  // When the turn went live here (state adjusted during render from the ticking clock; no effect).
  const [live, setLive] = useState<{ on: boolean; since: number | null }>({ on: isStreaming, since: isStreaming ? now : null });
  if (live.on !== isStreaming) setLive({ on: isStreaming, since: isStreaming ? now : null });
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const suggestions = useMemo(() => props.suggestions ?? [], [props.suggestions]);
  const menuOpen = !suggestionsDismissed && (suggestions.length > 0 || Boolean(props.suggestionsLoading));
  const groups = useMemo(() => suggestionGroups(suggestions), [suggestions]);
  const agentName = variant === 'chat' ? (props.agent?.name ?? null) : null;
  const modelName = variant === 'chat' ? (props.modelLabel ?? null) : null;

  const { pendingSelection, onPendingSelectionApplied } = props;
  useEffect(() => {
    if (pendingSelection != null) onPendingSelectionApplied?.();
  }, [pendingSelection, onPendingSelectionApplied]);

  // Recent prompts open in the imperative sheet; picking one fills the draft.
  const openHistory = (): void => {
    const entries = props.historyEntries ?? [];
    sheet.present(
      <ListSection>
        {entries.slice(0, 30).map((entry) => (
          <ListRow
            key={entry.id}
            kind="navigation"
            title={entry.text.replace(/\s+/g, ' ').slice(0, 120)}
            onPress={() => {
              sheet.dismiss();
              props.onPickHistory?.(entry);
            }}
          />
        ))}
      </ListSection>,
      { title: 'Recent prompts', detents: ['medium', 'large'] },
    );
  };

  const plus = plusMenu({
    attachAvailable: props.attachAvailable,
    attachDisabledReason: props.attachDisabledReason,
    attachGrantable: props.attachGrantable,
    browser: Boolean(props.captureActions && props.captureScopes?.browser),
    terminal: Boolean(props.captureActions && props.captureScopes?.terminal),
    terminalSelection: props.captureWorkspaceId ? (currentTerminalSelection(props.captureWorkspaceId)?.length ?? null) : null,
    history: (props.historyEntries?.length ?? 0) > 0,
  });
  const onPlus = (id: string): void => {
    const insert = (token: string): void => onDraftChange(`${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}${token}`);
    const capture = props.captureActions;
    if (id === 'file' || id === 'photo' || id === 'camera' || id === 'clipboard') props.onAttachFrom?.(id as AttachmentSource);
    else if (id === 'slash') insert('/');
    else if (id === 'mention') insert('@');
    else if (id === 'history') openHistory();
    else if (id === 'request-access') props.onRequestScope?.();
    else if (id === 'browser-screenshot') void capture?.captureBrowserScreenshot();
    else if (id === 'browser-text') void capture?.captureBrowserPageText();
    else if (id === 'terminal-selection') capture?.captureTerminalSelection(currentTerminalSelection(props.captureWorkspaceId ?? '') ?? '');
    else if (id.startsWith('terminal-')) void capture?.captureTerminalOutput(Number(id.slice('terminal-'.length)) as 50 | 200);
  };

  const onPrimary = (): void => {
    if (primary === 'send') {
      setSuggestionsDismissed(false);
      props.onSend();
    } else props.onStop();
  };

  const blockingReason = gated ? 'Answer the request above to send' : workspacePrep?.status === 'error' ? 'The workspace could not be prepared' : workspacePrep ? 'The workspace is being prepared' : props.disabledReason;

  return (
    <View className="relative">
      {props.dock}
      {gate && hasContent ? (
        <View accessibilityLiveRegion="polite" className="mx-3 mt-2 flex-row items-center gap-2">
          <Icon concept="hand" size={16} tone="warn" />
          <Text role="footnote" tone="fg-2" className="flex-1">
            {`${gate.label}. Answer it to send`}
          </Text>
          <Button label="Cancel and send" variant="ghost" size="sm" loading={gate.busy} onPress={gate.onCancelAndSend} testID="composer-cancel-and-send" />
        </View>
      ) : workspacePrep ? (
        <View accessibilityLiveRegion="polite" className="mx-3 mt-2 flex-row items-center gap-2">
          {workspacePrep.status === 'error' ? <Icon concept="warning" size={16} tone="err" /> : <Spinner size={14} />}
          <Text role="footnote" tone={workspacePrep.status === 'error' ? 'err' : 'fg-2'} numberOfLines={2} className="flex-1">
            {workspacePrep.status === 'error' ? (workspacePrep.error ?? 'Workspace preparation failed') : 'Preparing the workspace…'}
          </Text>
          {workspacePrep.status === 'error' ? <Button label="Retry" size="sm" loading={workspacePrep.retrying} onPress={workspacePrep.onRetry} /> : null}
        </View>
      ) : isStreaming && working ? (
        <View accessibilityLiveRegion="polite" className="mx-3 mt-2 flex-row items-center gap-2">
          <Spinner size={14} />
          <Text role="footnote" weight={600}>
            Working
          </Text>
          {live.since ? (
            <Text role="monoSm" tone="run">
              {formatElapsed(Math.max(0, now - live.since))}
            </Text>
          ) : null}
          {working.label ? (
            <Text role="footnote" tone="fg-3" numberOfLines={1} className="flex-1">
              {`· ${working.label}`}
            </Text>
          ) : null}
        </View>
      ) : props.disabledReason && !gated ? (
        <Text role="footnote" tone="warn" className="mx-4 mt-2">
          {props.disabledReason}
        </Text>
      ) : null}

      <Popover open={menuOpen} onOpenChange={(open) => setSuggestionsDismissed(!open)} anchor="composer" accessibilityLabel="Commands & skills" resultCount={suggestions.length} testID="composer-suggestions">
        <View className="py-2">
          <View className="flex-row items-center justify-between px-4 pb-1">
            <Text role="footnote" weight={600} tone="fg-2">
              Commands & skills
            </Text>
            {props.suggestionsLoading ? <Spinner size={12} /> : <Text role="monoSm" tone="fg-3">{String(suggestions.length)}</Text>}
          </View>
          <ScrollView keyboardShouldPersistTaps="always">
            {groups.map((group) => (
              <View key={group.title}>
                <Text role="caption" tone="fg-3" className="px-4 pb-0.5 pt-1.5">
                  {group.title}
                </Text>
                {group.items.map((item) => (
                  <SuggestionRow key={item.id} item={item} onSelect={(i) => props.onSelectSuggestion?.(i)} />
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </Popover>

      <ComposerSurface testID="composer">
        {voiceLive ? (
          <DictationPill
            state={props.voiceState ?? 'listening'}
            startedAt={props.voiceStartedAt ?? null}
            error={props.voiceError ?? null}
            onToggle={() => (props.voiceState === 'paused' ? props.onVoiceResume?.() : props.onVoicePause?.())}
            onCancel={() => props.onVoiceCancel?.()}
            onAccept={() => props.onVoiceAccept?.()}
          />
        ) : attachments.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerClassName="gap-2">
            {attachments.map((a) => (
              <Chip
                key={a.id}
                variant="attachment"
                label={a.name}
                icon={a.kind === 'image' ? 'image' : 'attach'}
                {...(a.previewUri ? { thumbnail: { uri: a.previewUri } } : {})}
                {...(a.error ? { error: a.error } : {})}
                onRemove={() => props.onRemoveAttachment(a.id)}
                testID="composer-attachment"
              />
            ))}
          </ScrollView>
        ) : null}
        {props.activeCommand ? (
          <View className="flex-row">
            <Chip variant="input" label={props.activeCommand.label} onRemove={props.activeCommand.onRemove} />
          </View>
        ) : null}
        <ComposerField
          value={draft}
          onChangeText={(text) => {
            setSuggestionsDismissed(false);
            props.onComposerInteraction?.();
            onDraftChange(text);
          }}
          placeholder={composerPlaceholder({ disabled, gated, argHint: props.activeCommand?.argHint, placeholder: props.placeholder, agent: agentName, orchestrator: props.orchestrator === true, files: props.files === true })}
          accessibilityLabel={composerLabel(agentName)}
          editable={!disabled || gated}
          selection={pendingSelection ?? null}
          onCaretChange={props.onCaretChange}
          onKeyPress={(key) => {
            if (key === 'ArrowUp') props.onHistoryStep?.(-1);
            else if (key === 'ArrowDown') props.onHistoryStep?.(1);
          }}
        />
        <View className="flex-row items-center gap-2">
          <Menu items={toMenu(plus)} onSelect={onPlus} accessibilityLabel="Add" testID="composer-options" trigger={<IconButton icon="plus" label="Add" size="sm" variant="bordered" onPress={() => undefined} />} />
          {variant === 'chat' && props.agent ? <Chip variant="composer" icon="agents" label={props.agent.name} locked testID="composer-agent" /> : null}
          {variant === 'chat' && modelName ? <Chip variant="dropdown" label={modelName} onPress={() => props.onModelPress?.()} testID="composer-model" /> : null}
          {variant === 'stage' && props.mode && props.onModeChange ? (
            <Chip variant="dropdown" icon={props.mode === 'plan' ? 'plan' : 'zap'} label={props.mode === 'plan' ? 'Plan' : 'Auto'} onPress={() => props.onModeChange?.(props.mode === 'plan' ? 'auto' : 'plan')} testID="composer-mode" />
          ) : null}
          <View className="flex-1" />
          {props.voiceAvailable && !voiceLive && !isStreaming ? (
            <IconButton icon="mic" label="Dictate a message" size="sm" onPress={() => props.onVoiceStart?.()} testID="composer-mic" />
          ) : null}
          <ComposerPrimaryButton
            kind={primary}
            disabled={primary === 'send' && !canSend}
            {...(primary === 'send' && !canSend ? { disabledReason: blockingReason ?? (hasContent ? 'Sending…' : 'Type a message') } : {})}
            {...(agentName ? { stopLabel: `Stop ${agentName}` } : {})}
            onPress={onPrimary}
            {...(primary === 'send' && props.onSendWithPlan ? { onLongPress: props.onSendWithPlan } : {})}
          />
        </View>
      </ComposerSurface>
    </View>
  );
}

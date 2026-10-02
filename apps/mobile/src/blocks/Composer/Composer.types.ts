// MB-01 Composer contract. `ComposerControlledProps` is what `useComposerController` supplies (draft, caret,
// suggestions, voice, attachments, captures, history); `ComposerTurnProps` is the screen's (stop, blocking state,
// agent and model chips, the dock above the card).
import type { ReactNode } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import type { AgentMode } from '@generatorai/client-core';

import type { ComposerCaptureActions } from './model/captureContext';
import type { AttachmentSource, ComposerAttachment, PromptHistoryEntry, SlashItem, StopState, VoiceUiState, WorkspacePrepState } from './model/types';

/** A pane the composer can ask the screen to reveal (`/browser`, `/terminal`, …). */
export type ComposerPane = 'browser' | 'terminal' | 'changes' | 'files' | 'plan' | 'tasks';

export type ChipAttachment = Pick<ComposerAttachment, 'id' | 'name'> & Partial<ComposerAttachment>;

export interface ComposerControlledProps {
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  /** Long-press on Send: send in Plan mode. */
  onSendWithPlan?: (() => void) | undefined;
  sending?: boolean | undefined;
  disabled?: boolean | undefined;
  caret?: number | undefined;
  onCaretChange?: ((caret: number) => void) | undefined;
  pendingSelection?: number | null | undefined;
  onPendingSelectionApplied?: (() => void) | undefined;
  /** Any manual edit while dictating pauses it. */
  onComposerInteraction?: (() => void) | undefined;
  suggestions?: readonly SlashItem[] | undefined;
  onSelectSuggestion?: ((item: SlashItem) => void) | undefined;
  suggestionsLoading?: boolean | undefined;
  activeCommand?: { label: string; argHint?: string | undefined; onRemove: () => void } | null | undefined;
  onOpenPane?: ((pane: ComposerPane) => void) | undefined;
  onHistoryStep?: ((dir: -1 | 1) => boolean) | undefined;
  voiceAvailable: boolean;
  voiceState?: VoiceUiState | undefined;
  voiceInterim?: string | undefined;
  voiceAmplitude?: SharedValue<number> | undefined;
  voiceWaveform?: SharedValue<number[]> | undefined;
  voiceStartedAt?: number | null | undefined;
  voiceError?: string | null | undefined;
  pushToTalk?: boolean | undefined;
  onVoiceStart?: (() => void) | undefined;
  onVoicePause?: (() => void) | undefined;
  onVoiceResume?: (() => void) | undefined;
  onVoiceCancel?: (() => void) | undefined;
  onVoiceAccept?: (() => void) | undefined;
  attachments: readonly ChipAttachment[];
  onRemoveAttachment: (id: string) => void;
  attachAvailable: boolean;
  attachDisabledReason?: string | undefined;
  attachGrantable?: boolean | undefined;
  onAttachFrom?: ((source: AttachmentSource) => void) | undefined;
  attachPending?: boolean | undefined;
  captureScopes?: { browser: boolean; terminal: boolean } | undefined;
  captureActions?: ComposerCaptureActions | undefined;
  captureWorkspaceId?: string | null | undefined;
  historyEntries?: readonly PromptHistoryEntry[] | undefined;
  historyVisible?: boolean | undefined;
  onOpenHistory?: (() => void) | undefined;
  onCloseHistory?: (() => void) | undefined;
  onPickHistory?: ((entry: PromptHistoryEntry) => void) | undefined;
}

export interface ComposerTurnProps {
  /** `stage`: a workflow stage's compact chat (no agent / model chips; a mode chip, WF-17). Default `chat`. */
  variant?: 'chat' | 'stage';
  placeholder?: string;
  onStop: () => void;
  isStreaming: boolean;
  stopState?: StopState | undefined;
  /** Why sending is off (archived, no permission, a closed stage), when no gate explains it. */
  disabledReason?: string | undefined;
  /** The bound agent: a locked chip (MD-03); hidden for model-only chats. */
  agent?: { name: string; role?: 'agent' | 'orchestrator' } | null;
  /** The next turn's model label; the chip opens the Turn sheet (`composer-model`). */
  modelLabel?: string | null;
  onModelPress?: () => void;
  /** Stage variant: the next message's mode (Auto / Plan). */
  mode?: AgentMode;
  onModeChange?: (mode: AgentMode) => void;
  /** The live turn's working strip ("Working 4:12 · reading Canvas.tsx"); the elapsed time counts from when the turn
   * went live on this screen. */
  working?: { label: string | null } | null;
  /** A pending gate holds sends; "Cancel and send" answers it and sends the draft (MD-03). */
  gate?: { label: string; busy: boolean; onCancelAndSend: () => void } | null;
  workspacePrep?: (WorkspacePrepState & { onRetry: () => void; retrying: boolean }) | null;
  /** Above the card: the changes tray, a seeded gate card. */
  dock?: ReactNode;
  onRequestScope?: () => void;
}

export type ComposerProps = ComposerControlledProps & ComposerTurnProps;

// ────────────────────────────────────────────────────────────────
// Composer — the chat input (v2, §6.4).
//
//   row 1   attachment chips            — image thumb / file / capture, remove
//   row 2   slash / mention strip       — while a `/` or `@` trigger is open
//   row 3   the field + mic             — OR the voice pill while dictating
//   row 4   [+] [model ▾] [mode] [options] … [gauge] [send/stop]
//
// Above the card, when the screen supplies them: the bound-agent chip, the
// workspace prep bar, and the gate banner ("Cancel and send").
//
// Two ways to drive it:
//   • `useComposerController()` returns `props` — spread them, add the turn
//     props (model, mode, effort, stop) the screen owns.
//   • The v1 prop set still works unchanged: a screen that passes
//     `mentionPaths` / `onOpenSection` / `onVoice` gets the v1 behaviour for
//     those parts, so nothing breaks while the screen adopts the hook.
//
// The send control is a single morphing target rather than two swapped
// buttons: swapping moves the tap area under the user's thumb at exactly the
// moment they are reaching for it, which is how you get accidental cancels.
// Long-press on Send = send with plan mode.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { KeyboardController } from 'react-native-keyboard-controller';
import type { SharedValue } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import {
  ArrowUp,
  Brain,
  Camera,
  ClipboardList,
  ClipboardPaste,
  Cpu,
  Maximize2,
  FileText,
  FolderOpen,
  Globe,
  History,
  Image as ImageIcon,
  Mic,
  Plus,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Square,
  TerminalSquare,
  TextSelect,
  Wand2,
} from 'lucide-react-native';
import type { AgentMode, ContextUsageSnapshot, ModelInfo } from '@generatorai/client-core';

import { Chip } from '../ui/Chip';
import { IconButton } from '../ui/Button';
import { ProgressRing } from '../ui/ProgressRing';
import { Spinner } from '../ui/States';
import { Touchable } from '../ui/Touchable';
import { ActionSheet, type MenuAction } from '../ui/ActionSheet';
import { haptics } from '../ui/haptics';
import { MAX_SCALE, useFontScale } from '../ui/accessibility';
import { ModelSheet } from './ModelSheet';
import { TurnOptionsSheet } from './TurnOptionsSheet';
import {
  SLASH_COMMANDS,
  applyMenuSelection,
  detectMenu,
  filterCommands,
  filterPaths,
} from './composerMenu';
import { AttachmentChips, type ChipAttachment } from './composer/AttachmentChips';
import { SuggestionStrip } from './composer/SuggestionStrip';
import { VoicePill } from './composer/VoicePill';
import { HistorySheet } from './composer/HistorySheet';
import { GaugeSheet } from './composer/GaugeSheet';
import {
  BoundAgentChip,
  GateBanner,
  WorkspacePrepBar,
  type BoundAgentProps,
  type GateBannerProps,
  type WorkspacePrepProps,
} from './composer/ComposerBanners';
import {
  MODE_OPTIONS,
  effectiveEffort,
  effortOptionsFor,
  effortTitle,
  turnChipLabel,
  turnChipParts,
} from './composer/turnOptions';
import { ProviderBrandIcon } from '../brand/VendorIcons';
import { TERMINAL_CAPTURE_LINES } from './composer/captures';
import type { ComposerCaptureActions } from './composer/captureContext';
import { currentTerminalSelection } from '../../terminal/terminalFocus';
import { useChatMotion } from './chatMotion';
import type {
  AttachmentSource,
  PromptHistoryEntry,
  SlashItem,
  StopState,
  VoiceUiState,
} from './composer/types';
import { SCOPE_REQUEST_ROUTE } from '../../navigation/routes';
import { findModel, promptLimit } from '../../api/useModels';
import { useTheme } from '../../theme/ThemeProvider';

export type { StopState } from './composer/types';

/** A pane the composer can ask the screen to reveal. */
export type ComposerPane = 'browser' | 'terminal' | 'changes' | 'files' | 'plan' | 'tasks';

/**
 * Props the controller hook supplies. The screen spreads
 * `useComposerController().props` and adds `ComposerTurnProps` beside them.
 */
export interface ComposerControlledProps {
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: () => void;
  /** Long-press on Send. */
  onSendWithPlan?: (() => void) | undefined;
  /** A send is in flight (attachments reading / request pending). */
  sending?: boolean | undefined;
  disabled?: boolean | undefined;

  /**
   * Caret position, lifted so dictated segments insert at it. Uncontrolled
   * if omitted.
   */
  caret?: number | undefined;
  onCaretChange?: ((caret: number) => void) | undefined;
  /**
   * One-shot selection to apply after a programmatic insertion, then clear.
   * Held only for a single render: leaving `selection` permanently
   * controlled fights the user's own typing on Android.
   */
  pendingSelection?: number | null | undefined;
  onPendingSelectionApplied?: (() => void) | undefined;
  /**
   * Fired on any manual interaction with the field while dictation is live
   * — the act of editing IS the pause signal (Part C.3).
   */
  onComposerInteraction?: (() => void) | undefined;

  /** Ranked `/` or `@` matches from the controller. Absent → v1 menu. */
  suggestions?: readonly SlashItem[] | undefined;
  onSelectSuggestion?: ((item: SlashItem) => void) | undefined;
  suggestionsLoading?: boolean | undefined;
  /** The `/command` chip pinned inside the card once picked. */
  activeCommand?: { label: string; argHint?: string | undefined; onRemove: () => void } | null | undefined;
  /** `/browser`, `/terminal` and the pane openers resolve through this. */
  onOpenPane?: ((pane: ComposerPane) => void) | undefined;
  /** Hardware ↑ / ↓ history. Return true when handled. */
  onHistoryStep?: ((dir: -1 | 1) => boolean) | undefined;

  voiceAvailable: boolean;
  /** v2 voice. When present the mic drives the pill; `onVoice` is ignored. */
  voiceState?: VoiceUiState | undefined;
  voiceInterim?: string | undefined;
  voiceAmplitude?: SharedValue<number> | undefined;
  voiceWaveform?: SharedValue<number[]> | undefined;
  voiceStartedAt?: number | null | undefined;
  voiceError?: string | null | undefined;
  /** Hold the mic to dictate, release to accept. */
  pushToTalk?: boolean | undefined;
  onVoiceStart?: (() => void) | undefined;
  onVoicePause?: (() => void) | undefined;
  onVoiceResume?: (() => void) | undefined;
  onVoiceCancel?: (() => void) | undefined;
  onVoiceAccept?: (() => void) | undefined;

  attachments: readonly ChipAttachment[];
  onRemoveAttachment: (id: string) => void;
  attachAvailable: boolean;
  /** Shown when the attach button is unavailable, instead of a dead control. */
  attachDisabledReason?: string | undefined;
  /** Whether "Request access" is worth offering. */
  attachGrantable?: boolean | undefined;
  /** v2: the `+` menu's pickers. */
  onAttachFrom?: ((source: AttachmentSource) => void) | undefined;
  attachPending?: boolean | undefined;
  /** Which capture sources this device may use (browser / terminal panes). */
  captureScopes?: { browser: boolean; terminal: boolean } | undefined;
  /** Fetch-and-attach for the capture items (terminal output, browser). */
  captureActions?: ComposerCaptureActions | undefined;
  /** For the terminal-selection item: which workspace's selection counts. */
  captureWorkspaceId?: string | null | undefined;

  historyEntries?: readonly PromptHistoryEntry[] | undefined;
  historyVisible?: boolean | undefined;
  onOpenHistory?: (() => void) | undefined;
  onCloseHistory?: (() => void) | undefined;
  onPickHistory?: ((entry: PromptHistoryEntry) => void) | undefined;
}

/** Props the screen owns: the chat's turn settings, stop, and banners. */
export interface ComposerTurnProps {
  onStop: () => void;
  isStreaming: boolean;
  /**
   * W30-b — what the Stop control should say and whether it accepts a press.
   * Owned by the screen, which is the only thing that can see whether the
   * BACKEND still considers the turn live. Absent means "behave as before".
   */
  stopState?: StopState | undefined;
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
  /** The full snapshot, for the gauge breakdown sheet. */
  contextUsage?: ContextUsageSnapshot | null | undefined;
  codebaseCount: number;

  /** Which agent drives this chat, when one is bound. */
  boundAgent?: BoundAgentProps | null | undefined;
  /** Mount readiness from the chat DTO. Hidden when ready. */
  workspacePrep?: WorkspacePrepProps | null | undefined;
  /** A pending interaction blocks sends; offers "Cancel and send". */
  gate?: Omit<GateBannerProps, 'hasDraft'> | null | undefined;
  /** Where "Request access" goes. Defaults to the scope-request route. */
  onRequestScope?: (() => void) | undefined;
  /**
   * The dock's top: the changes strip and a pinned decision card. Rendered
   * under the composer's single divider, so everything that belongs to "what
   * happens next" reads as one surface rather than cards floating over the
   * transcript.
   */
  dock?: React.ReactNode;
  /**
   * A workflow stage's composer (P03b, a stage is a compact chat): the
   * stage's session fixes the model, effort and permissions, so the strip
   * holds only the agent mode of the next message.
   */
  compact?: boolean | undefined;
  /** The field's placeholder; defaults to the chat's. */
  placeholder?: string | undefined;

  // ── v1 compatibility ──────────────────────────────────────────
  /** v1: paths for @-mentions when no `suggestions` are supplied. */
  mentionPaths?: readonly string[] | undefined;
  /** v1: opens a Workbench section for a slash command. */
  onOpenSection?: ((section: string) => void) | undefined;
  /** v1: single mic toggle. Ignored when `voiceState` is supplied. */
  onVoice?: (() => void) | undefined;
  voiceActive?: boolean | undefined;
  voiceBusy?: boolean | undefined;
  /** v1: single attach handler. Ignored when `onAttachFrom` is supplied. */
  onAttach?: (() => void) | undefined;
}

export type ComposerProps = ComposerControlledProps & ComposerTurnProps;

/** Line height of the field (text-md, leading-relaxed) at font scale 1. */
const LINE_HEIGHT = 24;
const MAX_LINES = 6;

export function Composer(props: ComposerProps): React.ReactElement {
  const { colors } = useTheme();
  const router = useRouter();
  const fontScale = useFontScale();
  const [sheet, setSheet] = useState<
    'none' | 'model' | 'options' | 'gauge' | 'mode' | 'attach' | 'captureTerminal' | 'captureBrowser'
  >('none');
  const [internalCaret, setInternalCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput | null>(null);
  const motion = useChatMotion();

  const caret = props.caret ?? internalCaret;
  const { onCaretChange } = props;
  const setCaret = useCallback(
    (next: number) => {
      setInternalCaret(next);
      onCaretChange?.(next);
    },
    [onCaretChange],
  );

  const {
    draft,
    onDraftChange,
    onSend,
    onStop,
    isStreaming,
    stopState,
    disabled = false,
    disabledReason,
    models,
    selectedModelId,
    attachments,
    onRemoveAttachment,
  } = props;

  const model = findModel(models, selectedModelId);
  const limit = promptLimit(model);
  const currentTokens = props.contextUsage?.currentTokens ?? props.contextTokens;
  const ratio = limit && currentTokens ? currentTokens / limit : 0;

  // ── Suggestions: controller-supplied, else the v1 menu ─────────
  const v1Menu = useMemo(
    () => (props.suggestions === undefined ? detectMenu(draft, caret) : null),
    [props.suggestions, draft, caret],
  );
  const v1Items = useMemo<SlashItem[]>(() => {
    if (!v1Menu) return [];
    if (v1Menu.kind === 'slash') {
      return filterCommands(v1Menu.query).map((c) => ({
        id: c.id,
        name: c.id,
        label: c.label,
        description: c.description,
        kind: 'navigate' as const,
        source: 'builtin' as const,
        pane: c.section as ComposerPane | undefined,
      }));
    }
    return filterPaths(props.mentionPaths ?? [], v1Menu.query).map((p) => ({
      id: p,
      name: p.slice(p.lastIndexOf('/') + 1),
      label: p.slice(p.lastIndexOf('/') + 1),
      description: p,
      kind: 'file' as const,
      source: 'workspace' as const,
      path: p,
    }));
  }, [v1Menu, props.mentionPaths]);

  const selectV1 = useCallback(
    (item: SlashItem) => {
      if (!v1Menu) return;
      haptics.select();
      if (v1Menu.kind === 'slash') {
        const command = SLASH_COMMANDS.find((c) => c.id === item.id);
        onDraftChange(draft.slice(v1Menu.end).trimStart());
        setCaret(0);
        if (command?.section) {
          if (props.onOpenPane) props.onOpenPane(command.section as ComposerPane);
          else props.onOpenSection?.(command.section);
        }
        return;
      }
      const next = applyMenuSelection(draft, v1Menu, `${item.path ?? item.label} `);
      onDraftChange(next.text);
      setCaret(next.caret);
    },
    [v1Menu, draft, onDraftChange, setCaret, props],
  );

  const suggestions = props.suggestions ?? v1Items;
  const onSelectSuggestion = props.onSelectSuggestion ?? selectV1;
  const menuOpen = props.suggestions !== undefined ? suggestions.length > 0 || Boolean(props.suggestionsLoading) : v1Menu !== null;

  // Release the one-shot selection on the render after it was applied, so
  // the field goes back to being uncontrolled for selection.
  const { pendingSelection, onPendingSelectionApplied } = props;
  useEffect(() => {
    if (pendingSelection != null) onPendingSelectionApplied?.();
  }, [pendingSelection, onPendingSelectionApplied]);

  // ── Voice ──────────────────────────────────────────────────────
  const voiceV2 = props.voiceState !== undefined;
  const voiceLive =
    voiceV2 && props.voiceState !== 'idle' && props.voiceWaveform !== undefined;

  // ── Gate: the field stays editable so "Cancel and send" has something to send.
  const hasGate = Boolean(props.gate);
  const fieldEditable = !disabled || hasGate;
  // A focused field that turns read-only (a gate opened mid-typing, the chat
  // was archived elsewhere) strands the platform keyboard: Android keeps the
  // IME window "shown" with nothing in it, so the composer stayed lifted over
  // an empty band the height of the keyboard, and sheets opened against that
  // phantom inset. Dismissing through the controller clears focus and hides
  // the IME from whichever view holds it, editable or not.
  useEffect(() => {
    if (fieldEditable) return;
    inputRef.current?.blur();
    void KeyboardController.dismiss();
  }, [fieldEditable]);

  const hasContent = draft.trim().length > 0 || attachments.length > 0 || Boolean(props.activeCommand);
  const canSend = hasContent && !disabled && !props.sending;
  const showMic =
    props.voiceAvailable && !voiceLive && !isStreaming && !props.activeCommand && !hasContent && !props.sending;
  const turnInput = {
    model,
    mode: props.mode,
    effort: props.effort,
    permissionMode: props.permissionMode,
    contextTier: props.contextTier,
  };
  const turnLabel = turnChipLabel(turnInput);
  const turnParts = turnChipParts(turnInput);
  const effortChoices = effortOptionsFor(model);
  const currentEffort = effectiveEffort(props.effort, model);
  const effortLabel = currentEffort ? effortTitle(currentEffort) : 'Effort';
  // The setup strip measures itself: with the context ring and Stop on screen
  // (or the Plan chip on), the full chips no longer fit a phone-width card and
  // the effort chip was cut mid-word. When they do not fit, Plan and effort
  // drop to their icons — full names stay in their accessibility labels —
  // and come back as soon as there is room. The full width is re-measured
  // whenever a label changes.
  const stripKey = `${turnParts.plan}|${turnParts.model}|${effortLabel}|${turnParts.longContext}|${turnParts.permission ?? ''}`;
  const [stripWidth, setStripWidth] = useState(0);
  const [stripFull, setStripFull] = useState<{ key: string; width: number } | null>(null);
  const fullWidth = stripFull?.key === stripKey ? stripFull.width : 0;
  const compactStrip = stripWidth > 0 && fullWidth > stripWidth + 1;

  // ── Swipe up on the field → history ───────────────────────────
  const touchStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const onFieldTouchStart = useCallback((e: GestureResponderEvent) => {
    touchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now() };
  }, []);
  const onFieldTouchEnd = useCallback(
    (e: GestureResponderEvent) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start || !props.onOpenHistory) return;
      const dx = Math.abs(e.nativeEvent.pageX - start.x);
      const dy = start.y - e.nativeEvent.pageY;
      if (dy >= 48 && dx < 32 && Date.now() - start.t < 600) {
        haptics.tap();
        props.onOpenHistory();
      }
    },
    [props],
  );

  const onKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = e.nativeEvent.key;
      if (key === 'ArrowUp') props.onHistoryStep?.(-1);
      else if (key === 'ArrowDown') props.onHistoryStep?.(1);
    },
    [props],
  );

  // ── Attach menu ────────────────────────────────────────────────
  const requestScope = useCallback(() => {
    if (props.onRequestScope) props.onRequestScope();
    else router.push(SCOPE_REQUEST_ROUTE);
  }, [props, router]);

  const canCaptureTerminal = Boolean(props.captureActions && props.captureScopes?.terminal);
  const canCaptureBrowser = Boolean(props.captureActions && props.captureScopes?.browser);
  const canCapture = canCaptureTerminal || canCaptureBrowser;

  const onAttachPress = useCallback(() => {
    // With a capture source on offer the menu still opens: terminal and page
    // TEXT can go into the draft even when uploads are withheld.
    if (!props.attachAvailable && !canCapture) {
      const reason =
        props.attachDisabledReason ?? 'This device was not granted permission to upload files.';
      Alert.alert(
        'Attachments are off for this device',
        reason,
        props.attachGrantable === false
          ? [{ text: 'OK' }]
          : [
              { text: 'Not now', style: 'cancel' },
              { text: 'Request access', onPress: requestScope },
            ],
      );
      return;
    }
    if (!props.onAttachFrom && props.onAttach) {
      props.onAttach();
      return;
    }
    setSheet('attach');
  }, [props, requestScope, canCapture]);

  const attachActions = useMemo<MenuAction[]>(() => {
    const pick = (source: AttachmentSource) => () => {
      setSheet('none');
      props.onAttachFrom?.(source);
    };
    const uploadOff = !props.attachAvailable;
    const offDetail = uploadOff ? (props.attachDisabledReason ?? 'Attachments are not permitted on this device.') : undefined;
    const pickerIcon = uploadOff ? colors['muted-foreground'] : colors.foreground;
    const items: MenuAction[] = [
      { label: 'Photo library', icon: <ImageIcon size={18} color={pickerIcon} />, onPress: pick('photo'), disabled: uploadOff, detail: offDetail },
      { label: 'Camera', icon: <Camera size={18} color={pickerIcon} />, onPress: pick('camera'), disabled: uploadOff, detail: offDetail },
      { label: 'Files', icon: <FolderOpen size={18} color={pickerIcon} />, onPress: pick('file'), disabled: uploadOff, detail: offDetail },
      { label: 'Paste image', icon: <ClipboardPaste size={18} color={pickerIcon} />, onPress: pick('clipboard'), disabled: uploadOff, detail: offDetail },
    ];
    // ActionSheet closes itself before running an action, so these simply
    // name the next sheet — the same hand-off TurnOptions → Model uses.
    if (canCaptureTerminal) {
      items.push({
        label: 'Terminal output',
        icon: <TerminalSquare size={18} color={colors.foreground} />,
        detail: uploadOff ? 'Added to your message as text' : undefined,
        onPress: () => setSheet('captureTerminal'),
      });
    }
    if (canCaptureBrowser) {
      items.push({
        label: 'Browser',
        icon: <Globe size={18} color={colors.foreground} />,
        detail: 'Screenshot or page text',
        onPress: () => setSheet('captureBrowser'),
      });
    }
    if (uploadOff && props.attachGrantable !== false) {
      items.push({
        label: 'Request file access',
        icon: <ShieldCheck size={18} color={colors.foreground} />,
        onPress: requestScope,
      });
    }
    if (props.onOpenHistory) {
      items.push({
        label: 'Recent prompts',
        icon: <History size={18} color={colors.foreground} />,
        onPress: () => {
          setSheet('none');
          props.onOpenHistory?.();
        },
      });
    }
    return items;
  }, [props, colors, canCaptureTerminal, canCaptureBrowser, requestScope]);

  const captureTerminalActions = useMemo<MenuAction[]>(() => {
    if (sheet !== 'captureTerminal' || !props.captureActions) return [];
    const actions = props.captureActions;
    const selection = props.captureWorkspaceId ? currentTerminalSelection(props.captureWorkspaceId) : null;
    const items: MenuAction[] = TERMINAL_CAPTURE_LINES.map((n) => ({
      label: `Last ${n} lines`,
      icon: <TerminalSquare size={18} color={colors.foreground} />,
      onPress: () => void actions.captureTerminalOutput(n),
    }));
    items.push({
      label: 'Current selection',
      icon: <TextSelect size={18} color={selection ? colors.foreground : colors['muted-foreground']} />,
      disabled: !selection,
      detail: selection
        ? `${selection.length.toLocaleString()} characters`
        : 'Long-press text in the Terminal pane to select it first.',
      onPress: () => actions.captureTerminalSelection(selection ?? ''),
    });
    return items;
  }, [sheet, props.captureActions, props.captureWorkspaceId, colors]);

  const captureBrowserActions = useMemo<MenuAction[]>(() => {
    if (sheet !== 'captureBrowser' || !props.captureActions) return [];
    const actions = props.captureActions;
    const uploadOff = !props.attachAvailable;
    return [
      {
        label: 'Screenshot',
        icon: <Camera size={18} color={uploadOff ? colors['muted-foreground'] : colors.foreground} />,
        disabled: uploadOff,
        detail: uploadOff
          ? (props.attachDisabledReason ?? 'Screenshots need permission to attach files.')
          : 'The whole visible page, as an image',
        onPress: () => void actions.captureBrowserScreenshot(),
      },
      {
        label: 'Page text',
        icon: <FileText size={18} color={colors.foreground} />,
        detail: uploadOff ? 'Added to your message as text' : 'The page’s structure and text, for the agent to read',
        onPress: () => void actions.captureBrowserPageText(),
      },
    ];
  }, [sheet, props.captureActions, props.attachAvailable, props.attachDisabledReason, colors]);

  const maxFieldHeight = Math.round(LINE_HEIGHT * MAX_LINES * Math.min(fontScale, MAX_SCALE.chrome) + 8);

  const placeholder = disabled && !hasGate
    ? 'Waiting…'
    : props.activeCommand?.argHint ?? props.placeholder ?? 'Ask anything · / actions · @ files';

  return (
    // No top hairline: the changes box and the composer card are each
    // bordered, so a divider above them drew a second, redundant line.
    <View className="bg-background">
      {props.dock}

      {/* With a gate open, the card above and the gate banner already say
          what is blocking; a third line saying it again is noise. */}
      {disabledReason && !hasGate ? (
        <Animated.View entering={motion.fadeIn()} exiting={motion.fadeOut()} className="px-4 pt-2">
          <Text className="text-sm text-warning">{disabledReason}</Text>
        </Animated.View>
      ) : null}

      {props.boundAgent ? <BoundAgentChip agent={props.boundAgent} /> : null}
      {props.workspacePrep ? <WorkspacePrepBar prep={props.workspacePrep} /> : null}
      {props.gate ? <GateBanner gate={{ ...props.gate, hasDraft: hasContent }} /> : null}

      <AttachmentChips items={attachments} onRemove={onRemoveAttachment} />

      {menuOpen ? (
        <SuggestionStrip
          items={suggestions}
          loading={Boolean(props.suggestionsLoading)}
          onSelect={onSelectSuggestion}
        />
      ) : null}

      {/* No layout transition on the card: when a chip or banner entered
          above it, Reanimated's LinearTransition left the card stranded at
          its pre-layout offset on Android — pushed half off the screen under
          the gesture bar (seen with the bound-agent chip). It also re-ran on
          every new line while typing. */}
      {/* Desktop's composer card: the theme's card colour, a 20pt radius and
          a border that turns primary on focus. Solid rather than Liquid
          Glass, so it takes the theme's colours instead of the system's. */}
      <View
        className="bg-card"
        style={{ marginHorizontal: 12, marginBottom: 8, marginTop: 8, borderRadius: 20,
          borderWidth: 1, borderColor: focused || voiceLive ? colors.primary : colors.border }}
      >
        {props.activeCommand ? (
          <View className="flex-row px-3 pt-2.5">
            <Chip
              accessibilityLabel={`Command ${props.activeCommand.label}`}
              label={props.activeCommand.label}
              icon={<Wand2 size={13} color={colors.primary} />}
              tone="accent"
              size="sm"
              onRemove={props.activeCommand.onRemove}
              removeLabel={`Remove ${props.activeCommand.label} command`}
            />
          </View>
        ) : null}

        {props.voiceInterim ? (
          <View className="px-3 pt-2.5">
            <Text
              accessibilityLabel={`Hearing: ${props.voiceInterim}`}
              className="text-md italic leading-relaxed text-muted-foreground"
            >
              {props.voiceInterim}
            </Text>
          </View>
        ) : null}

        {voiceLive ? (
          <VoicePill
            state={props.voiceState!}
            waveform={props.voiceWaveform!}
            startedAt={props.voiceStartedAt ?? null}
            error={props.voiceError}
            onPause={props.onVoicePause ?? (() => {})}
            onResume={props.onVoiceResume ?? (() => {})}
            onCancel={props.onVoiceCancel ?? (() => {})}
            onAccept={props.onVoiceAccept ?? (() => {})}
          />
        ) : (
          <View
            className="flex-row items-end gap-1 px-3 pt-2.5"
            onTouchStart={onFieldTouchStart}
            onTouchEnd={onFieldTouchEnd}
          >
            <TextInput
              ref={inputRef}
              accessibilityLabel="Message"
              accessibilityHint={props.onOpenHistory ? 'Swipe up for recent prompts' : undefined}
              multiline
              editable={fieldEditable}
              value={draft}
              onChangeText={(text) => {
                props.onComposerInteraction?.();
                onDraftChange(text);
              }}
              onSelectionChange={(e) => {
                const next = e.nativeEvent.selection.start;
                // A programmatic insertion moves the caret too and would
                // otherwise look like the user reaching in and editing.
                if (props.pendingSelection == null) props.onComposerInteraction?.();
                setCaret(next);
              }}
              onKeyPress={onKeyPress}
              {...(props.pendingSelection != null
                ? { selection: { start: props.pendingSelection, end: props.pendingSelection } }
                : {})}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={placeholder}
              placeholderTextColor={colors['muted-foreground']}
              // Six lines, then the field scrolls internally: a long paste
              // must not push the controls off screen.
              style={{ maxHeight: maxFieldHeight }}
              // No line height here: on iOS a multiline TextInput with an explicit
              // lineHeight lays its text out against the wrong box — a second
              // line pushed the first half out of the top of the field.
              className="min-h-9 flex-1 py-1 text-md text-foreground"
            />
          </View>
        )}

        <View className="flex-row items-center gap-1.5 px-2 pb-2 pt-1">
          <IconButton
            accessibilityLabel="Add attachment"
            // A disabled control that says nothing when tapped is the same as
            // a broken one. When the scope is withheld the button explains
            // itself rather than ignoring the tap.
            accessibilityHint={props.attachDisabledReason}
            icon={
              props.attachPending ? (
                <Spinner />
              ) : (
                <Plus size={18} color={props.attachAvailable ? colors['muted-foreground'] : colors['muted-foreground']} />
              )
            }
            disabled={Boolean(props.attachPending)}
            onPress={onAttachPress}
          />

          {/* The turn's setup — the desktop composer's row. Model and effort
              are the two changed most, so each is one tap: the model chip opens
              the model picker, the effort chip opens the turn-options sheet
              (effort, mode, permissions, context window). A separate "options"
              button used to sit here too; on a 402pt iPhone that cost the
              strip the room it needed and the effort chip was cut to "Mediu".
              Glyphs on the effort chip say when permissions or the context
              window differ from the defaults, so nothing set is hidden. */}
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6, alignItems: 'center', paddingRight: 4 }}
            style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }}
            onLayout={(e) => setStripWidth(e.nativeEvent.layout.width)}
            onContentSizeChange={(w) => {
              // Only full-size layouts are measured; the compact one is smaller by design.
              if (!compactStrip && (stripFull?.key !== stripKey || Math.abs(stripFull.width - w) > 1)) {
                setStripFull({ key: stripKey, width: w });
              }
            }}
          >
            {/* Plan leads the strip: it changes what Send does, so it must be on
                screen, not scrolled off behind the model name. */}
            {props.compact ? (
              <SetupChip
                testID="composer-mode"
                accessibilityLabel={`Mode: ${props.mode === 'plan' ? 'plan first' : 'auto'}`}
                accessibilityHint="Choose whether the agent plans before editing"
                icon={<ClipboardList size={13} color={props.mode === 'plan' ? colors.primary : colors['muted-foreground']} />}
                label={props.mode === 'plan' ? 'Plan' : 'Auto'}
                highlighted={props.mode === 'plan'}
                onPress={() => setSheet('mode')}
              />
            ) : null}
            {!props.compact && turnParts.plan ? (
              <SetupChip
                testID="composer-mode"
                accessibilityLabel="Mode: plan first"
                accessibilityHint="Choose whether the agent plans before editing"
                icon={<ClipboardList size={13} color={colors.primary} />}
                {...(compactStrip ? {} : { label: 'Plan' })}
                highlighted
                onPress={() => setSheet('mode')}
              />
            ) : null}
            {props.compact ? null : (
            <>
            <SetupChip
              testID="composer-model"
              accessibilityLabel={`Model: ${model?.name ?? 'server default'}`}
              accessibilityHint="Choose the model for this chat"
              icon={
                model?.provider ? (
                  <ProviderBrandIcon provider={model.provider} size={13} color={colors['muted-foreground']} />
                ) : (
                  <Cpu size={13} color={colors['muted-foreground']} />
                )
              }
              label={turnParts.model}
              maxWidth={112}
              onPress={() => setSheet('model')}
            />
            <SetupChip
              testID="composer-options"
              accessibilityLabel={`Turn options: ${turnLabel}`}
              accessibilityHint="Effort, mode, permissions and context window"
              icon={
                turnParts.permission === 'bypassPermissions' ? (
                  <ShieldOff size={13} color={colors.warning} />
                ) : turnParts.permission === 'acceptEdits' ? (
                  <ShieldCheck size={13} color={colors.primary} />
                ) : effortChoices.length > 0 ? (
                  <Brain size={13} color={turnParts.effortOverride ? colors.primary : colors['muted-foreground']} />
                ) : (
                  <SlidersHorizontal size={13} color={colors['muted-foreground']} />
                )
              }
              {...(effortChoices.length > 0 && !compactStrip ? { label: effortLabel } : {})}
              trailing={turnParts.longContext ? <Maximize2 size={12} color={colors['muted-foreground']} /> : null}
              highlighted={Boolean(turnParts.effortOverride) || turnParts.permission !== null}
              onPress={() => setSheet('options')}
            />
            </>
            )}
          </ScrollView>

          <View className="shrink-0 flex-row items-center gap-1.5">
            {/* Only once something is in the window: an empty ring at 0% read
                as a control that had failed to load. */}
            {ratio >= 0.01 && !props.compact ? (
              <Touchable
                accessibilityLabel={`Context usage ${Math.round(ratio * 100)} percent`}
                accessibilityHint="Shows where the context is going"
                haptic="tap"
                onPress={() => setSheet('gauge')}
                className="min-h-11 min-w-11 items-center justify-center"
              >
                <ProgressRing ratio={ratio} />
              </Touchable>
            ) : null}

            {/* One trailing action, as in iOS Messages and every chat client:
                the mic while the field is empty, Send once there is something
                to send, Stop while a turn runs. Showing mic AND a disabled
                Send cost a 44pt slot the setup strip needed — on a 402pt
                iPhone the effort chip was cut to "Mediu". The keyboard's own
                dictation key still covers adding speech to a half-written
                message. */}
            <MicButton
              visible={showMic}
              v2={voiceV2}
              state={props.voiceState ?? (props.voiceActive ? 'listening' : props.voiceBusy ? 'transcribing' : 'idle')}
              pushToTalk={Boolean(props.pushToTalk)}
              onStart={voiceV2 ? props.onVoiceStart : props.onVoice}
              onAccept={props.onVoiceAccept}
            />
            {showMic ? null : (
            <SendButton
              streaming={isStreaming}
              enabled={canSend}
              sending={Boolean(props.sending)}
              onSend={onSend}
              onSendWithPlan={props.onSendWithPlan}
              onStop={onStop}
              {...(stopState ? { stopState } : {})}
            />
            )}
          </View>
        </View>
      </View>

      <ModelSheet
        visible={sheet === 'model'}
        onClose={() => setSheet('none')}
        selectedId={selectedModelId}
        onSelect={props.onSelectModel}
      />

      <TurnOptionsSheet
        visible={sheet === 'options'}
        onClose={() => setSheet('none')}
        onOpenModel={() => setSheet('model')}
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

      <GaugeSheet
        visible={sheet === 'gauge'}
        onClose={() => setSheet('none')}
        usage={props.contextUsage}
        contextTokens={props.contextTokens}
        limit={limit}
        modelName={model?.name}
      />

      <ActionSheet
        visible={sheet === 'mode'}
        onClose={() => setSheet('none')}
        title="Agent mode"
        message={
          props.compact
            ? 'Applies to the messages you send this stage.'
            : "Applies to this chat's next turns. Long-press Send to plan just once."
        }
        actions={MODE_OPTIONS.map((option) => ({
          label: option.value === props.mode ? `${option.title} ✓` : option.title,
          icon: <Wand2 size={18} color={option.value === props.mode ? colors.primary : colors.foreground} />,
          detail: option.help,
          onPress: () => {
            setSheet('none');
            if (option.value !== props.mode) props.onModeChange(option.value);
          },
        }))}
      />

      <ActionSheet
        visible={sheet === 'attach'}
        onClose={() => setSheet('none')}
        title="Attach"
        actions={attachActions}
      />

      <ActionSheet
        visible={sheet === 'captureTerminal'}
        onClose={() => setSheet('none')}
        title="Terminal output"
        message="From the shell you last viewed in this workspace."
        actions={captureTerminalActions}
      />

      <ActionSheet
        visible={sheet === 'captureBrowser'}
        onClose={() => setSheet('none')}
        title="Browser"
        actions={captureBrowserActions}
      />

      {props.historyEntries ? (
        <HistorySheet
          visible={Boolean(props.historyVisible)}
          onClose={props.onCloseHistory ?? (() => {})}
          entries={props.historyEntries}
          onPick={props.onPickHistory ?? (() => {})}
        />
      ) : null}
    </View>
  );
}

function MicButton({
  visible,
  v2,
  state,
  pushToTalk,
  onStart,
  onAccept,
}: {
  visible: boolean;
  v2: boolean;
  state: VoiceUiState;
  pushToTalk: boolean;
  onStart: (() => void) | undefined;
  onAccept: (() => void) | undefined;
}): React.ReactElement | null {
  const { colors } = useTheme();
  if (!visible || !onStart) return null;
  const busy = state === 'transcribing';

  if (v2 && pushToTalk) {
    // Hold to talk: press-in starts, release accepts. A release before the
    // server has answered `ready` (a tap shorter than the handshake) tears
    // the session down with nothing to commit — the same as a cancel.
    return (
      <Touchable
        accessibilityLabel="Hold to dictate"
        accessibilityHint="Hold to record; release to add what you said"
        haptic="tap"
        disabled={busy}
        onPressIn={onStart}
        onPressOut={onAccept}
        className="h-11 w-11 items-center justify-center rounded-full"
      >
        {busy ? <Spinner /> : <Mic size={18} color={colors['muted-foreground']} />}
      </Touchable>
    );
  }

  return (
    <IconButton
      accessibilityLabel={state === 'paused' ? 'Resume dictation' : 'Dictate a message'}
      accessibilityHint="Records audio and transcribes it on your own server"
      disabled={busy}
      icon={busy ? <Spinner /> : <Mic size={18} color={colors['muted-foreground']} />}
      onPress={onStart}
    />
  );
}

function SendButton({
  streaming,
  enabled,
  sending,
  onSend,
  onSendWithPlan,
  onStop,
  stopState,
}: {
  streaming: boolean;
  enabled: boolean;
  sending: boolean;
  onSend: () => void;
  onSendWithPlan?: (() => void) | undefined;
  onStop: () => void;
  stopState?: StopState;
}): React.ReactElement {
  const { colors } = useTheme();
  const motion = useChatMotion();
  // W30-b — during the 400 ms arming window the control is genuinely
  // unpressable, not merely dimmed: a disabled-looking button that still fires
  // its handler is not an arming window, and Stop is the control people
  // double-tap hardest.
  const stopPressable = streaming ? (stopState?.enabled ?? true) : false;
  const active = stopPressable || (!streaming && enabled);

  return (
    <Touchable
      accessibilityLabel={streaming ? (stopState?.label ?? 'Stop') : sending ? 'Sending' : 'Send'}
      accessibilityHint={!streaming && onSendWithPlan ? 'Long-press to send in plan mode' : undefined}
      disabled={!active}
      haptic="commit"
      onPress={streaming ? onStop : onSend}
      onLongPress={
        !streaming && onSendWithPlan
          ? () => {
              haptics.success();
              onSendWithPlan();
            }
          : undefined
      }
      delayLongPress={350}
      className={`h-11 w-11 items-center justify-center rounded-full ${
        streaming ? 'bg-danger' : active ? 'bg-primary' : 'bg-primary opacity-40'
      }`}
    >
      <Animated.View key={streaming ? 'stop' : sending ? 'sending' : 'send'} entering={motion.fadeIn(120)}>
        {streaming ? (
          <Square
            size={13}
            fill={colors['destructive-foreground']}
            color={colors['destructive-foreground']}
          />
        ) : sending ? (
          <Spinner />
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

/**
 * One control in the composer's setup row: a glyph, an optional short label
 * and a chevron when it opens a picker. 32pt tall inside a 44pt touch target,
 * so the row stays compact without any chip being hard to hit.
 */
function SetupChip({
  icon,
  label,
  onPress,
  highlighted = false,
  trailing = null,
  maxWidth,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: {
  icon: React.ReactNode;
  label?: string;
  onPress: () => void;
  /** The value differs from the default — tinted so it is noticed before sending. */
  highlighted?: boolean;
  /** A small glyph after the label (e.g. the long-context mark). */
  trailing?: React.ReactNode;
  maxWidth?: number;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
}): React.ReactElement {
  return (
    <Touchable
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      haptic="tap"
      onPress={onPress}
      className="min-h-11 justify-center"
    >
      <View
        // Desktop's composer controls: no fill at rest, a blue tint (its
        // `bg-primary/10`) when the value differs from the default.
        className={`h-8 flex-row items-center gap-1.5 rounded-lg ${label ? 'px-2' : 'w-8 justify-center'} ${
          highlighted ? 'bg-control-strong' : 'bg-transparent'
        }`}
      >
        {icon}
        {label ? (
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_SCALE.chrome}
            style={maxWidth ? { maxWidth } : undefined}
            className={`text-sm font-medium ${highlighted ? 'text-primary' : 'text-muted-foreground'}`}
          >
            {label}
          </Text>
        ) : null}
        {trailing}
      </View>
    </Touchable>
  );
}

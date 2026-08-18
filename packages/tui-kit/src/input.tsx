// ────────────────────────────────────────────────────────────────
// Input: the composer, text fields, selects and confirmations.
//
// The composer is the reason this file exists. `ink-text-input` is a single
// line with no history, no paste handling and no completion, and the chat
// surface needs all three plus `$EDITOR` handoff.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useCursor } from 'ink';
import stringWidth from 'string-width';
import { useTheme } from './theme.js';
import {
  useKeys,
  usePaste,
  useSelection,
  useTerminalSize,
  useTerminalSuspension,
} from './hooks.js';

// ── TextInput ─────────────────────────────────────────────────────

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  mask?: boolean;
  isActive?: boolean;
}

export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  mask = false,
  isActive = true,
}: TextInputProps): React.JSX.Element {
  const theme = useTheme();
  const [cursor, setCursor] = useState(value.length);

  // The controlled `value` prop is a render-old snapshot. Two keystrokes
  // arriving before the parent re-renders would both edit the same snapshot
  // and the first character would be lost, so edits compose through a ref.
  const latest = useRef(value);
  const cursorRef = useRef(cursor);
  if (latest.current !== value && value !== undefined) {
    // An external replacement (history recall, form reset) wins over our copy.
    latest.current = value;
  }

  const apply = useCallback(
    (nextValue: string, nextCursor: number) => {
      const clamped = Math.max(0, Math.min(nextValue.length, nextCursor));
      latest.current = nextValue;
      cursorRef.current = clamped;
      setCursor(clamped);
      onChange(nextValue);
    },
    [onChange],
  );

  useEffect(() => {
    // Keep the cursor inside the value when it is replaced externally.
    if (cursor > value.length) {
      cursorRef.current = value.length;
      setCursor(value.length);
    }
  }, [value, cursor]);

  useKeys(
    (input, key) => {
      if (key.return) {
        onSubmit?.(latest.current);
        return;
      }
      if (key.leftArrow) {
        cursorRef.current = Math.max(0, cursorRef.current - 1);
        return setCursor(cursorRef.current);
      }
      if (key.rightArrow) {
        cursorRef.current = Math.min(latest.current.length, cursorRef.current + 1);
        return setCursor(cursorRef.current);
      }
      if (key.backspace || key.delete) {
        const at = cursorRef.current;
        if (at === 0) return;
        apply(latest.current.slice(0, at - 1) + latest.current.slice(at), at - 1);
        return;
      }
      // Control characters would otherwise be inserted as literal bytes.
      if (key.ctrl || key.meta || key.tab || key.escape || !input) return;
      const at = cursorRef.current;
      apply(latest.current.slice(0, at) + input + latest.current.slice(at), at + input.length);
    },
    { isActive },
  );

  const shown = mask ? '•'.repeat(value.length) : value;

  return (
    <Text>
      {value.length === 0 && placeholder ? (
        <Text color={theme.c('muted')}>{placeholder}</Text>
      ) : (
        <>
          <Text>{shown.slice(0, cursor)}</Text>
          <Text inverse>{shown.slice(cursor, cursor + 1) || ' '}</Text>
          <Text>{shown.slice(cursor + 1)}</Text>
        </>
      )}
    </Text>
  );
}

// ── Composer ──────────────────────────────────────────────────────

export interface CompletionCandidate {
  value: string;
  label: string;
  detail?: string;
}

export interface ComposerProps {
  onSubmit: (text: string) => void;
  placeholder?: string;
  isActive?: boolean;
  /** Rendered on the right of the hint row: model, agent, permission mode. */
  status?: React.ReactNode;
  /** Called with the token after `@`, `/` or a leading `!` so the host can offer candidates. */
  onRequestCompletions?: (trigger: '@' | '/' | '!', query: string) => CompletionCandidate[];
  /** Opens `$EDITOR` with the current draft and returns the edited text. */
  onOpenEditor?: (draft: string) => Promise<string>;
  history?: string[];
  maxRows?: number;
  /** Rows this composer currently occupies, so the host can shrink the body
   *  instead of letting the completion menu overflow the screen. */
  onHeightChange?: (rows: number) => void;
  /** Rows the completion menu may use. */
  maxMenuRows?: number;
}

/**
 * Multi-line prompt input.
 *
 * Enter submits and Shift+Enter inserts a newline — but only where the
 * terminal can tell them apart. Without the kitty keyboard protocol both
 * arrive as the same byte, so `\` at end of line is offered as the portable
 * continuation and the hint row says so.
 */
export function Composer({
  onSubmit,
  placeholder = 'Send a message…',
  isActive = true,
  status,
  onRequestCompletions,
  onOpenEditor,
  history = [],
  maxRows = 8,
  onHeightChange,
  maxMenuRows = 6,
}: ComposerProps): React.JSX.Element {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const { setCursorPosition } = useCursor();

  const [text, setText] = useState('');
  const [cursor, setCursor] = useState(0);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);

  const draftBeforeHistory = useRef('');

  // Text and cursor must move together, and they must be readable
  // *synchronously*. Reading `cursor` from the render closure means two
  // keystrokes arriving before React re-renders both insert at the same
  // index: typing "good morning" lands as "goodm onirgn".
  const textRef = useRef('');
  const cursorRef = useRef(0);

  const commit = useCallback((nextText: string, nextCursor: number) => {
    const clamped = Math.max(0, Math.min(nextText.length, nextCursor));
    textRef.current = nextText;
    cursorRef.current = clamped;
    setText(nextText);
    setCursor(clamped);
  }, []);

  const moveCursor = useCallback((delta: number) => {
    commit(textRef.current, cursorRef.current + delta);
  }, [commit]);

  const moveCursorTo = useCallback((at: number) => {
    commit(textRef.current, at);
  }, [commit]);

  // Derived, never stored. Tracking the query incrementally as keys arrive
  // means backspace, word-kill, paste and history recall each need their own
  // fix-up, and every one that is missed leaves a menu filtering on a token
  // that is no longer in the box.
  const completion = useMemo(() => {
    const before = text.slice(0, cursor);
    const start = Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n')) + 1;
    const token = before.slice(start);
    const trigger = token[0];
    if (trigger !== '@' && trigger !== '/' && trigger !== '!') return null;
    // `/` and `!` are line-leading verbs; mid-sentence they are punctuation
    // and a path, and offering commands for either is noise.
    if ((trigger === '/' || trigger === '!') && start !== 0) return null;
    if (dismissedToken === token) return null;
    return { trigger, query: token.slice(1), start } as const;
  }, [text, cursor, dismissedToken]);

  const candidates = useMemo(
    () => (completion && onRequestCompletions ? onRequestCompletions(completion.trigger, completion.query) : []),
    [completion, onRequestCompletions],
  );
  const selection = useSelection(candidates.length);

  // Paste arrives whole; inserting it character by character would submit at
  // the first newline and send a third of what the user pasted.
  usePaste(
    useCallback(
      (pasted: string) => {
        const at = cursorRef.current;
        commit(textRef.current.slice(0, at) + pasted + textRef.current.slice(at), at + pasted.length);
      },
      [commit],
    ),
    isActive,
  );

  const insert = useCallback(
    (fragment: string) => {
      const at = cursorRef.current;
      commit(
        textRef.current.slice(0, at) + fragment + textRef.current.slice(at),
        at + fragment.length,
      );
    },
    [commit],
  );

  const acceptCompletion = useCallback(() => {
    const candidate = candidates[selection.index];
    if (!candidate || !completion) return;
    const current = textRef.current;
    const before = current.slice(0, completion.start);
    const after = current.slice(cursorRef.current);
    commit(
      `${before}${completion.trigger}${candidate.value} ${after}`,
      completion.start + candidate.value.length + 2,
    );
  }, [candidates, selection.index, completion, commit]);

  const submit = useCallback(() => {
    const trimmed = textRef.current.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    commit('', 0);
    setHistoryIndex(null);
    setDismissedToken(null);
  }, [onSubmit, commit]);

  const suspend = useTerminalSuspension();
  const openEditor = useCallback(async () => {
    if (!onOpenEditor) return;
    await suspend(async () => {
      const edited = await onOpenEditor(textRef.current);
      commit(edited, edited.length);
    });
  }, [onOpenEditor, suspend, commit]);

  // ── Readline-style motions and kills ────────────────────────────
  //
  // Terminal users expect emacs bindings in any prompt, and the reference
  // agent CLIs (Claude Code, Codex) all implement them. Without these the
  // composer is a toy: no way to fix a typo at the start of a long prompt
  // without holding the left arrow.

  const killRing = useRef<string[]>([]);
  const undoStack = useRef<Array<{ text: string; cursor: number }>>([]);

  const pushUndo = useCallback(() => {
    undoStack.current.push({ text: textRef.current, cursor: cursorRef.current });
    if (undoStack.current.length > 100) undoStack.current.shift();
  }, []);

  const kill = useCallback(
    (from: number, to: number) => {
      const [start, end] = from < to ? [from, to] : [to, from];
      if (start === end) return;
      pushUndo();
      killRing.current.unshift(textRef.current.slice(start, end));
      if (killRing.current.length > 20) killRing.current.pop();
      commit(textRef.current.slice(0, start) + textRef.current.slice(end), start);
    },
    [commit, pushUndo],
  );

  /** Start of the logical line the cursor sits on. */
  const lineStart = useCallback((at: number) => textRef.current.lastIndexOf('\n', at - 1) + 1, []);

  /** End of the logical line the cursor sits on. */
  const lineEnd = useCallback((at: number) => {
    const next = textRef.current.indexOf('\n', at);
    return next === -1 ? textRef.current.length : next;
  }, []);

  const wordLeft = useCallback((at: number) => {
    const before = textRef.current.slice(0, at);
    const match = /[^\s]+\s*$/.exec(before);
    return match ? at - match[0].length : 0;
  }, []);

  const wordRight = useCallback((at: number) => {
    const after = textRef.current.slice(at);
    const match = /^\s*[^\s]+/.exec(after);
    return match ? at + match[0].length : textRef.current.length;
  }, []);

  useKeys(
    (input, key) => {
      if (completion && candidates.length > 0) {
        if (key.upArrow) return selection.move(-1);
        if (key.downArrow) return selection.move(1);
        if (key.tab || key.return) return acceptCompletion();
        if (key.escape) return setDismissedToken(`${completion.trigger}${completion.query}`);
      }

      // ── Control chords ───────────────────────────────────────────
      if (key.ctrl) {
        const at = cursorRef.current;
        switch (input) {
          case 'a':
            return moveCursorTo(lineStart(at));
          case 'e':
            return moveCursorTo(lineEnd(at));
          case 'b':
            return moveCursor(-1);
          case 'f':
            return moveCursor(1);
          case 'k':
            // At a line end, kill the newline itself so repeated presses join.
            return kill(at, lineEnd(at) === at ? Math.min(at + 1, textRef.current.length) : lineEnd(at));
          case 'u':
            return kill(lineStart(at), at);
          case 'w':
            return kill(wordLeft(at), at);
          case 'y': {
            const yanked = killRing.current[0];
            if (yanked) {
              pushUndo();
              insert(yanked);
            }
            return;
          }
          case 'd': {
            // Delete forward when there is text; exiting is the shell's job.
            if (at < textRef.current.length) {
              pushUndo();
              commit(textRef.current.slice(0, at) + textRef.current.slice(at + 1), at);
            }
            return;
          }
          case 'j':
            // The portable newline: works in every terminal, unlike Shift+Enter.
            return insert('\n');
          case '_': {
            const previous = undoStack.current.pop();
            if (previous) commit(previous.text, previous.cursor);
            return;
          }
          default:
            // Anything else is a global binding; let it through.
            return;
        }
      }

      // ── Alt/meta chords ──────────────────────────────────────────
      if (key.meta && !key.escape) {
        const at = cursorRef.current;
        if (input === 'b') return moveCursorTo(wordLeft(at));
        if (input === 'f') return moveCursorTo(wordRight(at));
        if (input === 'd') return kill(at, wordRight(at));
        if (input === 'e') {
          void openEditor();
          return;
        }
        if (key.backspace || key.delete) return kill(wordLeft(at), at);
        return;
      }

      if (key.return) {
        // Shift+Enter only reaches us with the kitty protocol; `\` + Enter and
        // Ctrl+J are the portable fallbacks and both are advertised.
        if (key.shift) return insert('\n');
        if (textRef.current.endsWith('\\')) {
          commit(`${textRef.current.slice(0, -1)}\n`, cursorRef.current);
          return;
        }
        return submit();
      }

      // Home/End, for users who reach for them before the emacs chords.
      if (key.home ?? false) return moveCursorTo(lineStart(cursorRef.current));
      if (key.end ?? false) return moveCursorTo(lineEnd(cursorRef.current));

      // History recall only once the cursor is on the first/last logical line,
      // so arrows still navigate inside a multi-line draft.
      if (key.upArrow) {
        const at = cursorRef.current;
        const start = lineStart(at);
        if (start > 0) {
          // Keep the column: dropping to the end of the line above is what
          // makes arrow navigation feel like a text box rather than a log.
          const column = at - start;
          const previousStart = lineStart(start - 1);
          return moveCursorTo(Math.min(previousStart + column, start - 1));
        }
        if (history.length === 0) return;
        if (historyIndex === null) draftBeforeHistory.current = textRef.current;
        const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(next);
        const entry = history[next] ?? '';
        commit(entry, entry.length);
        return;
      }

      if (key.downArrow) {
        const at = cursorRef.current;
        const end = lineEnd(at);
        if (end < textRef.current.length) {
          const column = at - lineStart(at);
          return moveCursorTo(Math.min(end + 1 + column, lineEnd(end + 1)));
        }
        if (historyIndex === null) return;
        const next = historyIndex + 1;
        if (next >= history.length) {
          setHistoryIndex(null);
          commit(draftBeforeHistory.current, draftBeforeHistory.current.length);
        } else {
          setHistoryIndex(next);
          const entry = history[next] ?? '';
          commit(entry, entry.length);
        }
        return;
      }

      if (key.leftArrow) return moveCursor(-1);
      if (key.rightArrow) return moveCursor(1);

      if (key.backspace || key.delete) {
        const at = cursorRef.current;
        if (at === 0) return;
        pushUndo();
        commit(textRef.current.slice(0, at - 1) + textRef.current.slice(at), at - 1);
        setDismissedToken(null);
        return;
      }

      if (key.tab || key.escape || !input) return;

      pushUndo();
      insert(input);
      setDismissedToken(null);
    },
    { isActive },
  );

  const lines = text.split('\n');
  const cursorRow = text.slice(0, cursor).split('\n').length - 1;

  // Window on the caret, not on the tail: a 40-line paste would otherwise
  // scroll the caret off the top the moment the user pressed Home.
  const firstRow = Math.max(0, Math.min(cursorRow - maxRows + 1, lines.length - maxRows));
  const visibleLines = lines.slice(firstRow, firstRow + maxRows);

  // border + padding + the two-column prompt gutter.
  const promptWidth = 4;

  // Placing the real terminal cursor is what makes IME composition (CJK,
  // dead keys) appear where the user is typing instead of at 0,0.
  useEffect(() => {
    if (!isActive) return;
    const before = text.slice(0, cursor);
    const column = stringWidth(before.split('\n').at(-1) ?? '');
    setCursorPosition({ x: promptWidth + column, y: cursorRow - firstRow });
  }, [text, cursor, cursorRow, firstRow, isActive, setCursorPosition, promptWidth]);

  // The full hint row needs ~64 columns. Below that it wraps onto a second
  // line and pushes the composer up, so the least-discoverable hints go first.
  const hints =
    columns >= 76
      ? ['⏎ send', '\\⏎ newline', '⌥E editor', '@ mention', '/ command', '^K kill']
      : columns >= 52
        ? ['⏎ send', '\\⏎ newline', '@ mention', '/ command']
        : ['⏎ send', '\\⏎ nl'];

  const menuOpen = completion !== null && candidates.length > 0;
  const menuRows = menuOpen ? Math.min(candidates.length, Math.max(1, maxMenuRows)) : 0;

  // Scroll the window with the selection rather than always slicing from 0,
  // or picking the 9th of 12 agents moves a highlight that is off-screen.
  const menuOffset = menuOpen
    ? Math.max(0, Math.min(selection.index - menuRows + 1, candidates.length - menuRows))
    : 0;
  const visibleCandidates = menuOpen ? candidates.slice(menuOffset, menuOffset + menuRows) : [];

  //  menu box (2 borders + rows + overflow counter) + input box (2 borders +
  //  text rows) + hint row.
  const height =
    (menuOpen ? menuRows + 2 + (candidates.length > menuRows ? 1 : 0) : 0) +
    visibleLines.length +
    2 +
    1;

  useEffect(() => {
    onHeightChange?.(height);
  }, [height, onHeightChange]);

  return (
    <Box flexDirection="column" width="100%">
      {menuOpen ? (
        <Box
          flexDirection="column"
          borderStyle={theme.borderStyle}
          borderColor={theme.c('borderMuted')}
          paddingX={1}
          width="100%"
        >
          {visibleCandidates.map((candidate, index) => (
            <Text
              key={candidate.value}
              color={index + menuOffset === selection.index ? theme.c('primary') : theme.c('muted')}
              wrap="truncate-end"
            >
              {index + menuOffset === selection.index ? theme.glyphs.arrowRight : ' '}{' '}
              {completion.trigger}
              {candidate.label}
              {candidate.detail ? <Text color={theme.c('muted')}>{`  ${candidate.detail}`}</Text> : null}
            </Text>
          ))}
          {candidates.length > visibleCandidates.length ? (
            <Text color={theme.c('muted')}>
              {`  ${selection.index + 1}/${candidates.length} · ↑↓ to scroll`}
            </Text>
          ) : null}
        </Box>
      ) : null}

      <Box
        borderStyle={theme.borderStyle}
        borderColor={isActive ? theme.c('focusBorder') : theme.c('borderMuted')}
        paddingX={1}
        flexDirection="row"
        width="100%"
      >
        {/* A fixed gutter rather than a prefix on line one: prefixing shifts
            every wrapped continuation line out of alignment. */}
        <Box flexShrink={0} flexDirection="column" width={2}>
          {visibleLines.map((_, index) => (
            <Text key={index} color={theme.c(index === 0 ? 'primary' : 'muted')}>
              {index === 0 ? `${theme.glyphs.arrowRight} ` : '  '}
            </Text>
          ))}
        </Box>

        <Box flexDirection="column" flexGrow={1}>
          {text.length === 0 ? (
            <Text color={theme.c('muted')}>{placeholder}</Text>
          ) : (
            visibleLines.map((line, index) => (
              <Text key={index} wrap="wrap">
                {line || ' '}
              </Text>
            ))
          )}
        </Box>
      </Box>

      <Box justifyContent="space-between" paddingX={1} width="100%">
        <Box flexShrink={1} overflow="hidden">
          <Text color={theme.c('muted')} wrap="truncate-end">
            {hints.join(` ${theme.glyphs.neutral} `)}
            {lines.length > maxRows ? ` ${theme.glyphs.neutral} ${cursorRow + 1}/${lines.length}` : ''}
          </Text>
        </Box>
        {/* The status names the model. It must keep its width and let the
            hints truncate, or a long model id wraps onto its own row and the
            composer silently grows by a line. */}
        {status ? (
          <Box marginLeft={2} flexShrink={0}>
            {status}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

// ── Select ────────────────────────────────────────────────────────

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  detail?: string;
  disabled?: boolean;
}

export function Select<T extends string>({
  options,
  onSelect,
  onCancel,
  isActive = true,
  height = 10,
}: {
  options: Array<SelectOption<T>>;
  onSelect: (value: T) => void;
  onCancel?: () => void;
  isActive?: boolean;
  height?: number;
}): React.JSX.Element {
  const theme = useTheme();
  const selectable = options.filter((o) => !o.disabled);
  const selection = useSelection(selectable.length);

  useKeys(
    (input, key) => {
      if (key.upArrow || input === 'k') return selection.move(-1);
      if (key.downArrow || input === 'j') return selection.move(1);
      if (key.return) {
        const option = selectable[selection.index];
        if (option) onSelect(option.value);
        return;
      }
      if (key.escape) onCancel?.();
    },
    { isActive },
  );

  const visible = selectable.slice(
    Math.max(0, selection.index - height + 1),
    Math.max(height, selection.index + 1),
  );

  // Labels share one column so the details line up as a second column. Without
  // this every row starts its detail at a different offset and a long detail
  // wraps to column zero, which reads as a new option rather than a
  // continuation.
  const labelWidth = Math.min(
    24,
    selectable.reduce((widest, o) => Math.max(widest, stringWidth(o.label)), 0),
  );

  return (
    <Box flexDirection="column" width="100%">
      {visible.map((option) => {
        const index = selectable.indexOf(option);
        const selected = index === selection.index;
        return (
          <Box key={option.value} width="100%">
            <Text color={selected ? theme.c('primary') : undefined} wrap="truncate-end">
              {selected ? theme.glyphs.arrowRight : ' '} {option.label.padEnd(labelWidth)}
              {option.detail ? <Text color={theme.c('muted')}>{`  ${option.detail}`}</Text> : null}
            </Text>
          </Box>
        );
      })}
      {selectable.length > visible.length ? (
        <Text color={theme.c('muted')}>{`  ${selection.index + 1}/${selectable.length}`}</Text>
      ) : null}
    </Box>
  );
}

// ── Confirm ───────────────────────────────────────────────────────

export function Confirm({
  message,
  onAnswer,
  danger = false,
  isActive = true,
}: {
  message: string;
  onAnswer: (value: boolean) => void;
  danger?: boolean;
  isActive?: boolean;
}): React.JSX.Element {
  const theme = useTheme();

  useKeys(
    (input, key) => {
      if (input.toLowerCase() === 'y') return onAnswer(true);
      if (input.toLowerCase() === 'n' || key.escape) return onAnswer(false);
      // Enter takes the SAFE answer. A destructive confirm that defaults to
      // "yes" on a stray keypress is how people delete production data.
      if (key.return) return onAnswer(!danger);
    },
    { isActive },
  );

  return (
    <Box flexDirection="column">
      <Text color={danger ? theme.c('danger') : undefined}>{message}</Text>
      <Text color={theme.c('muted')}>
        {danger ? 'y to confirm, anything else cancels' : 'y / n  (Enter = yes)'}
      </Text>
    </Box>
  );
}

// ── SearchInput ───────────────────────────────────────────────────

export function SearchInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  placeholder = 'Search…',
  isActive = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  placeholder?: string;
  isActive?: boolean;
}): React.JSX.Element {
  const theme = useTheme();

  useKeys(
    (_input, key) => {
      if (key.escape) onCancel?.();
    },
    { isActive },
  );

  return (
    <Box>
      <Text color={theme.c('primary')}>/ </Text>
      <TextInput
        value={value}
        onChange={onChange}
        {...(onSubmit ? { onSubmit } : {})}
        placeholder={placeholder}
        isActive={isActive}
      />
    </Box>
  );
}

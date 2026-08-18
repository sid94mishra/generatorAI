// ────────────────────────────────────────────────────────────────
// Overlays: the command palette, the help sheet, and the small modal set.
//
// Ink has no z-index, so an overlay replaces the content beneath it rather
// than floating over it. Faking a float with absolute positioning produces
// frames where both layers are half-drawn.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { CommandRegistry, Keymap } from '@generatorai/cli-core';
import { toPalette, type PaletteEntry } from '@generatorai/cli-core';
import {
  Confirm,
  Overlay,
  Select,
  TextInput,
  VirtualList,
  prettyChord,
  useKeys,
  useSelection,
  useTheme,
} from '@generatorai/tui-kit';
import { useActions, useTui, type OverlayKind } from './store.js';

export interface OverlayHostProps {
  registry: CommandRegistry;
  keymap: Keymap;
  /** Action ids the app has a handler for; the rest are hidden from help. */
  implemented: ReadonlySet<string>;
  onRunCommand: (entry: PaletteEntry) => void;
}

export function OverlayHost({ registry, keymap, implemented, onRunCommand }: OverlayHostProps): React.JSX.Element | null {
  const overlay = useTui((s) => s.overlay);
  const actions = useActions();

  switch (overlay.kind) {
    case 'none':
      return null;

    case 'palette':
      return (
        <CommandPalette
          registry={registry}
          keymap={keymap}
          onSelect={(entry) => {
            actions.closeOverlay();
            onRunCommand(entry);
          }}
          onCancel={actions.closeOverlay}
        />
      );

    case 'help':
      return <HelpOverlay keymap={keymap} implemented={implemented} onClose={actions.closeOverlay} />;

    case 'confirm':
      return (
        <Overlay title={overlay.danger ? 'Confirm' : 'Are you sure?'} footer="y confirm · n / Esc cancel">
          <Confirm
            message={overlay.message}
            danger={overlay.danger}
            onAnswer={(value) => {
              actions.closeOverlay();
              overlay.onAnswer(value);
            }}
          />
        </Overlay>
      );

    case 'input':
      return (
        <InputOverlay
          message={overlay.message}
          initial={overlay.initial}
          onSubmit={(value) => {
            actions.closeOverlay();
            overlay.onSubmit(value);
          }}
          onCancel={actions.closeOverlay}
        />
      );

    case 'select':
      return (
        <Overlay title={overlay.message} footer="↑↓ move · ⏎ select · Esc cancel">
          <Select
            options={overlay.options}
            onSelect={(value) => {
              actions.closeOverlay();
              overlay.onSelect(value);
            }}
            onCancel={actions.closeOverlay}
          />
        </Overlay>
      );

    case 'error':
      return <ErrorOverlay overlay={overlay} onClose={actions.closeOverlay} />;
  }
}

// ── Command palette ───────────────────────────────────────────────

function CommandPalette({
  registry,
  keymap,
  onSelect,
  onCancel,
}: {
  registry: CommandRegistry;
  keymap: Keymap;
  onSelect: (entry: PaletteEntry) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const [query, setQuery] = useState('');

  const entries = useMemo(() => toPalette(registry), [registry]);

  // Ranked by the registry's own search so the palette and `did you mean`
  // agree on what "close" means.
  const results = useMemo(() => {
    if (!query.trim()) return entries.slice(0, 40);
    const ranked = registry.search(query, 40);
    const byId = new Map(entries.map((e) => [e.id, e]));
    return ranked.map((spec) => byId.get(spec.id)).filter((e): e is PaletteEntry => Boolean(e));
  }, [query, entries, registry]);

  const selection = useSelection(results.length);

  useKeys((input, key) => {
    if (key.escape) return onCancel();
    if (key.upArrow) return selection.move(-1);
    if (key.downArrow) return selection.move(1);
    if (key.return) {
      const entry = results[selection.index];
      if (entry) onSelect(entry);
      return;
    }
    if (key.backspace || key.delete) return setQuery((q) => q.slice(0, -1));
    if (key.ctrl || key.meta || key.tab || !input) return;
    setQuery((q) => q + input);
  });

  return (
    <Overlay
      title="Command palette"
      footer={`↑↓ move · ⏎ run · Esc close   ${results.length} of ${entries.length}`}
    >
      <Box marginBottom={1}>
        <Text color={theme.c('primary')}>{'> '}</Text>
        <Text>{query || <Text color={theme.c('muted')}>Type to search commands…</Text>}</Text>
        <Text inverse> </Text>
      </Box>

      <VirtualList
        items={results}
        selectedIndex={selection.index}
        height={16}
        emptyMessage="No command matches."
        renderItem={(entry, _index, selected) => (
          <Text color={selected ? theme.c('primary') : undefined} wrap="truncate-end">
            {selected ? theme.glyphs.arrowRight : ' '}
            {/* Own gutter: trailing the description made it read as prose
                ("Forget a server !") instead of a warning. */}
            {entry.destructive ? <Text color={theme.c('danger')}>{'!'}</Text> : ' '}
            {` ${entry.title.padEnd(34)}`}
            <Text color={theme.c('muted')}>{entry.subtitle}</Text>
            {keymap.chordFor(entry.id) ? (
              <Text color={theme.c('muted')}>{`  ${prettyChord(keymap.chordFor(entry.id))}`}</Text>
            ) : null}
          </Text>
        )}
      />
    </Overlay>
  );
}

// ── Help ──────────────────────────────────────────────────────────

function HelpOverlay({
  keymap,
  implemented,
  onClose,
}: {
  keymap: Keymap;
  implemented: ReadonlySet<string>;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const [page, setPage] = useState(0);

  // Generated from the keymap registry, so a binding cannot exist without
  // appearing here and a remap is reflected automatically — but filtered to
  // the actions that are actually wired up, because a help sheet that lists
  // keys which do nothing is worse than one that lists fewer.
  const categories = useMemo(
    () =>
      keymap
        .byCategory()
        .map((category) => ({
          ...category,
          bindings: category.bindings.filter((binding) => implemented.has(binding.id)),
        }))
        .filter((category) => category.bindings.length > 0),
    [keymap, implemented],
  );
  const perPage = 2;
  const pages = Math.max(1, Math.ceil(categories.length / perPage));
  const visible = categories.slice(page * perPage, page * perPage + perPage);

  useKeys((input, key) => {
    if (key.escape || input === '?' || input === 'q') return onClose();
    if (key.rightArrow || key.pageDown || input === 'n') return setPage((p) => (p + 1) % pages);
    if (key.leftArrow || key.pageUp || input === 'p') return setPage((p) => (p - 1 + pages) % pages);
  });

  return (
    <Overlay title="Keyboard shortcuts" footer={`←→ page ${page + 1}/${pages} · Esc close`}>
      <Box flexDirection="row">
        {visible.map((category) => (
          <Box key={category.category} flexDirection="column" width="50%" paddingRight={2}>
            <Text bold color={theme.c('primary')}>
              {category.category}
            </Text>
            {category.bindings.map((binding) => (
              <Text key={binding.id}>
                <Text color={theme.c('foreground')} bold>
                  {prettyChord(binding.keys).padEnd(12)}
                </Text>
                <Text color={theme.c('muted')}>{binding.description}</Text>
              </Text>
            ))}
          </Box>
        ))}
      </Box>
    </Overlay>
  );
}

// ── Small modals ──────────────────────────────────────────────────

function InputOverlay({
  message,
  initial,
  onSubmit,
  onCancel,
}: {
  message: string;
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);

  useKeys((_input, key) => {
    if (key.escape) onCancel();
  });

  return (
    <Overlay title={message} footer="⏎ confirm · Esc cancel" height={7}>
      <TextInput value={value} onChange={setValue} onSubmit={onSubmit} />
    </Overlay>
  );
}

function ErrorOverlay({
  overlay,
  onClose,
}: {
  overlay: Extract<OverlayKind, { kind: 'error' }>;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();

  useKeys(() => onClose());

  return (
    <Overlay title={overlay.title} footer="Press any key to dismiss" height={10}>
      <Text color={theme.c('danger')} wrap="wrap">
        {overlay.message}
      </Text>
      {overlay.hint ? (
        <Box marginTop={1}>
          <Text color={theme.c('muted')} wrap="wrap">
            {overlay.hint}
          </Text>
        </Box>
      ) : null}
    </Overlay>
  );
}

// ── Toasts ────────────────────────────────────────────────────────

export function Toasts(): React.JSX.Element | null {
  const theme = useTheme();
  const toasts = useTui((s) => s.toasts);
  if (toasts.length === 0) return null;

  const colourFor = (tone: string): string | undefined => {
    switch (tone) {
      case 'success':
        return theme.c('success');
      case 'warning':
        return theme.c('warning');
      case 'error':
        return theme.c('danger');
      default:
        return theme.c('info');
    }
  };

  return (
    <Box flexDirection="column" paddingX={1} flexShrink={0}>
      {/* Each toast steals a row from the body, so a burst of them would push
          the composer off screen. Only the newest few are worth showing. */}
      {toasts.slice(-3).map((toast) => (
        <Text key={toast.id} color={colourFor(toast.tone)} wrap="truncate-end">
          {theme.glyphs.bullet} {toast.text}
        </Text>
      ))}
      {toasts.length > 3 ? (
        <Text color={theme.c('muted')}>{`  +${toasts.length - 3} more`}</Text>
      ) : null}
    </Box>
  );
}

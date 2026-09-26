// ────────────────────────────────────────────────────────────────
// Overlays: the command palette, the help sheet, and the small modal set.
//
// Ink has no z-index, so an overlay replaces the content beneath it rather
// than floating over it. Faking a float with absolute positioning produces
// frames where both layers are half-drawn.
//
// Close-key rule (one rule, every overlay):
//   • Escape closes every overlay.
//   • `q` ALSO closes an overlay that has no text input — help, validation,
//     blocked-work queue, stage detail, loop decision. It never closes one that is typing
//     into a field (palette, tab navigator, input, form), where `q` is a
//     letter the user meant to type. `ErrorOverlay` dismisses on any key.
// `overlays.closeKeys.test.tsx` pins this; add a new overlay to that table.
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { CommandRegistry, Keymap } from '@generatorai/cli-core';
import {
  fieldKey,
  formatRelative,
  missingRequiredFields,
  toPalette,
  type PaletteEntry,
} from '@generatorai/cli-core';
import {
  Confirm,
  JsonView,
  Overlay,
  Select,
  TextInput,
  VirtualList,
  prettyChord,
  useKeys,
  useSelection,
  useTheme,
} from '@generatorai/tui-kit';
import { blockedWorkItems, paneLeaves, useActions, useTui, type OverlayKind } from './store.js';

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

    case 'tabs':
      return <TabNavigator onClose={actions.closeOverlay} />;

    case 'notifications':
      return <NotificationQueue onClose={actions.closeOverlay} />;

    case 'confirm':
      return (
        <Overlay title={overlay.title ?? (overlay.danger ? 'Confirm' : 'Are you sure?')} footer="y confirm · n / Esc cancel">
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
        <Overlay title={overlay.message} footer={`↑↓ move · ${prettyChord('return')} select · Esc cancel`}>
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

    case 'form':
      return (
        <FormOverlay
          overlay={overlay}
          onSubmit={(values) => {
            actions.closeOverlay();
            overlay.onSubmit(values);
          }}
          onCancel={() => {
            actions.closeOverlay();
            // A caller awaiting `runWithForm` must hear about a dismissal, or
            // its promise never settles.
            overlay.onCancel?.();
          }}
        />
      );

    case 'validation':
      return (
        <ValidationOverlay
          overlay={overlay}
          onNavigate={(stageKey) => {
            actions.closeOverlay();
            overlay.onNavigate(stageKey);
          }}
          onClose={actions.closeOverlay}
        />
      );

    case 'stageDetail':
      return <StageDetailOverlay overlay={overlay} onClose={actions.closeOverlay} />;

    case 'loopDecision':
      return (
        <LoopDecisionOverlay
          overlay={overlay}
          onChoose={(value) => {
            actions.closeOverlay();
            overlay.onChoose(value);
          }}
          onClose={actions.closeOverlay}
        />
      );
  }
}

// ── Loop decision (P05) ───────────────────────────────────────────
//
// A parked loop's decisions as one list: a hotkey per option (the footer and
// each row say which), or ↑↓ + Enter. No text field, so `q` closes it too.

function LoopDecisionOverlay({
  overlay,
  onChoose,
  onClose,
}: {
  overlay: Extract<OverlayKind, { kind: 'loopDecision' }>;
  onChoose: (value: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const selection = useSelection(overlay.options.length);

  useKeys((input, key) => {
    if (key.escape || input === 'q') return onClose();
    if (key.upArrow) return selection.move(-1);
    if (key.downArrow) return selection.move(1);
    if (key.return) {
      const option = overlay.options[selection.index];
      if (option) onChoose(option.value);
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    const option = overlay.options.find((o) => o.key !== '' && o.key === input);
    if (option) onChoose(option.value);
  });

  return (
    <Overlay title={overlay.title} footer={`hotkey or ↑↓ + ${prettyChord('return')} · q / Esc close`}>
      <Box marginBottom={1}>
        <Text color={theme.c('warning')} wrap="wrap">
          {overlay.message}
        </Text>
      </Box>
      {overlay.options.map((option, index) => {
        const selected = index === selection.index;
        return (
          <Text key={option.value} color={selected ? theme.c('primary') : undefined} wrap="truncate-end">
            {selected ? theme.glyphs.arrowRight : ' '}
            <Text bold>{` ${(option.key || ' ').padEnd(2)}`}</Text>
            {option.label}
            {option.detail ? <Text color={theme.c('muted')}>{`  ${option.detail}`}</Text> : null}
          </Text>
        );
      })}
    </Overlay>
  );
}

// ── Schema-driven form (Phase 7 item 4) ────────────────────────────
//
// Fields come from the command spec itself (`formFieldsForSpec`), so this
// component knows nothing about workflows, stages, or any other domain —
// which is exactly why it can back BOTH the workflow-authoring surface and
// the palette's previously-refused "needs options" case with one
// implementation.
//
// One `TextInput` is mounted at a time (the focused field). `useKeys` is a
// module-level `useInput` registration per mount, so mounting one per field
// would give every keystroke to every field at once — the same
// parallel-listener hazard Phase 4 item 2 already hit with the leader key.

function FormOverlay({
  overlay,
  onSubmit,
  onCancel,
}: {
  overlay: Extract<OverlayKind, { kind: 'form' }>;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const { fields } = overlay;
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((field) => [fieldKey(field), field.initial])),
  );
  const [index, setIndex] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const field = fields[index];
  const editable = field !== undefined && field.type !== 'boolean' && field.type !== 'enum';

  const setValue = (key: string, value: string): void => {
    setProblem(null);
    setValues((current) => ({ ...current, [key]: value }));
  };

  const submit = (): void => {
    const missing = missingRequiredFields(fields, values);
    if (missing.length > 0) {
      // Named, not counted: "3 required fields" leaves the user hunting.
      setProblem(`Required: ${missing.map((f) => f.label).join(', ')}`);
      setIndex(fields.indexOf(missing[0]!));
      return;
    }
    onSubmit(values);
  };

  const move = (delta: 1 | -1): void =>
    setIndex((current) => (current + delta + fields.length) % fields.length);

  // Non-text fields own the bare keys a `TextInput` would otherwise swallow
  // (space to toggle, ←→ to cycle) — so this handler stands down entirely
  // while a text field is focused, except for the chords that can never be
  // typed INTO one.
  useKeys((input, key) => {
    if (key.escape) return onCancel();
    if (key.tab && key.shift) return move(-1);
    if (key.tab) return move(1);
    // Ctrl+S submits from anywhere, including mid-word in a text field —
    // the only way to submit without first walking to the last field.
    if (key.ctrl && input === 's') return submit();
    if (key.upArrow) return move(-1);
    if (key.downArrow) return move(1);
    if (editable) return;

    if (key.return) return submit();
    if (!field) return;
    if (field.type === 'boolean') {
      if (input === ' ' || key.leftArrow || key.rightArrow) {
        setValue(fieldKey(field), values[fieldKey(field)] === 'true' ? 'false' : 'true');
      }
      return;
    }
    // enum: cycle, including through "" for an optional one so it can be
    // cleared back to unset rather than being stuck on whatever was landed on.
    const options = [...(field.choices ?? [])];
    if (!field.required) options.unshift('');
    const at = options.indexOf(values[fieldKey(field)] ?? '');
    if (key.leftArrow) {
      setValue(fieldKey(field), options[(at - 1 + options.length) % options.length] ?? '');
    } else if (key.rightArrow || input === ' ') {
      setValue(fieldKey(field), options[(at + 1) % options.length] ?? '');
    }
  });

  return (
    <Overlay
      title={overlay.title}
      footer={`↑↓/Tab field · ←→/Space choose · ${prettyChord('return')} next/run · ${prettyChord('ctrl+s')} run · Esc cancel`}
      height={20}
    >
      {overlay.description ? (
        <Box marginBottom={1}>
          <Text color={theme.c('muted')} wrap="truncate-end">
            {overlay.description}
          </Text>
        </Box>
      ) : null}

      <VirtualList
        items={fields}
        selectedIndex={index}
        height={12}
        emptyMessage="This command takes no input."
        renderItem={(item, itemIndex, selected) => {
          const key = fieldKey(item);
          const value = values[key] ?? '';
          return (
            <Box>
              <Box flexShrink={0} width={22}>
                <Text
                  color={selected ? theme.c('primary') : theme.c('muted')}
                  bold={selected}
                  wrap="truncate-end"
                >
                  {selected ? theme.glyphs.arrowRight : ' '} {item.label}
                  {item.required ? <Text color={theme.c('danger')}>*</Text> : ''}
                </Text>
              </Box>
              <Box flexGrow={1} overflow="hidden">
                {selected && item.type !== 'boolean' && item.type !== 'enum' ? (
                  <TextInput
                    value={value}
                    onChange={(next) => setValue(key, next)}
                    // Enter on the last field runs; anywhere else it advances,
                    // matching how a terminal form is expected to behave.
                    onSubmit={() => (itemIndex === fields.length - 1 ? submit() : move(1))}
                    placeholder={item.description}
                  />
                ) : item.type === 'boolean' ? (
                  <Text color={value === 'true' ? theme.c('success') : theme.c('muted')}>
                    {value === 'true' ? '[x] on' : '[ ] off'}
                  </Text>
                ) : item.type === 'enum' ? (
                  <Text color={value ? undefined : theme.c('muted')}>
                    {value || '(unset)'}
                    <Text color={theme.c('muted')}>{`   ${(item.choices ?? []).join(' / ')}`}</Text>
                  </Text>
                ) : (
                  <Text color={value ? undefined : theme.c('muted')} wrap="truncate-end">
                    {value || item.description}
                  </Text>
                )}
              </Box>
            </Box>
          );
        }}
      />

      {problem ? (
        <Box marginTop={1}>
          <Text color={theme.c('danger')} wrap="truncate-end">
            {problem}
          </Text>
        </Box>
      ) : field ? (
        <Box marginTop={1}>
          <Text color={theme.c('muted')} wrap="truncate-end">
            {field.description}
            {field.variadic ? ' (repeatable — separate with commas)' : ''}
          </Text>
        </Box>
      ) : null}
    </Overlay>
  );
}

// ── Validation findings (Phase 7 item 6) ───────────────────────────
//
// `POST /workflow-definitions/validate` answers every issue with its JSON
// pointer and, when it belongs to one, the stage key — so Enter can move the
// DAG cursor straight to the stage at fault.

function ValidationOverlay({
  overlay,
  onNavigate,
  onClose,
}: {
  overlay: Extract<OverlayKind, { kind: 'validation' }>;
  onNavigate: (stageKey: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const selection = useSelection(overlay.issues.length);
  const selected = overlay.issues[selection.index];

  useKeys((input, key) => {
    if (key.escape || input === 'q') return onClose();
    if (key.upArrow) return selection.move(-1);
    if (key.downArrow) return selection.move(1);
    if (key.return) {
      // An issue not tied to a stage (a workflow setting, an empty graph)
      // says so in the footer rather than moving the cursor anywhere.
      if (selected?.stageKey) onNavigate(selected.stageKey);
    }
  });

  return (
    <Overlay
      title={overlay.title}
      footer={`↑↓ move · ${prettyChord('return')} jump to stage · q / Esc close`}
      height={18}
    >
      <Box marginBottom={1}>
        <Text color={overlay.valid ? theme.c('success') : theme.c('danger')} bold>
          {overlay.valid ? `${theme.glyphs.success} Valid` : `${theme.glyphs.failure} Not valid`}
        </Text>
        <Text color={theme.c('muted')}>
          {`  ${overlay.issues.filter((i) => i.severity === 'error').length} error(s), ${
            overlay.issues.filter((i) => i.severity === 'warning').length
          } warning(s)`}
        </Text>
      </Box>

      <VirtualList
        items={overlay.issues}
        selectedIndex={selection.index}
        height={10}
        emptyMessage="No findings."
        renderItem={(issue, _index, isSelected) => (
          <Text color={isSelected ? theme.c('primary') : undefined} wrap="truncate-end">
            {isSelected ? theme.glyphs.arrowRight : ' '}{' '}
            <Text color={issue.severity === 'error' ? theme.c('danger') : theme.c('warning')}>
              {issue.severity === 'error' ? theme.glyphs.failure : theme.glyphs.warning}
            </Text>{' '}
            {issue.message}
          </Text>
        )}
      />

      {selected ? (
        <Box marginTop={1}>
          <Text color={theme.c('muted')} wrap="truncate-end">
            {selected.code}
            {selected.stageKey ? `  ${theme.glyphs.neutral} stage: ${selected.stageKey}` : '  (not tied to a stage)'}
            {`  ${theme.glyphs.neutral} ${selected.path || '/'}`}
            {selected.hint ? `  ${theme.glyphs.neutral} ${selected.hint}` : ''}
          </Text>
        </Box>
      ) : null}
    </Overlay>
  );
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
      footer={`↑↓ move · ${prettyChord('return')} run · Esc close   ${results.length} of ${entries.length}`}
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
          <Text
            color={entry.shellOnlyHint ? theme.c('muted') : selected ? theme.c('primary') : undefined}
            dimColor={Boolean(entry.shellOnlyHint)}
            wrap="truncate-end"
          >
            {selected ? theme.glyphs.arrowRight : ' '}
            {/* Own gutter: trailing the description made it read as prose
                ("Forget a server !") instead of a warning. */}
            {entry.destructive ? <Text color={theme.c('danger')}>{'!'}</Text> : ' '}
            {` ${entry.title.padEnd(34)}`}
            {/* A shell-only command is listed (so it is discoverable) but
                disabled: the hint replaces the summary so the row itself
                says where the command works, before anyone presses ⏎. */}
            <Text color={theme.c('muted')}>{entry.shellOnlyHint ?? entry.subtitle}</Text>
            {keymap.chordFor(entry.id) ? (
              <Text color={theme.c('muted')}>{`  ${prettyChord(keymap.chordFor(entry.id))}`}</Text>
            ) : null}
          </Text>
        )}
      />
    </Overlay>
  );
}

// ── Tab navigator (Phase 4 item 4) ─────────────────────────────────
//
// `pane.nextTab`/`pane.prevTab` only step one at a time; jumping straight to
// a specific tab by number, name, or a fuzzy filter needed a real picker,
// the same reasoning the command palette already exists for.

function TabNavigator({ onClose }: { onClose: () => void }): React.JSX.Element {
  const theme = useTheme();
  const actions = useActions();
  const workbench = useTui((s) => s.workbench);
  const [query, setQuery] = useState('');

  const allTabs = useMemo(
    () =>
      workbench.tabs.map((tab, index) => ({
        id: tab.id,
        index,
        title: tab.title,
        running: paneLeaves(tab.root).some((leaf) => leaf.content.attachment),
      })),
    [workbench.tabs],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allTabs;
    return allTabs.filter((tab) => tab.title.toLowerCase().includes(q));
  }, [allTabs, query]);

  const selection = useSelection(results.length);

  const jumpTo = (tab: (typeof allTabs)[number] | undefined): void => {
    if (!tab) return;
    onClose();
    actions.focusTab(tab.index);
  };

  useKeys((input, key) => {
    if (key.escape) return onClose();
    if (key.upArrow) return selection.move(-1);
    if (key.downArrow) return selection.move(1);
    if (key.return) return jumpTo(results[selection.index]);
    if (key.backspace || key.delete) return setQuery((q) => q.slice(0, -1));
    if (key.ctrl || key.meta || key.tab) return;
    // Digits jump straight to that 1-based tab, matching the numbers the
    // tab strip itself already shows — typing "2" need not go through the
    // filter/select flow at all when the target is already on screen.
    if (/^[0-9]$/.test(input) && !query) {
      const oneBased = Number(input);
      const direct = allTabs[oneBased - 1];
      if (direct) return jumpTo(direct);
    }
    if (key.ctrl || key.meta || key.tab || !input) return;
    setQuery((q) => q + input);
  });

  return (
    <Overlay title="Jump to tab" footer={`↑↓ move · ${prettyChord('return')} jump · 1-9 direct · Esc close`}>
      <Box marginBottom={1}>
        <Text color={theme.c('primary')}>{'> '}</Text>
        <Text>{query || <Text color={theme.c('muted')}>Type to filter, or press a number…</Text>}</Text>
        <Text inverse> </Text>
      </Box>

      <VirtualList
        items={results}
        selectedIndex={selection.index}
        height={12}
        emptyMessage="No tab matches."
        renderItem={(tab, _index, selected) => (
          <Text color={selected ? theme.c('primary') : undefined} wrap="truncate-end">
            {selected ? theme.glyphs.arrowRight : ' '}
            {` ${tab.index + 1} `}
            {tab.running ? `${theme.glyphs.running} ` : '  '}
            {tab.title}
            {tab.id === workbench.activeTabId ? <Text color={theme.c('muted')}>{'  (current)'}</Text> : null}
          </Text>
        )}
      />
    </Overlay>
  );
}

// ── Blocked work / notification queue (Phase 6 item 5) ─────────────
//
// Deliberately mirrors `TabNavigator` immediately above: a filtered list,
// Enter jumps. No design precedent existed anywhere in this codebase (or
// `apps/web`) for a cross-entity aggregation of pending gates, so rather
// than invent a new interaction shape, this reuses the one the tab
// navigator already proved — a list of "places," Enter goes there. Once
// jumped to, the pane's own existing `chat.respond`/`run.approve` handling
// resolves the gate; this overlay only ever navigates, never answers,
// keeping exactly one place in the code that actually resolves a gate.

function NotificationQueue({ onClose }: { onClose: () => void }): React.JSX.Element {
  const theme = useTheme();
  const actions = useActions();
  const workbench = useTui((s) => s.workbench);
  const timelines = useTui((s) => s.timelines);

  const items = useMemo(() => blockedWorkItems(workbench, timelines), [workbench, timelines]);
  const selection = useSelection(items.length);

  const jumpTo = (item: (typeof items)[number] | undefined): void => {
    if (!item) return;
    onClose();
    actions.jumpToPane(item.paneId);
  };

  useKeys((input, key) => {
    if (key.escape || input === 'q') return onClose();
    if (key.upArrow) return selection.move(-1);
    if (key.downArrow) return selection.move(1);
    if (key.return) return jumpTo(items[selection.index]);
  });

  return (
    <Overlay title="Blocked work" footer={`↑↓ move · ${prettyChord('return')} jump to pane · q / Esc close`}>
      <VirtualList
        items={items}
        selectedIndex={selection.index}
        height={12}
        emptyMessage="Nothing is waiting for you."
        renderItem={(item, _index, selected) => (
          // One row per item, matching `TabNavigator`'s convention just
          // above — `VirtualList`'s `height` prop is an item-count budget,
          // not a terminal-row one, so a taller multi-line row would blow
          // past the overlay's fixed viewport without it knowing.
          <Text color={selected ? theme.c('primary') : undefined} wrap="truncate-end">
            {selected ? theme.glyphs.arrowRight : ' '} {theme.glyphs.warning}{' '}
            <Text color={theme.c('warning')} bold>
              {item.tabTitle}
            </Text>{' '}
            {theme.glyphs.neutral} {item.paneTitle}
            <Text color={theme.c('muted')}> — {item.summary}</Text>
          </Text>
        )}
      />
    </Overlay>
  );
}

// ── Stage detail (Phase 6 item 4) ──────────────────────────────────
//
// `stages`/`variables` are a point-in-time snapshot fetched when this
// opened (`App.tsx`'s `openStageDetail`) — this overlay does not re-fetch
// while open, matching the terminal chooser's `select` overlay. Per-stage
// Run-wide hooks, though, DO need to be live: they come out of the pane's
// own timeline (`hook.*`), which is already reducer-maintained and keeps
// updating while this overlay is open.

function StageDetailOverlay({
  overlay,
  onClose,
}: {
  overlay: Extract<OverlayKind, { kind: 'stageDetail' }>;
  onClose: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const timeline = useTui((s) => s.timelines[overlay.paneId]);
  const selection = useSelection(overlay.stages.length);

  const selectedStage = overlay.stages[selection.index];
  // Hooks are run-wide, not stage-scoped (no producer correlates a hook to
  // a specific stage run) — shown once, not per selected stage.
  const hooks = useMemo(() => (timeline?.items ?? []).filter((item) => item.kind === 'hook'), [timeline]);

  useKeys((input, key) => {
    if (key.escape || input === 'q') return onClose();
    if (key.upArrow) return selection.move(-1);
    if (key.downArrow) return selection.move(1);
  });

  const statusColor = (status: string): string | undefined => {
    if (status === 'completed') return theme.c('success');
    if (status === 'failed') return theme.c('danger');
    if (status === 'running') return theme.c('running');
    return theme.c('muted');
  };

  return (
    <Overlay title="Stage detail" footer="↑↓ select stage · q / Esc close" height={22}>
      <Box flexDirection="column">
        <VirtualList
          items={overlay.stages}
          selectedIndex={selection.index}
          height={Math.min(6, overlay.stages.length)}
          emptyMessage="No stages."
          renderItem={(stage, _index, selected) => (
            <Text color={selected ? theme.c('primary') : undefined} wrap="truncate-end">
              {selected ? theme.glyphs.arrowRight : ' '}
              {' '}
              <Text color={statusColor(stage.status)}>{stage.status.padEnd(10)}</Text>
              {stage.name ?? stage.id}
              {(stage.attempts ?? 0) > 1 ? (
                <Text color={theme.c('warning')}>{`  retry ×${(stage.attempts ?? 1) - 1}`}</Text>
              ) : null}
            </Text>
          )}
        />

        {selectedStage ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={theme.c('primary')}>
              {selectedStage.name ?? selectedStage.id}
            </Text>
            <Text color={theme.c('muted')}>
              {selectedStage.startedAt ? `started ${formatRelative(selectedStage.startedAt)}` : 'not started'}
              {selectedStage.completedAt ? `  ·  completed ${formatRelative(selectedStage.completedAt)}` : ''}
            </Text>
            {selectedStage.error ? (
              <Text color={theme.c('danger')} wrap="wrap">
                {selectedStage.error}
              </Text>
            ) : null}
          </Box>
        ) : null}

        {hooks.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.c('muted')}>Hooks (this run)</Text>
            {hooks.slice(-5).map((hook) => (
              <Text key={hook.id}>
                {hook.hook?.status === 'error'
                  ? theme.glyphs.failure
                  : hook.hook?.status === 'complete'
                    ? theme.glyphs.success
                    : theme.glyphs.running}{' '}
                {hook.text}
                {hook.hook?.error ? <Text color={theme.c('danger')}>{`  ${hook.hook.error}`}</Text> : null}
              </Text>
            ))}
          </Box>
        ) : null}

        {Object.keys(overlay.variables).length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text color={theme.c('muted')}>Variables</Text>
            <JsonView value={overlay.variables} height={4} />
          </Box>
        ) : null}
      </Box>
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
    <Overlay title="Keyboard shortcuts" footer={`←→ page ${page + 1}/${pages} · q / Esc close`}>
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
    <Overlay title={message} footer={`${prettyChord('return')} confirm · Esc cancel`} height={7}>
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

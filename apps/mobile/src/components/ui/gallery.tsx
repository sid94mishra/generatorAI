// ────────────────────────────────────────────────────────────────
// UI gallery — every primitive, with example props, on one screen.
//
// A dev-only catalogue. It exists so a change to `Touchable` can be seen on
// forty controls at once instead of being discovered on a screen two weeks
// later, and so a screen author can see what a `tone="warning"` chip looks
// like before writing one.
//
// `UI_GALLERY_SECTIONS` is data so a route can list, search or deep-link
// into it; `<UiGallery/>` is the default rendering of that data. The route
// that mounts it lives outside this directory.
// ────────────────────────────────────────────────────────────────

import React, { useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { Archive, Bell, Copy, FolderGit2, Plus, Search, Share, Sparkles, Trash2 } from 'lucide-react-native';

import { Button, Fab, IconButton } from './Button';
import { Chip, StaticChip } from './Chip';
import { SegmentedControl, type Segment } from './SegmentedControl';
import { ListGroup, ListRow } from './ListRow';
import { Badge, Card, Divider, SectionHeader, StatusDot, Surface } from './primitives';
import { Skeleton, SkeletonCard, SkeletonList } from './Skeleton';
import { ProgressBar, ProgressRing } from './ProgressRing';
import { Sheet, SheetRow, SheetSection } from './Sheet';
import { ActionSheet, ConfirmSheet } from './ActionSheet';
import { ContextMenu, useContextMenu } from './ContextMenu';
import { Pager, type PagerHandle } from './Pager';
import { SwipeableRow } from './SwipeableRow';
import { useToast } from './Toast';
import { PlainScroll } from './Screen';
import { EmptyState, ErrorState, LoadingState, LockedState, Spinner } from './States';
import { Field, SearchField, Switch } from './Form';
import { KeyboardSticky } from './KeyboardSticky';
import { Touchable } from './Touchable';
import { useTheme } from '../../theme/ThemeProvider';

export interface GallerySection {
  id: string;
  title: string;
  /** One line: what it is for, and the prop worth knowing about. */
  description: string;
  /** Names of the props the example exercises, for the section's caption. */
  props: string[];
  render: () => React.ReactElement;
}

// ── Example components that need local state ────────────────────

function ChipsExample(): React.ReactElement {
  const [selected, setSelected] = useState<string>('Sonnet');
  const [tags, setTags] = useState(['infra', 'mobile']);
  const { colors } = useTheme();
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        {['Sonnet', 'Opus', 'Haiku'].map((m) => (
          <Chip key={m} label={m} selected={selected === m} onPress={() => setSelected(m)} showChevron />
        ))}
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Chip label="Neutral" tone="neutral" selected />
        <Chip label="Accent" tone="accent" selected icon={<Sparkles size={13} color={colors.primary} />} />
        <Chip label="Success" tone="success" selected />
        <Chip label="Warning" tone="warning" selected />
        <Chip label="Danger" tone="danger" selected />
        <Chip label="Disabled" disabled />
      </View>
      <View className="flex-row flex-wrap gap-2">
        {tags.map((t) => (
          <Chip
            key={t}
            label={`#${t}`}
            size="sm"
            selected
            tone="neutral"
            onRemove={() => setTags((prev) => prev.filter((x) => x !== t))}
          />
        ))}
        <Chip label="sm chip" size="sm" onPress={() => {}} />
        <StaticChip label="read-only" />
        <StaticChip label="a1b2c3d" mono size="sm" />
        <StaticChip label="running" tone="success" />
      </View>
    </View>
  );
}

const SEGMENTS: Segment<'all' | 'running' | 'done'>[] = [
  { value: 'all', label: 'All', count: 12 },
  { value: 'running', label: 'Running', count: 3 },
  { value: 'done', label: 'Done' },
];

function SegmentedExample(): React.ReactElement {
  const [value, setValue] = useState<'all' | 'running' | 'done'>('all');
  return <SegmentedControl segments={SEGMENTS} value={value} onChange={setValue} />;
}

function SheetExample(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [fit, setFit] = useState(false);
  const [detent, setDetent] = useState(2);
  return (
    <View className="flex-row flex-wrap gap-2">
      <Button label="Detented sheet" variant="secondary" size="sm" onPress={() => setOpen(true)} />
      <Button label="fitContent sheet" variant="secondary" size="sm" onPress={() => setFit(true)} />
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title={`Detent ${detent}`}
        detents={[0.28, 0.6, 0.92]}
        initialDetent={1}
        onDetentChange={setDetent}
      >
        <SheetSection title="Drag the body, header or grabber" />
        {Array.from({ length: 24 }, (_, i) => (
          <SheetRow key={i} title={`Row ${i + 1}`} subtitle="Scrolls only at the tallest detent" onPress={() => {}} />
        ))}
      </Sheet>
      <Sheet visible={fit} onClose={() => setFit(false)} title="Fit to content" detents={[0.6]} fitContent>
        <SheetRow title="One" selected onPress={() => setFit(false)} />
        <SheetRow title="Two" onPress={() => setFit(false)} />
      </Sheet>
    </View>
  );
}

function ActionSheetExample(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const { colors } = useTheme();
  return (
    <View className="flex-row flex-wrap gap-2">
      <Button label="ActionSheet" variant="secondary" size="sm" onPress={() => setOpen(true)} />
      <Button label="ConfirmSheet" variant="danger" size="sm" onPress={() => setConfirm(true)} />
      <ActionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Chat: Fix flaky test"
        actions={[
          { label: 'Copy link', icon: <Copy size={18} color={colors.foreground} />, onPress: () => {} },
          { label: 'Share', icon: <Share size={18} color={colors.foreground} />, onPress: () => {} },
          { label: 'Archive', icon: <Archive size={18} color={colors.foreground} />, onPress: () => {} },
          {
            label: 'Delete',
            destructive: true,
            icon: <Trash2 size={18} color={colors.danger} />,
            onPress: () => {},
          },
        ]}
      />
      <ConfirmSheet
        visible={confirm}
        onClose={() => setConfirm(false)}
        title="Delete this chat?"
        message="Its worktree and checkpoints are removed too."
        confirmLabel="Delete"
        onConfirm={() => {}}
      />
    </View>
  );
}

function ContextMenuExample(): React.ReactElement {
  const { colors } = useTheme();
  const { open } = useContextMenu();
  const items = [
    { label: 'Copy', icon: <Copy size={18} color={colors.foreground} />, onPress: () => {} },
    { label: 'Share', icon: <Share size={18} color={colors.foreground} />, onPress: () => {} },
    { label: 'Delete', destructive: true, onPress: () => {} },
  ];
  return (
    <View className="gap-2">
      <ContextMenu items={items} title="Message">
        <Surface className="p-3">
          <Text className="text-md text-foreground">Long-press me (wrapped, non-pressable child)</Text>
        </Surface>
      </ContextMenu>
      <ListGroup>
        <ListRow
          title="Long-press me (row with its own onLongPress)"
          subtitle="Uses useContextMenu(); needs ContextMenuProvider"
          onPress={() => {}}
          onLongPress={() => open(items, { title: 'Row' })}
        />
      </ListGroup>
    </View>
  );
}

function PagerExample(): React.ReactElement {
  const pager = useRef<PagerHandle>(null);
  const [index, setIndex] = useState(0);
  const progress = useSharedValue(0);
  const labels = ['Chat', 'Changes', 'Terminal', 'Browser'];
  return (
    <View className="gap-2">
      <View className="h-56 overflow-hidden rounded-3xl border border-border bg-card">
        <Pager
          ref={pager}
          count={labels.length}
          index={index}
          onIndexChange={setIndex}
          indicator="labels"
          labels={labels}
          progress={progress}
          renderPage={(i, active) => (
            <View className="flex-1 items-center justify-center gap-1 p-4">
              <Text className="text-lg font-semibold text-foreground">{labels[i]}</Text>
              <Text className="text-sm text-muted-foreground">
                {active ? 'active' : 'mounted, inactive'} · swipe from ≥24pt inside
              </Text>
            </View>
          )}
        />
      </View>
      <View className="flex-row gap-2">
        <Button label="Prev" size="sm" variant="secondary" onPress={() => pager.current?.goTo(index - 1)} />
        <Button label="Next" size="sm" variant="secondary" onPress={() => pager.current?.goTo(index + 1)} />
      </View>
    </View>
  );
}

function ToastExample(): React.ReactElement {
  const toast = useToast();
  return (
    <View className="flex-row flex-wrap gap-2">
      <Button label="Info" size="sm" variant="secondary" onPress={() => toast({ message: 'Copied.' })} />
      <Button
        label="Success"
        size="sm"
        variant="secondary"
        onPress={() =>
          toast({ message: 'Archived.', variant: 'success', action: { label: 'Undo', onPress: () => {} } })
        }
      />
      <Button
        label="Warning"
        size="sm"
        variant="secondary"
        onPress={() => toast({ message: 'Reconnecting…', variant: 'warning', duration: 6000 })}
      />
      <Button
        label="Danger"
        size="sm"
        variant="secondary"
        onPress={() => toast({ message: 'Could not send.', variant: 'danger' })}
      />
    </View>
  );
}

function FormExample(): React.ReactElement {
  const [on, setOn] = useState(true);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  return (
    <View className="gap-3">
      <SearchField value={query} onChangeText={setQuery} placeholder="Search chats" onCancel={() => {}} />
      <Field label="Name" hint="Shown in the chat list" value={name} onChangeText={setName} />
      <Field label="With error" error="Required" value="" onChangeText={() => {}} />
      <View className="flex-row items-center justify-between">
        <Text className="text-md text-foreground">Switch</Text>
        <Switch value={on} onValueChange={setOn} accessibilityLabel="Example switch" />
      </View>
    </View>
  );
}

function SwipeableExample(): React.ReactElement {
  const { colors } = useTheme();
  return (
    <ListGroup>
      <SwipeableRow
        actions={[
          {
            label: 'Archive',
            tone: 'primary',
            icon: <Archive size={18} color={colors['primary-foreground']} />,
            onPress: () => {},
          },
          {
            label: 'Delete',
            tone: 'danger',
            icon: <Trash2 size={18} color={colors['destructive-foreground']} />,
            onPress: () => {},
          },
        ]}
      >
        <ListRow title="Swipe me left" subtitle="Full swipe arms the first action" onPress={() => {}} />
      </SwipeableRow>
    </ListGroup>
  );
}

function KeyboardStickyExample(): React.ReactElement {
  const [text, setText] = useState('');
  return (
    <KeyboardSticky mode="padding">
      <Field placeholder="Focus me — the field stays above the keyboard" value={text} onChangeText={setText} />
    </KeyboardSticky>
  );
}

// ── The catalogue ───────────────────────────────────────────────

export const UI_GALLERY_SECTIONS: GallerySection[] = [
  {
    id: 'button',
    title: 'Button / IconButton / Fab',
    description: 'Labelled bar, circular 44pt target, floating action.',
    props: ['variant', 'size', 'icon', 'loading', 'disabled', 'full', 'haptic'],
    render: () => <ButtonsExample />,
  },
  {
    id: 'chip',
    title: 'Chip / StaticChip',
    description: 'A value, not an action. Colour appears only when selected.',
    props: ['tone', 'size', 'icon', 'selected', 'onPress', 'onRemove', 'showChevron'],
    render: () => <ChipsExample />,
  },
  {
    id: 'segmented',
    title: 'SegmentedControl',
    description: 'Peer views. Indicator springs; pass `progress` from a Pager to track a drag.',
    props: ['segments', 'value', 'onChange', 'haptic', 'progress'],
    render: () => <SegmentedExample />,
  },
  {
    id: 'badge',
    title: 'Badge / StatusDot / SectionHeader / Divider',
    description: 'Status is icon + label, never colour alone.',
    props: ['tone', 'label', 'ring'],
    render: () => <BadgesExample />,
  },
  {
    id: 'list',
    title: 'ListRow / ListGroup',
    description: 'The grouped-list row. `toggle` makes the whole row one switch.',
    props: ['title', 'subtitle', 'icon', 'trailing', 'chevron', 'toggle', 'destructive', 'onLongPress'],
    render: () => <ListExample />,
  },
  {
    id: 'swipe',
    title: 'SwipeableRow',
    description: 'Trailing actions revealed by drag; arming haptic at 50%.',
    props: ['actions', 'enabled'],
    render: () => <SwipeableExample />,
  },
  {
    id: 'card',
    title: 'Card / Surface',
    description: 'The elevation ladder: background → card → raised.',
    props: ['className'],
    render: () => <CardsExample />,
  },
  {
    id: 'sheet',
    title: 'Sheet',
    description: 'Drag anywhere; velocity-aware detents; keyboard-aware; reduce-motion jumps.',
    props: ['detents', 'initialDetent', 'fitContent', 'scrollable', 'persistent', 'keyboardAware', 'onDetentChange'],
    render: () => <SheetExample />,
  },
  {
    id: 'actionsheet',
    title: 'ActionSheet / ConfirmSheet',
    description: 'Bottom-anchored actions with a subject line and a separated Cancel.',
    props: ['title', 'message', 'actions', 'confirmLabel', 'destructive'],
    render: () => <ActionSheetExample />,
  },
  {
    id: 'contextmenu',
    title: 'ContextMenu / useContextMenu',
    description: 'Long-press menu on the ActionSheet. Component for bubbles, hook for rows.',
    props: ['items', 'title', 'onPress', 'longPressDelay', 'open(items, options)'],
    render: () => <ContextMenuExample />,
  },
  {
    id: 'pager',
    title: 'Pager / PagerIndicator',
    description: 'Swipeable panes on the UI thread; leftmost 24pt left to the back gesture.',
    props: [
      'count',
      'index',
      'onIndexChange',
      'renderPage',
      'indicator',
      'labels',
      'progress',
      'simultaneousHandlers',
      'preload',
      'ref.goTo',
    ],
    render: () => <PagerExample />,
  },
  {
    id: 'toast',
    title: 'Toast',
    description: 'Top-anchored transient outcome. Swipe up to dismiss.',
    props: ['message', 'variant', 'action', 'duration'],
    render: () => <ToastExample />,
  },
  {
    id: 'form',
    title: 'Switch / Field / SearchField',
    description: 'Labelled inputs; the search field carries platform search behaviour.',
    props: ['label', 'hint', 'error', 'onCancel', 'onFocus', 'onBlur'],
    render: () => <FormExample />,
  },
  {
    id: 'keyboardsticky',
    title: 'KeyboardSticky',
    description: 'Docks its child above the keyboard (iOS); a no-op wrapper under Android resize.',
    props: ['offset', 'mode', 'enabled'],
    render: () => <KeyboardStickyExample />,
  },
  {
    id: 'progress',
    title: 'ProgressRing / ProgressBar',
    description: 'Usage and completion. Tone flips at the usage thresholds.',
    props: ['ratio', 'size', 'stroke', 'label'],
    render: () => <ProgressExample />,
  },
  {
    id: 'skeleton',
    title: 'Skeleton',
    description: 'One shared pulse for every placeholder; static under Reduce Motion.',
    props: ['width', 'height', 'radius', 'rows'],
    render: () => (
      <View className="gap-3">
        <SkeletonCard />
        <SkeletonList rows={3} />
        <Skeleton width="60%" height={14} />
      </View>
    ),
  },
  {
    id: 'states',
    title: 'Spinner / Loading / Empty / Error / Locked',
    description: 'The four states every list has; "nothing" and "not allowed" are different facts.',
    props: ['title', 'message', 'action', 'onRetry', 'reason'],
    render: () => (
      <View className="gap-2">
        <View className="flex-row items-center gap-3">
          <Spinner />
          <Spinner tone="primary" size="large" />
        </View>
        <LoadingState label="Loading runs" />
        <EmptyState
          title="No chats yet"
          message="Start one from the button below."
          action={{ label: 'New chat', onPress: () => {} }}
        />
        <ErrorState message="The server did not answer." onRetry={() => {}} />
        <LockedState
          title="Terminal unavailable"
          reason="This device does not have the exec:terminal scope."
          action={{ label: 'Request access', onPress: () => {} }}
        />
      </View>
    ),
  },
  {
    id: 'touchable',
    title: 'Touchable',
    description: 'The tap primitive under everything: UI-thread scale, haptic intent, 44pt target.',
    props: ['scale', 'haptic', 'a11yRole', 'ripple'],
    render: () => (
      <View className="flex-row flex-wrap gap-2">
        <Touchable onPress={() => {}} className="rounded-2xl bg-raised px-4 py-3">
          <Text className="text-md text-foreground">default</Text>
        </Touchable>
        <Touchable onPress={() => {}} scale="large" haptic="select" className="rounded-2xl bg-raised px-4 py-3">
          <Text className="text-md text-foreground">large · select</Text>
        </Touchable>
        <Touchable onPress={() => {}} scale="none" haptic="commit" className="rounded-2xl bg-raised px-4 py-3">
          <Text className="text-md text-foreground">none · commit</Text>
        </Touchable>
      </View>
    ),
  },
];

function ButtonsExample(): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        <Button label="Primary" onPress={() => {}} />
        <Button label="Secondary" variant="secondary" onPress={() => {}} />
        <Button label="Ghost" variant="ghost" onPress={() => {}} />
        <Button label="Danger" variant="danger" onPress={() => {}} />
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Button label="Small" size="sm" onPress={() => {}} />
        <Button
          label="Large"
          size="lg"
          icon={<Plus size={18} color={colors['primary-foreground']} />}
          onPress={() => {}}
        />
        <Button label="Loading" loading onPress={() => {}} />
        <Button label="Disabled" disabled onPress={() => {}} />
      </View>
      <Button label="Full width" full onPress={() => {}} />
      <View className="flex-row items-center gap-2">
        <IconButton
          accessibilityLabel="Search"
          icon={<Search size={20} color={colors.foreground} />}
          onPress={() => {}}
        />
        <IconButton
          accessibilityLabel="Notifications"
          badge
          icon={<Bell size={20} color={colors.foreground} />}
          onPress={() => {}}
        />
        <IconButton
          accessibilityLabel="Compact"
          compact
          variant="secondary"
          icon={<Plus size={16} color={colors.foreground} />}
          onPress={() => {}}
        />
        <IconButton
          accessibilityLabel="Selected"
          selected
          variant="primary"
          icon={<Sparkles size={18} color={colors['primary-foreground']} />}
          onPress={() => {}}
        />
      </View>
      <View className="h-24">
        <Fab
          accessibilityLabel="New chat"
          label="New"
          icon={<Plus size={22} color={colors['primary-foreground']} />}
          onPress={() => {}}
          offset={-8}
        />
      </View>
    </View>
  );
}

function BadgesExample(): React.ReactElement {
  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        <Badge label="Neutral" />
        <Badge label="Primary" tone="primary" />
        <Badge label="Success" tone="success" />
        <Badge label="Warning" tone="warning" />
        <Badge label="Danger" tone="danger" />
        <Badge label="Info" tone="info" />
      </View>
      <View className="flex-row items-center gap-3">
        <StatusDot tone="success" label="Running" />
        <StatusDot tone="warning" ring label="Waiting for you" />
        <StatusDot tone="danger" label="Failed" />
        <StatusDot tone="neutral" label={null} />
      </View>
      <SectionHeader title="Section header" action={<Text className="text-sm text-primary">Action</Text>} />
      <Divider />
    </View>
  );
}

function ListExample(): React.ReactElement {
  const { colors } = useTheme();
  const [on, setOn] = useState(false);
  return (
    <ListGroup>
      <ListRow
        title="Project"
        subtitle="generatorai"
        icon={<FolderGit2 size={18} color={colors.foreground} />}
        onPress={() => {}}
      />
      <ListRow
        title="Notifications"
        toggle={{ value: on, onValueChange: setOn }}
        icon={<Bell size={18} color={colors.foreground} />}
      />
      <ListRow title="Selected" selected onPress={() => {}} trailing={<Badge label="3" tone="primary" />} />
      <ListRow
        title="Delete everything"
        destructive
        icon={<Trash2 size={18} color={colors.danger} />}
        onPress={() => {}}
        chevron={false}
      />
      <ListRow title="Disabled" disabled subtitle="Needs the admin scope" />
    </ListGroup>
  );
}

function CardsExample(): React.ReactElement {
  return (
    <Card className="gap-2 p-4">
      <Text className="text-md font-semibold text-foreground">Card</Text>
      <Surface className="p-3">
        <Text className="text-sm text-muted-foreground">Surface — one step above the card.</Text>
      </Surface>
    </Card>
  );
}

function ProgressExample(): React.ReactElement {
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-4">
        <ProgressRing ratio={0.32} />
        <ProgressRing ratio={0.78} />
        <ProgressRing ratio={0.95} />
      </View>
      <ProgressBar ratio={0.32} />
      <ProgressBar ratio={0.95} />
    </View>
  );
}

/**
 * The default rendering. Wrap in `<Screen title="UI gallery">` (with
 * `scroll={false}`) and, for the hook example, `<ContextMenuProvider>`.
 */
export function UiGallery({ sections = UI_GALLERY_SECTIONS }: { sections?: GallerySection[] }): React.ReactElement {
  return (
    <PlainScroll>
      {sections.map((section) => (
        <View key={section.id} className="gap-2">
          <SectionHeader title={section.title} />
          <Text className="text-sm text-muted-foreground">{section.description}</Text>
          <Text className="font-mono text-xs text-muted-foreground">{section.props.join(' · ')}</Text>
          <Card className="p-4">{section.render()}</Card>
        </View>
      ))}
    </PlainScroll>
  );
}

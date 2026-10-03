// M10-04 static accessibility sweep (08 §4.8; MD-28, MD-195): every kit and block story is rendered on both platform
// projects and its host tree is checked for what a screen reader needs and Jest can see — every actionable element
// (pressable, or a button / link / switch / checkbox / radio / tab / menu item / adjustable role) exposes an accessible
// name, no actionable element is hidden from assistive tech, and no text opts out of Dynamic Type. Contrast is the
// palette test (theme/contrast.test.ts); hit frames are `hitFrameFor` (ui/platform tests) plus the device snapshot
// checker (e2e/a11y-check.mjs). Stories whose native hosts cannot render under Jest are listed, not skipped silently.
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import type * as ReactNative from 'react-native';
import { render } from '@testing-library/react-native';

import { themed } from './themed';

const ROLES = new Set(['button', 'link', 'switch', 'checkbox', 'radio', 'tab', 'menuitem', 'adjustable', 'togglebutton', 'imagebutton']);

/**
 * Story files Jest cannot load (a native view manager at module level); audited on device instead (a11y-check,
 * XCUITest audit). A file that fails to load and is not listed fails the sweep.
 */
const NATIVE_ONLY: Record<string, string> = {
  'GlassSurface.stories.tsx': 'expo-glass-effect registers its native view at import',
};

interface HostNode {
  type: string;
  props: Record<string, unknown>;
  children: Array<HostNode | string> | null;
}

function textOf(node: HostNode | string): string {
  if (typeof node === 'string') return node;
  if (node.props.accessible === false) return '';
  return (node.children ?? []).map(textOf).join('');
}

function accessibleName(node: HostNode): string {
  const label = node.props.accessibilityLabel ?? node.props['aria-label'];
  if (typeof label === 'string' && label.trim()) return label.trim();
  return textOf(node).trim();
}

function findings(root: HostNode | HostNode[] | null): string[] {
  const out: string[] = [];
  const visit = (node: HostNode | string, hidden: boolean): void => {
    if (typeof node === 'string') return;
    const p = node.props;
    const hiddenHere = hidden || p.accessibilityElementsHidden === true || p.importantForAccessibility === 'no-hide-descendants' || p['aria-hidden'] === true;
    const role = (p.accessibilityRole ?? p.role) as string | undefined;
    // Host views of RN pressables carry onClick (and the responder handlers), not onPress.
    const pressable = typeof p.onPress === 'function' || typeof p.onClick === 'function';
    const actionable = pressable || (role !== undefined && ROLES.has(role));
    const disabled = (p.accessibilityState as { disabled?: boolean } | undefined)?.disabled === true;
    if (actionable && !hiddenHere && p.accessible !== false && !disabled) {
      const id = typeof p.testID === 'string' ? ` #${p.testID}` : '';
      if (!accessibleName(node)) out.push(`${node.type}${id} (${role ?? 'pressable'}) has no accessible name`);
      if (role === undefined && pressable) out.push(`${node.type}${id} is pressable without a role`);
    }
    if (p.allowFontScaling === false) out.push(`${node.type} turns off font scaling`);
    for (const child of node.children ?? []) visit(child, hiddenHere);
  };
  for (const node of Array.isArray(root) ? root : root ? [root] : []) visit(node, false);
  return out;
}

function storyFiles(): string[] {
  const roots = ['ui', 'blocks'].map((dir) => path.join(__dirname, '..', '..', dir));
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.stories.tsx')) files.push(full);
    }
  };
  roots.forEach(walk);
  return files.sort();
}

type StoryModule = { default: { title: string; component?: React.ComponentType<Record<string, unknown>>; args?: Record<string, unknown>; render?: (args: Record<string, unknown>) => React.ReactElement } } & Record<string, unknown>;

type Case = { id: string; meta?: StoryModule['default']; story?: { args?: Record<string, unknown>; render?: (args: Record<string, unknown>) => React.ReactElement }; loadError?: string };

const cases: Case[] = storyFiles().flatMap((file): Case[] => {
  const base = path.basename(file);
  if (NATIVE_ONLY[base]) return [];
  let mod: StoryModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest loads each story module by path
    mod = require(file) as StoryModule;
  } catch (error) {
    return [{ id: base, loadError: (error as Error).message.split('\n')[0] }];
  }
  const meta = mod.default;
  return Object.entries(mod)
    .filter(([name, story]) => name !== 'default' && story && typeof story === 'object')
    .map(([name, story]) => ({ id: `${meta.title} › ${name}`, meta, story: story as { args?: Record<string, unknown>; render?: (args: Record<string, unknown>) => React.ReactElement } }));
});

describe('kit and block stories: accessible names, exposure, Dynamic Type', () => {
  it('finds the stories', () => {
    expect(cases.length).toBeGreaterThan(80);
  });
  it('flags what it is meant to flag', async () => {
    const { Pressable: RNPressable, Text: RNText, View } = jest.requireActual<typeof ReactNative>('react-native');
    const screen = await render(
      <View>
        <RNPressable onPress={() => undefined} accessibilityRole="button" testID="unnamed" />
        <RNPressable onPress={() => undefined} testID="roleless">
          <RNText>Go</RNText>
        </RNPressable>
        <RNText allowFontScaling={false}>Fixed</RNText>
        <RNPressable onPress={() => undefined} accessibilityRole="button" accessibilityLabel="Named" />
      </View>,
    );
    const found = findings(screen.toJSON() as HostNode);
    expect(found.some((f) => f.includes('#unnamed') && f.includes('no accessible name'))).toBe(true);
    expect(found.some((f) => f.includes('#roleless') && f.includes('without a role'))).toBe(true);
    expect(found.some((f) => f.includes('turns off font scaling'))).toBe(true);
    expect(found.some((f) => f.includes('Named'))).toBe(false);
    screen.unmount();
  });
  it.each(cases.map((c) => [c.id, c] as const))('%s', async (id, { meta, story, loadError }) => {
    if (loadError || !meta || !story) throw new Error(`${id} does not load under Jest (${loadError}); list it in NATIVE_ONLY with the reason`);
    const args = { ...(meta.args ?? {}), ...(story.args ?? {}) };
    const render$ = story.render ?? meta.render;
    const Component = meta.component;
    const element = render$ ? render$(args) : Component ? <Component {...args} /> : null;
    if (!element) throw new Error(`${id}: no component or render`);
    const screen = await render(themed(element));
    expect(findings(screen.toJSON() as HostNode | HostNode[] | null)).toEqual([]);
    screen.unmount();
  });
});

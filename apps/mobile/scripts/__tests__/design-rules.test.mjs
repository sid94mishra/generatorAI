import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { compareCounts } from '../check-design.mjs';
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const eslint = new ESLint({ cwd: root });
async function messages(source, file = 'src/ui/primitives/LintProbe.tsx') {
  const [result] = await eslint.lintText(source, { filePath: `${root}apps/mobile/${file}` });
  return result.messages;
}
const has = (messages, id) => messages.some((m) => m.messageId === id || m.ruleId === id);

test('kit rejects arbitrary/palette/default sizing, raw colors and missing stories', async () => {
  const result = await messages(`import {View} from 'react-native'; export const Probe = () => <View className="bg-red-500 text-xs w-[437px] md:flex dark:bg-white h-row font-bold" style={{backgroundColor:'#ffffff'}} />;`);
  for (const id of ['hardcodedPaletteClass', 'defaultTextSize', 'arbitraryValue', 'whiteBlackClass', 'defaultBreakpoint', 'darkVariant', 'fixedRowHeight', 'boldWeight', 'hexOrRgbInTs', 'literalInlineStyle', 'storiesPresent']) assert.ok(has(result, id), id);
  assert.ok(result.filter((m) => m.ruleId === 'mobile-design/design').every((m) => m.severity === 2));
});
test('unknown class is rejected by the real Tailwind compiler', async () => {
  assert.ok(has(await messages(`import {View} from 'react-native'; export const Probe = () => <View className="not-a-real-mobile-utility" />;`), 'better-tailwindcss/no-unknown-classes'));
});
test('shared vocabulary is accepted before M3 native emission', async () => {
  const result = await messages(`import {View} from 'react-native'; export const Probe = () => <View className="bg-surface text-fg-2 rounded-card min-h-row flex-1" />;`);
  assert.ok(!has(result, 'better-tailwindcss/no-unknown-classes'));
  assert.equal(result.filter((m) => m.ruleId === 'mobile-design/design' && m.messageId !== 'storiesPresent').length, 0);
});
test('ui cannot reach legacy data or router hooks; platform imports are confined', async () => {
  const result = await messages(`import {Button as useAuth} from '../../components/ui/Button'; import {useRouter} from 'expo-router'; import {Platform as Device} from 'react-native'; export const value = [useAuth,useRouter,Device];`);
  for (const id of ['boundaries/dependencies', 'routerPresentation', 'platformOs']) assert.ok(has(result, id), id);
});
test('router adapter admits presentational imports only', async () => {
  assert.ok(!has(await messages(`import {Stack} from 'expo-router'; export const option = Stack.Screen;`, 'src/ui/native/router/Header.tsx'), 'routerPresentation'));
  assert.ok(has(await messages(`import {router} from 'expo-router'; export const navigate = router.push;`, 'src/ui/native/router/Header.tsx'), 'routerPresentation'));
  assert.ok(has(await messages(`export * from 'expo-router';`, 'src/ui/native/router/Header.tsx'), 'routerPresentation'));
});
test('features use queries and kit controls; stories only relax raw elements', async () => {
  const source = `import {Text} from 'react-native'; import {useQuery} from '@tanstack/react-query'; export const Probe = () => <Text className="text-xs">hi</Text>;`;
  const result = await messages(source, 'src/features/lint-probe/Screen.tsx');
  assert.ok(has(result, 'rawTextImport'));
  assert.ok(has(result, 'featureData'));
  assert.ok(!has(await messages(source, 'src/features/lint-probe/queries.tsx'), 'featureData'));
  const story = await messages(source, 'src/features/lint-probe/Screen.stories.tsx');
  assert.ok(!has(story, 'rawTextImport'));
  assert.ok(has(story, 'defaultTextSize'));
});
test('new routes are hard zero even with legacy routes grandfathered', async () => {
  const result = await messages(`import {Platform} from 'react-native'; export const value = Platform.OS;`, 'app/lint-probe.tsx');
  assert.ok(result.some((m) => m.messageId === 'platformOs' && m.severity === 2));
});
test('compiler diagnostics are errors in new layers', async () => {
  const result = await messages(`import {useState} from 'react'; export function useProbe(flag:boolean) { if(flag) return useState(0); return null; }`, 'src/ui/lib/useProbe.ts');
  assert.ok(result.some((m) => m.ruleId === 'react-hooks/rules-of-hooks' && m.severity === 2));
});
test('per-file allowance cannot move, grow or be silently reset', () => {
  const baseline = {'src/legacy.ts': {palette: 2}};
  assert.deepEqual(compareCounts({'src/legacy.ts': {palette: 1}}, baseline), []);
  assert.equal(compareCounts({'src/legacy.ts': {palette: 3}}, baseline).length, 1);
  assert.equal(compareCounts({'src/new.ts': {palette: 1}}, baseline).length, 1);
  assert.equal(compareCounts({}, baseline, true).length, 1);
});

test('Tailwind class extraction follows a named class string', async () => {
  const result = await messages(`import {View} from 'react-native'; const className = 'text-xs'; export const Probe = () => <View className={className} />;`);
  assert.ok(has(result, 'better-tailwindcss/no-restricted-classes'));
});

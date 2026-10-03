// The builder group (04 §1.1: nested Stack; `(app)/_layout` presents the group as a full-screen modal, MD-21). The
// builder list is the group's root; its sheets (validate, versions, add stage, loop settings) present over it, so a
// link to a sheet still opens with the builder beneath (initialRouteName). Presentation from ui/platform (MD-21).
import React from 'react';
import { Stack } from 'expo-router';

import { sheetOptions, useStackScreenOptions } from '../../../../../src/ui/platform';

export const unstable_settings = { initialRouteName: 'index' };

const PICKER_SHEETS = ['validate', 'add-stage'];
const LARGE_SHEETS = ['versions', 'loop/[stageKey]'];

export default function BuilderLayout(): React.ReactElement {
  const screenOptions = useStackScreenOptions();
  return (
    <Stack screenOptions={screenOptions}>
      <Stack.Screen name="index" />
      {PICKER_SHEETS.map((name) => (
        <Stack.Screen key={name} name={name} options={sheetOptions('picker')} />
      ))}
      {LARGE_SHEETS.map((name) => (
        <Stack.Screen key={name} name={name} options={sheetOptions('large')} />
      ))}
    </Stack>
  );
}

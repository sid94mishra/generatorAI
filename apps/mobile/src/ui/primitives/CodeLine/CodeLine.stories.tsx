import React from 'react';
import { View } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { CodeLine } from './CodeLine';

function Lines({ wrap = false, fontSize = 12 }: { wrap?: boolean; fontSize?: number }): React.ReactElement {
  return (
    <View>
      <CodeLine text="  const cart = useCart.getState();" kind="context" oldNumber={18} newNumber={18} dualGutter gutterWidth={24} fontSize={fontSize} wrap={wrap} language="ts" />
      <CodeLine text="  await api.applyCoupon(code);" kind="del" oldNumber={19} dualGutter gutterWidth={24} fontSize={fontSize} wrap={wrap} language="ts" onPressGutter={() => undefined} />
      <CodeLine text="  setTotals(recalculate(cart, discount)); // a long line that wraps when wrap is on" kind="add" newNumber={20} dualGutter gutterWidth={24} fontSize={fontSize} wrap={wrap} language="ts" selected commentCount={1} onPressGutter={() => undefined} onPressComments={() => undefined} />
      <CodeLine text="export function recalculate(cart: Cart, d = 0) {" kind="plain" newNumber={69} gutterWidth={28} fontSize={fontSize} wrap={wrap} language="ts" changed />
      <CodeLine text="}" kind="plain" newNumber={70} gutterWidth={28} fontSize={fontSize} wrap={wrap} language="ts" noNewline />
    </View>
  );
}

function CodeLineGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Diff: context, removed, added (selected, comment), preview changed bar, no newline">
        <Lines />
      </StorySection>
      <StorySection title="Wrapped at 14 pt">
        <Lines wrap fontSize={14} />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <Lines />
        </WithFontScale>
        <RightToLeft>
          <Lines />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Lines />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/CodeLine', component: CodeLineGallery } satisfies Meta<typeof CodeLineGallery>;
export default meta;
export const States: StoryObj<typeof meta> = {};

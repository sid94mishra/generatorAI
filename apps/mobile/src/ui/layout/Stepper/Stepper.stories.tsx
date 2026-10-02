import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Stepper } from './Stepper';

const WIZARD = ['Basics', 'Trigger', 'Workflow & permission', 'Dataset', 'Variables & retry', 'Review'].map((label, i) => ({ id: String(i), label }));
const INLINE = ['Request', 'Admin approves', 'Edit'].map((label, i) => ({ id: String(i), label }));

function StepperGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Automation wizard, six pages (MD-66): first, middle, last">
        <Stepper steps={WIZARD} current={0} done={[]} />
        <Stepper steps={WIZARD} current={2} done={[0, 1]} />
        <Stepper steps={WIZARD} current={5} done={[0, 1, 2, 3, 4]} />
      </StorySection>
      <StorySection title="Inline (scope request)">
        <Stepper steps={INLINE} current={1} done={[0]} variant="inline" />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <Stepper steps={WIZARD} current={2} done={[0, 1]} />
        </WithFontScale>
        <RightToLeft>
          <Stepper steps={WIZARD} current={2} done={[0, 1]} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <Stepper steps={WIZARD} current={2} done={[0, 1]} />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/Stepper', component: StepperGallery } satisfies Meta<typeof StepperGallery>;
export default meta;
export const Wizard: StoryObj<typeof meta> = {};

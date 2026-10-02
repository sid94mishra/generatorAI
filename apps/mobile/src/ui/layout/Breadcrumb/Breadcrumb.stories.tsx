import React from 'react';
import { Alert } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { LONG_TEXT, RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { Breadcrumb, BreadcrumbTitle } from './Breadcrumb';

const go = (label: string) => () => Alert.alert('Go to', label);
const TWO = [{ label: 'Chats', onPress: go('Chats') }, { label: 'payments-service', onPress: go('payments-service') }];
const DEEP = [
  { label: 'Workflows', onPress: go('Workflows') },
  { label: 'Nightly dependency audit', onPress: go('Nightly') },
  { label: 'Run 248', onPress: go('Run') },
  { label: 'Assess risk', onPress: go('Stage') },
  { label: 'Step 4 of 6' },
];

function BreadcrumbGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Two levels, deep (middle collapses to … menu; last is plain text)">
        <Breadcrumb segments={TWO} />
        <Breadcrumb segments={DEEP} />
      </StorySection>
      <StorySection title="Title view (iOS header, centred) and Android title block (start)">
        <BreadcrumbTitle breadcrumb={TWO} title="Fix flaky checkout test" />
        <BreadcrumbTitle breadcrumb={TWO} title="Fix flaky checkout test" align="start" />
        <BreadcrumbTitle breadcrumb={TWO} title={LONG_TEXT} />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <BreadcrumbTitle breadcrumb={TWO} title="Fix flaky checkout test" />
        </WithFontScale>
        <RightToLeft>
          <Breadcrumb segments={TWO} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <BreadcrumbTitle breadcrumb={TWO} title="Fix flaky checkout test" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Layout/Breadcrumb', component: BreadcrumbGallery } satisfies Meta<typeof BreadcrumbGallery>;
export default meta;
export const Trails: StoryObj<typeof meta> = {};

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { RightToLeft, StoryPage, StorySection, ThemeMatrix, WithFontScale } from '../../storybook/StoryKit';
import { PermissionState } from './PermissionState';
import type { PermissionKind } from './PermissionState.types';

const noop = (): void => undefined;
const OS: PermissionKind[] = ['camera', 'microphone', 'notifications', 'biometrics', 'localNetwork'];

function PermissionStateGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="OS permissions: not determined (Allow) and denied (Open Settings)">
        {OS.map((kind) => (
          <React.Fragment key={kind}>
            <PermissionState kind={kind} status="undetermined" onRequest={noop} />
            <PermissionState kind={kind} status="denied" />
          </React.Fragment>
        ))}
        <PermissionState kind="camera" status="restricted" />
      </StorySection>
      <StorySection title="Server scope (Request access) and the app-lock overlay (Unlock)">
        <PermissionState kind="scope" status="missing-scope" scope="Manage devices" onRequest={noop} />
        <PermissionState kind="app-lock" status="locked" onRequest={noop} />
      </StorySection>
      <StorySection title="Font scale 2.0, right to left">
        <WithFontScale scale={2}>
          <PermissionState kind="notifications" status="denied" />
        </WithFontScale>
        <RightToLeft>
          <PermissionState kind="camera" status="undetermined" onRequest={noop} />
        </RightToLeft>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <PermissionState kind="camera" status="denied" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/PermissionState', component: PermissionStateGallery } satisfies Meta<typeof PermissionStateGallery>;
export default meta;
export const KindsAndStatuses: StoryObj<typeof meta> = {};

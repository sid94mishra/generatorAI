import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StoryPage, StoryRow, StorySection, ThemeMatrix } from '../../storybook/StoryKit';
import { QrCode } from './QrCode';

// Not a real pairing link: a placeholder payload to show the drawing.
const PAYLOAD = 'generatorai://pair?server=storybook&code=EXAMPLE00000';

function QrCodeGallery(): React.ReactElement {
  return (
    <StoryPage>
      <StorySection title="Default 200, small 120 (dark-on-light in every mode)">
        <StoryRow>
          <QrCode value={PAYLOAD} label="Pairing QR code" />
          <QrCode value={PAYLOAD} size={120} label="Pairing QR code" />
        </StoryRow>
      </StorySection>
      <StorySection title="Theme matrix">
        <ThemeMatrix>
          <QrCode value={PAYLOAD} size={120} label="Pairing QR code" />
        </ThemeMatrix>
      </StorySection>
    </StoryPage>
  );
}

const meta = { title: 'UI/Primitives/QrCode', component: QrCodeGallery } satisfies Meta<typeof QrCodeGallery>;
export default meta;
export const Codes: StoryObj<typeof meta> = {};

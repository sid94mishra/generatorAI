import type { StorybookConfig } from '@storybook/react-native';
const config: StorybookConfig = {
  stories: ['../src/ui/**/*.stories.tsx', '../src/blocks/**/*.stories.tsx'],
  deviceAddons: ['@storybook/addon-ondevice-controls', '@storybook/addon-ondevice-actions'],
};
export default config;

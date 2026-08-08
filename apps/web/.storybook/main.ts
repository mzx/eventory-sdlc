import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs', '@storybook/addon-mcp'],
  framework: '@storybook/react-vite',
  // Serves fixture responses for the app's real asset routes so stories render
  // exactly what production renders: /api/qr/<token> (QR sticker PNGs) and
  // /storage/<filename> (item photos).
  staticDirs: ['./public'],
  viteFinal: async (config) => {
    // Storybook inherits the app's vite.config.ts plugins. The PWA service
    // worker is meaningless in the component workbench and its workbox
    // precache step hard-fails on Storybook's >2MiB manager bundle.
    config.plugins = (config.plugins ?? [])
      .flat()
      .filter(
        (p) => !(p && typeof p === 'object' && 'name' in p && p.name.startsWith('vite-plugin-pwa')),
      );
    return config;
  },
};
export default config;

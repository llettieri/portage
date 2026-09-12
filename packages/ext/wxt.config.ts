import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: 'Portage',
    description: 'Send the current tab to another device via Portage.',
    permissions: ['storage', 'tabs', 'alarms'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'portage@lettieri.dev',
              strict_min_version: '142.0',
              data_collection_permissions: {
                required: ['browsingActivity'],
              },
            },
          },
        }
      : {}),
  }),
  vite: () => ({
    build: {
      minify: false,
    },
  }),
  webExt: {
    binaries: {
      firefox: '/Applications/Zen.app/Contents/MacOS/zen',
    },
  },
});

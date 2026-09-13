import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: 'Portage',
    description: 'Send the current tab to another device via Portage.',
    permissions: ['storage', 'tabs', 'alarms'],
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    // WXT derives `action`/`browser_action` itself from the popup entrypoint per build
    // target, then shallow-merges in whatever already sits under that same key — it never
    // converts a manifest()-supplied `action` into `browser_action` for MV2, so Firefox
    // needs default_icon set directly under `browser_action` or it's silently dropped.
    ...(browser === 'firefox'
      ? { browser_action: { default_icon: { 16: 'icons/action16.png', 24: 'icons/action24.png', 32: 'icons/action32.png' } } }
      : { action: { default_icon: { 16: 'icons/action16.png', 24: 'icons/action24.png', 32: 'icons/action32.png' } } }),
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
    plugins: [tailwindcss()],
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

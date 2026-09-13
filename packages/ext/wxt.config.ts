import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // The returned object's keys are the Chrome/Firefox manifest schema — an external,
  // fixed-casing contract (the browser reads `browser_specific_settings` etc. literally),
  // not something this codebase controls.
  /* eslint-disable camelcase */
  manifest: ({ browser }) => {
    const actionIcons = {
      16: 'icons/action16.png',
      24: 'icons/action24.png',
      32: 'icons/action32.png',
    };
    const base = {
      name: 'Portage',
      description: 'Send the current tab to another device via Portage.',
      permissions: ['storage', 'tabs', 'alarms'],
      icons: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png',
      },
    };

    // WXT derives `action`/`browser_action` itself from the popup entrypoint per build
    // target, then shallow-merges in whatever already sits under that same key — it never
    // converts a manifest()-supplied `action` into `browser_action` for MV2, so Firefox
    // needs default_icon set directly under `browser_action` or it's silently dropped.
    if (browser === 'firefox') {
      return {
        ...base,
        browser_action: { default_icon: actionIcons },
        browser_specific_settings: {
          gecko: {
            id: 'portage@lettieri.dev',
            strict_min_version: '142.0',
            data_collection_permissions: {
              required: ['browsingActivity'],
            },
          },
        },
      };
    }

    return {
      ...base,
      action: { default_icon: actionIcons },
    };
  },
  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      minify: false,
    },
  }),
});

import { defineConfig } from 'vitest/config';
import {
  cloudflareTest,
  cloudflarePool,
} from '@cloudflare/vitest-pool-workers';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        compatibilityDate: '2026-08-22',
      },
    }),
  ],
  test: {
    globals: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
  },
  pool: cloudflarePool({
    wrangler: { configPath: './wrangler.toml' },
    miniflare: {
      compatibilityDate: '2026-08-22',
    },
  }),
});

// Signs the add-on through AMO (unlisted channel) and downloads the signed .xpi
// into web-ext-artifacts/.
//
//   pnpm --filter ext sign
//
// Credentials come from WEB_EXT_API_KEY and WEB_EXT_API_SECRET. Real environment
// variables always win; the repo-root .env is a local convenience that fills in the
// gaps. That ordering is what makes this work unchanged in CI, where the secrets are
// injected by the runner and no .env exists.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const envFile = join(root, '.env');

const VARS = ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET'];

if (existsSync(envFile)) {
  // Anything already in the environment outranks the file.
  const preset = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => VARS.includes(k) && process.env[k]),
  );
  process.loadEnvFile(envFile);
  Object.assign(process.env, preset);

  const mode = statSync(envFile).mode & 0o077;
  if (mode !== 0) {
    console.warn(`warning: ${envFile} is readable by others — chmod 600 it`);
  }
}

const missing = VARS.filter((v) => !process.env[v]);
if (missing.length > 0) {
  console.error(`Missing ${missing.join(' and ')}.

Create credentials at https://addons.mozilla.org/en-US/developers/addon/api/key/
(the secret is shown only once), then either export them or copy .env.example to
.env at the repo root and fill them in.`);
  process.exit(1);
}

// Always rebuild first. Signing a stale .output/firefox-mv2 produces a signed .xpi that
// does not match the source you think you shipped, and nothing downstream will tell you.
console.log('building...');
execFileSync('pnpm', ['run', 'build:firefox'], { cwd: here, stdio: 'inherit' });

console.log('signing (unlisted)...');
execFileSync(
  'pnpm',
  [
    'exec',
    'web-ext',
    'sign',
    '--source-dir',
    '.output/firefox-mv2',
    '--channel',
    'unlisted',
    '--artifacts-dir',
    'web-ext-artifacts',
  ],
  { cwd: here, stdio: 'inherit' },
);

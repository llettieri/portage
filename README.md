# Portage

Cross-browser tab handoff between Arc (macOS) and Zen (Windows/macOS), via an encrypted
Cloudflare Durable Object hub. No accounts, no third-party service — the hub only ever sees
ciphertext.

See [`docs/SPEC.md`](docs/SPEC.md) for the full specification (what the system does and how it
behaves) and `CLAUDE.md` for the architecture, hard constraints, and the reasoning behind them.

## Packages

- `packages/protocol` — shared types, WebCrypto helpers (encrypt/decrypt, key derivation,
  pairing payload codec), and the shared reconnect-backoff policy
- `packages/hub` — Cloudflare Worker + Durable Object relay (pairing, auth, per-device inbox
  queue, abuse limits)
- `packages/ext` — WXT extension, one project built for two targets: MV3 for Arc (and other
  Chromium browsers), MV2 persistent background for Zen (and other Firefox forks)

## Install

Requires Node >=24 and pnpm (pinned via `packageManager` in `package.json`; run `corepack enable`
once per machine so `pnpm` resolves to the pinned version).

```bash
corepack enable
pnpm install
```

## Build everything

```bash
pnpm build
```

Runs each package's `build` script (`pnpm -r build`).

## Test

```bash
pnpm test
```

Runs `protocol`'s and `hub`'s test suites (crypto, pairing, routing, auth, inbox queue, abuse
limits), plus a type-check for `ext`. These automated checks are
necessary but not sufficient — see "Manual verification" below for what they cannot catch
(anything that only surfaces in a real browser: CORS, popup UI state, service-worker
lifecycle, key persistence across a restart).

## Deploy status

**Not yet deployed.** The hub now has real authentication and encryption (TASK-002 is
complete — pairing codes, per-device bearer tokens, AES-GCM with AAD-bound headers, a durable
per-device inbox queue), so nothing here blocks deploying on security grounds anymore. Deploy
is deliberately deferred as a separate, explicit step — run `pnpm --filter hub deploy` only
when you're ready to make the hub a real, publicly reachable Cloudflare Worker,
and re-run the full manual verification below against the deployed URL from two physically
separate machines afterward (not two profiles on one machine).

Until then: `pnpm dev:hub` (`wrangler dev` on localhost) is the only way this hub runs.

## Run the hub locally

```bash
pnpm dev:hub
```

Starts `wrangler dev` for `packages/hub`, listening on `http(s)://127.0.0.1:8787/room/:roomId`
for pairing/inbox HTTP routes and `ws://127.0.0.1:8787/room/:roomId` for the live relay. Room
IDs are generated client-side by the extension when you create a room — you never type one in.

## Load the Chromium build (Arc) unpacked

```bash
pnpm --filter ext build:chrome
```

Then in Arc: `chrome://extensions` → enable Developer Mode → "Load unpacked" → select
`packages/ext/.output/chrome-mv3`.

For a longer-lived local run with hot reload: `pnpm --filter ext dev:chrome`.

## Load the Firefox build (Zen) unpacked

```bash
pnpm --filter ext build:firefox
```

Then in Zen: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on" → select
`packages/ext/.output/firefox-mv2/manifest.json`.

For a longer-lived local run: `pnpm --filter ext dev:firefox` (wraps `web-ext run`, pointed at
a local Zen binary — see `packages/ext/wxt.config.ts`'s `webExt.binaries.firefox`).

## Pairing a new device

Both popups share the same flow:

1. **First device — "Create a new room":** enter a shared passphrase and the hub's host
   (`127.0.0.1:8787` for local dev — no `ws://` prefix; check **Use TLS** only if the hub is
   served over `wss`/`https`), click **Create a new room**. A pairing payload
   appears in a text box — copy it. This mints a fresh random room ID, derives an encryption
   key from the passphrase (PBKDF2, 600,000 iterations), and registers this device with the
   hub.
2. **Second device — "Join with pasted payload":** paste that payload, enter the **same**
   passphrase, click **Join with pasted payload**. The pairing code is single-use and expires
   after 5 minutes — if it's already been consumed or has expired, get a fresh one from step 1.
3. Both popups should show a green **connected** dot once paired.

**"Forget this room"** clears the paired room and returns to the create/join screen — use it
to re-pair, switch rooms, or recover from a bad pairing.

**"Unlock"** appears instead of the normal send/receive UI whenever a room is configured but
the encryption key isn't currently available — this happens after a real browser restart (or,
for the Chromium build, sometimes after Chrome kills an idle service worker) wipes the in-memory
key. Re-enter the same passphrase used originally; this re-derives the key locally from the
already-stored salt/iterations — no network round-trip, no new pairing exchange.

The passphrase itself is never sent to the hub and never leaves your own two browsers.

## Manual verification (acceptance criteria, must be checked by hand)

The automated suite cannot exercise real browser behavior. Before trusting a change to
`ext`/`hub`'s wire-facing code, re-check these by hand with both
extensions loaded and paired:

1. **Send/receive:** click "Send current tab" on a real `https://` page in one popup; confirm
   it shows up in the other's received list — and does **not** open on its own. Click "Open"
   there — only now should it navigate, in a new tab.
2. **Wrong passphrase fails loudly:** pair two devices with *different* passphrases (fresh
   pairing code each time — codes are single-use). Send a tab. Confirm the receiving popup
   shows the red "Couldn't decrypt a received message" banner, not a silently empty list.
3. **Offline delivery survives a real restart:** with both devices paired and connected, fully
   quit one browser (not just close the popup — quit the application). Send a tab from the
   other. Relaunch the quit browser — it should auto-reconnect; if its key was lost in the
   restart, Unlock with the same passphrase, then close/reopen the popup once to trigger a
   drain. The tab should appear without touching the sending side again.
4. **No plaintext in storage:** while `pnpm dev:hub` is running, after sending a couple of real
   handoffs, inspect the local Durable Object SQLite files under
   `packages/hub/.wrangler/state/v3/do/*/*.sqlite` — every `inbox` row's `envelope` column
   should contain only `iv`/`ciphertext` (base64), never a raw URL or title.

## Firefox build → AMO (SPIKE-1/SPIKE-1b/SPIKE-4, manual, human step)

`packages/ext`'s `browser_specific_settings.gecko.id` is **permanent** once first submitted to
AMO — currently `portage@lettieri.dev`. Confirm this is the value you want before submitting;
it cannot be changed afterwards.

Create `packages/ext/.env.submit` (see `.env.example`) with:

```
FIREFOX_JWT_ISSUER=...
FIREFOX_JWT_SECRET=...
FIREFOX_CHANNEL=unlisted
```

Get the issuer/secret pair from https://addons.mozilla.org/en-US/developers/addon/api/key/.
Then, from `packages/ext`:

```bash
pnpm run zip:firefox           # wxt build -b firefox + zips extension and sources together
pnpm run submit:firefox:dry-run   # sanity-checks auth against the addon, uploads nothing
pnpm run submit:firefox            # uploads and submits as an unlisted add-on
```

AMO permanently rejects re-uploading a version string, even a deleted one — bump the `version`
field in `packages/ext/package.json` before each new submission; nothing does this
automatically.

`wxt submit` does not download a signed `.xpi` locally (SPIKE-4) — after submitting, get it
from the AMO developer hub link printed in the terminal output, then install it in Zen
permanently to confirm it survives a browser restart.

## Not yet done

No presence (live tab-list sync) or stash (saved-links list) — those are separate features,
out of scope for TASK-001/TASK-002. No per-device recipient picker — "send current tab" always
addresses every other device in the room. Deploy and the associated two-machine verification
(see "Deploy status" above).

## License

[CC BY-NC-SA 4.0](LICENSE) — free to use, modify, and redistribute for non-commercial purposes,
with attribution, as long as derivative work carries the same license.
